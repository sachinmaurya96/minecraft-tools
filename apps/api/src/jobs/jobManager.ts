import sharp from 'sharp';
import { z } from 'zod';
import {
  BoneSchema,
  CropRectSchema,
  CubeSchema,
  LIMITS,
  MeshResolutionSchema,
  RotationSchema,
  TERMINAL_JOB_STATUSES,
  type ErrorCode,
  type GenerationJob,
  type JobStatus,
  type JobType,
  type ProviderCapabilities,
} from '@blockwright/shared';
import { validateSkinPng } from '@blockwright/minecraft-skin';
import { packAtlas, validateEntityModel } from '@blockwright/bedrock-export';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import type { ExportService } from '../exporters/exportService.js';
import { AppError, notFound } from '../http/errors.js';
import type { CapabilitiesService } from '../services/capabilities.js';
import type { ImageService } from '../services/images.js';
import type { MeshService } from '../services/meshes.js';
import type { ProjectService } from '../services/projects.js';
import { WorkerError, type WorkerClient, type WorkerFile } from '../services/workerClient.js';
import type { BaseRecord, FsStore } from '../storage/store.js';

export const SkinGenerateParams = z.object({
  projectId: z.string(),
  compositeAssetId: z.string(),
});
export const MeshGenerateParams = z.object({
  projectId: z.string().optional(),
  imageAssetId: z.string(),
  rotationDegrees: RotationSchema.default(0),
  crop: CropRectSchema.optional(),
  removeBackground: z.boolean().default(true),
  foregroundRatio: z.number().min(0.5).max(1).default(0.85),
  mcResolution: z.union([z.literal(128), z.literal(192), z.literal(256)]).default(192),
});
export const MeshToCuboidsParams = z.object({
  projectId: z.string().optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('artifact'), artifactId: z.string() }),
    z.object({ kind: z.literal('mesh-asset'), assetId: z.string() }),
  ]),
  resolution: MeshResolutionSchema.default('medium'),
  maxCubes: z.number().int().min(8).max(LIMITS.maxCubes).default(300),
});

const JOB_DEF: Record<JobType, { providerId: string; kind: 'skin' | 'entity'; workerType: string; params: z.ZodType }> = {
  'skin-generate': { providerId: 'sking-v101c', kind: 'skin', workerType: 'sking', params: SkinGenerateParams },
  'mesh-generate': { providerId: 'triposr', kind: 'entity', workerType: 'triposr', params: MeshGenerateParams },
  'mesh-to-cuboids': { providerId: 'mesh-cuboids-v1', kind: 'entity', workerType: 'mesh_to_cuboids', params: MeshToCuboidsParams },
};

export interface JobRecord extends BaseRecord, GenerationJob {
  params: Record<string, unknown>;
  workerJobId?: string;
}

export function toJobView(r: JobRecord): GenerationJob {
  const { ownerId: _o, expiresAt: _e, params: _p, workerJobId: _w, ...view } = r;
  return view;
}

const ACTIVE: JobStatus[] = ['queued', 'preprocessing', 'running', 'validating'];

class JobFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const CuboidResultSchema = z.object({
  bones: z.array(BoneSchema).min(1).max(LIMITS.maxBones),
  cubes: z.array(CubeSchema).min(1).max(LIMITS.maxCubes),
  stats: z.record(z.string(), z.unknown()).default({}),
  warnings: z.array(z.string()).default([]),
});

export interface JobManagerDeps {
  config: Config;
  store: FsStore;
  worker: WorkerClient;
  capabilities: CapabilitiesService;
  images: ImageService;
  meshes: MeshService;
  projects: ProjectService;
  exports: ExportService;
  logger: Logger;
}

export class JobManager {
  private running = new Set<string>();
  private queue: string[] = [];
  private cancelRequested = new Set<string>();
  private stopped = false;
  private deletingOwners = new Set<string>();
  pollIntervalMs = 1000;

  constructor(private readonly d: JobManagerDeps) {}

  /** Restart recovery: queued jobs resume; jobs that were mid-flight fail cleanly (never stay "running"). */
  async init(): Promise<void> {
    const jobs = await this.d.store.listRecords<JobRecord>('jobs');
    for (const job of jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (job.status === 'queued') this.queue.push(job.id);
      else if (ACTIVE.includes(job.status)) {
        if (job.workerJobId) await this.d.worker.cancelJob(job.workerJobId).catch(() => undefined);
        await this.finish(job, 'failed', { code: 'JOB_FAILED', message: 'Interrupted by a server restart. Your project was not changed; please retry.' });
      }
    }
    this.tick();
  }

  stop(): void {
    this.stopped = true;
  }

  private async save(job: JobRecord, patch: Partial<JobRecord>): Promise<JobRecord> {
    Object.assign(job, patch, { updatedAt: this.d.store.nowIso() });
    await this.d.store.putRecord('jobs', job);
    return job;
  }

  private async finish(
    job: JobRecord,
    status: 'ready' | 'failed' | 'cancelled',
    extra: { code?: ErrorCode; message?: string; result?: Record<string, unknown>; artifactIds?: string[] } = {},
  ) {
    await this.save(job, {
      status,
      progressStage: status === 'ready' ? 'Done' : status === 'cancelled' ? 'Cancelled' : 'Failed',
      finishedAt: this.d.store.nowIso(),
      ...(extra.code ? { errorCode: extra.code } : {}),
      ...(extra.message ? { errorMessage: extra.message } : {}),
      ...(extra.result ? { result: extra.result } : {}),
      ...(extra.artifactIds ? { artifactIds: extra.artifactIds } : {}),
    });
  }

  private unavailableError(p: ProviderCapabilities | undefined): AppError {
    if (!p) return new AppError(503, 'MODEL_NOT_CONFIGURED', 'This generator is not available.');
    const reason = p.reason ?? 'This generator is not available right now.';
    if (p.status === 'disabled') return new AppError(503, 'MODEL_NOT_CONFIGURED', reason);
    if (/not reachable/i.test(reason)) return new AppError(503, 'WORKER_UNAVAILABLE', reason);
    if (/gpu|cuda/i.test(reason)) return new AppError(503, 'GPU_UNAVAILABLE', reason);
    return new AppError(503, 'MODEL_NOT_CONFIGURED', reason);
  }

  async create(ownerId: string, type: JobType, rawParams: unknown): Promise<GenerationJob> {
    if (this.deletingOwners.has(ownerId)) throw new AppError(409, 'BAD_REQUEST', 'Your data is being deleted. Please wait.');
    const def = JOB_DEF[type];
    const params = def.params.parse(rawParams) as Record<string, unknown>;
    this.d.capabilities.invalidate();
    const provider = await this.d.capabilities.isReady(def.providerId);
    if (!provider?.available) throw this.unavailableError(provider);
    // validate inputs up front so obviously bad requests fail fast (and again at run time)
    await this.checkInputs(ownerId, type, params);
    const all = await this.d.store.listRecords<JobRecord>('jobs');
    if (all.filter((j) => j.ownerId === ownerId && ACTIVE.includes(j.status)).length >= this.d.config.MAX_JOBS_PER_SESSION) {
      throw new AppError(429, 'LIMIT_EXCEEDED', `You already have ${this.d.config.MAX_JOBS_PER_SESSION} generation job(s) running; wait for them to finish.`);
    }
    if (this.queue.length >= this.d.config.MAX_QUEUED_JOBS) {
      throw new AppError(429, 'LIMIT_EXCEEDED', 'The generation queue is full. Please try again later.');
    }
    const now = this.d.store.nowIso();
    if (this.deletingOwners.has(ownerId)) throw new AppError(409, 'BAD_REQUEST', 'Your data is being deleted. Please wait.');
    const job: JobRecord = {
      id: this.d.store.newId('jobs'),
      ownerId,
      type,
      kind: def.kind,
      mode: type === 'mesh-to-cuboids' ? 'manual' : 'ai',
      providerId: def.providerId,
      status: 'queued',
      progressStage: 'Waiting in queue',
      params,
      ...(typeof params.projectId === 'string' ? { projectId: params.projectId } : {}),
      createdAt: now,
      updatedAt: now,
      expiresAt: this.d.store.expiryFromNow(this.d.config.ttlMs),
    };
    await this.d.store.putRecord('jobs', job);
    this.queue.push(job.id);
    this.tick();
    return toJobView(job);
  }

  async get(ownerId: string, id: unknown): Promise<GenerationJob> {
    const job = await this.d.store.getOwned<JobRecord>('jobs', id, ownerId);
    if (!job) throw notFound('Job');
    return toJobView(job);
  }

  async cancel(ownerId: string, id: unknown): Promise<GenerationJob> {
    const job = await this.d.store.getOwned<JobRecord>('jobs', id, ownerId);
    if (!job) throw notFound('Job');
    if (TERMINAL_JOB_STATUSES.includes(job.status)) throw new AppError(409, 'JOB_NOT_CANCELLABLE', `Job is already ${job.status}.`);
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== job.id);
      await this.finish(job, 'cancelled');
    } else {
      this.cancelRequested.add(job.id);
      if (job.workerJobId) await this.d.worker.cancelJob(job.workerJobId).catch(() => undefined);
    }
    return toJobView(job);
  }

  /** Drain this owner's jobs before deleting records, so a runner cannot recreate them. */
  async withOwnerJobsStopped<T>(ownerId: string, action: () => Promise<T>): Promise<T> {
    if (this.deletingOwners.has(ownerId)) throw new AppError(409, 'BAD_REQUEST', 'Deletion is already in progress.');
    this.deletingOwners.add(ownerId);
    try {
      const jobs = (await this.d.store.listRecords<JobRecord>('jobs', true)).filter((job) => job.ownerId === ownerId);
      const ids = new Set(jobs.map((job) => job.id));
      this.queue = this.queue.filter((id) => !ids.has(id));
      for (const job of jobs) {
        this.cancelRequested.add(job.id);
        if (job.workerJobId) await this.d.worker.cancelJob(job.workerJobId).catch(() => undefined);
      }
      while ([...ids].some((id) => this.running.has(id))) await new Promise((resolve) => setTimeout(resolve, 25));
      for (const job of jobs) {
        if (job.workerJobId) await this.d.worker.deleteJob(job.workerJobId).catch(() => undefined);
        this.cancelRequested.delete(job.id);
      }
      return await action();
    } finally {
      this.deletingOwners.delete(ownerId);
    }
  }

  private tick(): void {
    if (this.stopped) return;
    while (this.running.size < this.d.config.MAX_RUNNING_JOBS && this.queue.length) {
      const id = this.queue.shift()!;
      this.running.add(id);
      void this.run(id)
        .catch((err) => this.d.logger.error({ err, jobId: id }, 'job runner crashed'))
        .finally(() => {
          this.running.delete(id);
          this.cancelRequested.delete(id);
          this.tick();
        });
    }
  }

  /** Wait until no job is running or queued (tests). */
  async idle(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (this.running.size || this.queue.length) {
      if (Date.now() - start > timeoutMs) throw new Error('JobManager did not become idle');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // ------------------------------------------------------------------ inputs

  private async checkInputs(ownerId: string, type: JobType, params: Record<string, unknown>): Promise<void> {
    await this.prepare(ownerId, type, params);
  }

  private async prepare(ownerId: string, type: JobType, params: Record<string, unknown>): Promise<WorkerFile[]> {
    if (type === 'skin-generate') {
      const p = params as z.infer<typeof SkinGenerateParams>;
      const project = await this.d.projects.get(ownerId, p.projectId);
      if (project.project.type !== 'skin') throw new AppError(400, 'BAD_REQUEST', 'Skin generation needs a skin project.');
      const { record, bytes } = await this.d.images.getBytes(ownerId, p.compositeAssetId);
      if (record.purpose !== 'composite' || record.mime !== 'image/png') {
        throw new AppError(400, 'BAD_IMAGE', 'Upload the reviewed composite as a PNG composite image.');
      }
      if (record.width !== record.height || record.width < 256 || record.width > 4096 || record.width % 2) {
        throw new AppError(400, 'BAD_IMAGE', `Sking needs an even, square composite between 256 and 4096 px; this one is ${record.width}x${record.height}.`);
      }
      return [{ field: 'composite', filename: 'composite.png', contentType: 'image/png', bytes }];
    }
    if (type === 'mesh-generate') {
      const p = params as z.infer<typeof MeshGenerateParams>;
      if (p.projectId) await this.d.projects.get(ownerId, p.projectId);
      const { record, bytes } = await this.d.images.getBytes(ownerId, p.imageAssetId);
      if (record.purpose !== 'reference') throw new AppError(400, 'BAD_IMAGE', 'Use one of your reference photos.');
      let img = sharp(bytes).rotate(p.rotationDegrees);
      if (p.crop) {
        const meta = await sharp(bytes).rotate(p.rotationDegrees).toBuffer({ resolveWithObject: true });
        const { width, height } = meta.info;
        const left = Math.min(p.crop.x, width - 1);
        const top = Math.min(p.crop.y, height - 1);
        img = sharp(meta.data).extract({ left, top, width: Math.min(p.crop.width, width - left), height: Math.min(p.crop.height, height - top) });
      }
      const png = await img.png().toBuffer();
      return [{ field: 'image', filename: 'image.png', contentType: 'image/png', bytes: png }];
    }
    const p = params as z.infer<typeof MeshToCuboidsParams>;
    if (p.projectId) {
      const project = await this.d.projects.get(ownerId, p.projectId);
      if (project.project.type !== 'entity') throw new AppError(400, 'BAD_REQUEST', 'Mesh conversion needs an entity project.');
    }
    if (p.source.kind === 'artifact') {
      const { record, bytes } = await this.d.exports.getArtifact(ownerId, p.source.artifactId);
      if (record.kind !== 'raw-mesh') throw new AppError(400, 'BAD_REQUEST', 'Choose a generated mesh to convert.');
      return [{ field: 'mesh', filename: record.filename.endsWith('.obj') ? 'mesh.obj' : 'mesh.glb', contentType: 'application/octet-stream', bytes }];
    }
    const { record, bytes } = await this.d.meshes.getBytes(ownerId, p.source.assetId);
    return [{ field: 'mesh', filename: `mesh.${record.format}`, contentType: 'application/octet-stream', bytes }];
  }

  // ------------------------------------------------------------------ runner

  private async run(id: string): Promise<void> {
    const job = await this.d.store.getRecord<JobRecord>('jobs', id);
    if (!job || job.status !== 'queued') return;
    const deadline = Date.now() + this.d.config.JOB_TIMEOUT_S * 1000;
    try {
      await this.save(job, { status: 'preprocessing', progressStage: 'Preparing input', startedAt: this.d.store.nowIso() });
      const files = await this.prepare(job.ownerId, job.type, job.params);
      const def = JOB_DEF[job.type];
      const workerParams: Record<string, unknown> = { ...job.params };
      const wjob = await this.d.worker.submitJob(def.workerType, workerParams, files);
      await this.save(job, { status: 'running', progressStage: wjob.stage || 'Submitted to worker', workerJobId: wjob.id });

      let failures = 0;
      for (;;) {
        if (this.cancelRequested.has(job.id)) {
          await this.d.worker.cancelJob(wjob.id).catch(() => undefined);
          await this.finish(job, 'cancelled');
          return;
        }
        if (Date.now() > deadline) {
          await this.d.worker.cancelJob(wjob.id).catch(() => undefined);
          throw new JobFailure('JOB_FAILED', `Timed out after ${this.d.config.JOB_TIMEOUT_S} s.`);
        }
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        let w;
        try {
          w = await this.d.worker.getJob(wjob.id);
          failures = 0;
        } catch (err) {
          if (err instanceof WorkerError && err.status === 404) throw new JobFailure('JOB_FAILED', 'The worker lost this job (it may have restarted).');
          if (++failures >= 10) throw new JobFailure('WORKER_UNAVAILABLE', 'Lost contact with the AI worker.');
          continue;
        }
        if (w.stage && w.stage !== job.progressStage) await this.save(job, { progressStage: w.stage });
        if (w.status === 'ready') {
          await this.save(job, { status: 'validating', progressStage: 'Validating output' });
          const { result, artifactIds } = await this.collect(job, w.id, w.artifacts, w.result ?? {});
          await this.finish(job, 'ready', { result, artifactIds });
          return;
        }
        if (w.status === 'failed') throw new JobFailure((w.error_code as ErrorCode) || 'JOB_FAILED', w.error_message || 'Generation failed.');
        if (w.status === 'cancelled') {
          await this.finish(job, 'cancelled');
          return;
        }
      }
    } catch (err) {
      const code: ErrorCode =
        err instanceof JobFailure ? err.code : err instanceof AppError ? err.code : err instanceof WorkerError ? 'WORKER_UNAVAILABLE' : 'JOB_FAILED';
      const message = err instanceof Error ? err.message : 'Generation failed.';
      if (!(err instanceof JobFailure) && !(err instanceof AppError)) this.d.logger.warn({ err, jobId: job.id }, 'job failed');
      await this.finish(job, 'failed', { code, message });
    } finally {
      // The API now owns any validated result. Remove the worker's input/output copies.
      if (job.workerJobId)
        await this.d.worker.deleteJob(job.workerJobId).catch((err) => this.d.logger.warn({ err, jobId: job.id }, 'worker scratch cleanup deferred to TTL'));
    }
  }

  /** Download, validate and store the worker's outputs. Nothing unvalidated becomes an artifact. */
  private async collect(job: JobRecord, workerJobId: string, names: string[], workerResult: Record<string, unknown>) {
    const fetchOne = async (name: string, max: number) => {
      if (!names.includes(name)) throw new JobFailure('JOB_FAILED', `Worker did not produce ${name}.`);
      return this.d.worker.downloadArtifact(workerJobId, name, max);
    };
    if (job.type === 'skin-generate') {
      const png = await fetchOne('skin.png', 1024 * 1024);
      const project = await this.d.projects.get(job.ownerId, job.params.projectId);
      const model = project.project.type === 'skin' ? project.project.model : 'classic';
      const { report } = validateSkinPng(png, model);
      // reject unusable output; fixable issues (e.g. transparent base pixels) are reported and left to the editor
      const fatal = report.issues.some((i) => ['NOT_PNG', 'CORRUPT_PNG', 'BAD_DIMENSIONS', 'LEGACY_64x32'].includes(i.code));
      if (fatal) throw new JobFailure('JOB_FAILED', 'The model output is not a valid 64x64 PNG skin.');
      const art = await this.d.exports.saveArtifact(job.ownerId, {
        kind: 'skin-png',
        filename: 'sking-result.png',
        mime: 'image/png',
        bytes: png,
        minecraftNative: true,
        label: 'AI-generated skin (Sking SKING_DDJ_v101c). Review it in the editor before exporting.',
        projectId: String(job.params.projectId),
        extra: { jobId: job.id, origin: 'ai', providerId: 'sking-v101c' },
      });
      return { result: { ...workerResult, skinArtifactId: art.id, validation: report }, artifactIds: [art.id] };
    }
    if (job.type === 'mesh-generate') {
      const glb = await fetchOne('mesh.glb', this.d.config.maxMeshBytes);
      if (Buffer.from(glb.subarray(0, 4)).toString('latin1') !== 'glTF') throw new JobFailure('JOB_FAILED', 'Worker output is not a binary glTF mesh.');
      const art = await this.d.exports.saveArtifact(job.ownerId, {
        kind: 'raw-mesh',
        filename: 'triposr-mesh.glb',
        mime: 'model/gltf-binary',
        bytes: glb,
        minecraftNative: false,
        label: 'Raw generic mesh from TripoSR (.glb). NOT a Minecraft model: convert it to cuboids before export.',
        ...(job.params.projectId ? { projectId: String(job.params.projectId) } : {}),
        extra: { jobId: job.id, origin: 'ai', providerId: 'triposr' },
      });
      return { result: { ...workerResult, meshArtifactId: art.id }, artifactIds: [art.id] };
    }
    // mesh-to-cuboids
    const raw = await fetchOne('cuboids.json', 8 * 1024 * 1024);
    let parsed;
    try {
      parsed = CuboidResultSchema.parse(JSON.parse(Buffer.from(raw).toString('utf8')));
    } catch {
      throw new JobFailure('JOB_FAILED', 'Worker returned an invalid cuboid model.');
    }
    const report = validateEntityModel(parsed);
    if (!report.ok)
      throw new JobFailure(report.issues.some((i) => i.code === 'MODEL_TOO_COMPLEX') ? 'MODEL_TOO_COMPLEX' : 'JOB_FAILED', report.issues[0]!.message);
    try {
      packAtlas(parsed.cubes);
    } catch (err) {
      throw new JobFailure('MODEL_TOO_COMPLEX', (err as Error).message);
    }
    // provenance follows the mesh: TripoSR output -> AI; user-supplied mesh -> import
    const src = job.params.source as z.infer<typeof MeshToCuboidsParams>['source'];
    let origin: 'ai' | 'import' = 'import';
    let sourceMeshArtifactId: string | undefined;
    if (src.kind === 'artifact') {
      const { record } = await this.d.exports.getArtifact(job.ownerId, src.artifactId);
      origin = record.origin === 'ai' ? 'ai' : 'import';
      sourceMeshArtifactId = record.id;
    }
    const art = await this.d.exports.saveArtifact(job.ownerId, {
      kind: 'cuboid-model',
      filename: 'cuboid-model.json',
      mime: 'application/json',
      bytes: Buffer.from(JSON.stringify({ bones: parsed.bones, cubes: parsed.cubes })),
      minecraftNative: false,
      label: 'Converted cuboid model (apply it to your entity project, then export)',
      ...(job.params.projectId ? { projectId: String(job.params.projectId) } : {}),
      extra: {
        jobId: job.id,
        origin,
        providerId: origin === 'ai' ? 'triposr+mesh-cuboids-v1' : 'mesh-cuboids-v1',
        ...(sourceMeshArtifactId ? { sourceMeshArtifactId } : {}),
      },
    });
    return {
      result: { ...workerResult, stats: parsed.stats, warnings: parsed.warnings, cuboidArtifactId: art.id, cubeCount: parsed.cubes.length, origin },
      artifactIds: [art.id],
    };
  }
}

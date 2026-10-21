import { afterEach, describe, expect, it } from 'vitest';
import { bytesToBase64, encodeRgbaPng } from '@blockwright/shared';
import { createTemplateSkin, createUvDebugSkin } from '@blockwright/minecraft-skin';
import { HUMANOID_TEMPLATE } from '@blockwright/bedrock-export';
import type { JobRecord } from '../jobs/jobManager.js';
import { JobManager } from '../jobs/jobManager.js';
import { makeApp, newSession, png, startFakeWorker, type FakeWorker } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>> | undefined;
let worker: FakeWorker | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  await worker?.close();
  ctx = undefined;
  worker = undefined;
});

const prov = { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] };

/** Minimal structurally valid binary glTF container (header + JSON chunk). */
function tinyGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }).padEnd(28, ' '));
  const header = Buffer.alloc(12);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(json.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length, 8);
  return Buffer.concat([header, chunkHeader, json]);
}

async function waitJob(token: string, id: string, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const res = await ctx!.http.get(`/api/v1/jobs/${id}`).set('X-Session-Token', token).expect(200);
    const job = res.body.data.job;
    if (['ready', 'failed', 'cancelled'].includes(job.status)) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`job stuck in ${job.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function skinProject(token: string) {
  const res = await ctx!.http
    .post('/api/v1/projects/skin')
    .set('X-Session-Token', token)
    .send({
      state: { displayName: 'S', model: 'classic', provenance: prov, references: [] },
      skinPngBase64: bytesToBase64(encodeRgbaPng(createTemplateSkin('classic'))),
    })
    .expect(201);
  return res.body.data.project;
}

async function entityProject(token: string) {
  const res = await ctx!.http
    .post('/api/v1/projects/entity')
    .set('X-Session-Token', token)
    .send({
      state: {
        displayName: 'E',
        identifier: 'ns_test:thing',
        templateId: 'humanoid',
        ...HUMANOID_TEMPLATE.build(),
        behavior: { profile: 'static', health: 10, movementSpeed: 0.25 },
        provenance: prov,
        references: [],
      },
    })
    .expect(201);
  return res.body.data.project;
}

const cuboids = (n: number) =>
  Buffer.from(
    JSON.stringify({
      bones: [{ id: 'root', name: 'root', pivot: [0, 0, 0] }],
      cubes: Array.from({ length: n }, (_, i) => ({ id: `v${i}`, boneId: 'root', origin: [i, 0, 0], size: [1, 2, 1], color: '#33aa55' })),
      stats: { cube_count: n },
      warnings: ['Converted to a static one-bone model.'],
    }),
  );

describe('job creation is refused truthfully when a provider cannot run', () => {
  it('worker unreachable -> WORKER_UNAVAILABLE; flag off -> MODEL_NOT_CONFIGURED', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const e = await entityProject(t);
    const res = await ctx.http
      .post('/api/v1/jobs/mesh-to-cuboids')
      .set('X-Session-Token', t)
      .send({ projectId: e.id, source: { kind: 'mesh-asset', assetId: 'img_x' } })
      .expect(503);
    expect(res.body.error.code).toBe('WORKER_UNAVAILABLE');
    const s = await skinProject(t);
    const sk = await ctx.http.post('/api/v1/jobs/skin-generate').set('X-Session-Token', t).send({ projectId: s.id, compositeAssetId: 'img_x' }).expect(503);
    expect(sk.body.error.code).toBe('MODEL_NOT_CONFIGURED');
  });

  it('enabled but no GPU on the worker -> GPU_UNAVAILABLE with the worker reason', async () => {
    worker = await startFakeWorker();
    worker.providers['sking-v101c'] = { status: 'unavailable', code: 'GPU_UNAVAILABLE', reason: 'Sking requires an NVIDIA CUDA GPU; this worker has none.' };
    ctx = await makeApp({ ENABLE_SKING: 'true' }, { workerUrl: worker.url });
    const t = await newSession(ctx.app);
    const s = await skinProject(t);
    const res = await ctx.http.post('/api/v1/jobs/skin-generate').set('X-Session-Token', t).send({ projectId: s.id, compositeAssetId: 'img_x' }).expect(503);
    expect(res.body.error).toMatchObject({ code: 'GPU_UNAVAILABLE' });
    expect(res.body.error.message).toMatch(/CUDA/);
    expect(worker.received).toHaveLength(0);
  });
});

describe('Sking job flow (fake worker, real API pipeline)', () => {
  it('validates the composite, runs, stores a validated artifact and applies it with server-attested AI provenance', async () => {
    worker = await startFakeWorker();
    worker.providers['sking-v101c'] = { status: 'ready' };
    const result = createUvDebugSkin('classic');
    worker.scripts.sking = {
      artifacts: { 'skin.png': Buffer.from(encodeRgbaPng(result)) },
      result: { model_version: 'SKING_DDJ_v101c', elapsed_s: 1.5 },
      pollsUntilDone: 3,
    };
    ctx = await makeApp({ ENABLE_SKING: 'true' }, { workerUrl: worker.url });
    const t = await newSession(ctx.app);
    const s = await skinProject(t);
    const upload = async (buf: Buffer, purpose: string) =>
      (await ctx!.http.post('/api/v1/assets/images').set('X-Session-Token', t).field('purpose', purpose).attach('file', buf, 'c.png').expect(201)).body.data
        .asset;

    const notSquare = await upload(await png(512, 256), 'composite');
    const bad = await ctx.http
      .post('/api/v1/jobs/skin-generate')
      .set('X-Session-Token', t)
      .send({ projectId: s.id, compositeAssetId: notSquare.id })
      .expect(400);
    expect(bad.body.error.code).toBe('BAD_IMAGE');
    const reference = await upload(await png(512, 512), 'reference');
    await ctx.http.post('/api/v1/jobs/skin-generate').set('X-Session-Token', t).send({ projectId: s.id, compositeAssetId: reference.id }).expect(400);

    const composite = await upload(await png(512, 512), 'composite');
    const created = await ctx.http
      .post('/api/v1/jobs/skin-generate')
      .set('X-Session-Token', t)
      .send({ projectId: s.id, compositeAssetId: composite.id })
      .expect(202);
    expect(created.body.data.job).toMatchObject({ status: 'queued', mode: 'ai', providerId: 'sking-v101c' });
    const job = await waitJob(t, created.body.data.job.id);
    expect(job.status).toBe('ready');
    expect(worker.received[0]).toMatchObject({ type: 'sking', files: ['composite'] });
    const artifactId = job.result.skinArtifactId as string;

    // other users cannot apply or read it
    const other = await newSession(ctx.app);
    await ctx.http.get(`/api/v1/jobs/${job.id}`).set('X-Session-Token', other).expect(404);

    const applied = await ctx.http.post(`/api/v1/projects/${s.id}/apply`).set('X-Session-Token', t).send({ baseRevision: 1, artifactId }).expect(200);
    expect(applied.body.data.project).toMatchObject({
      revision: 2,
      generationMode: 'ai',
      provenance: { origin: 'ai', providerId: 'sking-v101c', jobId: job.id },
    });
    // editing keeps AI provenance but marks it edited; the client cannot remove the server fields
    const edited = await ctx.http
      .put(`/api/v1/projects/${s.id}`)
      .set('X-Session-Token', t)
      .send({
        baseRevision: 2,
        state: {
          displayName: 'S',
          model: 'classic',
          provenance: { origin: 'ai', editedAfterGeneration: true, inferredRegions: [], notes: [] },
          references: [],
        },
      })
      .expect(200);
    expect(edited.body.data.project.provenance).toMatchObject({ origin: 'ai', providerId: 'sking-v101c', editedAfterGeneration: true });
  });

  it('propagates worker failures without touching the project', async () => {
    worker = await startFakeWorker();
    worker.providers['sking-v101c'] = { status: 'ready' };
    worker.scripts.sking = { fail: { code: 'JOB_FAILED', message: 'The Sking launcher exited with code 3.' } };
    ctx = await makeApp({ ENABLE_SKING: 'true' }, { workerUrl: worker.url });
    const t = await newSession(ctx.app);
    const s = await skinProject(t);
    const composite = (
      await ctx.http
        .post('/api/v1/assets/images')
        .set('X-Session-Token', t)
        .field('purpose', 'composite')
        .attach('file', await png(256, 256), 'c.png')
        .expect(201)
    ).body.data.asset;
    const job = await waitJob(
      t,
      (await ctx.http.post('/api/v1/jobs/skin-generate').set('X-Session-Token', t).send({ projectId: s.id, compositeAssetId: composite.id }).expect(202)).body
        .data.job.id,
    );
    expect(job).toMatchObject({ status: 'failed', errorCode: 'JOB_FAILED', errorMessage: 'The Sking launcher exited with code 3.' });
    expect((await ctx.http.get(`/api/v1/projects/${s.id}`).set('X-Session-Token', t)).body.data.project.revision).toBe(1);
  });
});

describe('mesh -> cuboids job flow', () => {
  async function setup(script: FakeWorker['scripts'][string], env: Record<string, string> = {}) {
    worker = await startFakeWorker();
    worker.scripts.mesh_to_cuboids = script;
    ctx = await makeApp(env, { workerUrl: worker.url });
    const t = await newSession(ctx.app);
    const e = await entityProject(t);
    const mesh = (await ctx.http.post('/api/v1/assets/meshes').set('X-Session-Token', t).attach('file', tinyGlb(), 'm.glb').expect(201)).body.data.mesh;
    return { t, e, mesh };
  }

  it('converts an uploaded mesh and applies it with "import" provenance', async () => {
    const { t, e, mesh } = await setup({ artifacts: { 'cuboids.json': cuboids(5) } });
    const created = await ctx!.http
      .post('/api/v1/jobs/mesh-to-cuboids')
      .set('X-Session-Token', t)
      .send({ projectId: e.id, source: { kind: 'mesh-asset', assetId: mesh.id }, resolution: 'low' })
      .expect(202);
    const job = await waitJob(t, created.body.data.job.id);
    expect(job).toMatchObject({ status: 'ready', mode: 'manual' });
    expect(job.result).toMatchObject({ cubeCount: 5, origin: 'import' });
    expect(worker!.received[0]!.params).toMatchObject({ resolution: 'low', maxCubes: 300 });
    const applied = await ctx!.http
      .post(`/api/v1/projects/${e.id}/apply`)
      .set('X-Session-Token', t)
      .send({ baseRevision: 1, artifactId: job.result.cuboidArtifactId })
      .expect(200);
    expect(applied.body.data.project.cubes).toHaveLength(5);
    expect(applied.body.data.project.provenance).toMatchObject({ origin: 'import', providerId: 'mesh-cuboids-v1' });
    // stale revision is refused
    await ctx!.http
      .post(`/api/v1/projects/${e.id}/apply`)
      .set('X-Session-Token', t)
      .send({ baseRevision: 1, artifactId: job.result.cuboidArtifactId })
      .expect(409);
  });

  it('rejects invalid or over-complex worker output (never stored as a result)', async () => {
    const { t, e, mesh } = await setup({ artifacts: { 'cuboids.json': Buffer.from('{"bones": "nope"}') } });
    const job = await waitJob(
      t,
      (
        await ctx!.http
          .post('/api/v1/jobs/mesh-to-cuboids')
          .set('X-Session-Token', t)
          .send({ projectId: e.id, source: { kind: 'mesh-asset', assetId: mesh.id } })
          .expect(202)
      ).body.data.job.id,
    );
    expect(job).toMatchObject({ status: 'failed', errorCode: 'JOB_FAILED' });
    expect(job.artifactIds).toBeUndefined();
    worker!.scripts.mesh_to_cuboids = { artifacts: { 'cuboids.json': cuboids(513) } };
    const job2 = await waitJob(
      t,
      (
        await ctx!.http
          .post('/api/v1/jobs/mesh-to-cuboids')
          .set('X-Session-Token', t)
          .send({ projectId: e.id, source: { kind: 'mesh-asset', assetId: mesh.id } })
          .expect(202)
      ).body.data.job.id,
    );
    expect(job2.status).toBe('failed');
  });

  it('cancels a running job on the worker and enforces the per-session job limit', async () => {
    const { t, e, mesh } = await setup({ pollsUntilDone: Infinity }, { MAX_JOBS_PER_SESSION: '1' });
    const body = { projectId: e.id, source: { kind: 'mesh-asset', assetId: mesh.id } };
    const id = (await ctx!.http.post('/api/v1/jobs/mesh-to-cuboids').set('X-Session-Token', t).send(body).expect(202)).body.data.job.id;
    const limited = await ctx!.http.post('/api/v1/jobs/mesh-to-cuboids').set('X-Session-Token', t).send(body).expect(429);
    expect(limited.body.error.code).toBe('LIMIT_EXCEEDED');
    for (let i = 0; i < 100 && worker!.received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    await ctx!.http.post(`/api/v1/jobs/${id}/cancel`).set('X-Session-Token', t).expect(200);
    const job = await waitJob(t, id);
    expect(job.status).toBe('cancelled');
    expect(worker!.cancelled.length).toBeGreaterThan(0);
    await ctx!.http.post(`/api/v1/jobs/${id}/cancel`).set('X-Session-Token', t).expect(409);
  });

  it('times out jobs that never finish', async () => {
    const { t, e, mesh } = await setup({ pollsUntilDone: Infinity }, { JOB_TIMEOUT_S: '10' });
    const id = (
      await ctx!.http
        .post('/api/v1/jobs/mesh-to-cuboids')
        .set('X-Session-Token', t)
        .send({ projectId: e.id, source: { kind: 'mesh-asset', assetId: mesh.id } })
        .expect(202)
    ).body.data.job.id;
    const job = await waitJob(t, id, 20000);
    expect(job).toMatchObject({ status: 'failed', errorCode: 'JOB_FAILED' });
    expect(job.errorMessage).toMatch(/Timed out/);
  }, 30000);

  it('deletes a session during a running job without recreating its private records', async () => {
    const { t, e, mesh } = await setup({ pollsUntilDone: Infinity });
    const id = (
      await ctx!.http
        .post('/api/v1/jobs/mesh-to-cuboids')
        .set('X-Session-Token', t)
        .send({ projectId: e.id, source: { kind: 'mesh-asset', assetId: mesh.id } })
        .expect(202)
    ).body.data.job.id;
    for (let i = 0; i < 100 && worker!.received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    await ctx!.http.delete('/api/v1/sessions/current').set('X-Session-Token', t).expect(200);
    await ctx!.deps.jobs.idle();
    expect(worker!.cancelled.length).toBeGreaterThan(0);
    expect(worker!.deleted.length).toBeGreaterThan(0);
    for (const kind of ['jobs', 'projects', 'assets', 'artifacts'] as const) expect(await ctx!.deps.store.listRecords(kind, true)).toEqual([]);
    await ctx!.http.get(`/api/v1/jobs/${id}`).set('X-Session-Token', t).expect(404);
  });
});

describe('restart recovery', () => {
  it('jobs left running by a crashed process fail cleanly instead of staying "running"', async () => {
    ctx = await makeApp();
    const now = new Date().toISOString();
    const stuck: JobRecord = {
      id: ctx.deps.store.newId('jobs'),
      ownerId: 'o'.repeat(32),
      type: 'mesh-to-cuboids',
      kind: 'entity',
      mode: 'manual',
      providerId: 'mesh-cuboids-v1',
      status: 'running',
      progressStage: 'Voxelizing',
      params: {},
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
    await ctx.deps.store.putRecord('jobs', stuck);
    const fresh = new JobManager({ ...ctx.deps, worker: ctx.deps.worker });
    await fresh.init();
    const after = await ctx.deps.store.getRecord<JobRecord>('jobs', stuck.id);
    expect(after).toMatchObject({ status: 'failed', errorCode: 'JOB_FAILED' });
    expect(after!.errorMessage).toMatch(/restart/);
  });
});

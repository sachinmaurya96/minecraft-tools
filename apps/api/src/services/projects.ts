import {
  base64ToBytes,
  bytesToBase64,
  encodeRgbaPng,
  EntityProjectStateSchema,
  generationModeFor,
  LIMITS,
  SkinProjectStateSchema,
  type EntityProject,
  type EntityProjectState,
  type Provenance,
  type ReferenceImage,
  type SkinModel,
  type SkinProject,
  type SkinProjectState,
} from '@blockwright/shared';
import { validateSkinPng } from '@blockwright/minecraft-skin';
import { topoSortBones } from '@blockwright/bedrock-export';
import type { Config } from '../config.js';
import { AppError, notFound } from '../http/errors.js';
import type { BaseRecord, FsStore } from '../storage/store.js';
import type { ImageService } from './images.js';

const MAX_REVISIONS_KEPT = 30;

type SkinMeta = Omit<SkinProject, keyof SkinProjectState | 'skinAssetId'>;
type EntityMeta = Omit<EntityProject, keyof EntityProjectState>;

export interface ProjectRecord extends BaseRecord {
  type: 'skin' | 'entity';
  revision: number;
  /** revision number -> ISO time + short label, newest last */
  history: Array<{ revision: number; at: string; label: string }>;
}

export interface RevisionSnapshot {
  state: SkinProjectState | EntityProjectState;
}

export type ProjectView = { project: SkinProject; skinPngBase64: string } | { project: EntityProject };

/** Tiny per-key mutex so concurrent saves of one project are serialised. */
class KeyedLock {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => next);
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export class ProjectService {
  private readonly lock = new KeyedLock();

  constructor(
    private readonly config: Config,
    private readonly store: FsStore,
    private readonly images: ImageService,
  ) {}

  // ---------------------------------------------------------------- helpers

  /** References must point at the caller's own, live image assets; server metadata wins. */
  private async verifyReferences(ownerId: string, refs: ReferenceImage[]): Promise<ReferenceImage[]> {
    if (refs.length > this.config.MAX_IMAGES_PER_PROJECT) {
      throw new AppError(400, 'LIMIT_EXCEEDED', `At most ${this.config.MAX_IMAGES_PER_PROJECT} reference images per project.`);
    }
    const out: ReferenceImage[] = [];
    for (const ref of refs) {
      const asset = await this.images.get(ownerId, ref.temporaryAssetId).catch(() => null);
      if (!asset || asset.purpose !== 'reference') {
        throw new AppError(400, 'VALIDATION_FAILED', `Reference image for "${ref.role}" is missing or expired; upload it again.`);
      }
      const rotated = ref.rotationDegrees === 90 || ref.rotationDegrees === 270;
      const w = rotated ? asset.height : asset.width;
      const h = rotated ? asset.width : asset.height;
      let crop = ref.crop;
      if (crop) {
        const x = Math.min(crop.x, w - 1);
        const y = Math.min(crop.y, h - 1);
        crop = { x, y, width: Math.max(1, Math.min(crop.width, w - x)), height: Math.max(1, Math.min(crop.height, h - y)) };
      }
      out.push({
        ...ref,
        originalName: asset.originalName,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        sizeBytes: asset.sizeBytes,
        ...(crop ? { crop } : {}),
      });
    }
    return out;
  }

  /** Clients may never claim AI provenance; it is only granted by applyGenerated(). */
  private guardProvenance(next: Provenance, previous?: Provenance): Provenance {
    if (next.origin === 'ai') {
      if (previous?.origin !== 'ai') {
        throw new AppError(400, 'VALIDATION_FAILED', 'AI provenance can only be set by the server from a completed generation job.');
      }
      // keep the server-attested fields; the client can only flag that it edited the result
      return { ...previous, editedAfterGeneration: previous.editedAfterGeneration || next.editedAfterGeneration };
    }
    // Non-AI origins are the client's own description of a manual/photo-assisted/sample result.
    const { providerId: _p, jobId: _j, ...rest } = next;
    return rest;
  }

  private decodeSkin(skinPngBase64: string, model: SkinModel): Uint8Array {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(skinPngBase64);
    } catch {
      throw new AppError(400, 'INVALID_SKIN', 'Skin PNG is not valid base64.');
    }
    if (bytes.length > 256 * 1024) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Skin PNG is too large.');
    const { report, image } = validateSkinPng(bytes, model);
    // Saving accepts work in progress (e.g. transparent base pixels); export enforces full validation.
    const fatal = report.issues.filter((i) => ['NOT_PNG', 'CORRUPT_PNG', 'BAD_DIMENSIONS', 'LEGACY_64x32'].includes(i.code));
    if (!image || fatal.length) throw new AppError(400, 'INVALID_SKIN', fatal[0]?.message ?? 'Invalid skin PNG.', report);
    return encodeRgbaPng(image); // canonical 8-bit RGBA, metadata-free
  }

  private checkEntityState(state: EntityProjectState): void {
    const bytes = Buffer.byteLength(JSON.stringify(state));
    if (bytes > LIMITS.maxProjectJsonBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Entity project is too large.');
    const ids = new Set(state.bones.map((b) => b.id));
    try {
      topoSortBones(state.bones);
    } catch (err) {
      throw new AppError(400, 'VALIDATION_FAILED', (err as Error).message);
    }
    for (const c of state.cubes) {
      if (!ids.has(c.boneId)) throw new AppError(400, 'VALIDATION_FAILED', `Cube ${c.id} references a missing bone.`);
    }
  }

  private async writeRevision(rec: ProjectRecord, state: SkinProjectState | EntityProjectState, label: string, png?: Uint8Array): Promise<void> {
    const snapshot: RevisionSnapshot = { state };
    await this.store.putBlob('projects', rec.id, `rev-${rec.revision}.json`, Buffer.from(JSON.stringify(snapshot)));
    if (png) await this.store.putBlob('projects', rec.id, `rev-${rec.revision}.png`, png);
    rec.history.push({ revision: rec.revision, at: rec.updatedAt, label });
    while (rec.history.length > MAX_REVISIONS_KEPT) {
      const old = rec.history.shift()!;
      await this.store.deleteBlob('projects', rec.id, `rev-${old.revision}.json`);
      await this.store.deleteBlob('projects', rec.id, `rev-${old.revision}.png`);
    }
    await this.store.putRecord('projects', rec);
  }

  private async readRevision(rec: ProjectRecord, revision: number): Promise<{ state: SkinProjectState | EntityProjectState; png?: Buffer }> {
    const json = await this.store.getBlob('projects', rec.id, `rev-${revision}.json`);
    if (!json) throw new AppError(404, 'NOT_FOUND', `Revision ${revision} is not available.`);
    const { state } = JSON.parse(json.toString('utf8')) as RevisionSnapshot;
    const png = rec.type === 'skin' ? ((await this.store.getBlob('projects', rec.id, `rev-${revision}.png`)) ?? undefined) : undefined;
    return { state, ...(png ? { png } : {}) };
  }

  private view(rec: ProjectRecord, state: SkinProjectState | EntityProjectState, png?: Uint8Array): ProjectView {
    const meta = { id: rec.id, revision: rec.revision, createdAt: rec.createdAt, updatedAt: rec.updatedAt, expiresAt: rec.expiresAt };
    if (rec.type === 'skin') {
      const s = state as SkinProjectState;
      const project: SkinProject = {
        ...s,
        ...(meta as SkinMeta),
        type: 'skin',
        generationMode: generationModeFor(s.provenance),
        skinAssetId: `${rec.id}:rev-${rec.revision}`,
      };
      return { project, skinPngBase64: bytesToBase64(png!) };
    }
    const s = state as EntityProjectState;
    const project: EntityProject = { ...s, ...(meta as EntityMeta), type: 'entity', generationMode: generationModeFor(s.provenance) };
    return { project };
  }

  private async getRecord(ownerId: string, id: unknown): Promise<ProjectRecord> {
    const rec = await this.store.getOwned<ProjectRecord>('projects', id, ownerId);
    if (!rec) throw notFound('Project');
    return rec;
  }

  // ---------------------------------------------------------------- API

  async createSkin(ownerId: string, rawState: unknown, skinPngBase64: string): Promise<ProjectView> {
    const state = SkinProjectStateSchema.parse(rawState);
    state.provenance = this.guardProvenance(state.provenance);
    state.references = await this.verifyReferences(ownerId, state.references);
    const png = this.decodeSkin(skinPngBase64, state.model);
    return this.create(ownerId, 'skin', state, png);
  }

  async createEntity(ownerId: string, rawState: unknown): Promise<ProjectView> {
    const state = EntityProjectStateSchema.parse(rawState);
    state.provenance = this.guardProvenance(state.provenance);
    state.references = await this.verifyReferences(ownerId, state.references);
    this.checkEntityState(state);
    return this.create(ownerId, 'entity', state);
  }

  private async create(ownerId: string, type: 'skin' | 'entity', state: SkinProjectState | EntityProjectState, png?: Uint8Array): Promise<ProjectView> {
    const now = this.store.nowIso();
    const rec: ProjectRecord = {
      id: this.store.newId('projects'),
      ownerId,
      type,
      revision: 1,
      history: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: this.store.expiryFromNow(this.config.ttlMs),
    };
    await this.writeRevision(rec, state, 'Created', png);
    await this.images.touch(
      ownerId,
      state.references.map((r) => r.temporaryAssetId),
    );
    return this.view(rec, state, png);
  }

  async get(ownerId: string, id: unknown): Promise<ProjectView> {
    const rec = await this.getRecord(ownerId, id);
    const { state, png } = await this.readRevision(rec, rec.revision);
    return this.view(rec, state, png);
  }

  async getRevision(
    ownerId: string,
    id: unknown,
    revision: number,
  ): Promise<{ record: ProjectRecord; state: SkinProjectState | EntityProjectState; png?: Buffer }> {
    const record = await this.getRecord(ownerId, id);
    if (!record.history.some((h) => h.revision === revision)) throw new AppError(404, 'NOT_FOUND', `Revision ${revision} is not available.`);
    return { record, ...(await this.readRevision(record, revision)) };
  }

  async update(ownerId: string, id: unknown, baseRevision: number, rawState: unknown, skinPngBase64?: string, label = 'Edited'): Promise<ProjectView> {
    const first = await this.getRecord(ownerId, id);
    return this.lock.run(first.id, async () => {
      const rec = await this.getRecord(ownerId, id);
      if (rec.revision !== baseRevision) {
        throw new AppError(
          409,
          'REVISION_CONFLICT',
          `Project changed elsewhere (now at revision ${rec.revision}, you edited ${baseRevision}). Reload to continue.`,
          {
            currentRevision: rec.revision,
          },
        );
      }
      const prev = await this.readRevision(rec, rec.revision);
      let state: SkinProjectState | EntityProjectState;
      let png: Uint8Array | undefined;
      if (rec.type === 'skin') {
        const s = SkinProjectStateSchema.parse(rawState);
        s.provenance = this.guardProvenance(s.provenance, prev.state.provenance);
        s.references = await this.verifyReferences(ownerId, s.references);
        png = skinPngBase64 ? this.decodeSkin(skinPngBase64, s.model) : prev.png;
        if (!png) throw new AppError(400, 'INVALID_SKIN', 'Skin PNG is required.');
        state = s;
      } else {
        const s = EntityProjectStateSchema.parse(rawState);
        s.provenance = this.guardProvenance(s.provenance, prev.state.provenance);
        s.references = await this.verifyReferences(ownerId, s.references);
        this.checkEntityState(s);
        state = s;
      }
      rec.revision += 1;
      rec.updatedAt = this.store.nowIso();
      rec.expiresAt = this.store.expiryFromNow(this.config.ttlMs);
      await this.writeRevision(rec, state, label, png);
      await this.images.touch(
        ownerId,
        state.references.map((r) => r.temporaryAssetId),
      );
      return this.view(rec, state, png);
    });
  }

  /**
   * Store a server-verified generation result as a new revision with AI (or
   * import) provenance. Used by the job system; the previous revision stays
   * available for revert.
   */
  async applyGenerated(
    ownerId: string,
    id: unknown,
    baseRevision: number,
    patch: { provenance: Provenance; skinPng?: Uint8Array; model?: Pick<EntityProjectState, 'bones' | 'cubes'>; sourceMeshArtifactId?: string },
    label: string,
  ): Promise<ProjectView> {
    const first = await this.getRecord(ownerId, id);
    return this.lock.run(first.id, async () => {
      const rec = await this.getRecord(ownerId, id);
      if (rec.revision !== baseRevision) {
        throw new AppError(409, 'REVISION_CONFLICT', `Project changed (now at revision ${rec.revision}). Reload, then apply the result again.`, {
          currentRevision: rec.revision,
        });
      }
      const prev = await this.readRevision(rec, rec.revision);
      let state: SkinProjectState | EntityProjectState;
      let png: Uint8Array | undefined;
      if (rec.type === 'skin') {
        if (!patch.skinPng) throw new AppError(400, 'BAD_REQUEST', 'This result is not a skin.');
        state = { ...(prev.state as SkinProjectState), provenance: patch.provenance };
        png = patch.skinPng;
      } else {
        if (!patch.model) throw new AppError(400, 'BAD_REQUEST', 'This result is not an entity model.');
        const s: EntityProjectState = { ...(prev.state as EntityProjectState), ...patch.model, provenance: patch.provenance };
        if (patch.sourceMeshArtifactId) s.sourceMeshArtifactId = patch.sourceMeshArtifactId;
        EntityProjectStateSchema.parse(s);
        this.checkEntityState(s);
        state = s;
      }
      rec.revision += 1;
      rec.updatedAt = this.store.nowIso();
      rec.expiresAt = this.store.expiryFromNow(this.config.ttlMs);
      await this.writeRevision(rec, state, label, png);
      return this.view(rec, state, png);
    });
  }

  async history(ownerId: string, id: unknown): Promise<ProjectRecord['history']> {
    return (await this.getRecord(ownerId, id)).history;
  }

  async revert(ownerId: string, id: unknown, baseRevision: number, toRevision: number): Promise<ProjectView> {
    const { state, png } = await this.getRevision(ownerId, id, toRevision);
    const first = await this.getRecord(ownerId, id);
    return this.lock.run(first.id, async () => {
      const rec = await this.getRecord(ownerId, id);
      if (rec.revision !== baseRevision) throw new AppError(409, 'REVISION_CONFLICT', 'Project changed; reload first.', { currentRevision: rec.revision });
      rec.revision += 1;
      rec.updatedAt = this.store.nowIso();
      rec.expiresAt = this.store.expiryFromNow(this.config.ttlMs);
      await this.writeRevision(rec, state, `Reverted to revision ${toRevision}`, png);
      return this.view(rec, state, png);
    });
  }

  async delete(ownerId: string, id: unknown): Promise<void> {
    const rec = await this.getRecord(ownerId, id);
    await this.store.deleteRecord('projects', rec.id);
    for (const art of await this.store.listRecords<BaseRecord & { projectId?: string }>('artifacts', true)) {
      if (art.ownerId === ownerId && art.projectId === rec.id) await this.store.deleteRecord('artifacts', art.id);
    }
  }
}

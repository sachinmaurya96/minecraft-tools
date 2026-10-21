import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError, notFound } from '../http/errors.js';
import type { BaseRecord, FsStore } from '../storage/store.js';

/**
 * User-supplied meshes (.glb / .obj) for the mesh -> cuboid converter. The API
 * only checks container structure and size; the worker does the bounded
 * geometric parsing. Meshes are never offered back as Minecraft content.
 */
export interface MeshRecord extends BaseRecord {
  assetType: 'mesh';
  format: 'glb' | 'obj';
  originalName: string;
  sizeBytes: number;
  sha256: string;
}

const MAX_OBJ_FACES = 500_000;

export function inspectMesh(bytes: Buffer): { format: 'glb' | 'obj' } {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'glTF') {
    const version = bytes.readUInt32LE(4);
    const length = bytes.readUInt32LE(8);
    if (version !== 2) throw new AppError(400, 'BAD_REQUEST', `Only glTF 2.0 binary (.glb) is supported (got version ${version}).`);
    if (length !== bytes.length) throw new AppError(400, 'BAD_REQUEST', 'The .glb file is truncated or has a wrong length header.');
    return { format: 'glb' };
  }
  // OBJ: must be plain text with vertices and faces
  const sample = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
  if (sample.includes(0)) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload a binary glTF (.glb) or Wavefront .obj mesh.');
  const text = bytes.toString('utf8');
  let vertices = 0;
  let faces = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) vertices++;
    else if (line.startsWith('f ')) faces++;
  }
  if (vertices < 3 || faces < 1)
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload a binary glTF (.glb) or Wavefront .obj mesh with vertices and faces.');
  if (faces > MAX_OBJ_FACES) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `The mesh has more than ${MAX_OBJ_FACES.toLocaleString('en')} faces.`);
  return { format: 'obj' };
}

export class MeshService {
  constructor(
    private readonly config: Config,
    private readonly store: FsStore,
  ) {}

  async ingest(ownerId: string, bytes: Buffer, originalName: string): Promise<MeshRecord> {
    if (bytes.length === 0) throw new AppError(400, 'BAD_REQUEST', 'The file is empty.');
    if (bytes.length > this.config.maxMeshBytes) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Meshes must be at most ${this.config.MAX_MESH_MB} MB.`);
    const { format } = inspectMesh(bytes);
    const now = this.store.nowIso();
    const rec: MeshRecord = {
      id: this.store.newId('assets'),
      ownerId,
      assetType: 'mesh',
      format,
      originalName: (originalName.split(/[\\/]/).pop() ?? 'mesh').replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 120),
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      createdAt: now,
      updatedAt: now,
      expiresAt: this.store.expiryFromNow(this.config.ttlMs),
    };
    await this.store.putBlob('assets', rec.id, `mesh.${format}`, bytes);
    await this.store.putRecord('assets', rec);
    return rec;
  }

  async getBytes(ownerId: string, id: unknown): Promise<{ record: MeshRecord; bytes: Buffer }> {
    const record = await this.store.getOwned<MeshRecord>('assets', id, ownerId);
    if (!record || record.assetType !== 'mesh') throw notFound('Mesh');
    const bytes = await this.store.getBlob('assets', record.id, `mesh.${record.format}`);
    if (!bytes) throw notFound('Mesh');
    return { record, bytes };
  }

  async delete(ownerId: string, id: unknown): Promise<void> {
    const { record } = await this.getBytes(ownerId, id);
    await this.store.deleteRecord('assets', record.id);
  }
}

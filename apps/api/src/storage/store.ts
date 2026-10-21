import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Durable local storage (PLAN §6.4): one JSON manifest per record plus a blob
 * folder per record, atomic writes (temp file + rename in the same folder), TTL
 * expiry. IDs are opaque random strings validated before they ever touch a path,
 * and raw filesystem paths never leave this module.
 */

export const RECORD_KINDS = ['assets', 'projects', 'jobs', 'artifacts'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

const PREFIX: Record<RecordKind, string> = { assets: 'img', projects: 'prj', jobs: 'job', artifacts: 'art' };
const ID_RE = /^(img|prj|job|art)_[A-Za-z0-9_-]{22}$/;
const BLOB_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface BaseRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export function isValidId(kind: RecordKind, id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id) && id.startsWith(`${PREFIX[kind]}_`);
}

export class FsStore {
  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  async init(): Promise<void> {
    for (const kind of RECORD_KINDS) {
      await fs.mkdir(path.join(this.root, 'records', kind), { recursive: true });
      await fs.mkdir(path.join(this.root, 'blobs', kind), { recursive: true });
    }
  }

  newId(kind: RecordKind): string {
    return `${PREFIX[kind]}_${randomBytes(16).toString('base64url')}`;
  }

  expiryFromNow(ttlMs: number): string {
    return new Date(this.now() + ttlMs).toISOString();
  }

  nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private recordPath(kind: RecordKind, id: string): string {
    if (!isValidId(kind, id)) throw new Error(`Invalid ${kind} id`);
    return path.join(this.root, 'records', kind, `${id}.json`);
  }

  private blobDir(kind: RecordKind, id: string): string {
    if (!isValidId(kind, id)) throw new Error(`Invalid ${kind} id`);
    return path.join(this.root, 'blobs', kind, id);
  }

  private async atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  async putRecord<T extends BaseRecord>(kind: RecordKind, record: T): Promise<T> {
    await this.atomicWrite(this.recordPath(kind, record.id), JSON.stringify(record));
    return record;
  }

  /** Returns null for unknown, malformed or expired ids. */
  async getRecord<T extends BaseRecord>(kind: RecordKind, id: unknown): Promise<T | null> {
    if (!isValidId(kind, id)) return null;
    try {
      const rec = JSON.parse(await fs.readFile(this.recordPath(kind, id), 'utf8')) as T;
      if (Date.parse(rec.expiresAt) <= this.now()) return null;
      return rec;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Owner-scoped read: records of other sessions are indistinguishable from missing ones. */
  async getOwned<T extends BaseRecord>(kind: RecordKind, id: unknown, ownerId: string): Promise<T | null> {
    const rec = await this.getRecord<T>(kind, id);
    return rec && rec.ownerId === ownerId ? rec : null;
  }

  async deleteRecord(kind: RecordKind, id: string): Promise<void> {
    await fs.rm(this.blobDir(kind, id), { recursive: true, force: true });
    await fs.rm(this.recordPath(kind, id), { force: true });
  }

  async listRecords<T extends BaseRecord>(kind: RecordKind, includeExpired = false): Promise<T[]> {
    const dir = path.join(this.root, 'records', kind);
    const out: T[] = [];
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      try {
        const rec = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as T;
        if (includeExpired || Date.parse(rec.expiresAt) > this.now()) out.push(rec);
      } catch {
        // partially written or corrupt manifests are ignored (and swept below)
      }
    }
    return out;
  }

  async putBlob(kind: RecordKind, id: string, name: string, bytes: Uint8Array): Promise<void> {
    if (!BLOB_RE.test(name)) throw new Error('Invalid blob name');
    const dir = this.blobDir(kind, id);
    await fs.mkdir(dir, { recursive: true });
    await this.atomicWrite(path.join(dir, name), bytes);
  }

  async getBlob(kind: RecordKind, id: string, name: string): Promise<Buffer | null> {
    if (!BLOB_RE.test(name)) return null;
    try {
      return await fs.readFile(path.join(this.blobDir(kind, id), name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteBlob(kind: RecordKind, id: string, name: string): Promise<void> {
    if (!BLOB_RE.test(name)) return;
    await fs.rm(path.join(this.blobDir(kind, id), name), { force: true });
  }

  /** Local path for handing a blob to a child process; never sent to clients. */
  blobFilePath(kind: RecordKind, id: string, name: string): string {
    if (!BLOB_RE.test(name)) throw new Error('Invalid blob name');
    return path.join(this.blobDir(kind, id), name);
  }

  /** Delete expired records, their blobs, orphaned blob folders and stale temp files. */
  async sweepExpired(): Promise<number> {
    let removed = 0;
    for (const kind of RECORD_KINDS) {
      const dir = path.join(this.root, 'records', kind);
      const live = new Set<string>();
      for (const name of await fs.readdir(dir)) {
        const full = path.join(dir, name);
        if (name.startsWith('.') && name.endsWith('.tmp')) {
          const st = await fs.stat(full).catch(() => null);
          if (st && this.now() - st.mtimeMs > 3600_000) await fs.rm(full, { force: true });
          continue;
        }
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -5);
        let expired = false;
        try {
          const rec = JSON.parse(await fs.readFile(full, 'utf8')) as BaseRecord;
          expired = Date.parse(rec.expiresAt) <= this.now();
        } catch {
          expired = true;
        }
        if (expired && isValidId(kind, id)) {
          await this.deleteRecord(kind, id);
          removed++;
        } else {
          live.add(id);
        }
      }
      for (const name of await fs.readdir(path.join(this.root, 'blobs', kind))) {
        if (!live.has(name) && isValidId(kind, name)) await fs.rm(this.blobDir(kind, name), { recursive: true, force: true });
      }
    }
    return removed;
  }
}

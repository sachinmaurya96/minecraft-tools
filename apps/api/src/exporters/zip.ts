import { crc32 } from 'node:zlib';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { isSafeArchivePath } from '@blockwright/bedrock-export';

/** Fixed timestamp so identical content produces identical archives (modulo UUIDs). */
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

export async function zipFiles(files: Map<string, Uint8Array>): Promise<Buffer> {
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  zip.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.on('warning', reject);
  });
  for (const name of [...files.keys()].sort()) {
    if (!isSafeArchivePath(name)) throw new Error(`Refusing to write unsafe archive path ${name}`);
    zip.append(Buffer.from(files.get(name)!), { name, date: FIXED_DATE });
  }
  await zip.finalize();
  await done;
  return Buffer.concat(chunks);
}

export interface ReadZipLimits {
  maxEntries: number;
  maxTotalBytes: number;
  maxEntryBytes: number;
}

export class ZipReadError extends Error {}

/**
 * Read every file of a ZIP into memory with ZIP-slip, symlink, size and CRC
 * checks. Directory entries are skipped. Used to verify our own archives
 * after writing them and to inspect anything uploaded.
 */
export async function readZip(buf: Buffer, limits: ReadZipLimits): Promise<Map<string, Uint8Array>> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.fromBufferPromise(buf, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  } catch (err) {
    throw new ZipReadError(`Not a readable ZIP archive: ${(err as Error).message}`);
  }
  if (zip.entryCount > limits.maxEntries) throw new ZipReadError(`Archive has too many entries (${zip.entryCount})`);
  const out = new Map<string, Uint8Array>();
  let total = 0;
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      zip.close();
      reject(err instanceof ZipReadError ? err : new ZipReadError(err.message));
    };
    zip.on('error', fail);
    zip.on('end', () => resolve(out));
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;
      if (name.endsWith('/')) {
        zip.readEntry();
        return;
      }
      if (yauzl.validateFileName(name) !== null || !isSafeArchivePath(name)) return fail(new ZipReadError(`Unsafe path in archive: ${name}`));
      const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (unixMode === 0o120000) return fail(new ZipReadError(`Symlink in archive: ${name}`));
      if (out.has(name)) return fail(new ZipReadError(`Duplicate entry: ${name}`));
      if (entry.uncompressedSize > limits.maxEntryBytes) return fail(new ZipReadError(`Entry too large: ${name}`));
      total += entry.uncompressedSize;
      if (total > limits.maxTotalBytes) return fail(new ZipReadError('Archive expands beyond the size limit'));
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return fail(err ?? new ZipReadError('Cannot read entry'));
        const parts: Buffer[] = [];
        let size = 0;
        stream.on('data', (c: Buffer) => {
          size += c.length;
          if (size > limits.maxEntryBytes) stream.destroy(new ZipReadError(`Entry too large: ${name}`));
          else parts.push(c);
        });
        stream.on('error', fail);
        stream.on('end', () => {
          const data = Buffer.concat(parts);
          if (crc32(data) >>> 0 !== entry.crc32) return fail(new ZipReadError(`CRC mismatch: ${name}`));
          out.set(name, new Uint8Array(data));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

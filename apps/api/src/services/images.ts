import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Metadata, OutputInfo } from 'sharp';
import { LIMITS, type ImageAsset, type ImagePurpose, type UploadMime } from '@blockwright/shared';
import type { Config } from '../config.js';
import { AppError, notFound } from '../http/errors.js';
import type { BaseRecord, FsStore } from '../storage/store.js';

// Never let libvips decode anything but these three formats: it also supports
// SVG, HEIF, TIFF, PDF... which we do not want to parse from untrusted input.
export function sniffImageType(buf: Uint8Array): UploadMime | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

const SHARP_FORMAT: Record<UploadMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };

export interface ImageRecord extends BaseRecord, Omit<ImageAsset, 'id' | 'createdAt' | 'expiresAt'> {
  assetType: 'image';
  blob: 'image.png' | 'image.jpg';
  thumb: 'thumb.png' | 'thumb.jpg';
}

export function toImageAsset(r: ImageRecord): ImageAsset {
  return {
    id: r.id,
    purpose: r.purpose,
    originalName: r.originalName,
    originalMime: r.originalMime,
    mime: r.mime,
    width: r.width,
    height: r.height,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    hasAlpha: r.hasAlpha,
    exifOrientationApplied: r.exifOrientationApplied,
    metadataStripped: true,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    warnings: r.warnings,
  };
}

function safeName(name: string): string {
  // display only: strip paths and control characters
  const base = name.split(/[\\/]/).pop() ?? 'image';
  return base.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 120) || 'image';
}

export class ImageService {
  constructor(
    private readonly config: Config,
    private readonly store: FsStore,
  ) {}

  async ingest(ownerId: string, input: { bytes: Buffer; originalName: string; declaredMime?: string; purpose: ImagePurpose }): Promise<ImageRecord> {
    const { bytes } = input;
    if (bytes.length === 0) throw new AppError(400, 'BAD_IMAGE', 'The file is empty.');
    if (bytes.length > this.config.maxImageBytes) {
      throw new AppError(413, 'IMAGE_TOO_LARGE', `Images must be at most ${this.config.MAX_IMAGE_MB} MB.`);
    }
    const sniffed = sniffImageType(bytes);
    if (!sniffed) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PNG, JPEG and WebP images are accepted (checked by file content, not name).');
    const warnings: string[] = [];
    if (input.declaredMime && input.declaredMime !== sniffed) {
      warnings.push(`File content is ${sniffed} although it was sent as ${input.declaredMime}; the content type was used.`);
    }

    const sharpOpts = { limitInputPixels: this.config.MAX_IMAGE_PIXELS, failOn: 'error' as const, sequentialRead: true };
    let meta: Metadata;
    try {
      meta = await sharp(bytes, sharpOpts).metadata();
    } catch (err) {
      const msg = (err as Error).message;
      if (/pixel limit/i.test(msg)) {
        throw new AppError(413, 'IMAGE_TOO_LARGE', `Images may have at most ${this.config.MAX_IMAGE_PIXELS.toLocaleString('en')} pixels.`);
      }
      throw new AppError(400, 'BAD_IMAGE', 'The image could not be decoded (corrupt or truncated file).');
    }
    if (meta.format !== SHARP_FORMAT[sniffed]) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Image format does not match its content.');
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    if (!width || !height) throw new AppError(400, 'BAD_IMAGE', 'The image has no dimensions.');
    if (width * height > this.config.MAX_IMAGE_PIXELS) {
      throw new AppError(413, 'IMAGE_TOO_LARGE', `Images may have at most ${this.config.MAX_IMAGE_PIXELS.toLocaleString('en')} pixels.`);
    }
    if (Math.min(width, height) < LIMITS.minImageSide) {
      throw new AppError(400, 'BAD_IMAGE', `The image is too small (${width}x${height}); use at least ${LIMITS.minImageSide} px on each side.`);
    }
    if ((meta.pages ?? 1) > 1) warnings.push('Animated image: only the first frame is used.');
    const exifOrientationApplied = !!meta.orientation && meta.orientation !== 1;

    const isComposite = input.purpose === 'composite';
    const maxSide = isComposite ? 4096 : LIMITS.normalizedImageMaxSide;
    let pipeline = sharp(bytes, { ...sharpOpts, autoOrient: true }).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    // Default sharp output strips EXIF/XMP/ICC metadata and converts to sRGB.
    const hasAlpha = !!meta.hasAlpha;
    const asPng = hasAlpha || isComposite || sniffed === 'image/png';
    pipeline = asPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 92, mozjpeg: true });
    let normalized: { data: Buffer; info: OutputInfo };
    try {
      normalized = await pipeline.toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppError(400, 'BAD_IMAGE', 'The image could not be decoded (corrupt or truncated file).');
    }
    if (normalized.info.width !== width || normalized.info.height !== height) {
      warnings.push(`Downscaled from ${width}x${height} to ${normalized.info.width}x${normalized.info.height}.`);
    }
    if (Math.min(width, height) < 256 && !isComposite) warnings.push('Low resolution: fine details may be lost.');
    if (exifOrientationApplied) warnings.push("Rotated upright using the photo's EXIF orientation; all metadata was removed.");

    const thumbnail = sharp(normalized.data).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true });
    const thumb = await (asPng ? thumbnail.png() : thumbnail.jpeg()).toBuffer();

    const sha256 = createHash('sha256').update(normalized.data).digest('hex');
    const owned = await this.listOwned(ownerId);
    if (owned.some((r) => r.sha256 === sha256)) warnings.push('You already uploaded an identical image.');

    const id = this.store.newId('assets');
    const now = this.store.nowIso();
    const record: ImageRecord = {
      id,
      ownerId,
      assetType: 'image',
      purpose: input.purpose,
      originalName: safeName(input.originalName),
      originalMime: sniffed,
      mime: asPng ? 'image/png' : 'image/jpeg',
      width: normalized.info.width,
      height: normalized.info.height,
      sizeBytes: normalized.data.length,
      sha256,
      hasAlpha,
      exifOrientationApplied,
      metadataStripped: true,
      warnings,
      blob: asPng ? 'image.png' : 'image.jpg',
      thumb: asPng ? 'thumb.png' : 'thumb.jpg',
      createdAt: now,
      updatedAt: now,
      expiresAt: this.store.expiryFromNow(this.config.ttlMs),
    };
    await this.store.putBlob('assets', id, record.blob, normalized.data);
    await this.store.putBlob('assets', id, record.thumb, thumb);
    await this.store.putRecord('assets', record);
    return record;
  }

  async listOwned(ownerId: string): Promise<ImageRecord[]> {
    return (await this.store.listRecords<ImageRecord>('assets')).filter((r) => r.ownerId === ownerId && r.assetType === 'image');
  }

  async get(ownerId: string, id: unknown): Promise<ImageRecord> {
    const rec = await this.store.getOwned<ImageRecord>('assets', id, ownerId);
    if (!rec || rec.assetType !== 'image') throw notFound('Image');
    return rec;
  }

  async getBytes(ownerId: string, id: unknown, variant: 'full' | 'thumb' = 'full'): Promise<{ record: ImageRecord; bytes: Buffer }> {
    const record = await this.get(ownerId, id);
    const bytes = await this.store.getBlob('assets', record.id, variant === 'thumb' ? record.thumb : record.blob);
    if (!bytes) throw notFound('Image');
    return { record, bytes };
  }

  async delete(ownerId: string, id: unknown): Promise<void> {
    const rec = await this.get(ownerId, id);
    await this.store.deleteRecord('assets', rec.id);
  }

  /** Extend the TTL of assets referenced by a project that was just saved. */
  async touch(ownerId: string, ids: string[]): Promise<void> {
    for (const id of ids) {
      const rec = await this.store.getOwned<ImageRecord>('assets', id, ownerId);
      if (!rec) continue;
      rec.expiresAt = this.store.expiryFromNow(this.config.ttlMs);
      rec.updatedAt = this.store.nowIso();
      await this.store.putRecord('assets', rec);
    }
  }
}

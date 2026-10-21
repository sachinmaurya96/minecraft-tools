import { ReportBuilder, SKIN_SIZE, type RgbaImage, type SkinModel, type ValidationReport } from '@blockwright/shared';
import { getSkinLayout, PART_LABELS, regionKey, type FaceRegion } from './layout.js';
import { decodePngToRgba, hasPngSignature, PngDecodeError, type PngInfo } from '@blockwright/shared';

export interface SkinStats {
  basePixels: number;
  transparentBasePixels: number;
  overlayOpaquePixels: number;
  overlaySemiTransparentPixels: number;
  baseRegionsWithTransparency: string[];
}

function forEachPixel(region: FaceRegion, fn: (x: number, y: number) => void): void {
  for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) fn(x, y);
}

export function skinStats(img: RgbaImage, model: SkinModel): SkinStats {
  const stats: SkinStats = {
    basePixels: 0,
    transparentBasePixels: 0,
    overlayOpaquePixels: 0,
    overlaySemiTransparentPixels: 0,
    baseRegionsWithTransparency: [],
  };
  for (const region of getSkinLayout(model)) {
    let regionTransparent = 0;
    forEachPixel(region, (x, y) => {
      const a = img.data[(y * img.width + x) * 4 + 3]!;
      if (region.layer === 'base') {
        stats.basePixels++;
        if (a !== 255) regionTransparent++;
      } else if (a === 255) {
        stats.overlayOpaquePixels++;
      } else if (a > 0) {
        stats.overlaySemiTransparentPixels++;
      }
    });
    if (regionTransparent > 0) {
      stats.transparentBasePixels += regionTransparent;
      stats.baseRegionsWithTransparency.push(regionKey(region));
    }
  }
  return stats;
}

/**
 * Structural and UV/alpha validation of a decoded skin (PLAN §3.1):
 * - exactly 64x64
 * - every base-layer face pixel fully opaque (Java renders the base layer opaque,
 *   so transparent base pixels show up as unintended colours)
 * - outer-layer transparency allowed; partial alpha flagged as a warning
 */
export function validateSkinImage(img: RgbaImage, model: SkinModel): ValidationReport {
  const report = new ReportBuilder();
  report.check('dimensions-64x64');
  if (img.width !== SKIN_SIZE || img.height !== SKIN_SIZE) {
    if (img.width === 64 && img.height === 32) {
      report.error('LEGACY_64x32', 'This is a legacy 64x32 skin. Convert it to the 64x64 layout first (the importer can do this).');
    } else {
      report.error('BAD_DIMENSIONS', `Skin must be 64x64 pixels, got ${img.width}x${img.height}.`);
    }
    return report.build();
  }
  const stats = skinStats(img, model);
  report.check('base-layer-opaque');
  if (stats.transparentBasePixels > 0) {
    const parts = [...new Set(stats.baseRegionsWithTransparency.map((k) => PART_LABELS[k.split('.')[0] as keyof typeof PART_LABELS]))];
    report.error(
      'BASE_TRANSPARENT',
      `${stats.transparentBasePixels} base-layer pixel(s) are not fully opaque (${parts.join(', ')}). ` +
        'Minecraft draws the base layer opaque, so these would show unintended colours. Paint them or use "Make base layer opaque".',
    );
  }
  report.check('overlay-alpha');
  if (stats.overlaySemiTransparentPixels > 0) {
    report.warn(
      'OVERLAY_SEMI_TRANSPARENT',
      `${stats.overlaySemiTransparentPixels} outer-layer pixel(s) are semi-transparent; editions and versions may render partial alpha differently.`,
    );
  }
  report.check('not-fully-opaque');
  let fullyOpaque = true;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] !== 255) {
      fullyOpaque = false;
      break;
    }
  }
  if (fullyOpaque) {
    report.warn(
      'FULLY_OPAQUE',
      'Every pixel of the image is opaque, including unused areas. Some launchers and viewers treat a fully opaque skin as an old-style skin and hide its outer layer; leave unused areas transparent.',
    );
  }
  report.info('OVERLAY_PIXELS', `${stats.overlayOpaquePixels} opaque outer-layer pixel(s).`);
  report.check('model-arm-width');
  report.info('MODEL', model === 'slim' ? 'Slim (3-pixel arms) model.' : 'Classic (4-pixel arms) model.');
  return report.build();
}

export interface PngValidationResult {
  report: ValidationReport;
  image?: RgbaImage;
  info?: PngInfo;
}

/** Validate raw PNG bytes: signature, CRCs/decodability, colour mode, then skin rules. */
export function validateSkinPng(bytes: Uint8Array, model: SkinModel): PngValidationResult {
  const report = new ReportBuilder();
  report.check('png-signature');
  if (!hasPngSignature(bytes)) {
    report.error('NOT_PNG', 'File is not a PNG image.');
    return { report: report.build() };
  }
  report.check('png-decode-crc');
  let decoded;
  try {
    decoded = decodePngToRgba(bytes);
  } catch (err) {
    report.error('CORRUPT_PNG', err instanceof PngDecodeError ? err.message : 'PNG could not be decoded.');
    return { report: report.build() };
  }
  report.check('png-color-mode');
  if (decoded.info.converted) {
    report.info('COLOR_MODE_CONVERTED', `Source PNG is ${decoded.info.colorType} ${decoded.info.depth}-bit; it is converted to 8-bit RGBA on export.`);
  }
  report.merge(validateSkinImage(decoded.image, model));
  return { report: report.build(), image: decoded.image, info: decoded.info };
}

/** Fix: set alpha=255 on every base-layer face pixel (RGB kept). */
export function makeBaseLayerOpaque(img: RgbaImage, model: SkinModel): RgbaImage {
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (const region of getSkinLayout(model)) {
    if (region.layer !== 'base') continue;
    forEachPixel(region, (x, y) => {
      out.data[(y * img.width + x) * 4 + 3] = 255;
    });
  }
  return out;
}

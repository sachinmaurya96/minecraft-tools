import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  borderBackgroundMask,
  bytesToBase64,
  createImage,
  cropImage,
  extractPalette,
  fillRect,
  flipHorizontal,
  getPixel,
  hexToRgba,
  maskCoverage,
  quantizeImage,
  resampleArea,
  resizeNearest,
  rgbaToHex,
  rotateImage,
  setPixel,
} from './index.js';
import { ReferenceListSchema, checkEntityIdentifier, provenanceLabel } from './index.js';

describe('raster basics', () => {
  it('crops, rotates and flips exactly', () => {
    const img = createImage(3, 2);
    setPixel(img, 0, 0, [1, 0, 0, 255]);
    setPixel(img, 2, 1, [2, 0, 0, 255]);
    const r90 = rotateImage(img, 90);
    expect([r90.width, r90.height]).toEqual([2, 3]);
    expect(getPixel(r90, 1, 0)[0]).toBe(1); // top-left -> top-right
    expect(getPixel(r90, 0, 2)[0]).toBe(2);
    const r270 = rotateImage(img, 270);
    expect(getPixel(r270, 0, 2)[0]).toBe(1);
    expect(getPixel(rotateImage(img, 180), 2, 1)[0]).toBe(1);
    expect(getPixel(flipHorizontal(img), 2, 0)[0]).toBe(1);
    const c = cropImage(img, { x: 1, y: 1, width: 2, height: 1 });
    expect([c.width, c.height, getPixel(c, 1, 0)[0]]).toEqual([2, 1, 2]);
  });

  it('area-averages with alpha weighting and reports coverage', () => {
    const img = createImage(2, 2);
    setPixel(img, 0, 0, [100, 0, 0, 255]);
    setPixel(img, 1, 0, [200, 0, 0, 255]);
    setPixel(img, 0, 1, [0, 0, 0, 0]); // transparent: ignored
    setPixel(img, 1, 1, [0, 0, 0, 0]);
    const { image, coverage } = resampleArea(img, { x: 0, y: 0, width: 2, height: 2 }, 1, 1);
    expect(getPixel(image, 0, 0)).toEqual([150, 0, 0, 255]);
    expect(coverage[0]).toBeCloseTo(0.5);
    const outside = resampleArea(img, { x: 5, y: 5, width: 2, height: 2 }, 1, 1);
    expect(outside.coverage[0]).toBe(0);
    expect(getPixel(outside.image, 0, 0)[3]).toBe(0);
    const big = resizeNearest(img, 4, 4);
    expect(getPixel(big, 3, 0)).toEqual([200, 0, 0, 255]);
  });

  it('extracts a deterministic palette and quantizes', () => {
    const img = createImage(10, 10, [250, 0, 0, 255]);
    fillRect(img, { x: 0, y: 0, width: 3, height: 10 }, [0, 0, 250, 255]);
    const p = extractPalette(img, 2);
    expect(p).toHaveLength(2);
    expect(p[0]!.color).toEqual([250, 0, 0, 255]);
    expect(p[0]!.share).toBeCloseTo(0.7);
    expect(extractPalette(img, 2)).toEqual(p);
    const q = quantizeImage(img, [
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
    expect(getPixel(q, 0, 0)).toEqual([0, 0, 255, 255]);
  });

  it('masks a plain border-connected background only', () => {
    const img = createImage(20, 20, [240, 240, 240, 255]);
    fillRect(img, { x: 5, y: 5, width: 10, height: 10 }, [20, 30, 40, 255]);
    fillRect(img, { x: 9, y: 9, width: 2, height: 2 }, [240, 240, 240, 255]); // enclosed: not background
    const mask = borderBackgroundMask(img, 30);
    expect(mask[0]).toBe(1);
    expect(mask[6 * 20 + 6]).toBe(0);
    expect(mask[9 * 20 + 9]).toBe(0);
    expect(maskCoverage(mask)).toBeCloseTo((400 - 100) / 400);
  });

  it('converts colours and base64', () => {
    expect(hexToRgba('#ff8000')).toEqual([255, 128, 0, 255]);
    expect(hexToRgba('#ff800080')).toEqual([255, 128, 0, 128]);
    expect(rgbaToHex([255, 128, 0, 255])).toBe('#ff8000');
    expect(rgbaToHex([255, 128, 0, 128])).toBe('#ff800080');
    const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('schemas', () => {
  it('rejects duplicate roles and multiple primaries', () => {
    const ref = (role: string, isPrimary?: boolean) => ({
      id: `r_${role}`,
      role,
      originalName: 'a.png',
      mime: 'image/png',
      width: 10,
      height: 10,
      sizeBytes: 10,
      temporaryAssetId: 'a1',
      rotationDegrees: 0,
      isPrimary,
    });
    expect(ReferenceListSchema.safeParse([ref('front'), ref('back')]).success).toBe(true);
    expect(ReferenceListSchema.safeParse([ref('front'), ref('front')]).success).toBe(false);
    expect(ReferenceListSchema.safeParse([ref('front', true), ref('back', true)]).success).toBe(false);
  });

  it('validates entity identifiers and labels provenance', () => {
    expect(checkEntityIdentifier('my_pack:robot_2')).toBeNull();
    expect(checkEntityIdentifier('minecraft:zombie')).toMatch(/reserved/);
    expect(checkEntityIdentifier('My:Robot')).not.toBeNull();
    expect(checkEntityIdentifier('a:b')).not.toBeNull(); // namespace too short
    expect(checkEntityIdentifier('ns:../../x')).not.toBeNull();
    expect(provenanceLabel({ origin: 'ai' })).toBe('AI-generated');
    expect(provenanceLabel({ origin: 'photo-assisted' })).toBe('Photo-assisted');
    expect(provenanceLabel({ origin: 'sample' })).toBe('Demo sample');
    expect(provenanceLabel({ origin: 'template' })).toBe('Manual');
  });
});

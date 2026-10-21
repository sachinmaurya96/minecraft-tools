import { describe, expect, it } from 'vitest';
import { cloneImage, createImage, getPixel, imagesEqual, setPixel, type RgbaImage } from '@blockwright/shared';
import { findRegion, getSkinLayout, pixelInfo } from './layout.js';
import { convertLegacySkin } from './legacy.js';
import { encodeRgbaPng } from '@blockwright/shared';
import { suggestModel } from './detect.js';
import { mirrorPixel } from './symmetry.js';
import { createBlankSkin, createTemplateSkin, createUvDebugSkin } from './template.js';
import { makeBaseLayerOpaque, validateSkinImage, validateSkinPng } from './validate.js';

describe('validation', () => {
  it.each(['classic', 'slim'] as const)('accepts the template skin (%s)', (model) => {
    const report = validateSkinImage(createTemplateSkin(model), model);
    expect(report.ok).toBe(true);
    expect(report.checks).toContain('base-layer-opaque');
  });

  it('rejects transparent base-layer pixels and the fix makes them opaque', () => {
    const img = createTemplateSkin('classic');
    setPixel(img, 9, 9, [10, 10, 10, 0]); // head front
    setPixel(img, 21, 21, [10, 10, 10, 120]); // torso front
    const report = validateSkinImage(img, 'classic');
    expect(report.ok).toBe(false);
    expect(report.issues.find((i) => i.code === 'BASE_TRANSPARENT')?.message).toMatch(/2 base-layer pixel/);
    const fixed = makeBaseLayerOpaque(img, 'classic');
    expect(validateSkinImage(fixed, 'classic').ok).toBe(true);
    expect(getPixel(fixed, 9, 9)).toEqual([10, 10, 10, 255]);
  });

  it('allows transparent overlay and warns on semi-transparent overlay', () => {
    const img = createTemplateSkin('classic');
    setPixel(img, 41, 9, [200, 0, 0, 255]); // hat
    setPixel(img, 42, 9, [200, 0, 0, 128]);
    const report = validateSkinImage(img, 'classic');
    expect(report.ok).toBe(true);
    expect(report.issues.map((i) => i.code)).toContain('OVERLAY_SEMI_TRANSPARENT');
  });

  it('rejects wrong sizes and non-PNG bytes', () => {
    expect(validateSkinImage(createImage(64, 32, [1, 1, 1, 255]), 'classic').issues[0]?.code).toBe('LEGACY_64x32');
    expect(validateSkinImage(createImage(128, 128), 'classic').issues[0]?.code).toBe('BAD_DIMENSIONS');
    expect(validateSkinPng(new Uint8Array([1, 2, 3, 4]), 'classic').report.issues[0]?.code).toBe('NOT_PNG');
    const ok = validateSkinPng(encodeRgbaPng(createTemplateSkin('slim')), 'slim');
    expect(ok.report.ok).toBe(true);
    expect(ok.report.checks).toEqual(expect.arrayContaining(['png-signature', 'png-decode-crc', 'png-color-mode', 'dimensions-64x64', 'base-layer-opaque']));
  });
});

describe('symmetry', () => {
  it.each(['classic', 'slim'] as const)('mirror is an involution on every face pixel (%s)', (model) => {
    for (const r of getSkinLayout(model)) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const m = mirrorPixel(model, x, y)!;
          expect(mirrorPixel(model, m.x, m.y)).toEqual({ x, y });
          expect(pixelInfo(model, m.x, m.y)!.region.layer).toBe(r.layer);
        }
      }
    }
  });

  it('maps known pixels', () => {
    expect(mirrorPixel('classic', 8, 8)).toEqual({ x: 15, y: 8 }); // head front left edge <-> right edge
    expect(mirrorPixel('classic', 44, 20)).toEqual({ x: 39, y: 52 }); // right arm front <-> left arm front
    expect(mirrorPixel('slim', 44, 20)).toEqual({ x: 38, y: 52 });
    expect(mirrorPixel('classic', 0, 8)).toEqual({ x: 23, y: 8 }); // head right side <-> head left side
    expect(mirrorPixel('classic', 0, 0)).toBeNull();
  });
});

describe('legacy 64x32 conversion', () => {
  /**
   * Independent reference: the 12 horizontally-flipped area copies used to upgrade
   * a legacy skin, as published in skinview-utils `convertSkinTo1_8` (MIT) and
   * performed by Minecraft Java. Entries are [srcX, srcY, dX, dY, w, h] with
   * destination = src + d.
   */
  function javaReference(src: RgbaImage): RgbaImage {
    const out = createImage(64, 64);
    out.data.set(src.data, 0);
    const copies: Array<[number, number, number, number, number, number]> = [
      [4, 16, 16, 32, 4, 4],
      [8, 16, 16, 32, 4, 4],
      [0, 20, 24, 32, 4, 12],
      [4, 20, 16, 32, 4, 12],
      [8, 20, 8, 32, 4, 12],
      [12, 20, 16, 32, 4, 12],
      [44, 16, -8, 32, 4, 4],
      [48, 16, -8, 32, 4, 4],
      [40, 20, 0, 32, 4, 12],
      [44, 20, -8, 32, 4, 12],
      [48, 20, -16, 32, 4, 12],
      [52, 20, -8, 32, 4, 12],
    ];
    for (const [x, y, dx, dy, w, h] of copies) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          setPixel(out, x + dx + (w - 1 - i), y + dy + j, getPixel(src, x + i, y + j));
        }
      }
    }
    return out;
  }

  it('matches the Java legacy copy table and clears an opaque hat', () => {
    const legacy = createImage(64, 32);
    for (let i = 0; i < legacy.data.length; i += 4) {
      legacy.data[i] = (i / 4) % 251;
      legacy.data[i + 1] = (i / 4) % 7;
      legacy.data[i + 2] = (i / 4) % 13;
      legacy.data[i + 3] = 255;
    }
    const { image, notes } = convertLegacySkin(legacy);
    const reference = javaReference(legacy);
    // compare everything except the hat (cleared because it was fully opaque)
    for (const r of getSkinLayout('classic')) {
      if (r.part === 'head' && r.layer === 'overlay') continue;
      if (r.layer === 'overlay') continue; // legacy skins have no other overlay data
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) expect(getPixel(image, x, y), `${r.part}.${r.face} ${x},${y}`).toEqual(getPixel(reference, x, y));
      }
    }
    const hat = findRegion('classic', 'head', 'overlay', 'front');
    expect(getPixel(image, hat.x, hat.y)[3]).toBe(0);
    expect(notes.join(' ')).toMatch(/Hat layer/);
    expect(validateSkinImage(image, 'classic').ok).toBe(true);
  });
});

describe('templates and model detection', () => {
  it('is deterministic and slim/classic differ only in arms', () => {
    expect(imagesEqual(createTemplateSkin('classic'), createTemplateSkin('classic'))).toBe(true);
    const a = createTemplateSkin('classic');
    const b = createTemplateSkin('slim');
    expect(getPixel(a, 9, 12)).toEqual(getPixel(b, 9, 12)); // head identical
  });

  it('suggests slim when classic-only arm columns are transparent', () => {
    const slim = createBlankSkin('slim');
    expect(suggestModel(slim)).toBe('slim');
    expect(suggestModel(createBlankSkin('classic'))).toBe('classic');
  });

  it('uv debug skin marks the top-left of every base face', () => {
    const dbg = createUvDebugSkin('classic');
    for (const r of getSkinLayout('classic').filter((g) => g.layer === 'base')) {
      expect(getPixel(dbg, r.x, r.y)).toEqual([255, 255, 255, 255]);
    }
    expect(validateSkinImage(dbg, 'classic').ok).toBe(true);
    const copy = cloneImage(dbg);
    expect(imagesEqual(copy, dbg)).toBe(true);
  });
});

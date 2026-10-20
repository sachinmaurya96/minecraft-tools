import { describe, expect, it } from 'vitest';
import { borderBackgroundMask, createImage, fillRect, getPixel, setPixel, type Rgba, type RgbaImage } from '@blockwright/shared';
import { findRegion } from './layout.js';
import { defaultBodyGuides, defaultSideGuides, fitGuides, projectPhotosToSkin, subjectBounds } from './photo.js';

const C = {
  bg: [255, 255, 255, 255] as Rgba,
  head: [200, 150, 120, 255] as Rgba,
  torso: [40, 120, 60, 255] as Rgba,
  rArm: [200, 40, 40, 255] as Rgba,
  lArm: [40, 40, 200, 255] as Rgba,
  rLeg: [90, 90, 20, 255] as Rgba,
  lLeg: [20, 90, 90, 255] as Rgba,
  back: [10, 10, 10, 255] as Rgba,
  side: [250, 200, 0, 255] as Rgba,
};

/** Synthetic front view, 10 px per skin unit (16 x 32 units), character's right arm on the viewer's left. */
function frontPhoto(pad = 0): RgbaImage {
  const img = createImage(160 + 2 * pad, 320 + 2 * pad, C.bg);
  const r = (x: number, y: number, w: number, h: number, c: Rgba) => fillRect(img, { x: x * 10 + pad, y: y * 10 + pad, width: w * 10, height: h * 10 }, c);
  r(4, 0, 8, 8, C.head);
  r(4, 8, 8, 12, C.torso);
  r(0, 8, 4, 12, C.rArm);
  r(12, 8, 4, 12, C.lArm);
  r(4, 20, 4, 12, C.rLeg);
  r(8, 20, 4, 12, C.lLeg);
  return img;
}

function faceColors(img: RgbaImage, part: Parameters<typeof findRegion>[1], face: Parameters<typeof findRegion>[3]) {
  const r = findRegion('classic', part, 'base', face);
  const set = new Set<string>();
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set.add(getPixel(img, x, y).join(','));
  return [...set];
}

describe('photo projection', () => {
  it('copies each guide box onto the matching front face and labels the rest inferred', () => {
    const res = projectPhotosToSkin({ model: 'classic', front: { image: frontPhoto(), guides: defaultBodyGuides('classic', 'front') } });
    expect(faceColors(res.image, 'head', 'front')).toEqual([C.head.join(',')]);
    expect(faceColors(res.image, 'body', 'front')).toEqual([C.torso.join(',')]);
    expect(faceColors(res.image, 'rightArm', 'front')).toEqual([C.rArm.join(',')]);
    expect(faceColors(res.image, 'leftArm', 'front')).toEqual([C.lArm.join(',')]);
    expect(faceColors(res.image, 'rightLeg', 'front')).toEqual([C.rLeg.join(',')]);
    expect(faceColors(res.image, 'leftLeg', 'front')).toEqual([C.lLeg.join(',')]);
    expect(res.sampledFaces).toContain('head.base.front');
    expect(res.inferredFaces).toEqual(expect.arrayContaining(['head.base.back', 'head.base.right', 'head.base.top', 'rightArm.base.left']));
    expect(res.sampledFaces).not.toContain('head.base.back');
    expect(res.warnings.join(' ')).toMatch(/No back photo/);
    // base layer is fully opaque, overlay empty
    const hat = findRegion('classic', 'head', 'overlay', 'front');
    expect(getPixel(res.image, hat.x, hat.y)[3]).toBe(0);
  });

  it('uses the back photo (viewer-mirrored layout) for back faces', () => {
    const back = createImage(160, 320, C.bg);
    fillRect(back, { x: 0, y: 0, width: 160, height: 320 }, C.back);
    // in a back view the character's right arm is on the viewer's right
    fillRect(back, { x: 120, y: 80, width: 40, height: 120 }, C.rArm);
    const res = projectPhotosToSkin({
      model: 'classic',
      front: { image: frontPhoto(), guides: defaultBodyGuides('classic', 'front') },
      back: { image: back, guides: defaultBodyGuides('classic', 'back') },
    });
    expect(faceColors(res.image, 'rightArm', 'back')).toEqual([C.rArm.join(',')]);
    expect(faceColors(res.image, 'leftArm', 'back')).toEqual([C.back.join(',')]);
    expect(res.sampledFaces).toContain('rightArm.base.back');
  });

  it('a background mask keeps background out of over-sized guide boxes', () => {
    const photo = frontPhoto();
    const guides = defaultBodyGuides('classic', 'front');
    guides.head = { x: 0.2, y: 0, w: 0.6, h: 0.25 }; // wider than the 0.25..0.75 head
    const noMask = projectPhotosToSkin({ model: 'classic', front: { image: photo, guides } });
    const head = findRegion('classic', 'head', 'base', 'front');
    expect(getPixel(noMask.image, head.x, head.y + 4)).not.toEqual(C.head); // blended with white
    const mask = borderBackgroundMask(photo, 30);
    const masked = projectPhotosToSkin({ model: 'classic', front: { image: photo, guides, mask } });
    expect(getPixel(masked.image, head.x, head.y + 4)).toEqual(C.head);
  });

  it('samples a side photo onto the near outer limb face; torso side stays approximate', () => {
    const left = createImage(80, 320, C.bg);
    fillRect(left, { x: 0, y: 0, width: 80, height: 320 }, C.side);
    const res = projectPhotosToSkin({
      model: 'classic',
      front: { image: frontPhoto(), guides: defaultBodyGuides('classic', 'front') },
      left: { image: left, guides: defaultSideGuides() },
    });
    expect(faceColors(res.image, 'leftArm', 'left')).toEqual([C.side.join(',')]);
    expect(res.sampledFaces).toContain('leftArm.base.left');
    expect(res.inferredFaces).toContain('body.base.left');
    expect(res.inferredFaces).toContain('rightArm.base.right');
  });

  it('quantizes to the requested colour count and preserves an existing overlay', () => {
    const existing = createImage(64, 64);
    setPixel(existing, 41, 9, [1, 2, 3, 255]);
    const res = projectPhotosToSkin({
      model: 'classic',
      front: { image: frontPhoto(), guides: defaultBodyGuides('classic', 'front') },
      quantizeColors: 4,
      preserveOverlayFrom: existing,
    });
    const colors = new Set<string>();
    for (const part of ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const) {
      for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back'] as const) faceColors(res.image, part, face).forEach((c) => colors.add(c));
    }
    expect(colors.size).toBeLessThanOrEqual(4);
    expect(getPixel(res.image, 41, 9)).toEqual([1, 2, 3, 255]);
  });

  it('fits guides to the subject bounds from a mask', () => {
    const photo = frontPhoto(40);
    const mask = borderBackgroundMask(photo, 30);
    const bounds = subjectBounds(mask, photo.width, photo.height)!;
    expect(bounds.x).toBeCloseTo(40 / 240, 3);
    expect(bounds.w).toBeCloseTo(160 / 240, 3);
    const guides = fitGuides(defaultBodyGuides('classic', 'front'), bounds);
    const res = projectPhotosToSkin({ model: 'classic', front: { image: photo, guides, mask } });
    expect(faceColors(res.image, 'leftLeg', 'front')).toEqual([C.lLeg.join(',')]);
  });
});

import { createImage, getPixel, setPixel, type RgbaImage } from '@blockwright/shared';
import { findRegion, type BodyPart } from './layout.js';
import { mirrorPixel } from './symmetry.js';

export interface LegacyConversion {
  image: RgbaImage;
  notes: string[];
}

/**
 * Convert a legacy 64x32 skin to the 64x64 layout the way Minecraft Java does:
 * copy the top half, then derive the left arm and left leg by mirroring the
 * right ones (faces flipped, right/left sides swapped). If the hat layer has no
 * transparent pixel at all (common in old skins with a solid background) it is
 * cleared, as the game does.
 */
export function convertLegacySkin(src: RgbaImage): LegacyConversion {
  if (src.width !== 64 || src.height !== 32) throw new RangeError('Expected a 64x32 skin');
  const notes: string[] = ['Converted legacy 64x32 skin: left arm and left leg mirrored from the right limbs.'];
  const out = createImage(64, 64);
  out.data.set(src.data, 0);
  const mirrorInto = (from: BodyPart) => {
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back'] as const) {
      const r = findRegion('classic', from, 'base', face);
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const m = mirrorPixel('classic', x, y);
          if (m) setPixel(out, m.x, m.y, getPixel(out, x, y));
        }
      }
    }
  };
  mirrorInto('rightArm');
  mirrorInto('rightLeg');

  // Hat: x 32..63, y 0..15
  let hasTransparent = false;
  for (let y = 0; y < 16 && !hasTransparent; y++) {
    for (let x = 32; x < 64; x++) {
      if (getPixel(out, x, y)[3] < 128) {
        hasTransparent = true;
        break;
      }
    }
  }
  if (!hasTransparent) {
    for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) setPixel(out, x, y, [0, 0, 0, 0]);
    notes.push('Hat layer had no transparent pixels (old-style solid background) and was cleared.');
  }
  return { image: out, notes };
}

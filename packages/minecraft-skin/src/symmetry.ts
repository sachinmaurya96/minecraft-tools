import type { SkinModel } from '@blockwright/shared';
import { findRegion, pixelInfo, type BodyPart, type SkinFace } from './layout.js';

export const MIRROR_PART: Record<BodyPart, BodyPart> = {
  head: 'head',
  body: 'body',
  rightArm: 'leftArm',
  leftArm: 'rightArm',
  rightLeg: 'leftLeg',
  leftLeg: 'rightLeg',
};

export const MIRROR_FACE: Record<SkinFace, SkinFace> = {
  top: 'top',
  bottom: 'bottom',
  front: 'front',
  back: 'back',
  right: 'left',
  left: 'right',
};

/**
 * Atlas position of the pixel that is the mirror image (across the character's
 * left/right symmetry plane) of (x, y). Within every face the mirror flips the
 * horizontal axis; right/left faces swap. This is the same mapping Minecraft
 * uses to derive left limbs from right limbs when converting legacy 64x32 skins.
 * Returns null for pixels outside any face.
 */
export function mirrorPixel(model: SkinModel, x: number, y: number): { x: number; y: number } | null {
  const info = pixelInfo(model, x, y);
  if (!info) return null;
  const { region, localX, localY } = info;
  const target = findRegion(model, MIRROR_PART[region.part], region.layer, MIRROR_FACE[region.face]);
  return { x: target.x + (target.w - 1 - localX), y: target.y + localY };
}

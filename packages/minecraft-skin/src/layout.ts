import type { SkinModel } from '@blockwright/shared';

/**
 * Standard 64x64 Minecraft player-skin atlas (Java Edition 1.8+ layout).
 *
 * Every body part is a box with dimensions (w, h, d) whose six faces are laid
 * out in the conventional "box UV" net starting at texture offset (u, v):
 *
 *            u+d      u+d+w    u+2d+w
 *     v      [ top  ][bottom]
 *     v+d    [right][ front ][ left ][ back ]
 *            u     u+d      u+d+w  u+2d+w  u+2d+2w
 *
 * "right"/"left" are the *character's* right/left. Seen from the front, the
 * character's right arm is on the viewer's left. These offsets are verified in
 * layout.test.ts against the UV code shipped in skinview3d (an independent
 * implementation) so they are not improvised.
 */

export const BODY_PARTS = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const SKIN_LAYERS = ['base', 'overlay'] as const;
export type SkinLayer = (typeof SKIN_LAYERS)[number];

export const SKIN_FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'] as const;
export type SkinFace = (typeof SKIN_FACES)[number];

export const PART_LABELS: Record<BodyPart, string> = {
  head: 'Head',
  body: 'Torso',
  rightArm: 'Right arm',
  leftArm: 'Left arm',
  rightLeg: 'Right leg',
  leftLeg: 'Left leg',
};

export const LAYER_LABELS: Record<SkinLayer, string> = {
  base: 'Base layer',
  overlay: 'Outer layer',
};

export const OVERLAY_LABELS: Record<BodyPart, string> = {
  head: 'Hat',
  body: 'Jacket',
  rightArm: 'Right sleeve',
  leftArm: 'Left sleeve',
  rightLeg: 'Right trouser',
  leftLeg: 'Left trouser',
};

interface PartDef {
  base: [number, number];
  overlay: [number, number];
  /** [width, height, depth] in pixels */
  size: (model: SkinModel) => [number, number, number];
}

const armSize = (model: SkinModel): [number, number, number] => [model === 'slim' ? 3 : 4, 12, 4];

export const PART_DEFS: Record<BodyPart, PartDef> = {
  head: { base: [0, 0], overlay: [32, 0], size: () => [8, 8, 8] },
  body: { base: [16, 16], overlay: [16, 32], size: () => [8, 12, 4] },
  rightArm: { base: [40, 16], overlay: [40, 32], size: armSize },
  leftArm: { base: [32, 48], overlay: [48, 48], size: armSize },
  rightLeg: { base: [0, 16], overlay: [0, 32], size: () => [4, 12, 4] },
  leftLeg: { base: [16, 48], overlay: [0, 48], size: () => [4, 12, 4] },
};

export interface FaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceRegion extends FaceRect {
  part: BodyPart;
  layer: SkinLayer;
  face: SkinFace;
}

export function boxFaces(u: number, v: number, w: number, h: number, d: number): Record<SkinFace, FaceRect> {
  return {
    top: { x: u + d, y: v, w, h: d },
    bottom: { x: u + d + w, y: v, w, h: d },
    right: { x: u, y: v + d, w: d, h },
    front: { x: u + d, y: v + d, w, h },
    left: { x: u + d + w, y: v + d, w: d, h },
    back: { x: u + 2 * d + w, y: v + d, w, h },
  };
}

const layoutCache = new Map<SkinModel, FaceRegion[]>();

/** All 72 face regions (6 parts x 2 layers x 6 faces) for a model. */
export function getSkinLayout(model: SkinModel): FaceRegion[] {
  const cached = layoutCache.get(model);
  if (cached) return cached;
  const regions: FaceRegion[] = [];
  for (const part of BODY_PARTS) {
    const def = PART_DEFS[part];
    const [w, h, d] = def.size(model);
    for (const layer of SKIN_LAYERS) {
      const [u, v] = def[layer];
      const faces = boxFaces(u, v, w, h, d);
      for (const face of SKIN_FACES) regions.push({ part, layer, face, ...faces[face] });
    }
  }
  layoutCache.set(model, regions);
  return regions;
}

export function findRegion(model: SkinModel, part: BodyPart, layer: SkinLayer, face: SkinFace): FaceRegion {
  const r = getSkinLayout(model).find((g) => g.part === part && g.layer === layer && g.face === face);
  if (!r) throw new Error(`No region ${part}/${layer}/${face}`);
  return r;
}

const lookupCache = new Map<SkinModel, Int16Array>();

/** 64x64 table: index into getSkinLayout(model) for each pixel, or -1 if unused. */
export function getPixelLookup(model: SkinModel): Int16Array {
  const cached = lookupCache.get(model);
  if (cached) return cached;
  const table = new Int16Array(64 * 64).fill(-1);
  getSkinLayout(model).forEach((r, idx) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (table[y * 64 + x] !== -1) throw new Error(`Overlapping skin regions at ${x},${y}`);
        table[y * 64 + x] = idx;
      }
    }
  });
  lookupCache.set(model, table);
  return table;
}

export interface PixelInfo {
  region: FaceRegion;
  /** Pixel position inside the face rectangle. */
  localX: number;
  localY: number;
}

export function pixelInfo(model: SkinModel, x: number, y: number): PixelInfo | null {
  if (x < 0 || y < 0 || x >= 64 || y >= 64) return null;
  const idx = getPixelLookup(model)[y * 64 + x]!;
  if (idx < 0) return null;
  const region = getSkinLayout(model)[idx]!;
  return { region, localX: x - region.x, localY: y - region.y };
}

export function regionKey(r: Pick<FaceRegion, 'part' | 'layer' | 'face'>): string {
  return `${r.part}.${r.layer}.${r.face}`;
}

export function describePixel(model: SkinModel, x: number, y: number): string {
  const info = pixelInfo(model, x, y);
  if (!info) return 'Unused area (ignored by the game)';
  const { region } = info;
  const layerName = region.layer === 'overlay' ? OVERLAY_LABELS[region.part] : PART_LABELS[region.part];
  return `${layerName} · ${region.face} face · ${LAYER_LABELS[region.layer]}`;
}

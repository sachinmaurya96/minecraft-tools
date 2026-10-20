import {
  createImage,
  hexToRgba,
  LIMITS,
  resizeNearest,
  type Cube,
  type RgbaImage,
  type VoxelFace,
} from '@blockwright/shared';
import { FACE_ORDER, faceTexelSize, type TexRect } from './faces.js';
import { decodeFacePixels } from './model.js';

/**
 * Texture atlas for a cuboid model (PLAN §9.6).
 *
 * Strategy (deterministic):
 * 1. "exact": every face gets its own non-overlapping rectangle of one texel per
 *    model unit, filled with its colour or painted/sampled bitmap. Editable later
 *    in Blockbench face by face.
 * 2. "palette": if that does not fit in `preferExactUpTo`, solid-colour faces share
 *    one 4x4 swatch per distinct colour and map onto its inner 2x2 texels (1 texel
 *    of padding against bleeding); bitmap faces keep exact rectangles.
 * 3. If neither fits in `maxSize`, packing fails with MODEL_TOO_COMPLEX.
 * Sizes are powers of two. Unused texels are transparent.
 */

export class ModelTooComplexError extends Error {
  readonly code = 'MODEL_TOO_COMPLEX';
}

export interface PackedFace {
  cubeId: string;
  face: VoxelFace;
  /** Rectangle the face's UV covers. */
  rect: TexRect;
  shared: boolean;
}

export interface Atlas {
  width: number;
  height: number;
  image: RgbaImage;
  mode: 'exact' | 'palette';
  faces: Map<string, PackedFace>;
  /** True if any texel used by a face has alpha < 255 (needs an alpha-test material). */
  hasTransparency: boolean;
  usedTexels: number;
}

export interface AtlasOptions {
  maxSize?: number;
  preferExactUpTo?: number;
}

export const faceKey = (cubeId: string, face: VoxelFace) => `${cubeId}:${face}`;

interface FaceContent {
  cubeId: string;
  face: VoxelFace;
  w: number;
  h: number;
  /** Either a bitmap (exactly w x h) or a solid colour. */
  bitmap?: RgbaImage;
  color?: string;
}

export function resolveFaceContents(cubes: readonly Cube[]): FaceContent[] {
  const out: FaceContent[] = [];
  for (const cube of cubes) {
    for (const face of FACE_ORDER) {
      const [w, h] = faceTexelSize(cube.size, face);
      const paint = cube.faces?.[face] ?? { kind: 'color' as const, color: cube.color };
      if (paint.kind === 'hidden') continue;
      if (paint.kind === 'pixels') {
        let bmp: RgbaImage = { width: paint.width, height: paint.height, data: decodeFacePixels(paint) };
        if (bmp.width !== w || bmp.height !== h) bmp = resizeNearest(bmp, w, h);
        out.push({ cubeId: cube.id, face, w, h, bitmap: bmp });
      } else {
        out.push({ cubeId: cube.id, face, w, h, color: paint.color.toLowerCase() });
      }
    }
  }
  return out;
}

interface Item {
  w: number;
  h: number;
  index: number;
}

function shelfPack(items: Item[], width: number): { pos: Array<[number, number]>; height: number } | null {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w || a.index - b.index);
  const pos: Array<[number, number]> = new Array(items.length);
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const it of order) {
    if (it.w > width) return null;
    if (x + it.w > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    pos[it.index] = [x, y];
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  return { pos, height: y + shelf };
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

function bestPacking(items: Item[], maxSize: number) {
  let best: { width: number; height: number; pos: Array<[number, number]> } | null = null;
  for (let width = 16; width <= maxSize; width *= 2) {
    const packed = shelfPack(items, width);
    if (!packed) continue;
    const height = Math.max(16, nextPow2(packed.height));
    if (height > maxSize) continue;
    const area = width * height;
    const bestArea = best ? best.width * best.height : Infinity;
    if (
      !best ||
      area < bestArea ||
      (area === bestArea && Math.max(width, height) < Math.max(best.width, best.height))
    ) {
      best = { width, height, pos: packed.pos };
    }
  }
  return best;
}

export function packAtlas(cubes: readonly Cube[], options: AtlasOptions = {}): Atlas {
  const maxSize = options.maxSize ?? LIMITS.maxAtlasSize;
  const preferExactUpTo = Math.min(options.preferExactUpTo ?? 512, maxSize);
  const contents = resolveFaceContents(cubes);

  // 1. exact
  const exactItems = contents.map((c, index) => ({ w: c.w, h: c.h, index }));
  const exact = bestPacking(exactItems, preferExactUpTo);
  if (exact) {
    const image = createImage(exact.width, exact.height);
    const faces = new Map<string, PackedFace>();
    contents.forEach((c, i) => {
      const [x, y] = exact.pos[i]!;
      paint(image, { x, y, w: c.w, h: c.h }, c);
      faces.set(faceKey(c.cubeId, c.face), { cubeId: c.cubeId, face: c.face, rect: { x, y, w: c.w, h: c.h }, shared: false });
    });
    return finish(image, faces, 'exact');
  }

  // 2. palette: shared 4x4 swatches for solid colours
  const colors = [...new Set(contents.filter((c) => c.color).map((c) => c.color!))].sort();
  const bitmapFaces = contents.filter((c) => c.bitmap);
  const items: Item[] = [
    ...colors.map((_, index) => ({ w: 4, h: 4, index })),
    ...bitmapFaces.map((c, i) => ({ w: c.w, h: c.h, index: colors.length + i })),
  ];
  const packed = bestPacking(items, maxSize);
  if (!packed) {
    throw new ModelTooComplexError(
      `The model needs more texture space than ${maxSize}x${maxSize}. Reduce the number of painted faces or cubes.`,
    );
  }
  const image = createImage(packed.width, packed.height);
  const swatch = new Map<string, TexRect>();
  colors.forEach((color, i) => {
    const [x, y] = packed.pos[i]!;
    const rgba = hexToRgba(color);
    for (let yy = 0; yy < 4; yy++) {
      for (let xx = 0; xx < 4; xx++) image.data.set(rgba, ((y + yy) * image.width + x + xx) * 4);
    }
    swatch.set(color, { x: x + 1, y: y + 1, w: 2, h: 2 });
  });
  const faces = new Map<string, PackedFace>();
  for (const c of contents) {
    if (c.color) {
      faces.set(faceKey(c.cubeId, c.face), { cubeId: c.cubeId, face: c.face, rect: swatch.get(c.color)!, shared: true });
    }
  }
  bitmapFaces.forEach((c, i) => {
    const [x, y] = packed.pos[colors.length + i]!;
    paint(image, { x, y, w: c.w, h: c.h }, c);
    faces.set(faceKey(c.cubeId, c.face), { cubeId: c.cubeId, face: c.face, rect: { x, y, w: c.w, h: c.h }, shared: false });
  });
  return finish(image, faces, 'palette');
}

function paint(image: RgbaImage, rect: TexRect, c: FaceContent): void {
  if (c.bitmap) {
    for (let y = 0; y < rect.h; y++) {
      const src = y * c.bitmap.width * 4;
      image.data.set(c.bitmap.data.subarray(src, src + rect.w * 4), ((rect.y + y) * image.width + rect.x) * 4);
    }
    return;
  }
  const rgba = hexToRgba(c.color!);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) image.data.set(rgba, ((rect.y + y) * image.width + rect.x + x) * 4);
  }
}

function finish(image: RgbaImage, faces: Map<string, PackedFace>, mode: Atlas['mode']): Atlas {
  let hasTransparency = false;
  const seen = new Set<string>();
  let usedTexels = 0;
  for (const f of faces.values()) {
    const key = `${f.rect.x},${f.rect.y},${f.rect.w},${f.rect.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usedTexels += f.rect.w * f.rect.h;
    for (let y = f.rect.y; y < f.rect.y + f.rect.h; y++) {
      for (let x = f.rect.x; x < f.rect.x + f.rect.w; x++) {
        if (image.data[(y * image.width + x) * 4 + 3]! < 255) hasTransparency = true;
      }
    }
  }
  return { width: image.width, height: image.height, image, mode, faces, hasTransparency, usedTexels };
}

/** Read a face's natural bitmap back out of an atlas (used by tests and the face painter). */
export function readFaceBitmap(atlas: Atlas, cubeId: string, face: VoxelFace): RgbaImage {
  const f = atlas.faces.get(faceKey(cubeId, face));
  if (!f) throw new Error(`No face ${cubeId}:${face} in atlas`);
  const out = createImage(f.rect.w, f.rect.h);
  for (let y = 0; y < f.rect.h; y++) {
    const src = ((f.rect.y + y) * atlas.width + f.rect.x) * 4;
    out.data.set(atlas.image.data.subarray(src, src + f.rect.w * 4), y * f.rect.w * 4);
  }
  return out;
}


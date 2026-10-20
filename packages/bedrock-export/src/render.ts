import { createImage, getPixel, setPixel, type Rgba, type RgbaImage } from '@blockwright/shared';
import { readFaceBitmap, type Atlas } from './atlas.js';
import type { EntityModel } from './model.js';

/**
 * Orthographic front (north) view rasterised from the atlas — used for pack
 * icons and thumbnails. Bone/cube rotations are ignored (approximate icon).
 * In the front view screen-right is +X of the Bedrock frame and the north
 * face bitmap's column 0 sits at the cube's minimum X.
 */
export function renderFrontView(model: EntityModel, atlas: Atlas, size = 128, background: Rgba = [28, 32, 44, 255]): RgbaImage {
  const out = createImage(size, size, background);
  const cubes = model.cubes.filter((c) => c.faces?.north?.kind !== 'hidden' && c.size[0] > 0 && c.size[1] > 0);
  if (cubes.length === 0) return out;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const c of cubes) {
    const inf = c.inflate ?? 0;
    x0 = Math.min(x0, c.origin[0] - inf);
    x1 = Math.max(x1, c.origin[0] + c.size[0] + inf);
    y0 = Math.min(y0, c.origin[1] - inf);
    y1 = Math.max(y1, c.origin[1] + c.size[1] + inf);
  }
  const margin = Math.max(2, Math.round(size * 0.06));
  const scale = (size - 2 * margin) / Math.max(x1 - x0, y1 - y0);
  const offX = (size - (x1 - x0) * scale) / 2;
  const offY = (size - (y1 - y0) * scale) / 2;
  const bitmaps = new Map(cubes.map((c) => [c.id, readFaceBitmap(atlas, c.id, 'north')]));
  for (let py = 0; py < size; py++) {
    const y = y1 - (py + 0.5 - offY) / scale;
    for (let px = 0; px < size; px++) {
      const x = x0 + (px + 0.5 - offX) / scale;
      let best: (typeof cubes)[number] | null = null;
      for (const c of cubes) {
        const inf = c.inflate ?? 0;
        if (x < c.origin[0] - inf || x >= c.origin[0] + c.size[0] + inf) continue;
        if (y < c.origin[1] - inf || y >= c.origin[1] + c.size[1] + inf) continue;
        // closest to a camera at -Z wins; outer layers (inflate) win ties
        if (!best || c.origin[2] - inf < best.origin[2] - (best.inflate ?? 0)) {
          const bmp = bitmaps.get(c.id)!;
          const i = Math.min(bmp.width - 1, Math.floor(((x - c.origin[0] + inf) / (c.size[0] + 2 * inf)) * bmp.width));
          const j = Math.min(bmp.height - 1, Math.floor(((c.origin[1] + c.size[1] + inf - y) / (c.size[1] + 2 * inf)) * bmp.height));
          if (getPixel(bmp, i, j)[3] < 128) continue; // transparent texel: look behind
          best = c;
          setPixel(out, px, py, [...getPixel(bmp, i, j).slice(0, 3), 255] as Rgba);
        }
      }
    }
  }
  return out;
}

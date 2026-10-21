import type { Rgba, SkinModel } from '@blockwright/shared';
import { mirrorPixel, pixelInfo } from '@blockwright/minecraft-skin';

/**
 * Pure 64x64 skin paint operations on RGBA buffers. They return a new buffer
 * (or the same one when nothing changed) so undo snapshots stay valid.
 */
export type SkinPixels = Uint8ClampedArray;

export interface PaintResult {
  pixels: SkinPixels;
  changed: number;
  /** Set when a request was refused (e.g. erasing the base layer). */
  refused?: string;
}

const idx = (x: number, y: number) => (y * 64 + x) * 4;

function targets(model: SkinModel, x: number, y: number, mirror: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [[x, y]];
  if (mirror) {
    const m = mirrorPixel(model, x, y);
    if (m && (m.x !== x || m.y !== y)) out.push([m.x, m.y]);
  }
  return out;
}

export function paintPixels(src: SkinPixels, model: SkinModel, points: Array<[number, number]>, color: Rgba, mirror: boolean): PaintResult {
  let out: SkinPixels | null = null;
  let changed = 0;
  for (const [px, py] of points) {
    if (px < 0 || py < 0 || px >= 64 || py >= 64) continue;
    for (const [x, y] of targets(model, px, py, mirror)) {
      const info = pixelInfo(model, x, y);
      // base layer must stay opaque: paint it with alpha 255
      const c: Rgba = info?.region.layer === 'base' ? [color[0], color[1], color[2], 255] : color;
      const i = idx(x, y);
      const p = out ?? src;
      if (p[i] === c[0] && p[i + 1] === c[1] && p[i + 2] === c[2] && p[i + 3] === c[3]) continue;
      out ??= new Uint8ClampedArray(src);
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = c[3];
      changed++;
    }
  }
  return { pixels: out ?? src, changed };
}

export function erasePixels(src: SkinPixels, model: SkinModel, points: Array<[number, number]>, mirror: boolean): PaintResult {
  let out: SkinPixels | null = null;
  let changed = 0;
  let refused: string | undefined;
  for (const [px, py] of points) {
    for (const [x, y] of targets(model, px, py, mirror)) {
      const info = pixelInfo(model, x, y);
      if (info?.region.layer === 'base') {
        refused = 'The base layer must stay opaque. Paint over it instead, or erase on the outer layer.';
        continue;
      }
      const i = idx(x, y);
      if ((out ?? src)[i + 3] === 0 && (out ?? src)[i] === 0) continue;
      out ??= new Uint8ClampedArray(src);
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      changed++;
    }
  }
  return { pixels: out ?? src, changed, ...(refused ? { refused } : {}) };
}

/** Flood fill (4-connected, exact colour match) limited to the face region that was clicked. */
export function fillRegion(src: SkinPixels, model: SkinModel, x: number, y: number, color: Rgba, mirror: boolean): PaintResult {
  let pixels = src;
  let changed = 0;
  for (const [sx, sy] of targets(model, x, y, mirror)) {
    const info = pixelInfo(model, sx, sy);
    if (!info) continue;
    const r = info.region;
    const c: Rgba = r.layer === 'base' ? [color[0], color[1], color[2], 255] : color;
    const start = idx(sx, sy);
    const target = [pixels[start], pixels[start + 1], pixels[start + 2], pixels[start + 3]];
    if (target[0] === c[0] && target[1] === c[1] && target[2] === c[2] && target[3] === c[3]) continue;
    const out = new Uint8ClampedArray(pixels);
    const stack: Array<[number, number]> = [[sx, sy]];
    const seen = new Set<number>();
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < r.x || cy < r.y || cx >= r.x + r.w || cy >= r.y + r.h) continue;
      const key = cy * 64 + cx;
      if (seen.has(key)) continue;
      seen.add(key);
      const i = key * 4;
      if (out[i] !== target[0] || out[i + 1] !== target[1] || out[i + 2] !== target[2] || out[i + 3] !== target[3]) continue;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = c[3];
      changed++;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    pixels = out;
  }
  return { pixels, changed };
}

export function pickColor(src: SkinPixels, x: number, y: number): Rgba | null {
  const i = idx(x, y);
  if (src[i + 3] === 0) return null;
  return [src[i]!, src[i + 1]!, src[i + 2]!, src[i + 3]!];
}

/** Integer points on the segment between two pixels (so fast strokes have no gaps). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

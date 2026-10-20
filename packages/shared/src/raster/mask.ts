import { colorDistanceSq } from './color.js';
import { createImage, type RgbaImage } from './image.js';
import { extractPalette } from './palette.js';

/**
 * Deterministic background mask (1 = background) by flood-filling from the image
 * border through pixels close to one of the dominant border colours. Works for
 * plain/studio backgrounds; it is *not* semantic segmentation and the UI says so.
 *
 * `tolerance` is an RGB distance (0..441). Fully transparent pixels always count
 * as background.
 */
export function borderBackgroundMask(img: RgbaImage, tolerance = 40): Uint8Array {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  // dominant colours along the border
  const border = createImage(2 * (w + h), 1);
  let k = 0;
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    border.data.set(data.subarray(i, i + 4), k * 4);
    k++;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  const seeds = extractPalette(border, 3).filter((e) => e.share >= 0.1).map((e) => e.color);
  const tolSq = tolerance * tolerance;
  const isBackground = (p: number) => {
    const i = p * 4;
    if (data[i + 3]! < 16) return true;
    const c = [data[i]!, data[i + 1]!, data[i + 2]!];
    return seeds.some((s) => colorDistanceSq(c, s) <= tolSq);
  };
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const visit = (p: number) => {
    if (mask[p]) return;
    if (!isBackground(p)) return;
    mask[p] = 1;
    queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++]!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }
  return mask;
}

export function maskCoverage(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) n += v;
  return mask.length ? n / mask.length : 0;
}

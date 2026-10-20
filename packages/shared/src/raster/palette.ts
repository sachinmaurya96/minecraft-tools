import { colorDistanceSq } from './color.js';
import { createImage, type Rgba, type RgbaImage } from './image.js';

export interface PaletteEntry {
  color: Rgba;
  /** Fraction of sampled pixels assigned to this colour (0..1). */
  share: number;
}

interface Box {
  pixels: number[][]; // [r,g,b]
}

function channelRange(box: Box, ch: number): number {
  let min = 255;
  let max = 0;
  for (const p of box.pixels) {
    const v = p[ch]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/**
 * Split index (1..n-1) of channel-sorted pixels that minimises the summed squared
 * error of both halves along that channel. Unlike a plain median split this puts
 * the cut on the boundary between distinct colours.
 */
function bestSplit(sorted: number[][], ch: number): number {
  const n = sorted.length;
  const prefix = new Float64Array(n + 1);
  const prefixSq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = sorted[i]![ch]!;
    prefix[i + 1] = prefix[i]! + v;
    prefixSq[i + 1] = prefixSq[i]! + v * v;
  }
  let best = Math.floor(n / 2);
  let bestErr = Infinity;
  for (let k = 1; k < n; k++) {
    // only cut between different values so identical colours stay together
    if (sorted[k]![ch] === sorted[k - 1]![ch]) continue;
    const s1 = prefix[k]!;
    const s2 = prefix[n]! - s1;
    const err = prefixSq[k]! - (s1 * s1) / k + (prefixSq[n]! - prefixSq[k]! - (s2 * s2) / (n - k));
    if (err < bestErr) {
      bestErr = err;
      best = k;
    }
  }
  return best;
}

/**
 * Deterministic variance-minimising median-cut palette extraction. Pixels with alpha < 128 or
 * `mask[p] === 1` are ignored. Large images are sampled on a fixed stride so
 * the result is reproducible.
 */
export function extractPalette(img: RgbaImage, maxColors: number, mask?: Uint8Array, maxSamples = 40000): PaletteEntry[] {
  const total = img.width * img.height;
  const stride = Math.max(1, Math.floor(total / maxSamples));
  const pixels: number[][] = [];
  for (let p = 0; p < total; p += stride) {
    if (mask && mask[p]) continue;
    const i = p * 4;
    if (img.data[i + 3]! < 128) continue;
    pixels.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]);
  }
  if (pixels.length === 0) return [];
  const boxes: Box[] = [{ pixels }];
  while (boxes.length < maxColors) {
    // split the box with the largest (range * population)
    let best = -1;
    let bestScore = 0;
    let bestCh = 0;
    boxes.forEach((box, idx) => {
      if (box.pixels.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        const score = channelRange(box, ch) * box.pixels.length;
        if (score > bestScore) {
          bestScore = score;
          best = idx;
          bestCh = ch;
        }
      }
    });
    if (best < 0 || bestScore === 0) break;
    const box = boxes[best]!;
    box.pixels.sort((a, b) => a[bestCh]! - b[bestCh]! || a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
    const cut = bestSplit(box.pixels, bestCh);
    boxes.splice(best, 1, { pixels: box.pixels.slice(0, cut) }, { pixels: box.pixels.slice(cut) });
  }
  const entries = boxes
    .filter((b) => b.pixels.length > 0)
    .map((b) => {
      const sum = [0, 0, 0];
      for (const p of b.pixels) {
        sum[0]! += p[0]!;
        sum[1]! += p[1]!;
        sum[2]! += p[2]!;
      }
      const n = b.pixels.length;
      return {
        color: [Math.round(sum[0]! / n), Math.round(sum[1]! / n), Math.round(sum[2]! / n), 255] as Rgba,
        share: n / pixels.length,
      };
    });
  entries.sort((a, b) => b.share - a.share);
  return entries;
}

export function nearestPaletteColor(c: Rgba | readonly number[], palette: readonly Rgba[]): Rgba {
  let best = palette[0]!;
  let bestD = Infinity;
  for (const p of palette) {
    const d = colorDistanceSq(c, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Map every opaque pixel to its nearest palette colour (alpha preserved). */
export function quantizeImage(img: RgbaImage, palette: readonly Rgba[]): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]!;
    if (a === 0 || palette.length === 0) {
      out.data.set(img.data.subarray(i, i + 4), i);
      continue;
    }
    const c = nearestPaletteColor([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!], palette);
    out.data[i] = c[0];
    out.data[i + 1] = c[1];
    out.data[i + 2] = c[2];
    out.data[i + 3] = a;
  }
  return out;
}

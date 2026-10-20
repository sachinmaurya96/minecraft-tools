import { createImage, type RgbaImage, type Rect } from './image.js';

export interface ResampleResult {
  image: RgbaImage;
  /**
   * Fraction (0..1) of each output pixel's source area that carried usable
   * (unmasked, non-transparent) colour. Low coverage means the value is a guess.
   */
  coverage: Float32Array;
}

/**
 * Area-average a (possibly fractional) source rectangle down to outW x outH.
 * `mask` (same size as src, 1 = ignore) excludes background pixels; transparent
 * pixels are weighted by alpha. Output pixels are fully opaque where coverage > 0
 * and fully transparent where nothing usable was found.
 */
export function resampleArea(
  src: RgbaImage,
  rect: Rect,
  outW: number,
  outH: number,
  mask?: Uint8Array,
): ResampleResult {
  const out = createImage(outW, outH);
  const coverage = new Float32Array(outW * outH);
  const sx = rect.width / outW;
  const sy = rect.height / outH;
  for (let oy = 0; oy < outH; oy++) {
    const y0 = rect.y + oy * sy;
    const y1 = y0 + sy;
    for (let ox = 0; ox < outW; ox++) {
      const x0 = rect.x + ox * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      let area = 0;
      const iy0 = Math.max(0, Math.floor(y0));
      const iy1 = Math.min(src.height, Math.ceil(y1));
      const ix0 = Math.max(0, Math.floor(x0));
      const ix1 = Math.min(src.width, Math.ceil(x1));
      for (let iy = iy0; iy < iy1; iy++) {
        const wy = Math.min(y1, iy + 1) - Math.max(y0, iy);
        if (wy <= 0) continue;
        for (let ix = ix0; ix < ix1; ix++) {
          const wx = Math.min(x1, ix + 1) - Math.max(x0, ix);
          if (wx <= 0) continue;
          const cellArea = wx * wy;
          area += cellArea;
          const p = iy * src.width + ix;
          if (mask && mask[p]) continue;
          const i = p * 4;
          const alpha = src.data[i + 3]! / 255;
          if (alpha <= 0) continue;
          const w = cellArea * alpha;
          r += src.data[i]! * w;
          g += src.data[i + 1]! * w;
          b += src.data[i + 2]! * w;
          wsum += w;
        }
      }
      const o = oy * outW + ox;
      coverage[o] = area > 0 ? wsum / area : 0;
      if (wsum > 0) {
        out.data[o * 4] = Math.round(r / wsum);
        out.data[o * 4 + 1] = Math.round(g / wsum);
        out.data[o * 4 + 2] = Math.round(b / wsum);
        out.data[o * 4 + 3] = 255;
      }
    }
  }
  return { image: out, coverage };
}

/** Nearest-neighbour resize (used to resample painted face bitmaps after a resize). */
export function resizeNearest(src: RgbaImage, outW: number, outH: number): RgbaImage {
  const out = createImage(outW, outH);
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / outH));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / outW));
      const si = (sy * src.width + sx) * 4;
      out.data.set(src.data.subarray(si, si + 4), (y * outW + x) * 4);
    }
  }
  return out;
}

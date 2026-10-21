/**
 * Minimal, dependency-free RGBA raster type used everywhere pixels must be exact
 * (skins, entity atlases). Browser canvases premultiply alpha and can alter RGB
 * of translucent pixels, so editable pixel data never round-trips through a canvas.
 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, 4 bytes per pixel, length = width * height * 4. */
  readonly data: Uint8ClampedArray;
}

export type Rgba = [number, number, number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createImage(width: number, height: number, fill: Rgba = [0, 0, 0, 0]): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid image size ${width}x${height}`);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill.some((c) => c !== 0)) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

export function imageFromData(width: number, height: number, data: ArrayLike<number>): RgbaImage {
  if (data.length !== width * height * 4) {
    throw new RangeError(`Expected ${width * height * 4} bytes for ${width}x${height} RGBA, got ${data.length}`);
  }
  return { width, height, data: Uint8ClampedArray.from(data) };
}

export function cloneImage(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function getPixel(img: RgbaImage, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
}

export function setPixel(img: RgbaImage, x: number, y: number, c: Rgba): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = c[3];
}

export function inBounds(img: RgbaImage, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < img.width && y < img.height;
}

export function fillRect(img: RgbaImage, rect: Rect, c: Rgba): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) setPixel(img, x, y, c);
  }
}

export function cropImage(img: RgbaImage, rect: Rect): RgbaImage {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.floor(rect.x + rect.width));
  const y1 = Math.min(img.height, Math.floor(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) throw new RangeError('Crop rectangle is outside the image');
  const out = createImage(x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y++) {
    const src = (y * img.width + x0) * 4;
    out.data.set(img.data.subarray(src, src + (x1 - x0) * 4), (y - y0) * out.width * 4);
  }
  return out;
}

/** Rotate clockwise by 0/90/180/270 degrees. */
export function rotateImage(img: RgbaImage, degrees: 0 | 90 | 180 | 270): RgbaImage {
  if (degrees === 0) return cloneImage(img);
  const { width: w, height: h } = img;
  const out = degrees === 180 ? createImage(w, h) : createImage(h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (degrees === 90) {
        nx = h - 1 - y;
        ny = x;
      } else if (degrees === 180) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      setPixel(out, nx, ny, getPixel(img, x, y));
    }
  }
  return out;
}

export function flipHorizontal(img: RgbaImage): RgbaImage {
  const out = createImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) setPixel(out, img.width - 1 - x, y, getPixel(img, x, y));
  }
  return out;
}

/** Copy `src` into `dst` at (dx, dy). Pixels are replaced, not blended. */
export function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      setPixel(dst, tx, ty, getPixel(src, x, y));
    }
  }
}

export function imagesEqual(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Number of pixels that differ between two equally sized images. */
export function countDifferentPixels(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('Images differ in size');
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
      n++;
    }
  }
  return n;
}

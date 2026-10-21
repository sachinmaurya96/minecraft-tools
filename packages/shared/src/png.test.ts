import { describe, expect, it } from 'vitest';
import { encode } from 'fast-png';
import { createImage, imagesEqual, setPixel } from './index.js';
import { decodePngToRgba, encodeRgbaPng, PngDecodeError } from './index.js';

describe('png codec', () => {
  it('round-trips exact RGBA including RGB under zero alpha', () => {
    const img = createImage(64, 64);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 37) % 256;
    setPixel(img, 3, 3, [200, 10, 20, 0]); // canvas round-trips would zero this RGB
    setPixel(img, 4, 3, [17, 99, 250, 1]);
    const bytes = encodeRgbaPng(img);
    const { image, info } = decodePngToRgba(bytes);
    expect(info).toMatchObject({ width: 64, height: 64, depth: 8, channels: 4, colorType: 'rgba', converted: false });
    expect(imagesEqual(image, img)).toBe(true);
  });

  it('rejects non-PNG and corrupt data', () => {
    expect(() => decodePngToRgba(new TextEncoder().encode('GIF89a not a png'))).toThrow(PngDecodeError);
    const bytes = encodeRgbaPng(createImage(8, 8, [1, 2, 3, 255]));
    const corrupt = bytes.slice();
    corrupt[corrupt.length - 20]! ^= 0xff; // flip bits inside IDAT/IEND -> CRC mismatch
    expect(() => decodePngToRgba(corrupt)).toThrow(PngDecodeError);
    expect(() => decodePngToRgba(bytes.slice(0, 30))).toThrow(PngDecodeError);
  });

  it('expands RGB, grey+alpha and 16-bit images to 8-bit RGBA', () => {
    const rgb = encode({ width: 2, height: 1, data: new Uint8Array([10, 20, 30, 40, 50, 60]), channels: 3, depth: 8 });
    expect(Array.from(decodePngToRgba(rgb).image.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    const ga = encode({ width: 1, height: 1, data: new Uint8Array([128, 64]), channels: 2, depth: 8 });
    expect(Array.from(decodePngToRgba(ga).image.data)).toEqual([128, 128, 128, 64]);
    const deep = encode({ width: 1, height: 1, data: new Uint16Array([65535, 0, 257 * 100, 65535]), channels: 4, depth: 16 });
    const d = decodePngToRgba(deep);
    expect(Array.from(d.image.data)).toEqual([255, 0, 100, 255]);
    expect(d.info.converted).toBe(true);
  });

  it('decodes indexed PNGs with sub-byte depth and a transparent palette entry', () => {
    // 3x2 image, 2-bit indices, rows are byte aligned (3 px * 2 bit = 6 bit -> 1 byte per row)
    const indices = [0, 1, 2, 3, 2, 1];
    const packed = new Uint8Array(2);
    indices.forEach((v, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      packed[row]! |= v << (6 - col * 2);
    });
    const png = encode({
      width: 3,
      height: 2,
      data: packed,
      depth: 2,
      channels: 1,
      palette: [
        [255, 0, 0, 0],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [9, 9, 9, 255],
      ],
    });
    const { image, info } = decodePngToRgba(png);
    expect(info.colorType).toBe('indexed');
    expect(Array.from(image.data.subarray(0, 12))).toEqual([255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255]);
    expect(Array.from(image.data.subarray(12, 24))).toEqual([9, 9, 9, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
  });
});

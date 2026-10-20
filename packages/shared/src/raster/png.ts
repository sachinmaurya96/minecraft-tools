import { decode, encode, hasPngSignature } from 'fast-png';
import { createImage, type RgbaImage } from './image.js';

export { hasPngSignature };

export type PngColorType = 'gray' | 'gray-alpha' | 'rgb' | 'rgba' | 'indexed';

export interface PngInfo {
  width: number;
  height: number;
  depth: number;
  channels: number;
  colorType: PngColorType;
  /** True if the source needed conversion to 8-bit RGBA. */
  converted: boolean;
}

export class PngDecodeError extends Error {}

/**
 * Decode any standard PNG into exact 8-bit RGBA (CRC checked). 16-bit samples
 * are reduced to 8-bit; grey, RGB and indexed images (with tRNS) are expanded.
 */
export function decodePngToRgba(bytes: Uint8Array): { image: RgbaImage; info: PngInfo } {
  if (!hasPngSignature(bytes)) throw new PngDecodeError('Not a PNG file (bad signature)');
  let png;
  try {
    png = decode(bytes, { checkCrc: true });
  } catch (err) {
    throw new PngDecodeError(`Corrupt PNG: ${(err as Error).message}`);
  }
  const { width, height, depth, channels } = png;
  if (!width || !height) throw new PngDecodeError('PNG has zero size');
  const out = createImage(width, height);
  const n = width * height;
  const src = png.data;
  const to8 = depth === 16 ? (v: number) => Math.round(v / 257) : (v: number) => v;
  // Sub-byte depths (1/2/4, only for grey and indexed) stay bit-packed in
  // byte-aligned rows; unpack sample `p` (single channel) with the row stride.
  const rowBytes = Math.ceil((width * depth) / 8);
  const packedSample = (p: number): number => {
    const x = p % width;
    const y = (p - x) / width;
    const bit = x * depth;
    const byte = src[y * rowBytes + (bit >> 3)]!;
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const sample1 = depth < 8 ? packedSample : (p: number) => src[p]!;
  let colorType: PngColorType;

  if (png.palette) {
    colorType = 'indexed';
    const palette = png.palette;
    for (let p = 0; p < n; p++) {
      const entry = palette[sample1(p)];
      if (!entry) throw new PngDecodeError('Palette index out of range');
      out.data[p * 4] = entry[0]!;
      out.data[p * 4 + 1] = entry[1]!;
      out.data[p * 4 + 2] = entry[2]!;
      out.data[p * 4 + 3] = entry[3] ?? 255;
    }
  } else if (channels === 4 || channels === 3) {
    colorType = channels === 4 ? 'rgba' : 'rgb';
    const key = channels === 3 && png.transparency ? Array.from(png.transparency) : null;
    for (let p = 0; p < n; p++) {
      const r = src[p * channels]!;
      const g = src[p * channels + 1]!;
      const b = src[p * channels + 2]!;
      const transparent = key !== null && r === key[0] && g === key[1] && b === key[2];
      out.data[p * 4] = to8(r);
      out.data[p * 4 + 1] = to8(g);
      out.data[p * 4 + 2] = to8(b);
      out.data[p * 4 + 3] = channels === 4 ? to8(src[p * 4 + 3]!) : transparent ? 0 : 255;
    }
  } else if (channels === 2 || channels === 1) {
    colorType = channels === 2 ? 'gray-alpha' : 'gray';
    const key = channels === 1 && png.transparency ? png.transparency[0] : undefined;
    const max = depth === 16 ? 65535 : (1 << depth) - 1;
    const scale = (v: number) => Math.round((v / max) * 255);
    for (let p = 0; p < n; p++) {
      const v = channels === 1 ? sample1(p) : src[p * 2]!;
      const g = scale(v);
      out.data[p * 4] = g;
      out.data[p * 4 + 1] = g;
      out.data[p * 4 + 2] = g;
      out.data[p * 4 + 3] = channels === 2 ? scale(src[p * 2 + 1]!) : key !== undefined && v === key ? 0 : 255;
    }
  } else {
    throw new PngDecodeError(`Unsupported channel count ${channels}`);
  }
  return {
    image: out,
    info: { width, height, depth, channels, colorType, converted: !(colorType === 'rgba' && depth === 8) },
  };
}

/** Encode exact 8-bit RGBA (no ancillary metadata chunks). */
export function encodeRgbaPng(img: RgbaImage): Uint8Array {
  return encode({
    width: img.width,
    height: img.height,
    data: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength),
    depth: 8,
    channels: 4,
  });
}

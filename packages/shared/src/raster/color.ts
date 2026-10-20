import type { Rgba } from './image.js';

export function hexToRgba(hex: string): Rgba {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid colour "${hex}"`);
  const v = parseInt(m[1]!, 16);
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}

export function rgbaToHex(c: Rgba, includeAlpha = c[3] !== 255): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}${includeAlpha ? h(c[3]) : ''}`;
}

/** Squared RGB distance (alpha ignored); cheap and good enough for palettes/masks. */
export function colorDistanceSq(a: Rgba | readonly number[], b: Rgba | readonly number[]): number {
  const dr = a[0]! - b[0]!;
  const dg = a[1]! - b[1]!;
  const db = a[2]! - b[2]!;
  return dr * dr + dg * dg + db * db;
}

/** Relative luminance (sRGB, WCAG formula) in [0, 1]. */
export function luminance(c: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

/** Scale RGB by `factor` (e.g. 0.8 to darken), keeping alpha. */
export function shade(c: Rgba, factor: number): Rgba {
  return [
    Math.round(Math.min(255, c[0] * factor)),
    Math.round(Math.min(255, c[1] * factor)),
    Math.round(Math.min(255, c[2] * factor)),
    c[3],
  ];
}

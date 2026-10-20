import { createImage, hexToRgba, setPixel, shade, type Rgba, type RgbaImage, type SkinModel } from '@blockwright/shared';
import { findRegion, getSkinLayout, SKIN_FACES, type BodyPart, type SkinFace } from './layout.js';

/**
 * Original, procedurally drawn starter character ("Explorer"). It is not a copy
 * of any Mojang default skin: colours come from the palette below and the
 * pattern is generated per face from simple rules.
 */
export interface TemplatePalette {
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  trousers: string;
  shoes: string;
}

export const DEFAULT_TEMPLATE_PALETTE: TemplatePalette = {
  skin: '#c98f6b',
  hair: '#4a2f1f',
  eyes: '#2f6fae',
  shirt: '#3f8f5a',
  trousers: '#3b4a6b',
  shoes: '#2b2b2b',
};

export const TEMPLATE_PRESETS: Record<string, TemplatePalette> = {
  explorer: DEFAULT_TEMPLATE_PALETTE,
  ember: { skin: '#e0b48f', hair: '#b5452b', eyes: '#3d7a3a', shirt: '#c46a1d', trousers: '#5a3d2b', shoes: '#3a2418' },
  frost: { skin: '#8c5a3c', hair: '#1d1d24', eyes: '#5a3a24', shirt: '#4f8fc4', trousers: '#e3e8ef', shoes: '#4b5563' },
  dusk: { skin: '#f1cdb0', hair: '#e9d27a', eyes: '#7a4fb3', shirt: '#6b3f8f', trousers: '#2d2a3a', shoes: '#191621' },
};

/** Tiny deterministic per-pixel variation so flat colours read as pixel art. */
function jitter(c: Rgba, x: number, y: number, amount = 0.05): Rgba {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const r = ((h ^ (h >>> 16)) & 0xffff) / 0xffff; // 0..1
  return shade(c, 1 - amount + r * amount * 2);
}

type Painter = (lx: number, ly: number, w: number, h: number) => Rgba;

function paintFace(img: RgbaImage, model: SkinModel, part: BodyPart, face: SkinFace, painter: Painter, faceShade = 1): void {
  const r = findRegion(model, part, 'base', face);
  for (let ly = 0; ly < r.h; ly++) {
    for (let lx = 0; lx < r.w; lx++) {
      const x = r.x + lx;
      const y = r.y + ly;
      setPixel(img, x, y, jitter(shade(painter(lx, ly, r.w, r.h), faceShade), x, y));
    }
  }
}

const FACE_SHADE: Record<SkinFace, number> = { top: 1.06, bottom: 0.82, right: 0.92, front: 1, left: 0.92, back: 0.88 };

export function createTemplateSkin(model: SkinModel, palette: TemplatePalette = DEFAULT_TEMPLATE_PALETTE): RgbaImage {
  const img = createImage(64, 64);
  const c = {
    skin: hexToRgba(palette.skin),
    hair: hexToRgba(palette.hair),
    eyes: hexToRgba(palette.eyes),
    shirt: hexToRgba(palette.shirt),
    trousers: hexToRgba(palette.trousers),
    shoes: hexToRgba(palette.shoes),
    white: [236, 236, 236, 255] as Rgba,
  };

  // Head
  for (const face of SKIN_FACES) {
    const painter: Painter = (lx, ly, w) => {
      switch (face) {
        case 'top':
          return c.hair;
        case 'bottom':
          return shade(c.skin, 0.9);
        case 'back':
          return ly < 6 ? c.hair : c.skin;
        case 'right':
        case 'left': {
          // hair covers the top rows and the back half of the sides
          const backCol = face === 'right' ? lx < 3 : lx > w - 4;
          return ly < 2 || (backCol && ly < 6) ? c.hair : c.skin;
        }
        case 'front': {
          if (ly < 2) return c.hair;
          if (ly === 2 && (lx === 0 || lx === w - 1)) return c.hair;
          if (ly === 4 && (lx === 1 || lx === 6)) return c.white;
          if (ly === 4 && (lx === 2 || lx === 5)) return c.eyes;
          if (ly === 6 && (lx === 3 || lx === 4)) return shade(c.skin, 0.72);
          if (ly === 5 && (lx === 3 || lx === 4)) return shade(c.skin, 0.88);
          return c.skin;
        }
      }
    };
    paintFace(img, model, 'head', face, painter, FACE_SHADE[face]);
  }

  // Torso: shirt with a collar and a belt line
  for (const face of SKIN_FACES) {
    paintFace(
      img,
      model,
      'body',
      face,
      (lx, ly, w, h) => {
        if (face === 'bottom') return c.trousers;
        if (face === 'top') return c.shirt;
        if (ly === h - 1) return shade(c.trousers, 0.8);
        if (face === 'front' && ly === 0 && lx >= 3 && lx <= 4) return c.skin;
        if (face === 'front' && ly === 1 && lx === 3) return shade(c.shirt, 0.75);
        if (face === 'front' && ly === 1 && lx === 4) return shade(c.shirt, 0.75);
        if (face === 'front' && lx === Math.floor(w / 2) && ly > 1 && ly < h - 1 && ly % 3 === 0) return shade(c.shirt, 0.7);
        return c.shirt;
      },
      FACE_SHADE[face],
    );
  }

  // Arms: short sleeves, then skin
  for (const part of ['rightArm', 'leftArm'] as const) {
    for (const face of SKIN_FACES) {
      paintFace(
        img,
        model,
        part,
        face,
        (_lx, ly, _w, h) => {
          if (face === 'top') return c.shirt;
          if (face === 'bottom') return shade(c.skin, 0.9);
          if (ly < 4) return ly === 3 ? shade(c.shirt, 0.85) : c.shirt;
          return ly === h - 1 ? shade(c.skin, 0.9) : c.skin;
        },
        FACE_SHADE[face],
      );
    }
  }

  // Legs: trousers then shoes
  for (const part of ['rightLeg', 'leftLeg'] as const) {
    for (const face of SKIN_FACES) {
      paintFace(
        img,
        model,
        part,
        face,
        (_lx, ly, _w, h) => {
          if (face === 'top') return c.trousers;
          if (face === 'bottom') return c.shoes;
          if (ly >= h - 2) return ly === h - 2 ? shade(c.shoes, 1.25) : c.shoes;
          return c.trousers;
        },
        FACE_SHADE[face],
      );
    }
  }
  return img;
}

const PART_HUES: Record<BodyPart, number> = {
  head: 0,
  body: 120,
  rightArm: 210,
  leftArm: 280,
  rightLeg: 40,
  leftLeg: 170,
};
const FACE_LIGHTNESS: Record<SkinFace, number> = { top: 0.85, bottom: 0.25, right: 0.4, front: 0.6, left: 0.5, back: 0.32 };

function hsl(h: number, s: number, l: number): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), 255];
}

/**
 * UV debug skin: every part has its own hue, every face its own lightness, and
 * each face's local top-left pixel is white with a black pixel to its right, so
 * orientation and mirroring mistakes are visible in a 3D preview. Overlay left empty.
 */
export function createUvDebugSkin(model: SkinModel): RgbaImage {
  const img = createImage(64, 64);
  for (const region of getSkinLayout(model)) {
    if (region.layer !== 'base') continue;
    const base = hsl(PART_HUES[region.part], 0.7, FACE_LIGHTNESS[region.face]);
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) setPixel(img, x, y, base);
    }
    setPixel(img, region.x, region.y, [255, 255, 255, 255]);
    if (region.w > 1) setPixel(img, region.x + 1, region.y, [0, 0, 0, 255]);
  }
  return img;
}

export function createBlankSkin(model: SkinModel, color = '#9aa0a6'): RgbaImage {
  const img = createImage(64, 64);
  const c = hexToRgba(color);
  for (const region of getSkinLayout(model)) {
    if (region.layer !== 'base') continue;
    for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) setPixel(img, x, y, c);
  }
  return img;
}

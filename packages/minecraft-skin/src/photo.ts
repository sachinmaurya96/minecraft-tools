import {
  createImage,
  extractPalette,
  getPixel,
  nearestPaletteColor,
  resampleArea,
  setPixel,
  type Rgba,
  type RgbaImage,
  type SkinModel,
} from '@blockwright/shared';
import { BODY_PARTS, findRegion, getSkinLayout, PART_DEFS, regionKey, type BodyPart, type SkinFace } from './layout.js';
import { DEFAULT_TEMPLATE_PALETTE } from './template.js';

/**
 * Photo-assisted skin projection ("photo-projection-v1").
 *
 * Deterministic, non-AI: the pixels inside user-adjustable guide boxes on the
 * front (and optionally back/side) photos are area-averaged down to the matching
 * skin faces. Faces nobody photographed (sides without side photos, tops,
 * bottoms, inner limb faces, the back without a back photo) are *inferred* by
 * interpolating neighbouring sampled edges, and are reported as such so the UI
 * can label them approximate.
 */

/** Normalized box (0..1) in the rotated + cropped photo. */
export interface GuideBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BodyGuides = Record<BodyPart, GuideBox>;
export interface SideGuides {
  head: GuideBox;
  /** The near arm; also used (approximately) for the torso side it covers. */
  arm: GuideBox;
  /** The near leg. */
  leg: GuideBox;
}

export interface PhotoView<G> {
  image: RgbaImage;
  guides: G;
  /** Optional background mask (1 = background), same size as `image`. */
  mask?: Uint8Array;
}

export interface PhotoProjectionInput {
  model: SkinModel;
  front: PhotoView<BodyGuides>;
  back?: PhotoView<BodyGuides>;
  /** Photo of the character's left side. */
  left?: PhotoView<SideGuides>;
  /** Photo of the character's right side. */
  right?: PhotoView<SideGuides>;
  /** Reduce the base layer to N colours (0/undefined = off). */
  quantizeColors?: number;
  /** Existing skin whose outer layer is preserved (photo projection only writes the base layer). */
  preserveOverlayFrom?: RgbaImage;
}

export interface PhotoProjectionResult {
  image: RgbaImage;
  sampledFaces: string[];
  inferredFaces: string[];
  /** Sampled pixels whose source area was mostly background/outside the photo. */
  lowCoveragePixels: number;
  warnings: string[];
}

const MIN_COVERAGE = 0.3;

/** Default guides for a full-body, front-facing character filling the crop (16 x 32 units). */
export function defaultBodyGuides(model: SkinModel, view: 'front' | 'back'): BodyGuides {
  const armW = model === 'slim' ? 3 : 4;
  const u = (x: number, y: number, w: number, h: number): GuideBox => ({ x: x / 16, y: y / 32, w: w / 16, h: h / 32 });
  const front: BodyGuides = {
    head: u(4, 0, 8, 8),
    body: u(4, 8, 8, 12),
    // character's right side is on the viewer's left in a front view
    rightArm: u(4 - armW, 8, armW, 12),
    leftArm: u(12, 8, armW, 12),
    rightLeg: u(4, 20, 4, 12),
    leftLeg: u(8, 20, 4, 12),
  };
  if (view === 'front') return front;
  const mirror = (g: GuideBox): GuideBox => ({ ...g, x: 1 - g.x - g.w });
  return {
    head: mirror(front.head),
    body: mirror(front.body),
    rightArm: mirror(front.rightArm),
    leftArm: mirror(front.leftArm),
    rightLeg: mirror(front.rightLeg),
    leftLeg: mirror(front.leftLeg),
  };
}

export function defaultSideGuides(): SideGuides {
  return {
    head: { x: 0, y: 0, w: 1, h: 0.25 },
    arm: { x: 0.25, y: 0.25, w: 0.5, h: 0.375 },
    leg: { x: 0.25, y: 0.625, w: 0.5, h: 0.375 },
  };
}

/** Bounding box (normalized) of non-background pixels, or null if the mask covers everything. */
export function subjectBounds(mask: Uint8Array, width: number, height: number): GuideBox | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0 / width, y: y0 / height, w: (x1 - x0 + 1) / width, h: (y1 - y0 + 1) / height };
}

/** Fit body guides into a subject bounding box (e.g. from a background mask). */
export function fitGuides(guides: BodyGuides, bounds: GuideBox): BodyGuides {
  const out = {} as BodyGuides;
  for (const part of BODY_PARTS) {
    const g = guides[part];
    out[part] = { x: bounds.x + g.x * bounds.w, y: bounds.y + g.y * bounds.h, w: g.w * bounds.w, h: g.h * bounds.h };
  }
  return out;
}

interface FaceBitmap {
  img: RgbaImage;
  sampled: boolean;
}

type FaceSet = Record<SkinFace, FaceBitmap | undefined>;

function sample(view: PhotoView<unknown>, box: GuideBox, w: number, h: number): { img: RgbaImage; low: number; usable: boolean } {
  const { image } = view;
  const rect = { x: box.x * image.width, y: box.y * image.height, width: box.w * image.width, height: box.h * image.height };
  const { image: out, coverage } = resampleArea(image, rect, w, h, view.mask);
  let low = 0;
  for (let i = 0; i < coverage.length; i++) {
    if (coverage[i]! < MIN_COVERAGE) {
      low++;
      out.data[i * 4 + 3] = 0; // mark for fill
    }
  }
  return { img: out, low, usable: low < coverage.length };
}

function averageOpaque(img: RgbaImage, filter?: (x: number, y: number) => boolean): Rgba | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (filter && !filter(x, y)) continue;
      const p = getPixel(img, x, y);
      if (p[3] === 0) continue;
      r += p[0];
      g += p[1];
      b += p[2];
      n++;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255] : null;
}

/** Fill transparent (low-coverage) pixels from the nearest opaque pixel in the same row, else `fallback`. */
function fillHoles(img: RgbaImage, fallback: Rgba): void {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (getPixel(img, x, y)[3] !== 0) continue;
      let found: Rgba | null = null;
      for (let d = 1; d < img.width && !found; d++) {
        for (const nx of [x - d, x + d]) {
          if (nx < 0 || nx >= img.width) continue;
          const p = getPixel(img, nx, y);
          if (p[3] !== 0) {
            found = p;
            break;
          }
        }
      }
      setPixel(img, x, y, found ?? fallback);
    }
  }
}

const lerp = (a: Rgba, b: Rgba, t: number): Rgba => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  255,
];

const PART_FALLBACK: Record<BodyPart, string> = {
  head: DEFAULT_TEMPLATE_PALETTE.skin,
  body: DEFAULT_TEMPLATE_PALETTE.shirt,
  rightArm: DEFAULT_TEMPLATE_PALETTE.shirt,
  leftArm: DEFAULT_TEMPLATE_PALETTE.shirt,
  rightLeg: DEFAULT_TEMPLATE_PALETTE.trousers,
  leftLeg: DEFAULT_TEMPLATE_PALETTE.trousers,
};

function hex(h: string): Rgba {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

export function projectPhotosToSkin(input: PhotoProjectionInput): PhotoProjectionResult {
  const { model } = input;
  const warnings: string[] = [];
  let lowCoveragePixels = 0;
  const faces = {} as Record<BodyPart, FaceSet>;

  const sideOf: Partial<Record<BodyPart, { view: PhotoView<SideGuides>; face: 'left' | 'right'; box: keyof SideGuides }[]>> = {};
  const addSide = (view: PhotoView<SideGuides> | undefined, face: 'left' | 'right') => {
    if (!view) return;
    const limb = face === 'left' ? { arm: 'leftArm', leg: 'leftLeg' } : { arm: 'rightArm', leg: 'rightLeg' };
    const pairs: Array<[BodyPart, keyof SideGuides]> = [
      ['head', 'head'],
      ['body', 'arm'],
      [limb.arm as BodyPart, 'arm'],
      [limb.leg as BodyPart, 'leg'],
    ];
    for (const [part, box] of pairs) (sideOf[part] ??= []).push({ view, face, box });
  };
  addSide(input.left, 'left');
  addSide(input.right, 'right');

  for (const part of BODY_PARTS) {
    const [w, h, d] = PART_DEFS[part].size(model);
    const set: FaceSet = { top: undefined, bottom: undefined, right: undefined, front: undefined, left: undefined, back: undefined };
    faces[part] = set;

    const front = sample(input.front, input.front.guides[part], w, h);
    lowCoveragePixels += front.low;
    const fallback = averageOpaque(front.img) ?? hex(PART_FALLBACK[part]);
    if (!front.usable) warnings.push(`No usable photo pixels for the ${part} front; used a fallback colour.`);
    fillHoles(front.img, fallback);
    set.front = { img: front.img, sampled: front.usable };

    if (input.back) {
      const back = sample(input.back, input.back.guides[part], w, h);
      lowCoveragePixels += back.low;
      fillHoles(back.img, averageOpaque(back.img) ?? fallback);
      set.back = { img: back.img, sampled: back.usable };
    } else {
      // Inferred back: each row takes the colour of the front row's outer edges.
      const img = createImage(w, h);
      for (let y = 0; y < h; y++) {
        const edge = lerp(getPixel(front.img, 0, y), getPixel(front.img, w - 1, y), 0.5);
        for (let x = 0; x < w; x++) setPixel(img, x, y, edge);
      }
      set.back = { img, sampled: false };
    }

    for (const side of sideOf[part] ?? []) {
      const s = sample(side.view, side.view.guides[side.box], d, h);
      lowCoveragePixels += s.low;
      fillHoles(s.img, fallback);
      // the torso side is hidden behind the arm in a side photo: keep it, but label approximate
      set[side.face] = { img: s.img, sampled: part !== 'body' && s.usable };
    }
  }

  // Inferred faces by interpolating sampled neighbours (see layout.ts for the net).
  for (const part of BODY_PARTS) {
    const [w, h, d] = PART_DEFS[part].size(model);
    const set = faces[part];
    const front = set.front!.img;
    const back = set.back!.img;
    if (!set.right) {
      // right face: column 0 touches the back's last column, column d-1 the front's first
      const img = createImage(d, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < d; x++) setPixel(img, x, y, lerp(getPixel(back, w - 1, y), getPixel(front, 0, y), d > 1 ? x / (d - 1) : 1));
      }
      set.right = { img, sampled: false };
    }
    if (!set.left) {
      // left face: column 0 touches the front's last column, column d-1 the back's first
      const img = createImage(d, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < d; x++) setPixel(img, x, y, lerp(getPixel(front, w - 1, y), getPixel(back, 0, y), d > 1 ? x / (d - 1) : 0));
      }
      set.left = { img, sampled: false };
    }
    {
      // top: row d-1 touches the front's top row, row 0 the back's top row (mirrored columns)
      const img = createImage(w, d);
      for (let y = 0; y < d; y++) {
        for (let x = 0; x < w; x++) setPixel(img, x, y, lerp(getPixel(back, w - 1 - x, 0), getPixel(front, x, 0), d > 1 ? y / (d - 1) : 1));
      }
      set.top = { img, sampled: false };
    }
    {
      // bottom: uniform average of the front and back bottom rows (orientation-agnostic)
      const f = averageOpaque(front, (_x, y) => y === h - 1)!;
      const b = averageOpaque(back, (_x, y) => y === h - 1)!;
      set.bottom = { img: createImage(w, d, lerp(f, b, 0.5)), sampled: false };
    }
  }

  // Compose the 64x64 skin: base from faces, overlay preserved or empty.
  const out = createImage(64, 64);
  if (input.preserveOverlayFrom) {
    for (const r of getSkinLayout(model)) {
      if (r.layer !== 'overlay') continue;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) setPixel(out, x, y, getPixel(input.preserveOverlayFrom, x, y));
    }
  }
  const sampledFaces: string[] = [];
  const inferredFaces: string[] = [];
  for (const part of BODY_PARTS) {
    for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back'] as const) {
      const bmp = faces[part][face]!;
      const region = findRegion(model, part, 'base', face);
      for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) setPixel(out, region.x + x, region.y + y, getPixel(bmp.img, x, y));
      (bmp.sampled ? sampledFaces : inferredFaces).push(regionKey(region));
    }
  }

  if (input.quantizeColors && input.quantizeColors > 1) {
    const baseOnly = createImage(64, 64);
    for (const r of getSkinLayout(model)) {
      if (r.layer !== 'base') continue;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) setPixel(baseOnly, x, y, getPixel(out, x, y));
    }
    const palette = extractPalette(baseOnly, input.quantizeColors).map((e) => e.color);
    for (const r of getSkinLayout(model)) {
      if (r.layer !== 'base') continue;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) setPixel(out, x, y, nearestPaletteColor(getPixel(out, x, y), palette));
      }
    }
  }

  if (!input.back) warnings.push('No back photo: the back of every part is approximated from the front edges.');
  if (!input.left && !input.right) warnings.push('No side photos: side faces are interpolated between front and back.');
  if (lowCoveragePixels > 0) {
    warnings.push(`${lowCoveragePixels} pixel(s) fell on background or outside the photo and were filled from neighbours.`);
  }
  return { image: out, sampledFaces, inferredFaces, lowCoveragePixels, warnings };
}

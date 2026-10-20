import {
  bytesToBase64,
  createImage,
  hexToRgba,
  setPixel,
  type Bone,
  type Cube,
  type EntityProjectState,
  type FacePaint,
  type RgbaImage,
  type SkinModel,
  type Vec3,
} from '@blockwright/shared';
import type { GeoCube, GeoFile } from './geometry.js';
import { importGeometry } from './import.js';

/**
 * Original starter models for the entity editor. Coordinates are in the
 * Bedrock frame; entities face north (-Z) and the entity's right side is at
 * negative X (it appears at +X in Blockbench, which mirrors X).
 */

export type TemplateModel = Pick<EntityProjectState, 'bones' | 'cubes' | 'spawnEgg'>;

export interface EntityTemplate {
  id: string;
  name: string;
  description: string;
  build(): TemplateModel;
}

const bone = (id: string, name: string, pivot: Vec3, parentId?: string): Bone => ({ id, name, pivot, ...(parentId ? { parentId } : {}) });
const cube = (id: string, boneId: string, origin: Vec3, size: Vec3, color: string, faces?: Cube['faces'], name?: string): Cube => ({
  id,
  boneId,
  origin,
  size,
  color,
  ...(faces ? { faces } : {}),
  ...(name ? { name } : {}),
});

function bitmapPaint(img: RgbaImage): FacePaint {
  return { kind: 'pixels', width: img.width, height: img.height, rgba: bytesToBase64(img.data) };
}

/** 8x8 front-of-head bitmap with eyes and a fringe (natural orientation: as seen from the front). */
function faceBitmap(skin: string, hair: string, eye: string, w = 8, h = 8): RgbaImage {
  const img = createImage(w, h, hexToRgba(skin));
  const hairC = hexToRgba(hair);
  const eyeC = hexToRgba(eye);
  const white: [number, number, number, number] = [240, 240, 240, 255];
  for (let x = 0; x < w; x++) setPixel(img, x, 0, hairC);
  for (let x = 0; x < w; x++) if (x < 2 || x > w - 3) setPixel(img, x, 1, hairC);
  const ey = Math.floor(h / 2);
  setPixel(img, 1, ey, white);
  setPixel(img, 2, ey, eyeC);
  setPixel(img, w - 3, ey, eyeC);
  setPixel(img, w - 2, ey, white);
  return img;
}

export const HUMANOID_TEMPLATE: EntityTemplate = {
  id: 'humanoid',
  name: 'Blocky humanoid',
  description: 'Head, torso, two arms and two legs. Player-like proportions (32 px / 2 blocks tall).',
  build() {
    const skin = '#c9a27e';
    return {
      bones: [
        bone('body', 'body', [0, 24, 0]),
        bone('head', 'head', [0, 24, 0], 'body'),
        bone('right_arm', 'right_arm', [-5, 22, 0], 'body'),
        bone('left_arm', 'left_arm', [5, 22, 0], 'body'),
        bone('right_leg', 'right_leg', [-2, 12, 0]),
        bone('left_leg', 'left_leg', [2, 12, 0]),
      ],
      cubes: [
        cube('torso', 'body', [-4, 12, -2], [8, 12, 4], '#3f7fbf', undefined, 'torso'),
        cube('head', 'head', [-4, 24, -4], [8, 8, 8], skin, { north: bitmapPaint(faceBitmap(skin, '#4a2f1f', '#2f4f8f')), up: { kind: 'color', color: '#4a2f1f' } }, 'head'),
        cube('right_arm', 'right_arm', [-8, 12, -2], [4, 12, 4], skin, { up: { kind: 'color', color: '#3f7fbf' } }, 'right arm'),
        cube('left_arm', 'left_arm', [4, 12, -2], [4, 12, 4], skin, { up: { kind: 'color', color: '#3f7fbf' } }, 'left arm'),
        cube('right_leg', 'right_leg', [-4, 0, -2], [4, 12, 4], '#3b4a6b', { down: { kind: 'color', color: '#2b2b2b' } }, 'right leg'),
        cube('left_leg', 'left_leg', [0, 0, -2], [4, 12, 4], '#3b4a6b', { down: { kind: 'color', color: '#2b2b2b' } }, 'left leg'),
      ],
      spawnEgg: { baseColor: '#3f7fbf', overlayColor: '#c9a27e' },
    };
  },
};

export const QUADRUPED_TEMPLATE: EntityTemplate = {
  id: 'quadruped',
  name: 'Four-legged creature',
  description: 'Horizontal body, head at the front (north), four legs and a tail.',
  build() {
    const fur = '#8a5a3b';
    return {
      bones: [
        bone('body', 'body', [0, 12, 0]),
        bone('head', 'head', [0, 14, -8], 'body'),
        bone('leg_front_right', 'leg_front_right', [-3, 8, -6]),
        bone('leg_front_left', 'leg_front_left', [3, 8, -6]),
        bone('leg_back_right', 'leg_back_right', [-3, 8, 6]),
        bone('leg_back_left', 'leg_back_left', [3, 8, 6]),
        bone('tail', 'tail', [0, 15, 8], 'body'),
      ],
      cubes: [
        cube('body', 'body', [-5, 8, -8], [10, 8, 16], fur, { up: { kind: 'color', color: '#7a4e33' } }, 'body'),
        cube('head', 'head', [-4, 10, -14], [8, 8, 6], fur, { north: bitmapPaint(faceBitmap(fur, '#5e3b26', '#1d1d1d')) }, 'head'),
        cube('snout', 'head', [-2, 10, -15], [4, 3, 1], '#d9b38c', undefined, 'snout'),
        cube('leg_fr', 'leg_front_right', [-5, 0, -7], [4, 8, 4], '#6e4630', undefined, 'front right leg'),
        cube('leg_fl', 'leg_front_left', [1, 0, -7], [4, 8, 4], '#6e4630', undefined, 'front left leg'),
        cube('leg_br', 'leg_back_right', [-5, 0, 3], [4, 8, 4], '#6e4630', undefined, 'back right leg'),
        cube('leg_bl', 'leg_back_left', [1, 0, 3], [4, 8, 4], '#6e4630', undefined, 'back left leg'),
        cube('tail', 'tail', [-1, 11, 8], [2, 5, 2], '#5e3b26', undefined, 'tail'),
      ],
      spawnEgg: { baseColor: '#8a5a3b', overlayColor: '#d9b38c' },
    };
  },
};

export const BLOCK_TEMPLATE: EntityTemplate = {
  id: 'block',
  name: 'Single block',
  description: 'One 16 x 16 x 16 cube: the smallest possible entity, good for testing.',
  build() {
    return {
      bones: [bone('root', 'root', [0, 0, 0])],
      cubes: [cube('block', 'root', [-8, 0, -8], [16, 16, 16], '#5f9e4f', { up: { kind: 'color', color: '#7cc46a' } }, 'block')],
      spawnEgg: { baseColor: '#5f9e4f', overlayColor: '#3d2b1f' },
    };
  },
};

export const ENTITY_TEMPLATES: EntityTemplate[] = [HUMANOID_TEMPLATE, QUADRUPED_TEMPLATE, BLOCK_TEMPLATE];

export function getEntityTemplate(id: string): EntityTemplate | undefined {
  return ENTITY_TEMPLATES.find((t) => t.id === id);
}

/**
 * Turn a 64x64 player skin into a humanoid entity model with the same box-UV
 * layout as the player model: base parts plus slightly inflated outer-layer
 * cubes (hat, jacket, sleeves, trousers). Fully transparent outer faces are
 * hidden. Uses the generic box-UV importer, so the mapping is the same one
 * Blockbench applies.
 */
export function skinToHumanoid(skin: RgbaImage, model: SkinModel): Pick<EntityProjectState, 'bones' | 'cubes'> {
  const armW = model === 'slim' ? 3 : 4;
  const c = (origin: Vec3, size: Vec3, uv: [number, number], inflate?: number): GeoCube => ({ origin, size, uv, ...(inflate ? { inflate } : {}) });
  const geo: GeoFile = {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: 'geometry.skin.humanoid', texture_width: 64, texture_height: 64 },
        bones: [
          { name: 'body', pivot: [0, 24, 0], cubes: [c([-4, 12, -2], [8, 12, 4], [16, 16]), c([-4, 12, -2], [8, 12, 4], [16, 32], 0.25)] },
          { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [c([-4, 24, -4], [8, 8, 8], [0, 0]), c([-4, 24, -4], [8, 8, 8], [32, 0], 0.5)] },
          {
            name: 'right_arm',
            parent: 'body',
            pivot: [-5, 22, 0],
            cubes: [c([-4 - armW, 12, -2], [armW, 12, 4], [40, 16]), c([-4 - armW, 12, -2], [armW, 12, 4], [40, 32], 0.25)],
          },
          {
            name: 'left_arm',
            parent: 'body',
            pivot: [5, 22, 0],
            cubes: [c([4, 12, -2], [armW, 12, 4], [32, 48]), c([4, 12, -2], [armW, 12, 4], [48, 48], 0.25)],
          },
          { name: 'right_leg', pivot: [-2, 12, 0], cubes: [c([-4, 0, -2], [4, 12, 4], [0, 16]), c([-4, 0, -2], [4, 12, 4], [0, 32], 0.25)] },
          { name: 'left_leg', pivot: [2, 12, 0], cubes: [c([0, 0, -2], [4, 12, 4], [16, 48]), c([0, 0, -2], [4, 12, 4], [0, 48], 0.25)] },
        ],
      },
    ],
  };
  const imported = importGeometry(geo, skin);
  // drop outer-layer cubes whose faces are all transparent
  const cubes = imported.cubes.filter((cb) => !cb.inflate || Object.values(cb.faces ?? {}).some((f) => f?.kind !== 'hidden'));
  return { bones: imported.bones, cubes };
}

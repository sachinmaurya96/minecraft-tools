import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh } from 'three';
// Deep import: skinview3d's model module builds the player geometry without any DOM/WebGL.
import { SkinObject } from 'skinview3d/libs/model.js';
import {
  BODY_PARTS,
  describePixel,
  findRegion,
  getPixelLookup,
  getSkinLayout,
  pixelInfo,
  type BodyPart,
  type SkinFace,
  type SkinLayer,
} from './layout.js';
import type { SkinModel } from '@blockwright/shared';

describe('skin layout', () => {
  it.each(['classic', 'slim'] as const)('has 72 non-overlapping in-bounds regions (%s)', (model) => {
    const regions = getSkinLayout(model);
    expect(regions).toHaveLength(72);
    for (const r of regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(64);
      expect(r.y + r.h).toBeLessThanOrEqual(64);
    }
    expect(() => getPixelLookup(model)).not.toThrow();
  });

  // Reference coordinates of the front faces from the public 64x64 skin template.
  it('matches well-known front-face coordinates', () => {
    const f = (model: SkinModel, part: BodyPart, layer: SkinLayer = 'base') => {
      const r = findRegion(model, part, layer, 'front');
      return [r.x, r.y, r.w, r.h];
    };
    expect(f('classic', 'head')).toEqual([8, 8, 8, 8]);
    expect(f('classic', 'head', 'overlay')).toEqual([40, 8, 8, 8]);
    expect(f('classic', 'body')).toEqual([20, 20, 8, 12]);
    expect(f('classic', 'body', 'overlay')).toEqual([20, 36, 8, 12]);
    expect(f('classic', 'rightArm')).toEqual([44, 20, 4, 12]);
    expect(f('slim', 'rightArm')).toEqual([44, 20, 3, 12]);
    expect(f('classic', 'rightArm', 'overlay')).toEqual([44, 36, 4, 12]);
    expect(f('classic', 'leftArm')).toEqual([36, 52, 4, 12]);
    expect(f('classic', 'leftArm', 'overlay')).toEqual([52, 52, 4, 12]);
    expect(f('classic', 'rightLeg')).toEqual([4, 20, 4, 12]);
    expect(f('classic', 'rightLeg', 'overlay')).toEqual([4, 36, 4, 12]);
    expect(f('classic', 'leftLeg')).toEqual([20, 52, 4, 12]);
    expect(f('classic', 'leftLeg', 'overlay')).toEqual([4, 52, 4, 12]);
    // head top/side/back
    expect(findRegion('classic', 'head', 'base', 'top')).toMatchObject({ x: 8, y: 0, w: 8, h: 8 });
    expect(findRegion('classic', 'head', 'base', 'right')).toMatchObject({ x: 0, y: 8, w: 8, h: 8 });
    expect(findRegion('classic', 'head', 'base', 'back')).toMatchObject({ x: 24, y: 8, w: 8, h: 8 });
  });

  it('reports pixel info and unused areas', () => {
    expect(pixelInfo('classic', 9, 9)).toMatchObject({ region: { part: 'head', layer: 'base', face: 'front' }, localX: 1, localY: 1 });
    expect(pixelInfo('classic', 0, 0)).toBeNull();
    // the 4th classic arm column is unused for slim
    expect(pixelInfo('classic', 54, 20)).not.toBeNull();
    expect(pixelInfo('slim', 54, 20)).toBeNull();
    expect(describePixel('classic', 0, 0)).toMatch(/Unused/);
    expect(describePixel('classic', 41, 9)).toMatch(/Hat/);
  });
});

/**
 * Independent verification against skinview3d: read back the UVs its SkinObject
 * assigns to each three.js box face and compare with our regions. three.js box
 * faces are ordered +X, -X, +Y, -Y, +Z, -Z; skinview3d's model faces +Z with the
 * character's right arm on -X, so -X is the character's right side.
 */
describe('skin layout vs skinview3d', () => {
  const FACE_BY_BOX_INDEX: SkinFace[] = ['left', 'right', 'top', 'bottom', 'front', 'back'];

  function meshRects(mesh: Mesh): Array<[number, number, number, number]> {
    const uv = (mesh.geometry as BoxGeometry).getAttribute('uv');
    const rects: Array<[number, number, number, number]> = [];
    for (let face = 0; face < 6; face++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = 0; k < 4; k++) {
        xs.push(Math.round(uv.getX(face * 4 + k) * 64));
        ys.push(Math.round((1 - uv.getY(face * 4 + k)) * 64));
      }
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      rects.push([x, y, Math.max(...xs) - x, Math.max(...ys) - y]);
    }
    return rects;
  }

  it.each(['classic', 'slim'] as const)('agrees for every part, layer and face (%s)', (model) => {
    const skin = new SkinObject();
    skin.modelType = model === 'slim' ? 'slim' : 'default';
    for (const part of BODY_PARTS) {
      const bodyPart = skin[part];
      for (const layer of ['base', 'overlay'] as const) {
        const mesh = (layer === 'base' ? bodyPart.innerLayer : bodyPart.outerLayer) as Mesh;
        const rects = meshRects(mesh);
        rects.forEach((rect, i) => {
          const r = findRegion(model, part, layer, FACE_BY_BOX_INDEX[i]!);
          expect([r.x, r.y, r.w, r.h], `${model} ${part} ${layer} ${FACE_BY_BOX_INDEX[i]}`).toEqual(rect);
        });
      }
    }
  });
});

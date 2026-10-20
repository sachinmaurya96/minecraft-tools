import { describe, expect, it } from 'vitest';
import { getPixel, type Cube, type VoxelFace } from '@blockwright/shared';
import { faceKey, packAtlas, readFaceBitmap, resolveFaceContents } from './atlas.js';
import { FACE_NORMALS, faceTexelSize } from './faces.js';
import { buildGeometry, geometryToRenderModel } from './geometry.js';
import { importGeometry } from './import.js';
import { HUMANOID_TEMPLATE, QUADRUPED_TEMPLATE } from './templates.js';
import { ALL_FACES, markedBitmap } from './test-helpers.js';

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]!);
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

function markedCube(): Cube {
  const size: [number, number, number] = [6, 10, 4]; // asymmetric so face sizes differ
  const faces: Cube['faces'] = {};
  ALL_FACES.forEach((face, i) => {
    const [w, h] = faceTexelSize(size, face);
    faces[face] = markedBitmap(w, h, [40 + i * 30, 40, 40], 10 + i);
  });
  return { id: 'c1', boneId: 'b1', origin: [-3, 0, -2], size, color: '#808080', faces };
}

describe('face orientation (EN-03)', () => {
  const model = { bones: [{ id: 'b1', name: 'root', pivot: [0, 0, 0] as [number, number, number] }], cubes: [markedCube()] };
  const atlas = packAtlas(model.cubes);
  const { geo } = buildGeometry(model, atlas, 'geometry.test.orient');
  const render = geometryToRenderModel(geo);
  const faces = render.bones[0]!.cubes[0]!.faces;

  it.each(ALL_FACES)('%s face: bitmap appears unmirrored when seen from outside', (face) => {
    const f = faces.find((x) => x.face === face)!;
    const p = (k: number) => f.positions.slice(k * 3, k * 3 + 3);
    // TL->TR is "screen right" and TL->BL "screen down" for a viewer outside the face,
    // so their cross product must point into the cube (opposite the outward normal).
    const n = cross(sub(p(1), p(0)), sub(p(2), p(0)));
    expect(dot(n, FACE_NORMALS[face])).toBeLessThan(0);
    // all 4 corners lie on the face plane
    const axis = FACE_NORMALS[face].findIndex((v) => v !== 0);
    expect(new Set([0, 1, 2, 3].map((k) => p(k)[axis]))).toHaveProperty('size', 1);
  });

  it.each(ALL_FACES)('%s face: natural top-left texel lands on the face top-left corner', (face) => {
    const f = faces.find((x) => x.face === face)!;
    const bmp = readFaceBitmap(atlas, 'c1', face);
    // UV at fractional position (0.5/W, 0.5/H) = centre of the first texel
    const [u0, v0, u1, v1, u2, v2] = [f.uvs[0]!, f.uvs[1]!, f.uvs[2]!, f.uvs[3]!, f.uvs[4]!, f.uvs[5]!];
    const u = u0 + ((u1 - u0) * 0.5) / bmp.width + ((u2 - u0) * 0.5) / bmp.height;
    const v = v0 + ((v1 - v0) * 0.5) / bmp.width + ((v2 - v0) * 0.5) / bmp.height;
    const texel = getPixel(atlas.image, Math.floor(u), Math.floor(v));
    expect(texel).toEqual(getPixel(bmp, 0, 0));
    // and the original bitmap's marker is what readFaceBitmap returns (atlas stores natural orientation)
    expect(getPixel(bmp, 0, 0)[0]).toBe(255);
  });

  it('writes up/down faces from the far corner with negative size (Blockbench encoding)', () => {
    const cube = geo['minecraft:geometry'][0]!.bones![0]!.cubes![0]!;
    const uv = cube.uv as Record<VoxelFace, { uv: number[]; uv_size: number[] }>;
    expect(uv.up.uv_size.every((s) => s < 0)).toBe(true);
    expect(uv.down.uv_size.every((s) => s < 0)).toBe(true);
    expect(uv.north.uv_size.every((s) => s > 0)).toBe(true);
    const r = atlas.faces.get(faceKey('c1', 'up'))!.rect;
    expect(uv.up.uv).toEqual([r.x + r.w, r.y + r.h]);
  });

  it('mirrors X into the Blockbench frame and the entity right side (negative X) appears at +X', () => {
    const t = HUMANOID_TEMPLATE.build();
    const a = packAtlas(t.cubes);
    const rm = geometryToRenderModel(buildGeometry(t, a, 'geometry.t.h').geo);
    const rightArm = rm.bones.find((b) => b.name === 'right_arm')!;
    expect(rightArm.parent).toBe('body');
    // body pivot (0,24,0) -> right arm pivot (-5,22,0) in Bedrock = (+5,22,0) in Blockbench
    expect(rightArm.position).toEqual([5, -2, 0]);
    // unrotated cube: its pivot is the origin, so vertex positions are absolute Blockbench coordinates
    const xs = rightArm.cubes[0]!.faces.flatMap((f) => [0, 1, 2, 3].map((k) => f.positions[k * 3]!));
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([4, 8]); // Bedrock x -8..-4 -> Blockbench +4..+8
  });
});

describe('geometry round trip', () => {
  it.each([HUMANOID_TEMPLATE, QUADRUPED_TEMPLATE])('$id: export -> import preserves shape and every face bitmap', (template) => {
    const model = template.build();
    const atlas = packAtlas(model.cubes);
    const { geo, cubeOrder } = buildGeometry(model, atlas, 'geometry.rt.model');
    const imported = importGeometry(JSON.parse(JSON.stringify(geo)), atlas.image);
    expect(imported.cubes).toHaveLength(model.cubes.length);
    expect(imported.bones.map((b) => b.name)).toEqual(expect.arrayContaining(model.bones.map((b) => b.name)));
    const original = resolveFaceContents(model.cubes);
    imported.cubes.forEach((ic, i) => {
      const src = model.cubes.find((c) => c.id === cubeOrder[i])!;
      expect(ic.origin).toEqual(src.origin);
      expect(ic.size).toEqual(src.size);
      // re-pack the imported cube and compare natural face bitmaps texel by texel
      const reAtlas = packAtlas([{ ...ic, id: src.id }]);
      for (const face of ALL_FACES) {
        const want = original.find((o) => o.cubeId === src.id && o.face === face)!;
        const got = readFaceBitmap(reAtlas, src.id, face);
        const exp = readFaceBitmap(atlas, src.id, face);
        expect(got.width).toBe(want.w);
        expect(Array.from(got.data)).toEqual(Array.from(exp.data));
      }
    });
  });
});

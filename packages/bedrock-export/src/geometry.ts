import type { Cube, Vec3, VoxelFace } from '@blockwright/shared';
import { faceKey, type Atlas } from './atlas.js';
import {
  boxUvInternal,
  FACE_ORDER,
  facePoint,
  faceUvEntry,
  internalFaceUv,
  type GeoUvFace,
} from './faces.js';
import { modelBounds, topoSortBones, type EntityModel } from './model.js';

export const GEOMETRY_FORMAT_VERSION = '1.12.0';

export interface GeoCube {
  origin: Vec3;
  size: Vec3;
  pivot?: Vec3;
  rotation?: Vec3;
  inflate?: number;
  mirror?: boolean;
  uv?: Partial<Record<VoxelFace, GeoUvFace>> | [number, number];
}

export interface GeoBone {
  name: string;
  parent?: string;
  pivot?: Vec3;
  rotation?: Vec3;
  mirror?: boolean;
  cubes?: GeoCube[];
}

export interface GeoDescription {
  identifier: string;
  texture_width: number;
  texture_height: number;
  visible_bounds_width?: number;
  visible_bounds_height?: number;
  visible_bounds_offset?: Vec3;
}

export interface GeoFile {
  format_version: string;
  'minecraft:geometry': Array<{ description: GeoDescription; bones?: GeoBone[] }>;
}

const r4 = (n: number) => {
  const v = Math.round(n * 1e4) / 1e4;
  return Object.is(v, -0) ? 0 : v;
};
const v3 = (v: readonly number[]): Vec3 => [r4(v[0]!), r4(v[1]!), r4(v[2]!)];
const nonZero = (v?: readonly number[]) => !!v && v.some((n) => n !== 0);

/** Visible bounds (in blocks) generous enough for culling; see PLAN §9.6. */
export function visibleBounds(cubes: readonly Cube[]): { width: number; height: number; offset: Vec3 } {
  const { min, max } = modelBounds(cubes);
  const horizontal = Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2]));
  const width = Math.ceil(((horizontal * 2) / 16 + 0.5) * 2) / 2;
  const height = Math.ceil(((max[1] - Math.min(0, min[1])) / 16 + 0.5) * 2) / 2;
  const offset: Vec3 = [0, r4((max[1] + Math.min(0, min[1])) / 2 / 16), 0];
  return { width, height, offset };
}

export interface BuiltGeometry {
  geo: GeoFile;
  /** Cube ids in the order they appear in the file (bone order, then cube order). */
  cubeOrder: string[];
}

export function buildGeometry(model: EntityModel, atlas: Atlas, identifier: string): BuiltGeometry {
  const bones = topoSortBones(model.bones);
  const byId = new Map(model.bones.map((b) => [b.id, b]));
  const cubeOrder: string[] = [];
  const geoBones: GeoBone[] = bones.map((bone) => {
    const out: GeoBone = { name: bone.name, pivot: v3(bone.pivot) };
    if (bone.parentId) out.parent = byId.get(bone.parentId)!.name;
    if (nonZero(bone.rotation)) out.rotation = v3(bone.rotation!);
    const cubes = model.cubes.filter((c) => c.boneId === bone.id);
    if (cubes.length) {
      out.cubes = cubes.map((cube) => {
        cubeOrder.push(cube.id);
        const gc: GeoCube = { origin: v3(cube.origin), size: v3(cube.size) };
        if (nonZero(cube.rotation)) {
          // Bedrock rotates around the cube centre when pivot is omitted; always write it explicitly.
          gc.pivot = v3(cube.pivot ?? cube.origin.map((o, i) => o + cube.size[i]! / 2));
          gc.rotation = v3(cube.rotation!);
        }
        if (cube.inflate) gc.inflate = r4(cube.inflate);
        const uv: Partial<Record<VoxelFace, GeoUvFace>> = {};
        for (const face of FACE_ORDER) {
          if (cube.faces?.[face]?.kind === 'hidden') continue;
          const packed = atlas.faces.get(faceKey(cube.id, face));
          if (!packed) throw new Error(`Atlas is missing ${cube.id}:${face}`);
          uv[face] = faceUvEntry(face, packed.rect);
        }
        gc.uv = uv;
        return gc;
      });
    }
    return out;
  });
  const bounds = visibleBounds(model.cubes);
  return {
    geo: {
      format_version: GEOMETRY_FORMAT_VERSION,
      'minecraft:geometry': [
        {
          description: {
            identifier,
            texture_width: atlas.width,
            texture_height: atlas.height,
            visible_bounds_width: bounds.width,
            visible_bounds_height: bounds.height,
            visible_bounds_offset: bounds.offset,
          },
          bones: geoBones,
        },
      ],
    },
    cubeOrder,
  };
}

// ---------------------------------------------------------------------------
// Render model: what a Bedrock geometry looks like in the Blockbench frame.
// The browser preview turns this into three.js meshes, and tests use it to
// check face orientation without a GPU.
// ---------------------------------------------------------------------------

export interface RenderFace {
  face: VoxelFace;
  /** 4 corners (x,y,z) relative to the cube pivot, in natural order TL, TR, BL, BR. */
  positions: number[];
  /** 4 (u,v) pairs in texel units matching `positions`. */
  uvs: number[];
}

export interface RenderCube {
  /** Index into the file's cube order (see BuiltGeometry.cubeOrder). */
  index: number;
  /** Pivot relative to the owning bone's pivot (Blockbench frame). */
  position: Vec3;
  /** Degrees, Euler order ZYX (Blockbench frame). */
  rotation: Vec3;
  faces: RenderFace[];
}

export interface RenderBone {
  name: string;
  parent?: string;
  /** Pivot relative to the parent bone's pivot (Blockbench frame). */
  position: Vec3;
  rotation: Vec3;
  cubes: RenderCube[];
}

export interface RenderModel {
  identifier: string;
  textureWidth: number;
  textureHeight: number;
  bones: RenderBone[];
}

export const EULER_ORDER = 'ZYX';

const CORNERS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];

/** Parse one geometry of a .geo.json into the Blockbench frame (transcribing its parseBone/parseCube). */
export function geometryToRenderModel(file: GeoFile, index = 0): RenderModel {
  const geometry = file['minecraft:geometry']?.[index];
  if (!geometry) throw new Error('No geometry in file');
  const desc = geometry.description;
  const bones = geometry.bones ?? [];
  const byName = new Map(bones.map((b) => [b.name.toLowerCase(), b]));
  const bbPivot = (b: GeoBone | undefined): Vec3 => (b?.pivot ? [-b.pivot[0], b.pivot[1], b.pivot[2]] : [0, 0, 0]);
  let cubeIndex = 0;
  const out: RenderBone[] = bones.map((bone) => {
    const parent = bone.parent ? byName.get(bone.parent.toLowerCase()) : undefined;
    const pivot = bbPivot(bone);
    const parentPivot = parent ? bbPivot(parent) : ([0, 0, 0] as Vec3);
    const rb: RenderBone = {
      name: bone.name,
      ...(parent ? { parent: parent.name } : {}),
      position: [pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]],
      rotation: bone.rotation ? [-bone.rotation[0], -bone.rotation[1], bone.rotation[2]] : [0, 0, 0],
      cubes: [],
    };
    for (const cube of bone.cubes ?? []) {
      const inflate = cube.inflate ?? 0;
      const size = cube.size;
      const from: Vec3 = [-(cube.origin[0] + size[0]) - inflate, cube.origin[1] - inflate, cube.origin[2] - inflate];
      const to: Vec3 = [from[0] + size[0] + 2 * inflate, from[1] + size[1] + 2 * inflate, from[2] + size[2] + 2 * inflate];
      const hasRotation = nonZero(cube.rotation);
      const pivotBedrock = cube.pivot ?? (hasRotation ? cube.origin.map((o, i) => o + size[i]! / 2) : [0, 0, 0]);
      const cubePivot: Vec3 = [-pivotBedrock[0]!, pivotBedrock[1]!, pivotBedrock[2]!];
      let faceUvs: Partial<Record<VoxelFace, [number, number, number, number]>>;
      if (Array.isArray(cube.uv)) {
        faceUvs = boxUvInternal(cube.uv, size, cube.mirror ?? bone.mirror ?? false);
      } else {
        faceUvs = {};
        for (const face of FACE_ORDER) {
          const entry = cube.uv?.[face];
          if (entry) faceUvs[face] = internalFaceUv(face, entry);
        }
      }
      const faces: RenderFace[] = [];
      for (const face of FACE_ORDER) {
        const uv = faceUvs[face];
        if (!uv) continue; // omitted face is not drawn
        const positions: number[] = [];
        const uvs: number[] = [];
        for (const [lx, ly] of CORNERS) {
          const p = facePoint(face, from, to, lx, ly);
          positions.push(p[0] - cubePivot[0], p[1] - cubePivot[1], p[2] - cubePivot[2]);
          uvs.push(uv[0] + (uv[2] - uv[0]) * lx, uv[1] + (uv[3] - uv[1]) * ly);
        }
        faces.push({ face, positions, uvs });
      }
      rb.cubes.push({
        index: cubeIndex++,
        position: [cubePivot[0] - pivot[0], cubePivot[1] - pivot[1], cubePivot[2] - pivot[2]],
        rotation: cube.rotation ? [-cube.rotation[0], -cube.rotation[1], cube.rotation[2]] : [0, 0, 0],
        faces,
      });
    }
    return rb;
  });
  return { identifier: desc.identifier, textureWidth: desc.texture_width, textureHeight: desc.texture_height, bones: out };
}

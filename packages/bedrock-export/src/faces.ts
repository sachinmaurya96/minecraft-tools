import type { VoxelFace } from '@blockwright/shared';

/**
 * Face/UV conventions for Bedrock per-face UV geometry (format 1.12.0).
 *
 * Reference: Blockbench's Bedrock codec (js/formats/bedrock/bedrock.js, GPL-3.0)
 * and its CubeFace.UVToLocal (js/outliner/types/cube.js). Blockbench is the
 * creator tool Microsoft's docs point to, and what it shows is what creators
 * see in game; the in-game check is still a manual acceptance step.
 *
 * Coordinate frames
 * - "Bedrock frame": numbers exactly as written in .geo.json (model pixels,
 *   Y up, cube origin = min corner, pivots absolute).
 * - "Blockbench frame": a right-handed three.js frame obtained by mirroring X:
 *   from.x = -(origin.x + size.x), pivot.x = -pivot.x, rotation = [-rx, -ry, rz]
 *   (Euler order ZYX). Entities face north (-Z). The entity's right side is +X.
 *
 * Face bitmaps (our internal per-face paint) are stored "as seen from outside
 * the cube, upright":
 * - north/south/east/west: row 0 is the top (+Y); columns run left->right as
 *   seen by a viewer looking at that face.
 * - up: viewed from above, row 0 is the north (front) edge, column 0 west.
 *   (In the Blockbench frame west is -X, i.e. the entity's left.)
 * - down: viewed from below, row 0 is the south (back) edge, column 0 west.
 *
 * JSON encoding (mirrors Blockbench's compileCube): side faces use
 * `uv = [x, y]`, `uv_size = [w, h]`; up/down faces are written from the far
 * corner with negative size: `uv = [x + w, y + h]`, `uv_size = [-w, -h]`.
 */

export const FACE_ORDER: readonly VoxelFace[] = ['north', 'east', 'south', 'west', 'up', 'down'];

export const FACE_LABELS: Record<VoxelFace, string> = {
  north: 'Front (north)',
  south: 'Back (south)',
  east: "Entity's right (east)",
  west: "Entity's left (west)",
  up: 'Top (up)',
  down: 'Bottom (down)',
};

type Size3 = readonly [number, number, number];

/** Face extent in model units: [horizontal, vertical] as seen from outside. */
export function faceExtent(size: Size3, face: VoxelFace): [number, number] {
  const [sx, sy, sz] = size;
  switch (face) {
    case 'north':
    case 'south':
      return [sx, sy];
    case 'east':
    case 'west':
      return [sz, sy];
    case 'up':
    case 'down':
      return [sx, sz];
  }
}

/** Texel rectangle size used for a face: one texel per model unit, at least 1. */
export function faceTexelSize(size: Size3, face: VoxelFace): [number, number] {
  const [w, h] = faceExtent(size, face);
  return [Math.max(1, Math.ceil(w - 1e-6)), Math.max(1, Math.ceil(h - 1e-6))];
}

export interface TexRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GeoUvFace {
  uv: [number, number];
  uv_size: [number, number];
}

/** JSON per-face UV entry for a face whose natural bitmap occupies `rect` in the atlas. */
export function faceUvEntry(face: VoxelFace, rect: TexRect): GeoUvFace {
  if (face === 'up' || face === 'down') {
    return { uv: [rect.x + rect.w, rect.y + rect.h], uv_size: [-rect.w, -rect.h] };
  }
  return { uv: [rect.x, rect.y], uv_size: [rect.w, rect.h] };
}

/**
 * Blockbench-internal face UV `[u1, v1, u2, v2]` for a JSON per-face entry
 * (transcribed from Blockbench's parseCube). The face's natural top-left
 * corner samples (u1, v1) and its bottom-right (u2, v2).
 */
export function internalFaceUv(face: VoxelFace, entry: GeoUvFace): [number, number, number, number] {
  const uv: [number, number, number, number] = [entry.uv[0], entry.uv[1], entry.uv[0] + entry.uv_size[0], entry.uv[1] + entry.uv_size[1]];
  if (face === 'up' || face === 'down') return [uv[2], uv[3], uv[0], uv[1]];
  return uv;
}

/**
 * Blockbench-internal box-UV face UVs for a cube with box UV offset (u, v) and
 * integer size, transcribed from Blockbench's Cube preview controller updateUV.
 */
export function boxUvInternal(offset: readonly [number, number], size: Size3, mirror = false): Record<VoxelFace, [number, number, number, number]> {
  const [sx, sy, sz] = size.map((s) => Math.floor(s)) as [number, number, number];
  const list: Array<{ face: VoxelFace; from: [number, number]; size: [number, number] }> = [
    { face: 'east', from: [0, sz], size: [sz, sy] },
    { face: 'west', from: [sz + sx, sz], size: [sz, sy] },
    { face: 'up', from: [sz + sx, sz], size: [-sx, -sz] },
    { face: 'down', from: [sz + sx * 2, 0], size: [-sx, sz] },
    { face: 'south', from: [sz * 2 + sx, sz], size: [sx, sy] },
    { face: 'north', from: [sz, sz], size: [sx, sy] },
  ];
  if (mirror) {
    for (const f of list) {
      f.from[0] += f.size[0];
      f.size[0] *= -1;
    }
    const east = list[0]!;
    const west = list[1]!;
    [east.from, west.from] = [west.from, east.from];
    [east.size, west.size] = [west.size, east.size];
  }
  const out = {} as Record<VoxelFace, [number, number, number, number]>;
  for (const f of list) {
    out[f.face] = [f.from[0] + offset[0], f.from[1] + offset[1], f.from[0] + f.size[0] + offset[0], f.from[1] + f.size[1] + offset[1]];
  }
  return out;
}

/**
 * Position (Blockbench frame) of the point at fractional face coordinates
 * (lx, ly) in [0,1]^2 — (0,0) is the face's natural top-left — on a cube that
 * spans `from`..`to`. Transcribed from Blockbench's CubeFace.UVToLocal
 * (rotation 0), without its final subtraction of the cube pivot.
 */
export function facePoint(
  face: VoxelFace,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  lx: number,
  ly: number,
): [number, number, number] {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const v: [number, number, number] = [from[0], from[1], from[2]];
  switch (face) {
    case 'east':
      v[0] = to[0];
      v[1] = lerp(to[1], from[1], ly);
      v[2] = lerp(to[2], from[2], lx);
      break;
    case 'west':
      v[1] = lerp(to[1], from[1], ly);
      v[2] = lerp(from[2], to[2], lx);
      break;
    case 'up':
      v[1] = to[1];
      v[2] = lerp(from[2], to[2], ly);
      v[0] = lerp(from[0], to[0], lx);
      break;
    case 'down':
      v[2] = lerp(to[2], from[2], ly);
      v[0] = lerp(from[0], to[0], lx);
      break;
    case 'south':
      v[2] = to[2];
      v[1] = lerp(to[1], from[1], ly);
      v[0] = lerp(from[0], to[0], lx);
      break;
    case 'north':
      v[1] = lerp(to[1], from[1], ly);
      v[0] = lerp(to[0], from[0], lx);
      break;
  }
  return v;
}

/** Outward unit normal of a face in the Blockbench frame. */
export const FACE_NORMALS: Record<VoxelFace, [number, number, number]> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

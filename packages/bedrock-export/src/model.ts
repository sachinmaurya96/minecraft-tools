import {
  base64ToBytes,
  LIMITS,
  ReportBuilder,
  type Bone,
  type Cube,
  type EntityProjectState,
  type FacePaint,
  type ValidationReport,
  type Vec3,
} from '@blockwright/shared';

export type EntityModel = Pick<EntityProjectState, 'bones' | 'cubes'>;

/** Bones ordered parents-first. Throws on unknown parents or cycles. */
export function topoSortBones(bones: readonly Bone[]): Bone[] {
  const byId = new Map(bones.map((b) => [b.id, b]));
  const out: Bone[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (b: Bone, depth: number) => {
    const s = state.get(b.id);
    if (s === 'done') return;
    if (s === 'visiting' || depth > bones.length) throw new Error(`Bone hierarchy has a cycle at "${b.name}"`);
    state.set(b.id, 'visiting');
    if (b.parentId) {
      const parent = byId.get(b.parentId);
      if (!parent) throw new Error(`Bone "${b.name}" has an unknown parent`);
      visit(parent, depth + 1);
    }
    state.set(b.id, 'done');
    out.push(b);
  };
  for (const b of bones) visit(b, 0);
  return out;
}

export function decodeFacePixels(paint: Extract<FacePaint, { kind: 'pixels' }>): Uint8ClampedArray {
  const bytes = base64ToBytes(paint.rgba);
  if (bytes.length !== paint.width * paint.height * 4) {
    throw new Error(`Face bitmap is ${bytes.length} bytes, expected ${paint.width * paint.height * 4}`);
  }
  return new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Semantic validation beyond the zod schema (PLAN §6.3): unique bone ids/names,
 * resolvable acyclic parents, cubes attached to existing bones, non-empty
 * finite cubes, decodable face bitmaps, bounded complexity.
 */
export function validateEntityModel(model: EntityModel): ValidationReport {
  const r = new ReportBuilder();
  r.check('bones-unique');
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const b of model.bones) {
    if (ids.has(b.id)) r.error('DUPLICATE_BONE_ID', `Duplicate bone id ${b.id}`);
    ids.add(b.id);
    const lower = b.name.toLowerCase();
    if (names.has(lower)) r.error('DUPLICATE_BONE_NAME', `Bone name "${b.name}" is used twice (names are case-insensitive)`);
    names.add(lower);
  }
  r.check('bone-hierarchy');
  try {
    topoSortBones(model.bones);
  } catch (err) {
    r.error('BAD_BONE_HIERARCHY', (err as Error).message);
  }
  if (model.bones.length > LIMITS.maxBones) r.error('TOO_MANY_BONES', `At most ${LIMITS.maxBones} bones are allowed`);

  r.check('cubes');
  if (model.cubes.length === 0) r.error('NO_CUBES', 'The model has no cubes, so the entity would be invisible.');
  if (model.cubes.length > LIMITS.maxCubes) {
    r.error('MODEL_TOO_COMPLEX', `The model has ${model.cubes.length} cubes; the limit is ${LIMITS.maxCubes}.`);
  } else if (model.cubes.length > LIMITS.warnCubes) {
    r.warn('MANY_CUBES', `${model.cubes.length} cubes may perform poorly on low-end devices.`);
  }
  const cubeIds = new Set<string>();
  for (const c of model.cubes) {
    const where = c.name ?? c.id;
    if (cubeIds.has(c.id)) r.error('DUPLICATE_CUBE_ID', `Duplicate cube id ${c.id}`);
    cubeIds.add(c.id);
    if (!ids.has(c.boneId)) r.error('CUBE_BONE_MISSING', `Cube "${where}" is attached to a bone that does not exist`);
    const nums = [...c.origin, ...c.size, ...(c.pivot ?? []), ...(c.rotation ?? [])];
    if (nums.some((n) => !Number.isFinite(n))) r.error('NON_FINITE', `Cube "${where}" has a non-finite number`);
    if (c.size.some((s) => s < 0)) r.error('NEGATIVE_SIZE', `Cube "${where}" has a negative size`);
    if (c.size.every((s) => s === 0)) r.error('EMPTY_CUBE', `Cube "${where}" has zero size`);
    for (const [face, paint] of Object.entries(c.faces ?? {})) {
      if (paint?.kind !== 'pixels') continue;
      try {
        decodeFacePixels(paint);
      } catch (err) {
        r.error('BAD_FACE_BITMAP', `Cube "${where}" ${face} face: ${(err as Error).message}`);
      }
    }
  }
  return r.build();
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Axis-aligned bounds of all cubes in the Bedrock frame (rotations widen the box conservatively). */
export function modelBounds(cubes: readonly Cube[]): Bounds {
  if (cubes.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of cubes) {
    const inflate = c.inflate ?? 0;
    const lo = c.origin.map((o) => o - inflate) as Vec3;
    const hi = c.origin.map((o, i) => o + c.size[i]! + inflate) as Vec3;
    if (c.rotation && c.rotation.some((a) => a !== 0)) {
      // bounding sphere around the cube centre
      const centre = lo.map((l, i) => (l + hi[i]!) / 2);
      const radius = Math.hypot(...c.size.map((s) => s / 2 + inflate));
      const pivot = c.pivot ?? centre;
      const reach = Math.hypot(...centre.map((v, i) => v - pivot[i]!)) + radius;
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, pivot[i]! - reach);
        hi[i] = Math.max(hi[i]!, pivot[i]! + reach);
      }
    }
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, lo[i]!);
      max[i] = Math.max(max[i]!, hi[i]!);
    }
  }
  return { min, max };
}

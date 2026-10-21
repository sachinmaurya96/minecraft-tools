import {
  BONE_NAME_RE,
  bytesToBase64,
  checkEntityIdentifier,
  createImage,
  getPixel,
  LIMITS,
  rgbaToHex,
  setPixel,
  type Bone,
  type Cube,
  type FacePaint,
  type FacePaintMap,
  type RgbaImage,
  type Vec3,
  type VoxelFace,
} from '@blockwright/shared';
import { boxUvInternal, FACE_ORDER, faceTexelSize, internalFaceUv } from './faces.js';
import type { GeoFile } from './geometry.js';

export interface ImportedModel {
  bones: Bone[];
  cubes: Cube[];
  /** `namespace:name` derived from `geometry.namespace.name`, if valid. */
  suggestedIdentifier?: string;
  warnings: string[];
}

export class GeometryImportError extends Error {}

function sanitizeBoneName(name: string, used: Set<string>): string {
  let base = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 28);
  if (!/^[A-Za-z_]/.test(base)) base = `b_${base}`;
  if (!BONE_NAME_RE.test(base)) base = 'bone';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base}_${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Natural bitmap of one face sampled from the texture (nearest texel at face texel centres). */
function sampleFace(texture: RgbaImage, uv: [number, number, number, number], w: number, h: number, scaleX: number, scaleY: number): RgbaImage {
  const out = createImage(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = uv[0] + ((i + 0.5) / w) * (uv[2] - uv[0]);
      const v = uv[1] + ((j + 0.5) / h) * (uv[3] - uv[1]);
      const tx = Math.min(texture.width - 1, Math.max(0, Math.floor(u * scaleX)));
      const ty = Math.min(texture.height - 1, Math.max(0, Math.floor(v * scaleY)));
      setPixel(out, i, j, getPixel(texture, tx, ty));
    }
  }
  return out;
}

function toPaint(bmp: RgbaImage): FacePaint {
  const first = getPixel(bmp, 0, 0);
  let uniform = true;
  let anyVisible = false;
  for (let i = 0; i < bmp.data.length; i += 4) {
    if (bmp.data[i + 3]! > 0) anyVisible = true;
    if (bmp.data[i] !== first[0] || bmp.data[i + 1] !== first[1] || bmp.data[i + 2] !== first[2] || bmp.data[i + 3] !== first[3]) {
      uniform = false;
    }
  }
  if (!anyVisible) return { kind: 'hidden' };
  if (uniform) return { kind: 'color', color: rgbaToHex(first) };
  return { kind: 'pixels', width: bmp.width, height: bmp.height, rgba: bytesToBase64(bmp.data) };
}

/**
 * Convert a Bedrock geometry (format 1.12.0+, per-face or box UV) and its
 * texture into the editor's cuboid model with per-face bitmaps. Coordinates
 * stay in the Bedrock frame. HD textures are sampled down to one texel per
 * model unit.
 */
export function importGeometry(file: GeoFile, texture: RgbaImage | null, geometryIndex = 0, defaultColor = '#9aa0a6'): ImportedModel {
  const list = file?.['minecraft:geometry'];
  if (!Array.isArray(list) || !list[geometryIndex]) {
    throw new GeometryImportError('Not a Bedrock geometry file (expected "minecraft:geometry", format 1.12.0 or newer).');
  }
  const geo = list[geometryIndex]!;
  const tw = geo.description?.texture_width ?? texture?.width ?? 64;
  const th = geo.description?.texture_height ?? texture?.height ?? 64;
  const warnings: string[] = [];
  if (texture && (texture.width !== tw || texture.height !== th)) {
    warnings.push(`Texture is ${texture.width}x${texture.height} but the geometry declares ${tw}x${th}; it was scaled to match.`);
  }
  const scaleX = texture ? texture.width / tw : 1;
  const scaleY = texture ? texture.height / th : 1;
  const srcBones = geo.bones ?? [];
  const totalCubes = srcBones.reduce((n, b) => n + (b.cubes?.length ?? 0), 0);
  if (totalCubes > LIMITS.maxCubes) throw new GeometryImportError(`Model has ${totalCubes} cubes; the limit is ${LIMITS.maxCubes}.`);
  if (srcBones.length > LIMITS.maxBones) throw new GeometryImportError(`Model has ${srcBones.length} bones; the limit is ${LIMITS.maxBones}.`);

  const used = new Set<string>();
  const idByName = new Map<string, string>();
  const bones: Bone[] = srcBones.map((b, i) => {
    const id = `b${i}`;
    idByName.set(String(b.name).toLowerCase(), id);
    const bone: Bone = { id, name: sanitizeBoneName(String(b.name ?? `bone${i}`), used), pivot: (b.pivot ?? [0, 0, 0]) as Vec3 };
    if (b.rotation) bone.rotation = b.rotation as Vec3;
    return bone;
  });
  srcBones.forEach((b, i) => {
    if (b.parent) {
      const pid = idByName.get(String(b.parent).toLowerCase());
      if (pid) bones[i]!.parentId = pid;
      else warnings.push(`Bone "${b.name}" referenced unknown parent "${b.parent}"; it was made a root bone.`);
    }
  });
  if (bones.length === 0) throw new GeometryImportError('Geometry has no bones.');

  const cubes: Cube[] = [];
  srcBones.forEach((b, bi) => {
    for (const c of b.cubes ?? []) {
      const size = c.size as Vec3;
      let faceUv: Partial<Record<VoxelFace, [number, number, number, number]>>;
      if (Array.isArray(c.uv)) faceUv = boxUvInternal(c.uv, size, c.mirror ?? b.mirror ?? false);
      else {
        faceUv = {};
        for (const face of FACE_ORDER) {
          const entry = c.uv?.[face];
          if (entry) faceUv[face] = internalFaceUv(face, entry);
        }
      }
      const faces: FacePaintMap = {};
      let firstColor: string | undefined;
      for (const face of FACE_ORDER) {
        const uv = faceUv[face];
        if (!uv) {
          faces[face] = { kind: 'hidden' };
          continue;
        }
        if (!texture) continue;
        const [w, h] = faceTexelSize(size, face);
        const bmp = sampleFace(texture, uv, w, h, scaleX, scaleY);
        const paint = toPaint(bmp);
        faces[face] = paint;
        if (paint.kind === 'color') firstColor ??= paint.color;
      }
      const cube: Cube = {
        id: `c${cubes.length}`,
        boneId: bones[bi]!.id,
        origin: c.origin as Vec3,
        size,
        color: firstColor?.slice(0, 7) ?? defaultColor,
        faces,
      };
      if (c.pivot) cube.pivot = c.pivot as Vec3;
      if (c.rotation) cube.rotation = c.rotation as Vec3;
      if (c.inflate) cube.inflate = c.inflate;
      cubes.push(cube);
    }
  });

  let suggestedIdentifier: string | undefined;
  const m = /^geometry\.([a-z0-9_]+)\.([a-z0-9_]+)$/.exec(geo.description?.identifier ?? '');
  if (m && !checkEntityIdentifier(`${m[1]}:${m[2]}`)) suggestedIdentifier = `${m[1]}:${m[2]}`;
  return { bones, cubes, warnings, ...(suggestedIdentifier ? { suggestedIdentifier } : {}) };
}

import { checkEntityIdentifier, decodePngToRgba, LIMITS, ReportBuilder, utf8Decode, type ValidationReport, type VoxelFace } from '@blockwright/shared';
import { boxUvInternal, FACE_ORDER, internalFaceUv } from './faces.js';
import type { GeoBone, GeoFile } from './geometry.js';
import type { PackFiles } from './pack.js';
import { UUID_RE } from './uuid.js';

export interface AddonSummary {
  identifier?: string;
  geometryId?: string;
  texturePath?: string;
  textureSize?: [number, number];
  cubeCount?: number;
  boneCount?: number;
}

export interface AddonValidation extends ValidationReport {
  summary: AddonSummary;
}

const SAFE_PATH = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

export function isSafeArchivePath(p: string): boolean {
  if (!p || p.length > 200 || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  if (!SAFE_PATH.test(p)) return false;
  return p.split('/').every((seg) => seg !== '..' && seg !== '.' && seg !== '');
}

const RP_ALLOWED = [
  'manifest.json',
  'pack_icon.png',
  'entity/',
  'models/',
  'textures/',
  'render_controllers/',
  'texts/',
  'animations/',
  'animation_controllers/',
];
const BP_ALLOWED = ['manifest.json', 'pack_icon.png', 'entities/', 'spawn_rules/', 'loot_tables/'];

// Raw JSON is inspected field-by-field below to produce detailed validation reports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(files: PackFiles, path: string, r: ReportBuilder): any {
  const bytes = files.get(path);
  if (!bytes) {
    r.error('MISSING_FILE', `Missing ${path}`, path);
    return undefined;
  }
  try {
    return JSON.parse(utf8Decode(bytes));
  } catch (err) {
    r.error('BAD_JSON', `${path} is not valid UTF-8 JSON: ${(err as Error).message}`, path);
    return undefined;
  }
}

const isVersion = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n >= 0);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw manifest, checked field-by-field
function checkManifest(m: any, label: string, moduleType: string, r: ReportBuilder): string[] {
  const uuids: string[] = [];
  if (!m) return uuids;
  if (m.format_version !== 2) r.error('MANIFEST_FORMAT', `${label} manifest format_version must be 2`, `${label}/manifest.json`);
  const h = m.header;
  if (!h || typeof h.name !== 'string' || !h.name) r.error('MANIFEST_HEADER', `${label} manifest header.name missing`);
  if (!h || typeof h.uuid !== 'string' || !UUID_RE.test(h.uuid)) r.error('MANIFEST_UUID', `${label} header.uuid is not a valid UUID`);
  else uuids.push(h.uuid.toLowerCase());
  if (!h || !isVersion(h.version)) r.error('MANIFEST_VERSION', `${label} header.version must be [major, minor, patch]`);
  if (!h || !isVersion(h.min_engine_version)) r.error('MANIFEST_ENGINE', `${label} header.min_engine_version must be [major, minor, patch]`);
  if (!Array.isArray(m.modules) || m.modules.length === 0) {
    r.error('MANIFEST_MODULES', `${label} manifest has no modules`);
  } else {
    for (const mod of m.modules) {
      if (mod.type !== moduleType) r.error('MANIFEST_MODULE_TYPE', `${label} module type must be "${moduleType}", got "${mod.type}"`);
      if (typeof mod.uuid !== 'string' || !UUID_RE.test(mod.uuid)) r.error('MANIFEST_UUID', `${label} module uuid is not a valid UUID`);
      else uuids.push(mod.uuid.toLowerCase());
      if (!isVersion(mod.version)) r.error('MANIFEST_VERSION', `${label} module version must be [major, minor, patch]`);
    }
  }
  return uuids;
}

function listUnder(files: PackFiles, prefix: string, suffix: string): string[] {
  return [...files.keys()].filter((p) => p.startsWith(prefix) && p.endsWith(suffix)).sort();
}

function checkGeometryStructure(geo: GeoFile, geoIndex: number, textureSize: [number, number] | undefined, r: ReportBuilder, summary: AddonSummary) {
  const g = geo['minecraft:geometry'][geoIndex]!;
  const tw = g.description.texture_width;
  const th = g.description.texture_height;
  if (!Number.isInteger(tw) || !Number.isInteger(th) || tw <= 0 || th <= 0) {
    r.error('GEO_TEXTURE_SIZE', 'Geometry texture_width/texture_height must be positive integers');
    return;
  }
  if (textureSize && (textureSize[0] !== tw || textureSize[1] !== th)) {
    r.error('TEXTURE_SIZE_MISMATCH', `Texture is ${textureSize[0]}x${textureSize[1]} but geometry declares ${tw}x${th}`);
  }
  if (tw > LIMITS.maxAtlasSize || th > LIMITS.maxAtlasSize) r.error('TEXTURE_TOO_LARGE', `Texture larger than ${LIMITS.maxAtlasSize}px`);
  const bones: GeoBone[] = Array.isArray(g.bones) ? g.bones : [];
  if (bones.length === 0) r.error('GEO_NO_BONES', 'Geometry has no bones');
  const names = new Map<string, GeoBone>();
  for (const b of bones) {
    if (typeof b.name !== 'string' || !b.name) {
      r.error('GEO_BONE_NAME', 'A bone has no name');
      continue;
    }
    const key = b.name.toLowerCase();
    if (names.has(key)) r.error('GEO_BONE_DUPLICATE', `Bone name "${b.name}" is duplicated`);
    names.set(key, b);
  }
  for (const b of bones) {
    if (b.parent !== undefined && !names.has(String(b.parent).toLowerCase())) {
      r.error('GEO_BONE_PARENT', `Bone "${b.name}" has unknown parent "${b.parent}"`);
    }
    if (b.pivot !== undefined && !isVec3(b.pivot)) r.error('GEO_BONE_PIVOT', `Bone "${b.name}" pivot is not 3 finite numbers`);
  }
  // cycle check
  for (const b of bones) {
    const seen = new Set<string>();
    let cur: GeoBone | undefined = b;
    while (cur?.parent) {
      const k = cur.name.toLowerCase();
      if (seen.has(k)) {
        r.error('GEO_BONE_CYCLE', `Bone hierarchy has a cycle at "${b.name}"`);
        break;
      }
      seen.add(k);
      cur = names.get(String(cur.parent).toLowerCase());
    }
  }
  let cubeCount = 0;
  const inBounds = (x0: number, y0: number, x1: number, y1: number) =>
    Math.min(x0, x1) >= 0 && Math.min(y0, y1) >= 0 && Math.max(x0, x1) <= tw && Math.max(y0, y1) <= th;
  for (const b of bones) {
    for (const [ci, c] of (b.cubes ?? []).entries()) {
      cubeCount++;
      const where = `${b.name}#${ci}`;
      if (!isVec3(c.origin) || !isVec3(c.size)) {
        r.error('GEO_CUBE_NUMBERS', `Cube ${where} origin/size must be 3 finite numbers`);
        continue;
      }
      if (c.size.some((s) => s < 0)) r.error('GEO_CUBE_SIZE', `Cube ${where} has a negative size`);
      if (c.size.every((s) => s === 0)) r.error('GEO_CUBE_EMPTY', `Cube ${where} has zero size`);
      if ([...c.origin, ...c.size.map((s, i) => s + c.origin[i]!)].some((v) => Math.abs(v) > LIMITS.maxCoordinate)) {
        r.error('GEO_CUBE_BOUNDS', `Cube ${where} lies outside ±${LIMITS.maxCoordinate} model units`);
      }
      if (c.pivot !== undefined && !isVec3(c.pivot)) r.error('GEO_CUBE_PIVOT', `Cube ${where} pivot invalid`);
      if (c.rotation !== undefined && !isVec3(c.rotation)) r.error('GEO_CUBE_ROTATION', `Cube ${where} rotation invalid`);
      if (Array.isArray(c.uv)) {
        const faces = boxUvInternal(c.uv as [number, number], c.size, c.mirror ?? b.mirror ?? false);
        for (const face of FACE_ORDER) {
          const [x0, y0, x1, y1] = faces[face];
          if (!inBounds(x0, y0, x1, y1)) r.error('UV_OUT_OF_BOUNDS', `Cube ${where} box UV ${face} face is outside the ${tw}x${th} texture`);
        }
      } else if (c.uv && typeof c.uv === 'object') {
        const faces = Object.keys(c.uv);
        if (faces.length === 0) r.warn('GEO_NO_FACES', `Cube ${where} has no faces and will be invisible`);
        for (const face of faces) {
          if (!(FACE_ORDER as readonly string[]).includes(face)) {
            r.error('UV_BAD_FACE', `Cube ${where} has unknown face "${face}"`);
            continue;
          }
          const entry = c.uv[face as VoxelFace]!;
          if (!Array.isArray(entry.uv) || entry.uv.length !== 2 || !Array.isArray(entry.uv_size) || entry.uv_size.length !== 2) {
            r.error('UV_BAD_ENTRY', `Cube ${where} ${face} UV must have uv[2] and uv_size[2]`);
            continue;
          }
          const [x0, y0, x1, y1] = internalFaceUv(face as VoxelFace, entry);
          if (![x0, y0, x1, y1].every(Number.isFinite)) r.error('UV_BAD_ENTRY', `Cube ${where} ${face} UV is not finite`);
          else if (!inBounds(x0, y0, x1, y1)) {
            r.error('UV_OUT_OF_BOUNDS', `Cube ${where} ${face} UV [${entry.uv}] size [${entry.uv_size}] is outside the ${tw}x${th} texture`);
          }
        }
      } else {
        r.error('GEO_CUBE_UV', `Cube ${where} has no UV mapping`);
      }
    }
  }
  if (cubeCount === 0) r.error('GEO_NO_CUBES', 'Geometry has no cubes; the entity would be invisible');
  if (cubeCount > LIMITS.maxCubes) r.error('MODEL_TOO_COMPLEX', `Geometry has ${cubeCount} cubes (limit ${LIMITS.maxCubes})`);
  summary.cubeCount = cubeCount;
  summary.boneCount = bones.length;
}

/**
 * Structural validation of a resource + behavior pack pair for one custom
 * entity: safe paths, manifests, distinct UUIDs, dependency link, matching
 * identifiers, geometry/texture/render-controller references, texture size,
 * UV bounds, bone parents, cube limits. Necessary — not sufficient — for
 * in-game compatibility.
 */
export function validateAddonPacks(behaviorPack: PackFiles, resourcePack: PackFiles): AddonValidation {
  const r = new ReportBuilder();
  const summary: AddonSummary = {};

  r.check('archive-paths');
  for (const [label, files, allowed] of [
    ['BP', behaviorPack, BP_ALLOWED],
    ['RP', resourcePack, RP_ALLOWED],
  ] as const) {
    for (const p of files.keys()) {
      if (!isSafeArchivePath(p)) r.error('UNSAFE_PATH', `${label} contains unsafe path "${p}"`, p);
      else if (!allowed.some((a) => (a.endsWith('/') ? p.startsWith(a) : p === a))) r.warn('UNEXPECTED_FILE', `${label} contains unexpected file ${p}`, p);
    }
  }

  r.check('manifests');
  const rpManifest = parseJson(resourcePack, 'manifest.json', r);
  const bpManifest = parseJson(behaviorPack, 'manifest.json', r);
  const uuids = [...checkManifest(rpManifest, 'RP', 'resources', r), ...checkManifest(bpManifest, 'BP', 'data', r)];
  r.check('uuid-uniqueness');
  if (new Set(uuids).size !== uuids.length) r.error('UUID_DUPLICATE', 'Pack header/module UUIDs must all be distinct');

  r.check('dependency-link');
  if (rpManifest?.header && bpManifest) {
    const deps: Array<{ uuid?: unknown; version?: unknown }> = Array.isArray(bpManifest.dependencies) ? bpManifest.dependencies : [];
    const dep = deps.find((d) => typeof d.uuid === 'string' && d.uuid.toLowerCase() === String(rpManifest.header.uuid).toLowerCase());
    if (!dep) r.error('DEPENDENCY_MISSING', 'Behavior pack does not depend on the resource pack UUID');
    else if (JSON.stringify(dep.version) !== JSON.stringify(rpManifest.header.version)) {
      r.error('DEPENDENCY_VERSION', 'Behavior pack dependency version does not match the resource pack version');
    }
  }

  r.check('behavior-entity');
  const bpEntities = listUnder(behaviorPack, 'entities/', '.json');
  let identifier: string | undefined;
  if (bpEntities.length !== 1) r.error('BP_ENTITY_COUNT', `Expected exactly 1 behavior entity file, found ${bpEntities.length}`);
  else {
    const e = parseJson(behaviorPack, bpEntities[0]!, r);
    const d = e?.['minecraft:entity']?.description;
    if (!d || typeof d.identifier !== 'string') r.error('BP_ENTITY_ID', 'Behavior entity has no description.identifier', bpEntities[0]);
    else {
      identifier = d.identifier;
      const problem = checkEntityIdentifier(d.identifier);
      if (problem) r.error('INVALID_IDENTIFIER', `Behavior entity identifier "${d.identifier}": ${problem}`);
      if (d.is_summonable !== true) r.error('NOT_SUMMONABLE', 'Behavior entity must set is_summonable: true');
      if (d.is_spawnable !== true) r.warn('NOT_SPAWNABLE', 'Behavior entity has no spawn egg (is_spawnable is not true)');
    }
    if (typeof e?.format_version !== 'string') r.error('FORMAT_VERSION', 'Behavior entity has no format_version');
  }
  summary.identifier = identifier;

  r.check('client-entity');
  const clientFiles = listUnder(resourcePack, 'entity/', '.entity.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw client entity, checked field-by-field
  let client: any;
  if (clientFiles.length !== 1) r.error('RP_ENTITY_COUNT', `Expected exactly 1 client entity file, found ${clientFiles.length}`);
  else {
    client = parseJson(resourcePack, clientFiles[0]!, r)?.['minecraft:client_entity']?.description;
    if (!client) r.error('RP_ENTITY', 'Client entity has no minecraft:client_entity.description');
    else if (identifier && client.identifier !== identifier) {
      r.error('IDENTIFIER_MISMATCH', `Client entity "${client.identifier}" does not match behavior entity "${identifier}"`);
    }
  }

  r.check('render-controllers');
  const controllerFiles = listUnder(resourcePack, 'render_controllers/', '.json');
  const definedControllers = new Set<string>();
  for (const f of controllerFiles) {
    const rc = parseJson(resourcePack, f, r);
    for (const k of Object.keys(rc?.render_controllers ?? {})) definedControllers.add(k);
  }
  const referenced: string[] = Array.isArray(client?.render_controllers)
    ? client.render_controllers.map((c: unknown) => (typeof c === 'string' ? c : Object.keys(c as object)[0]))
    : [];
  if (client && referenced.length === 0) r.error('NO_RENDER_CONTROLLER', 'Client entity lists no render controller');
  for (const id of referenced) {
    if (id !== 'controller.render.default' && !definedControllers.has(id)) r.error('RENDER_CONTROLLER_MISSING', `Render controller "${id}" is not defined`);
  }
  if (client && typeof client.materials?.default !== 'string') r.error('MATERIAL_MISSING', 'Client entity has no default material');

  r.check('geometry-reference');
  const geoRef: string | undefined = client?.geometry?.default;
  summary.geometryId = geoRef;
  let geoMatch: { file: GeoFile; index: number } | undefined;
  for (const f of listUnder(resourcePack, 'models/', '.json')) {
    const geo = parseJson(resourcePack, f, r) as GeoFile | undefined;
    const list = geo?.['minecraft:geometry'];
    if (!Array.isArray(list)) {
      r.error('GEO_FORMAT', `${f} is not a minecraft:geometry (1.12.0+) file`, f);
      continue;
    }
    list.forEach((g, index) => {
      if (g?.description?.identifier === geoRef) {
        if (geoMatch) r.error('GEO_DUPLICATE', `Geometry "${geoRef}" is defined more than once`);
        geoMatch = { file: geo!, index };
      }
    });
  }
  if (client && !geoRef) r.error('GEO_REF_MISSING', 'Client entity has no default geometry');
  else if (client && !geoMatch) r.error('GEO_NOT_FOUND', `Geometry "${geoRef}" referenced by the client entity is not in the pack`);
  else if (geoRef && !/^geometry\.[a-z0-9_.]+$/.test(geoRef))
    r.warn('GEO_ID_STYLE', `Geometry identifier "${geoRef}" should look like geometry.<namespace>.<name>`);

  r.check('texture-reference');
  const texRef: string | undefined = client?.textures?.default;
  summary.texturePath = texRef;
  let textureSize: [number, number] | undefined;
  if (client && !texRef) r.error('TEXTURE_REF_MISSING', 'Client entity has no default texture');
  else if (texRef) {
    const png = resourcePack.get(`${texRef}.png`);
    if (!png) r.error('TEXTURE_NOT_FOUND', `Texture ${texRef}.png is not in the resource pack`);
    else {
      try {
        const { image } = decodePngToRgba(png);
        textureSize = [image.width, image.height];
        summary.textureSize = textureSize;
      } catch (err) {
        r.error('TEXTURE_CORRUPT', `Texture ${texRef}.png cannot be decoded: ${(err as Error).message}`);
      }
    }
  }

  r.check('geometry-structure');
  r.check('uv-bounds');
  if (geoMatch) checkGeometryStructure(geoMatch.file, geoMatch.index, textureSize, r, summary);

  r.check('lang');
  const lang = resourcePack.get('texts/en_US.lang');
  if (!lang) r.warn('LANG_MISSING', 'No texts/en_US.lang: the entity name shows as its raw identifier');
  else if (
    identifier &&
    !utf8Decode(lang, false)
      .split(/\r?\n/)
      .some((l: string) => l.startsWith(`entity.${identifier}.name=`))
  ) {
    r.warn('LANG_NAME_MISSING', `texts/en_US.lang has no entity.${identifier}.name entry`);
  }

  r.check('pack-icons');
  for (const [label, files] of [
    ['BP', behaviorPack],
    ['RP', resourcePack],
  ] as const) {
    const icon = files.get('pack_icon.png');
    if (!icon) r.warn('ICON_MISSING', `${label} has no pack_icon.png`);
    else {
      try {
        decodePngToRgba(icon);
      } catch {
        r.error('ICON_CORRUPT', `${label} pack_icon.png cannot be decoded`);
      }
    }
  }
  return { ...r.build(), summary };
}

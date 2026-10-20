import { encodeRgbaPng, utf8Encode, type EntityProjectState } from '@blockwright/shared';
import { packAtlas, type Atlas, type AtlasOptions } from './atlas.js';
import { buildGeometry, type BuiltGeometry } from './geometry.js';
import { modelBounds, validateEntityModel } from './model.js';
import { renderFrontView } from './render.js';
import { freshPackUuids, type PackUuids } from './uuid.js';

/**
 * Builds the two packs of a Bedrock add-on for one custom entity (PLAN §3.2).
 * Format versions follow Microsoft's "Creating New Entity Types" guide:
 * behavior entity 1.12.0, client entity 1.10.0, render controller 1.8.0,
 * geometry 1.12.0, manifest format_version 2.
 *
 * File names include the namespace, and the texture lives under
 * textures/entity/<namespace>/, so two add-ons with the same entity name in
 * different namespaces never override each other's resources by path.
 */

export const MANIFEST_FORMAT_VERSION = 2;
export const DEFAULT_MIN_ENGINE_VERSION: [number, number, number] = [1, 21, 0];
export const GENERATOR = { name: 'blockwright', version: '0.1.0' };

export type PackFiles = Map<string, Uint8Array>;

export interface AddonBuildOptions {
  uuids?: PackUuids;
  packVersion?: [number, number, number];
  minEngineVersion?: [number, number, number];
  atlas?: AtlasOptions;
}

export interface BuiltAddon {
  identifier: string;
  namespace: string;
  slug: string;
  geometryId: string;
  texturePath: string;
  renderControllerId: string;
  material: 'entity' | 'entity_alphatest';
  uuids: PackUuids;
  resourcePack: PackFiles;
  behaviorPack: PackFiles;
  atlas: Atlas;
  geometry: BuiltGeometry;
  /** Safe ASCII base for download names, e.g. `my_ns_robot`. */
  fileBase: string;
}

export class AddonBuildError extends Error {
  constructor(
    message: string,
    readonly code: 'EXPORT_INVALID' | 'MODEL_TOO_COMPLEX' | 'INVALID_IDENTIFIER',
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const json = (value: unknown) => utf8Encode(`${JSON.stringify(value, null, 2)}\n`);
const text = (value: string) => utf8Encode(value);

function langValue(s: string): string {
  // .lang values end at a line break; "##" starts a comment
  return s.replace(/[\r\n\t]/g, ' ').replace(/##/g, '# #').trim();
}

export function buildBehaviorEntity(state: EntityProjectState, collision: { width: number; height: number }) {
  const [, slug] = state.identifier.split(':') as [string, string];
  const components: Record<string, unknown> = {
    'minecraft:type_family': { family: [slug, 'blockwright_custom'] },
    'minecraft:health': { value: state.behavior.health, max: state.behavior.health },
    'minecraft:collision_box': collision,
    'minecraft:physics': {},
    'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
    'minecraft:nameable': {},
  };
  if (state.behavior.profile === 'wander') {
    Object.assign(components, {
      'minecraft:movement': { value: state.behavior.movementSpeed },
      'minecraft:movement.basic': {},
      'minecraft:jump.static': {},
      'minecraft:navigation.walk': { avoid_water: true },
      'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 1 },
      'minecraft:behavior.look_at_player': { priority: 7, look_distance: 6, probability: 0.02 },
      'minecraft:behavior.random_look_around': { priority: 8 },
    });
  }
  return {
    format_version: '1.12.0',
    'minecraft:entity': {
      description: { identifier: state.identifier, is_spawnable: true, is_summonable: true },
      components,
    },
  };
}

export function buildAddon(state: EntityProjectState, options: AddonBuildOptions = {}): BuiltAddon {
  const modelReport = validateEntityModel(state);
  if (!modelReport.ok) {
    const tooComplex = modelReport.issues.some((i) => i.code === 'MODEL_TOO_COMPLEX');
    throw new AddonBuildError(
      modelReport.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' '),
      tooComplex ? 'MODEL_TOO_COMPLEX' : 'EXPORT_INVALID',
      modelReport,
    );
  }
  const [namespace, slug] = state.identifier.split(':') as [string, string];
  const geometryId = `geometry.${namespace}.${slug}`;
  const texturePath = `textures/entity/${namespace}/${slug}`;
  const renderControllerId = `controller.render.${namespace}.${slug}`;
  const fileStem = `${namespace}.${slug}`;
  const uuids = options.uuids ?? freshPackUuids();
  const packVersion = options.packVersion ?? [1, 0, 0];
  const minEngine = options.minEngineVersion ?? DEFAULT_MIN_ENGINE_VERSION;

  let atlas: Atlas;
  try {
    atlas = packAtlas(state.cubes, options.atlas);
  } catch (err) {
    if ((err as { code?: string }).code === 'MODEL_TOO_COMPLEX') throw new AddonBuildError((err as Error).message, 'MODEL_TOO_COMPLEX');
    throw err;
  }
  const geometry = buildGeometry(state, atlas, geometryId);
  const material = atlas.hasTransparency ? 'entity_alphatest' : 'entity';
  const icon = encodeRgbaPng(renderFrontView(state, atlas, 128));

  const { min, max } = modelBounds(state.cubes);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const collision = {
    width: Math.min(4, Math.max(0.3, round1(Math.max(max[0] - min[0], max[2] - min[2]) / 16))),
    height: Math.min(8, Math.max(0.3, round1((max[1] - Math.max(0, min[1])) / 16))),
  };

  const description = `Custom entity ${state.identifier}. Made with Blockwright - not an official Minecraft product.`;
  const metadata = { generated_with: { [GENERATOR.name]: [GENERATOR.version] } };

  const rp: PackFiles = new Map();
  rp.set(
    'manifest.json',
    json({
      format_version: MANIFEST_FORMAT_VERSION,
      header: {
        name: `${state.displayName} (Resources)`,
        description,
        uuid: uuids.rpHeader,
        version: packVersion,
        min_engine_version: minEngine,
      },
      modules: [{ description: 'Entity model, texture and render controller', type: 'resources', uuid: uuids.rpModule, version: packVersion }],
      metadata,
    }),
  );
  rp.set('pack_icon.png', icon);
  rp.set(
    `entity/${fileStem}.entity.json`,
    json({
      format_version: '1.10.0',
      'minecraft:client_entity': {
        description: {
          identifier: state.identifier,
          materials: { default: material },
          textures: { default: texturePath },
          geometry: { default: geometryId },
          render_controllers: [renderControllerId],
          spawn_egg: { base_color: state.spawnEgg.baseColor, overlay_color: state.spawnEgg.overlayColor },
        },
      },
    }),
  );
  rp.set(`models/entity/${fileStem}.geo.json`, json(geometry.geo));
  rp.set(`${texturePath}.png`, encodeRgbaPng(atlas.image));
  rp.set(
    `render_controllers/${fileStem}.render_controllers.json`,
    json({
      format_version: '1.8.0',
      render_controllers: {
        [renderControllerId]: {
          geometry: 'Geometry.default',
          materials: [{ '*': 'Material.default' }],
          textures: ['Texture.default'],
        },
      },
    }),
  );
  const name = langValue(state.displayName);
  rp.set(
    'texts/en_US.lang',
    text(`entity.${state.identifier}.name=${name}\nitem.spawn_egg.entity.${state.identifier}.name=Spawn ${name}\n`),
  );
  rp.set('texts/languages.json', json(['en_US']));

  const bp: PackFiles = new Map();
  bp.set(
    'manifest.json',
    json({
      format_version: MANIFEST_FORMAT_VERSION,
      header: {
        name: `${state.displayName} (Behaviors)`,
        description,
        uuid: uuids.bpHeader,
        version: packVersion,
        min_engine_version: minEngine,
      },
      modules: [{ description: 'Entity behavior', type: 'data', uuid: uuids.bpModule, version: packVersion }],
      dependencies: [{ uuid: uuids.rpHeader, version: packVersion }],
      metadata,
    }),
  );
  bp.set('pack_icon.png', icon);
  bp.set(`entities/${fileStem}.json`, json(buildBehaviorEntity(state, collision)));

  return {
    identifier: state.identifier,
    namespace,
    slug,
    geometryId,
    texturePath,
    renderControllerId,
    material,
    uuids,
    resourcePack: rp,
    behaviorPack: bp,
    atlas,
    geometry,
    fileBase: `${namespace}_${slug}`,
  };
}

import { describe, expect, it } from 'vitest';
import { bytesToBase64, createImage, getPixel, LIMITS, utf8Decode, utf8Encode, type Cube } from '@blockwright/shared';
import { createUvDebugSkin } from '@blockwright/minecraft-skin';
import { ModelTooComplexError, packAtlas, readFaceBitmap } from './atlas.js';
import { AddonBuildError, buildAddon, type PackFiles } from './pack.js';
import { BLOCK_TEMPLATE, HUMANOID_TEMPLATE, QUADRUPED_TEMPLATE, skinToHumanoid } from './templates.js';
import { stateFrom } from './test-helpers.js';
import { isSafeArchivePath, validateAddonPacks } from './validate.js';
import { UUID_RE } from './uuid.js';

const readJson = (files: PackFiles, path: string) => JSON.parse(utf8Decode(files.get(path)!));
const clone = (files: PackFiles): PackFiles => new Map([...files].map(([k, v]) => [k, v.slice()]));
const codes = (r: { issues: { code: string; severity: string }[] }) => r.issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('buildAddon', () => {
  it.each([HUMANOID_TEMPLATE, QUADRUPED_TEMPLATE, BLOCK_TEMPLATE])('$id template produces a structurally valid add-on', (t) => {
    const addon = buildAddon(stateFrom(t));
    const report = validateAddonPacks(addon.behaviorPack, addon.resourcePack);
    expect(codes(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({ identifier: 'test_ns:test_bot', geometryId: 'geometry.test_ns.test_bot', cubeCount: t.build().cubes.length });
  });

  it('lays out the expected pack files with linked, distinct UUIDs', () => {
    const addon = buildAddon(stateFrom());
    expect([...addon.resourcePack.keys()].sort()).toEqual([
      'entity/test_ns.test_bot.entity.json',
      'manifest.json',
      'models/entity/test_ns.test_bot.geo.json',
      'pack_icon.png',
      'render_controllers/test_ns.test_bot.render_controllers.json',
      'texts/en_US.lang',
      'texts/languages.json',
      'textures/entity/test_ns/test_bot.png',
    ]);
    expect([...addon.behaviorPack.keys()].sort()).toEqual(['entities/test_ns.test_bot.json', 'manifest.json', 'pack_icon.png']);
    const rp = readJson(addon.resourcePack, 'manifest.json');
    const bp = readJson(addon.behaviorPack, 'manifest.json');
    expect(rp.format_version).toBe(2);
    expect(rp.modules[0].type).toBe('resources');
    expect(bp.modules[0].type).toBe('data');
    expect(bp.dependencies).toEqual([{ uuid: rp.header.uuid, version: rp.header.version }]);
    const all = [rp.header.uuid, rp.modules[0].uuid, bp.header.uuid, bp.modules[0].uuid];
    expect(new Set(all).size).toBe(4);
    all.forEach((u) => expect(u).toMatch(UUID_RE));
    const client = readJson(addon.resourcePack, 'entity/test_ns.test_bot.entity.json')['minecraft:client_entity'].description;
    expect(client).toMatchObject({
      identifier: 'test_ns:test_bot',
      geometry: { default: 'geometry.test_ns.test_bot' },
      textures: { default: 'textures/entity/test_ns/test_bot' },
      materials: { default: 'entity' },
      render_controllers: ['controller.render.test_ns.test_bot'],
    });
    const entity = readJson(addon.behaviorPack, 'entities/test_ns.test_bot.json')['minecraft:entity'];
    expect(entity.description).toEqual({ identifier: 'test_ns:test_bot', is_spawnable: true, is_summonable: true });
    expect(entity.components['minecraft:behavior.random_stroll']).toBeDefined();
    const lang = utf8Decode(addon.resourcePack.get('texts/en_US.lang')!);
    expect(lang).toContain('entity.test_ns:test_bot.name=Test Bot');
    expect(lang).toContain('item.spawn_egg.entity.test_ns:test_bot.name=Spawn Test Bot');
  });

  it('generates fresh UUIDs per export and a static profile without movement', () => {
    const s = stateFrom();
    s.behavior.profile = 'static';
    const a = buildAddon(s);
    const b = buildAddon(s);
    expect(a.uuids.rpHeader).not.toBe(b.uuids.rpHeader);
    const comps = readJson(a.behaviorPack, 'entities/test_ns.test_bot.json')['minecraft:entity'].components;
    expect(comps['minecraft:movement']).toBeUndefined();
    expect(comps['minecraft:physics']).toEqual({});
  });

  it('switches to an alpha-tested material when a face has transparency', () => {
    const s = stateFrom();
    s.cubes[0]!.faces = { north: { kind: 'pixels', width: 8, height: 12, rgba: bytesToBase64(createImage(8, 12, [1, 2, 3, 0]).data) } };
    const addon = buildAddon(s);
    expect(addon.material).toBe('entity_alphatest');
  });

  it('rejects models over the cube limit with MODEL_TOO_COMPLEX', () => {
    const s = stateFrom(BLOCK_TEMPLATE);
    const base = s.cubes[0]!;
    s.cubes = Array.from({ length: LIMITS.maxCubes + 1 }, (_, i): Cube => ({ ...base, id: `c${i}`, origin: [i % 30, 0, Math.floor(i / 30)], size: [1, 1, 1] }));
    expect(() => buildAddon(s)).toThrow(AddonBuildError);
    try {
      buildAddon(s);
    } catch (err) {
      expect((err as AddonBuildError).code).toBe('MODEL_TOO_COMPLEX');
    }
  });

  it('rejects empty models and broken hierarchies', () => {
    const s = stateFrom();
    s.cubes = [];
    expect(() => buildAddon(s)).toThrow(/no cubes/);
    const t = stateFrom();
    t.bones[0]!.parentId = 'head'; // body -> head -> body cycle
    expect(() => buildAddon(t)).toThrow(/cycle/);
  });
});

describe('atlas strategies', () => {
  it('uses shared colour swatches when exact packing would be too large, and fails beyond the max', () => {
    const cubes: Cube[] = Array.from({ length: 64 }, (_, i) => ({
      id: `c${i}`,
      boneId: 'b',
      origin: [0, 0, 0],
      size: [16, 16, 16],
      color: i % 2 ? '#ff0000' : '#00ff00',
    }));
    const atlas = packAtlas(cubes, { preferExactUpTo: 128 });
    expect(atlas.mode).toBe('palette');
    expect(atlas.width).toBeLessThanOrEqual(16);
    const red = readFaceBitmap(atlas, 'c1', 'north');
    expect(getPixel(red, 0, 0)).toEqual([255, 0, 0, 255]);
    const huge: Cube[] = [
      {
        id: 'h',
        boneId: 'b',
        origin: [0, 0, 0],
        size: [64, 64, 1],
        color: '#fff',
        faces: {
          north: { kind: 'pixels', width: 64, height: 64, rgba: bytesToBase64(createImage(64, 64, [1, 1, 1, 255]).data) },
        },
      } as unknown as Cube,
    ];
    expect(() => packAtlas(huge, { maxSize: 32 })).toThrow(ModelTooComplexError);
  });
});

describe('validateAddonPacks negative cases (EN-05/06/07)', () => {
  const addon = buildAddon(stateFrom());

  it('flags a mismatched client identifier', () => {
    const rp = clone(addon.resourcePack);
    const path = 'entity/test_ns.test_bot.entity.json';
    const j = readJson(rp, path);
    j['minecraft:client_entity'].description.identifier = 'test_ns:other';
    rp.set(path, utf8Encode(JSON.stringify(j)));
    expect(codes(validateAddonPacks(addon.behaviorPack, rp))).toContain('IDENTIFIER_MISMATCH');
  });

  it('flags a missing texture, broken dependency and duplicate UUIDs', () => {
    const rp = clone(addon.resourcePack);
    rp.delete('textures/entity/test_ns/test_bot.png');
    expect(codes(validateAddonPacks(addon.behaviorPack, rp))).toContain('TEXTURE_NOT_FOUND');
    const bp = clone(addon.behaviorPack);
    const m = readJson(bp, 'manifest.json');
    m.dependencies = [];
    m.modules[0].uuid = readJson(addon.resourcePack, 'manifest.json').header.uuid;
    bp.set('manifest.json', utf8Encode(JSON.stringify(m)));
    const c = codes(validateAddonPacks(bp, addon.resourcePack));
    expect(c).toContain('DEPENDENCY_MISSING');
    expect(c).toContain('UUID_DUPLICATE');
  });

  it('flags UVs outside the texture and texture size mismatch', () => {
    const rp = clone(addon.resourcePack);
    const path = 'models/entity/test_ns.test_bot.geo.json';
    const geo = readJson(rp, path);
    geo['minecraft:geometry'][0].bones[0].cubes[0].uv.north.uv = [500, 500];
    geo['minecraft:geometry'][0].description.texture_width = 2048;
    rp.set(path, utf8Encode(JSON.stringify(geo)));
    const c = codes(validateAddonPacks(addon.behaviorPack, rp));
    expect(c).toContain('UV_OUT_OF_BOUNDS');
    expect(c).toContain('TEXTURE_SIZE_MISMATCH');
  });

  it('flags unsafe paths and reserved namespaces', () => {
    const bp = clone(addon.behaviorPack);
    bp.set('../evil.json', utf8Encode('{}'));
    expect(codes(validateAddonPacks(bp, addon.resourcePack))).toContain('UNSAFE_PATH');
    for (const p of ['../a', '/abs', 'a/../b', 'C:/x', 'a\\b', 'a//b', './a']) expect(isSafeArchivePath(p), p).toBe(false);
    expect(isSafeArchivePath('textures/entity/ns/a_b.png')).toBe(true);
    const bp2 = clone(addon.behaviorPack);
    const path = 'entities/test_ns.test_bot.json';
    const e = readJson(bp2, path);
    e['minecraft:entity'].description.identifier = 'minecraft:test_bot';
    bp2.set(path, utf8Encode(JSON.stringify(e)));
    const c = codes(validateAddonPacks(bp2, addon.resourcePack));
    expect(c).toContain('INVALID_IDENTIFIER');
    expect(c).toContain('IDENTIFIER_MISMATCH');
  });
});

describe('skin to humanoid entity', () => {
  it('maps skin faces with the box-UV convention and drops empty outer layers', () => {
    const skin = createUvDebugSkin('classic');
    const model = skinToHumanoid(skin, 'classic');
    expect(model.cubes.filter((c) => !c.inflate)).toHaveLength(6);
    expect(model.cubes.filter((c) => c.inflate)).toHaveLength(0); // debug skin has an empty outer layer
    const head = model.cubes.find((c) => c.size[0] === 8 && c.size[2] === 8)!;
    const atlas = packAtlas([head]);
    // north (front) face = skin head front (8,8)-(16,16), unmirrored
    const north = readFaceBitmap(atlas, head.id, 'north');
    expect(getPixel(north, 0, 0)).toEqual(getPixel(skin, 8, 8));
    expect(getPixel(north, 1, 0)).toEqual(getPixel(skin, 9, 8));
    // east (entity's right) face = skin head "right" region (0,8)
    expect(getPixel(readFaceBitmap(atlas, head.id, 'east'), 0, 0)).toEqual(getPixel(skin, 0, 8));
    // up face: box UV up is stored flipped both ways, so natural (0,0) = skin top region's last texel
    expect(getPixel(readFaceBitmap(atlas, head.id, 'up'), 0, 0)).toEqual(getPixel(skin, 15, 7));
    const addon = buildAddon({ ...stateFrom(), bones: model.bones, cubes: model.cubes });
    expect(validateAddonPacks(addon.behaviorPack, addon.resourcePack).ok).toBe(true);
  });
});

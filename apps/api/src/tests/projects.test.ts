import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { base64ToBytes, bytesToBase64, decodePngToRgba, encodeRgbaPng, setPixel, utf8Decode } from '@blockwright/shared';
import { createTemplateSkin, createUvDebugSkin } from '@blockwright/minecraft-skin';
import { HUMANOID_TEMPLATE, BLOCK_TEMPLATE } from '@blockwright/bedrock-export';
import { readZip } from '../exporters/zip.js';
import { binaryParser, makeApp, newSession, png } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => ctx?.cleanup());

const prov = { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] };
const skinState = (references: unknown[] = []) => ({ displayName: 'Test skin', model: 'classic', provenance: prov, references });
const entityState = (identifier = 'test_ns:test_bot') => ({
  displayName: 'Test Bot',
  identifier,
  templateId: 'humanoid',
  ...HUMANOID_TEMPLATE.build(),
  behavior: { profile: 'wander', health: 20, movementSpeed: 0.25 },
  provenance: prov,
  references: [],
});
const skinB64 = (img = createTemplateSkin('classic')) => bytesToBase64(encodeRgbaPng(img));

describe('skin projects', () => {
  it('creates from a server template, saves revisions and detects conflicts', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const created = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', t)
      .send({ state: skinState(), template: { kind: 'template' } })
      .expect(201);
    const p = created.body.data.project;
    expect(p).toMatchObject({ type: 'skin', revision: 1, generationMode: 'manual', model: 'classic' });
    expect(decodePngToRgba(base64ToBytes(created.body.data.skinPngBase64)).image.width).toBe(64);

    const edited = createTemplateSkin('classic');
    setPixel(edited, 9, 9, [1, 2, 3, 255]);
    const upd = await ctx.http
      .put(`/api/v1/projects/${p.id}`)
      .set('X-Session-Token', t)
      .send({ baseRevision: 1, state: skinState(), skinPngBase64: skinB64(edited) })
      .expect(200);
    expect(upd.body.data.project.revision).toBe(2);
    const stale = await ctx.http
      .put(`/api/v1/projects/${p.id}`)
      .set('X-Session-Token', t)
      .send({ baseRevision: 1, state: skinState(), skinPngBase64: skinB64() })
      .expect(409);
    expect(stale.body.error).toMatchObject({ code: 'REVISION_CONFLICT', details: { currentRevision: 2 } });

    const got = await ctx.http.get(`/api/v1/projects/${p.id}`).set('X-Session-Token', t).expect(200);
    expect(Array.from(decodePngToRgba(base64ToBytes(got.body.data.skinPngBase64)).image.data.slice((9 * 64 + 9) * 4, (9 * 64 + 9) * 4 + 4))).toEqual([
      1, 2, 3, 255,
    ]);

    const history = await ctx.http.get(`/api/v1/projects/${p.id}/revisions`).set('X-Session-Token', t).expect(200);
    expect(history.body.data.revisions.map((r: { revision: number }) => r.revision)).toEqual([1, 2]);
    const reverted = await ctx.http.post(`/api/v1/projects/${p.id}/revert`).set('X-Session-Token', t).send({ baseRevision: 2, toRevision: 1 }).expect(200);
    expect(reverted.body.data.project.revision).toBe(3);
    expect(reverted.body.data.skinPngBase64).toBe(created.body.data.skinPngBase64);
  });

  it('rejects invalid skins, foreign references, duplicate roles and self-declared AI provenance', async () => {
    ctx = await makeApp();
    const alice = await newSession(ctx.app);
    const bob = await newSession(ctx.app);
    const notPng = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', alice)
      .send({ state: skinState(), skinPngBase64: 'aGVsbG8=' })
      .expect(400);
    expect(notPng.body.error.code).toBe('INVALID_SKIN');
    const wrongSize = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', alice)
      .send({ state: skinState(), skinPngBase64: bytesToBase64(await png(32, 32)) })
      .expect(400);
    expect(wrongSize.body.error.code).toBe('INVALID_SKIN');

    const bobAsset = (
      await ctx.http
        .post('/api/v1/assets/images')
        .set('X-Session-Token', bob)
        .attach('file', await png(64, 64), 'b.png')
        .expect(201)
    ).body.data.asset;
    const ref = (role: string, assetId: string) => ({
      id: `ref_${role}`,
      role,
      originalName: 'x.png',
      mime: 'image/png',
      width: 1,
      height: 1,
      sizeBytes: 1,
      temporaryAssetId: assetId,
      rotationDegrees: 0,
    });
    const foreign = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', alice)
      .send({ state: skinState([ref('front', bobAsset.id)]), skinPngBase64: skinB64() })
      .expect(400);
    expect(foreign.body.error.message).toMatch(/missing or expired/);

    const own = (
      await ctx.http
        .post('/api/v1/assets/images')
        .set('X-Session-Token', alice)
        .attach('file', await png(80, 120), 'a.png')
        .expect(201)
    ).body.data.asset;
    const dup = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', alice)
      .send({ state: skinState([ref('front', own.id), ref('front', own.id)]), skinPngBase64: skinB64() })
      .expect(400);
    expect(dup.body.error.code).toBe('VALIDATION_FAILED');
    // server metadata wins over client claims
    const okRef = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', alice)
      .send({ state: skinState([ref('front', own.id)]), skinPngBase64: skinB64() })
      .expect(201);
    expect(okRef.body.data.project.references[0]).toMatchObject({ width: 80, height: 120 });

    const fakeAi = await ctx.http
      .post('/api/v1/projects/skin')
      .set('X-Session-Token', alice)
      .send({ state: { ...skinState(), provenance: { ...prov, origin: 'ai' } }, skinPngBase64: skinB64() })
      .expect(400);
    expect(fakeAi.body.error.message).toMatch(/only be set by the server/);
  });

  it('saves work in progress with transparent base pixels but refuses to export it', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const img = createTemplateSkin('classic');
    setPixel(img, 9, 9, [0, 0, 0, 0]);
    const p = (
      await ctx.http
        .post('/api/v1/projects/skin')
        .set('X-Session-Token', t)
        .send({ state: skinState(), skinPngBase64: skinB64(img) })
        .expect(201)
    ).body.data.project;
    const res = await ctx.http.post('/api/v1/exports/skin').set('X-Session-Token', t).send({ projectId: p.id, revision: 1 }).expect(422);
    expect(res.body.error.code).toBe('EXPORT_INVALID');
    expect(res.body.error.details.issues.map((i: { code: string }) => i.code)).toContain('BASE_TRANSPARENT');
  });

  it('exports exact PNG bytes for the requested revision (SK-07/SK-08)', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const img = createUvDebugSkin('slim');
    const p = (
      await ctx.http
        .post('/api/v1/projects/skin')
        .set('X-Session-Token', t)
        .send({ state: { ...skinState(), model: 'slim' }, skinPngBase64: skinB64(img) })
        .expect(201)
    ).body.data.project;
    const exp = await ctx.http.post('/api/v1/exports/skin').set('X-Session-Token', t).send({ projectId: p.id, revision: 1 }).expect(201);
    const art = exp.body.data.artifact;
    expect(art).toMatchObject({ kind: 'skin-png', mime: 'image/png', minecraftNative: true });
    expect(art.filename).toMatch(/^Test_skin-slim\.png$/);
    expect(exp.body.data.validation.ok).toBe(true);
    const dl = await ctx.http.get(`/api/v1/artifacts/${art.id}/download`).set('X-Session-Token', t).buffer(true).expect(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="${art.filename}"`);
    expect(dl.headers['x-artifact-sha256']).toBe(art.sha256);
    // independent decoder: libvips via sharp
    const raw = await sharp(dl.body as Buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([raw.info.width, raw.info.height, raw.info.channels]).toEqual([64, 64, 4]);
    expect(Buffer.compare(raw.data, Buffer.from(img.data))).toBe(0);
    // other sessions cannot fetch it
    const other = await newSession(ctx.app);
    await ctx.http.get(`/api/v1/artifacts/${art.id}/download`).set('X-Session-Token', other).expect(404);
    // tampering with the stored file is detected
    await ctx.deps.store.putBlob('artifacts', art.id, 'file', Buffer.from('tampered'));
    const bad = await ctx.http.get(`/api/v1/artifacts/${art.id}/download`).set('X-Session-Token', t).expect(500);
    expect(bad.body.error.code).toBe('EXPORT_INVALID');
  });
});

describe('entity projects and add-on export', () => {
  it('validates identifiers and bone hierarchy on save', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const reserved = await ctx.http
      .post('/api/v1/projects/entity')
      .set('X-Session-Token', t)
      .send({ state: entityState('minecraft:zombie') })
      .expect(400);
    expect(reserved.body.error.code).toBe('VALIDATION_FAILED');
    await ctx.http
      .post('/api/v1/projects/entity')
      .set('X-Session-Token', t)
      .send({ state: entityState('Bad Name:../x') })
      .expect(400);
    const cyclic = entityState();
    cyclic.bones[0]!.parentId = 'head';
    const res = await ctx.http.post('/api/v1/projects/entity').set('X-Session-Token', t).send({ state: cyclic }).expect(400);
    expect(res.body.error.message).toMatch(/cycle/);
  });

  it('exports a user-modified entity as a verified .mcaddon (EN-02/EN-04/EN-13)', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const p = (await ctx.http.post('/api/v1/projects/entity').set('X-Session-Token', t).send({ state: entityState() }).expect(201)).body.data.project;
    const modified = entityState();
    modified.cubes = modified.cubes.map((c) =>
      c.id === 'head' ? { ...c, size: [10, 10, 10] as [number, number, number], origin: [-5, 24, -5] as [number, number, number] } : c,
    );
    modified.cubes.push({ id: 'hat', boneId: 'head', origin: [-6, 33, -6], size: [12, 2, 12], color: '#aa2222' });
    await ctx.http.put(`/api/v1/projects/${p.id}`).set('X-Session-Token', t).send({ baseRevision: 1, state: modified }).expect(200);

    const exp = await ctx.http
      .post('/api/v1/exports/bedrock-addon')
      .set('X-Session-Token', t)
      .send({ projectId: p.id, revision: 2, includeRaw: true })
      .expect(201);
    const { artifact, raw, validation, summary } = exp.body.data;
    expect(artifact).toMatchObject({ kind: 'mcaddon', filename: 'test_ns_test_bot.mcaddon', mime: 'application/zip', minecraftNative: true });
    expect(validation.ok).toBe(true);
    expect(validation.checks).toEqual(
      expect.arrayContaining(['mcaddon-zip-readable', 'mcaddon-contains-two-mcpacks', 'archive-content-matches-build', 'uuid-uniqueness', 'uv-bounds']),
    );
    expect(summary.cubeCount).toBe(7);
    expect(raw.map((r: { kind: string }) => r.kind)).toEqual(['geo-json', 'entity-texture']);

    const dl = await ctx.http.get(`/api/v1/artifacts/${artifact.id}/download`).set('X-Session-Token', t).buffer(true).parse(binaryParser).expect(200);
    expect(dl.headers['content-type']).toBe('application/zip');
    expect(dl.headers['content-disposition']).toBe('attachment; filename="test_ns_test_bot.mcaddon"');
    const outer = await readZip(dl.body as Buffer, { maxEntries: 10, maxTotalBytes: 1e8, maxEntryBytes: 1e8 });
    expect([...outer.keys()].sort()).toEqual(['test_ns_test_bot_BP.mcpack', 'test_ns_test_bot_RP.mcpack']);
    const rp = await readZip(Buffer.from(outer.get('test_ns_test_bot_RP.mcpack')!), { maxEntries: 50, maxTotalBytes: 1e8, maxEntryBytes: 1e8 });
    const geo = JSON.parse(utf8Decode(rp.get('models/entity/test_ns.test_bot.geo.json')!));
    const head = geo['minecraft:geometry'][0].bones.find((b: { name: string }) => b.name === 'head');
    expect(head.cubes.map((c: { size: number[] }) => c.size)).toEqual([
      [10, 10, 10],
      [12, 2, 12],
    ]);

    // a newer revision is a different export: no stale cached downloads
    const exp2 = await ctx.http
      .post('/api/v1/exports/bedrock-addon')
      .set('X-Session-Token', t)
      .send({ projectId: p.id, revision: 1, includeRaw: false })
      .expect(201);
    expect(exp2.body.data.artifact.id).not.toBe(artifact.id);
    expect(exp2.body.data.summary.cubeCount).toBe(6);
  });

  it('refuses to export models over the complexity limit (EN-08)', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const s = { ...entityState(), ...BLOCK_TEMPLATE.build() };
    s.cubes = Array.from({ length: 513 }, (_, i) => ({
      id: `c${i}`,
      boneId: 'root',
      origin: [i % 20, 0, Math.floor(i / 20)] as [number, number, number],
      size: [1, 1, 1] as [number, number, number],
      color: '#336699',
    }));
    const res = await ctx.http.post('/api/v1/projects/entity').set('X-Session-Token', t).send({ state: s }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED'); // schema caps cubes at 512 before anything is built
    s.cubes = s.cubes.slice(0, 0);
    const empty = (await ctx.http.post('/api/v1/projects/entity').set('X-Session-Token', t).send({ state: s }).expect(201)).body.data.project;
    const exp = await ctx.http.post('/api/v1/exports/bedrock-addon').set('X-Session-Token', t).send({ projectId: empty.id, revision: 1 }).expect(422);
    expect(exp.body.error.code).toBe('EXPORT_INVALID');
  });

  it('deleting a project removes its exports', async () => {
    ctx = await makeApp();
    const t = await newSession(ctx.app);
    const p = (await ctx.http.post('/api/v1/projects/entity').set('X-Session-Token', t).send({ state: entityState() }).expect(201)).body.data.project;
    const art = (await ctx.http.post('/api/v1/exports/bedrock-addon').set('X-Session-Token', t).send({ projectId: p.id, revision: 1 }).expect(201)).body.data
      .artifact;
    await ctx.http.delete(`/api/v1/projects/${p.id}`).set('X-Session-Token', t).expect(200);
    await ctx.http.get(`/api/v1/projects/${p.id}`).set('X-Session-Token', t).expect(404);
    await ctx.http.get(`/api/v1/artifacts/${art.id}/download`).set('X-Session-Token', t).expect(404);
  });
});

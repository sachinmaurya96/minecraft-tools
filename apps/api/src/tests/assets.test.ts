import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { makeApp, newSession, png } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => ctx?.cleanup());

const upload = (token: string, buf: Buffer, name = 'photo.png', type?: string) =>
  ctx.http
    .post('/api/v1/assets/images')
    .set('X-Session-Token', token)
    .attach('file', buf, { filename: name, ...(type ? { contentType: type } : {}) });

describe('reference image upload', () => {
  it('accepts PNG, JPEG and WebP, normalizes them and reports metadata', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    const p = await upload(token, await png(300, 400)).expect(201);
    expect(p.body.data.asset).toMatchObject({ mime: 'image/png', width: 300, height: 400, metadataStripped: true, purpose: 'reference' });
    const j = await upload(
      token,
      await sharp({ create: { width: 320, height: 240, channels: 3, background: '#336699' } })
        .jpeg()
        .toBuffer(),
      'a.jpg',
    ).expect(201);
    expect(j.body.data.asset).toMatchObject({ mime: 'image/jpeg', originalMime: 'image/jpeg' });
    const w = await upload(
      token,
      await sharp({ create: { width: 64, height: 64, channels: 4, background: '#00000000' } })
        .webp()
        .toBuffer(),
      'a.webp',
    ).expect(201);
    expect(w.body.data.asset).toMatchObject({ originalMime: 'image/webp', mime: 'image/png', hasAlpha: true });
    expect(w.body.data.asset.warnings.join(' ')).toMatch(/Low resolution/);
  });

  it('applies EXIF orientation and strips all metadata', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    const withExif = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#aa3311' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: 'secret owner', Artist: 'someone' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const res = await upload(token, withExif, 'rotated.jpg').expect(201);
    const asset = res.body.data.asset;
    expect(asset.exifOrientationApplied).toBe(true);
    expect([asset.width, asset.height]).toEqual([200, 400]); // rotated upright
    const stored = await ctx.http.get(`/api/v1/assets/images/${asset.id}/content`).set('X-Session-Token', token).buffer(true).expect(200);
    expect(stored.headers['x-content-type-options']).toBe('nosniff');
    expect(stored.headers['cache-control']).toContain('no-store');
    const meta = await sharp(stored.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect((stored.body as Buffer).includes(Buffer.from('secret owner'))).toBe(false);
  });

  it('rejects files by content, not by name or declared type (SVG, text, fake PNG)', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    expect((await upload(token, svg, 'x.png', 'image/png').expect(415)).body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await upload(token, Buffer.from('hello world'), 'x.jpg', 'image/jpeg').expect(415)).body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
    await upload(token, gif, 'x.gif', 'image/gif').expect(415);
    // real PNG signature but truncated body
    const truncated = (await png(100, 100)).subarray(0, 60);
    expect((await upload(token, truncated, 'x.png').expect(400)).body.error.code).toBe('BAD_IMAGE');
    // declared type mismatch is tolerated but reported
    const ok = await upload(token, await png(64, 64), 'x.jpg', 'image/jpeg').expect(201);
    expect(ok.body.data.asset.warnings.join(' ')).toMatch(/sent as image\/jpeg/);
  });

  it('enforces the byte-size limit', async () => {
    ctx = await makeApp({ MAX_IMAGE_MB: '0.01' });
    const token = await newSession(ctx.app);
    const noisy = await sharp(randomBytes(200 * 200 * 3), { raw: { width: 200, height: 200, channels: 3 } })
      .png()
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(0.01 * 1024 * 1024);
    expect((await upload(token, noisy).expect(413)).body.error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('enforces the pixel-count limit before decoding (decompression bombs) and a minimum size', async () => {
    ctx = await makeApp({ MAX_IMAGE_PIXELS: '250000' });
    const token = await newSession(ctx.app);
    const bomb = await png(4000, 4000); // tiny file, 16 Mpx
    expect(bomb.length).toBeLessThan(1024 * 1024); // well under the byte limit
    expect((await upload(token, bomb).expect(413)).body.error.code).toBe('IMAGE_TOO_LARGE');
    expect((await upload(token, await png(20, 20)).expect(400)).body.error.code).toBe('BAD_IMAGE');
  });

  it('downscales very large references and flags duplicates', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    const big = await png(3000, 1500);
    const a = await upload(token, big).expect(201);
    expect([a.body.data.asset.width, a.body.data.asset.height]).toEqual([2048, 1024]);
    expect(a.body.data.asset.warnings.join(' ')).toMatch(/Downscaled/);
    const b = await upload(token, big).expect(201);
    expect(b.body.data.asset.warnings.join(' ')).toMatch(/identical/);
  });

  it('keeps uploads private to their session and supports deletion', async () => {
    ctx = await makeApp();
    const alice = await newSession(ctx.app);
    const bob = await newSession(ctx.app);
    const id = (await upload(alice, await png(64, 64)).expect(201)).body.data.asset.id as string;
    await ctx.http.get(`/api/v1/assets/images/${id}`).set('X-Session-Token', bob).expect(404);
    await ctx.http.get(`/api/v1/assets/images/${id}/content`).set('X-Session-Token', bob).expect(404);
    await ctx.http.delete(`/api/v1/assets/images/${id}`).set('X-Session-Token', bob).expect(404);
    await ctx.http.get(`/api/v1/assets/images/${id}`).expect(401);
    // guessed / traversal ids are simply not found
    await ctx.http.get('/api/v1/assets/images/..%2F..%2Fsecret').set('X-Session-Token', alice).expect(404);
    await ctx.http.get('/api/v1/assets/images/img_aaaaaaaaaaaaaaaaaaaaaa').set('X-Session-Token', alice).expect(404);
    await ctx.http.delete(`/api/v1/assets/images/${id}`).set('X-Session-Token', alice).expect(200);
    await ctx.http.get(`/api/v1/assets/images/${id}`).set('X-Session-Token', alice).expect(404);
  });

  it('expires uploads after the TTL and sweeps their files', async () => {
    ctx = await makeApp({ PROJECT_TTL_HOURS: '0.0001' }); // ~0.36 s
    const token = await newSession(ctx.app);
    const id = (await upload(token, await png(64, 64)).expect(201)).body.data.asset.id as string;
    await new Promise((r) => setTimeout(r, 500));
    await ctx.http.get(`/api/v1/assets/images/${id}`).set('X-Session-Token', token).expect(404);
    expect(await ctx.deps.store.sweepExpired()).toBe(1);
    expect(await ctx.deps.store.getBlob('assets', id, 'image.png')).toBeNull();
  });

  it('deletes everything of a session on request', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    await upload(token, await png(64, 64)).expect(201);
    await upload(token, await png(65, 65)).expect(201);
    const res = await ctx.http.delete('/api/v1/sessions/current').set('X-Session-Token', token).expect(200);
    expect(res.body.data.deleted.assets).toBe(2);
  });
});

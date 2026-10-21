import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp, newSession } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => ctx?.cleanup());

describe('health, envelope, errors', () => {
  it('health is public and carries a request id', async () => {
    ctx = await makeApp();
    const res = await ctx.http.get('/health').expect(200);
    expect(res.body).toMatchObject({ data: { status: 'ok' }, error: null });
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
    const echoed = await ctx.http.get('/health').set('X-Request-Id', 'my-trace-1234').expect(200);
    expect(echoed.headers['x-request-id']).toBe('my-trace-1234');
  });

  it('unknown routes return a NOT_FOUND envelope', async () => {
    ctx = await makeApp();
    // unauthenticated callers learn nothing about which routes exist
    expect((await ctx.http.get('/api/v1/does-not-exist').expect(401)).body.error.code).toBe('UNAUTHORIZED');
    const token = await newSession(ctx.app);
    const res = await ctx.http.get('/api/v1/does-not-exist').set('X-Session-Token', token).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await ctx.http.get('/api/nope').expect(404)).body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON and oversized bodies with clear codes', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    const bad = await ctx.http.post('/api/v1/exports/skin').set('X-Session-Token', token).set('Content-Type', 'application/json').send('{nope').expect(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
    const big = await ctx.http
      .post('/api/v1/exports/skin')
      .set('X-Session-Token', token)
      .send({ projectId: 'x'.repeat(10_000), revision: 1 })
      .expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const invalid = await ctx.http.post('/api/v1/exports/skin').set('X-Session-Token', token).send({ projectId: 1 }).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('allows only the configured browser origin', async () => {
    ctx = await makeApp({ WEB_ORIGIN: 'https://tools.example' });
    const ok = await ctx.http.get('/api/v1/capabilities').set('Origin', 'https://tools.example');
    expect(ok.headers['access-control-allow-origin']).toBe('https://tools.example');
    const other = await ctx.http.get('/api/v1/capabilities').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets security headers', async () => {
    ctx = await makeApp();
    const res = await ctx.http.get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });
});

describe('sessions', () => {
  it('issues tokens and rejects missing, malformed and forged ones', async () => {
    ctx = await makeApp();
    const token = await newSession(ctx.app);
    expect(token).toMatch(/^s1\./);
    await ctx.http.get('/api/v1/sessions/current').set('X-Session-Token', token).expect(200);
    await ctx.http.get('/api/v1/sessions/current').expect(401);
    await ctx.http.get('/api/v1/sessions/current').set('X-Session-Token', 'garbage').expect(401);
    const forged = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    const res = await ctx.http.get('/api/v1/sessions/current').set('X-Session-Token', forged).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('tokens from another server secret are rejected', async () => {
    ctx = await makeApp({ SESSION_SECRET: 'a'.repeat(40) });
    const other = await makeApp({ SESSION_SECRET: 'b'.repeat(40) });
    const token = await newSession(other.app);
    await ctx.http.get('/api/v1/sessions/current').set('X-Session-Token', token).expect(401);
    await other.cleanup();
  });
});

describe('capabilities', () => {
  it('reports truthful availability when the worker is down and AI flags are off', async () => {
    ctx = await makeApp();
    const res = await request(ctx.app).get('/api/v1/capabilities').expect(200);
    const byId = Object.fromEntries(res.body.data.providers.map((p: { id: string }) => [p.id, p]));
    expect(res.body.data.worker.reachable).toBe(false);
    expect(byId['manual-skin']).toMatchObject({ available: true, status: 'ready' });
    expect(byId['photo-projection-v1']).toMatchObject({ available: true, mode: 'photo-assisted' });
    expect(byId['sking-v101c']).toMatchObject({ available: false, status: 'disabled', mode: 'ai', requiresGpu: true });
    expect(byId['triposr']).toMatchObject({ available: false, status: 'disabled' });
    expect(byId['mesh-cuboids-v1']).toMatchObject({ available: false, status: 'unavailable' });
    expect(byId['mesh-cuboids-v1'].reason).toMatch(/not reachable/);
    // never leaks the worker URL or token
    expect(JSON.stringify(res.body)).not.toContain('127.0.0.1:9');
  });
});

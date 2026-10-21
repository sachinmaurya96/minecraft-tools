import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createServices } from '../container.js';
import { WorkerClient } from '../services/workerClient.js';

export const WORKER_TOKEN = 'w'.repeat(48);

export async function makeApp(env: Record<string, string> = {}, opts: { workerUrl?: string } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bw-api-'));
  const config = loadConfig(
    {
      NODE_ENV: 'test',
      DATA_DIR: dir,
      LOG_LEVEL: 'silent',
      AI_WORKER_URL: opts.workerUrl ?? 'http://127.0.0.1:9',
      AI_WORKER_TOKEN: WORKER_TOKEN,
      RATE_LIMIT_MAX: '100000',
      UPLOAD_RATE_LIMIT_MAX: '100000',
      JOB_RATE_LIMIT_MAX: '100000',
      ...env,
    },
    dir,
  );
  const worker = new WorkerClient(config.AI_WORKER_URL, config.AI_WORKER_TOKEN, 2000);
  const deps = await createServices(config, pino({ level: 'silent' }), worker);
  deps.jobs.pollIntervalMs = 20;
  await deps.jobs.init();
  const app = createApp(deps);
  return {
    app,
    deps,
    dir,
    http: request(app),
    async cleanup() {
      deps.jobs.stop();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export async function newSession(app: Parameters<typeof request>[0]): Promise<string> {
  const res = await request(app).post('/api/v1/sessions').expect(201);
  return res.body.data.token as string;
}

export function png(width: number, height: number, rgb: [number, number, number] = [200, 50, 50], alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 0.5 } : { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Test-only fake of the worker's HTTP contract (see services/ai-worker/app/main.py).
// It runs no model; tests tell it what each job type should "return".
// ---------------------------------------------------------------------------

export interface FakeJobScript {
  /** artifacts by name the job produces */
  artifacts?: Record<string, Buffer>;
  result?: Record<string, unknown>;
  fail?: { code: string; message: string };
  /** number of polls before the job finishes; Infinity = never */
  pollsUntilDone?: number;
}

export interface FakeWorker {
  url: string;
  providers: Record<string, { status: string; reason?: string; code?: string }>;
  scripts: Record<string, FakeJobScript>;
  received: Array<{ type: string; params: Record<string, unknown>; files: string[] }>;
  cancelled: string[];
  deleted: string[];
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeWorker(): Promise<FakeWorker> {
  const jobs = new Map<string, { type: string; polls: number; script: FakeJobScript; cancelled: boolean }>();
  const fake: Omit<FakeWorker, 'url' | 'close'> = {
    providers: { 'sking-v101c': { status: 'disabled' }, triposr: { status: 'disabled' }, 'mesh-cuboids-v1': { status: 'ready' } },
    scripts: {},
    received: [],
    cancelled: [],
    deleted: [],
  };
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') return send(res, 200, { status: 'ok' });
    if (req.headers.authorization !== `Bearer ${WORKER_TOKEN}`) return send(res, 401, { detail: 'bad token' });
    if (url.pathname === '/v1/capabilities') return send(res, 200, { device: 'cpu', providers: fake.providers });
    if (url.pathname === '/v1/jobs' && req.method === 'POST') {
      const raw = (await readBody(req)).toString('latin1');
      const type = /name="type"\r\n\r\n([^\r]+)/.exec(raw)?.[1] ?? '';
      const params = JSON.parse(/name="params"\r\n\r\n([^\r]+)/.exec(raw)?.[1] ?? '{}');
      const files = [...raw.matchAll(/name="(\w+)"; filename="/g)].map((m) => m[1]!);
      fake.received.push({ type, params, files });
      const id = `fake${jobs.size}`;
      jobs.set(id, { type, polls: 0, script: fake.scripts[type] ?? {}, cancelled: false });
      return send(res, 202, { id, type, status: 'queued', stage: 'Queued', artifacts: [] });
    }
    const m = /^\/v1\/jobs\/([^/]+)(\/cancel|\/artifacts\/(.+))?$/.exec(url.pathname);
    const job = m && jobs.get(m[1]!);
    if (!m || !job) return send(res, 404, { detail: 'unknown job' });
    if (req.method === 'DELETE') {
      fake.deleted.push(m[1]!);
      jobs.delete(m[1]!);
      return send(res, 200, { deleted: true });
    }
    if (m[2] === '/cancel') {
      job.cancelled = true;
      fake.cancelled.push(m[1]!);
      return send(res, 200, { id: m[1], status: 'cancelled' });
    }
    if (m[3]) {
      const art = job.script.artifacts?.[decodeURIComponent(m[3])];
      if (!art) return send(res, 404, { detail: 'unknown artifact' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': art.length });
      return res.end(art);
    }
    job.polls++;
    const done = job.polls >= (job.script.pollsUntilDone ?? 1);
    if (job.cancelled) return send(res, 200, { id: m[1], type: job.type, status: 'cancelled', stage: 'Cancelled', artifacts: [] });
    if (!done) return send(res, 200, { id: m[1], type: job.type, status: 'running', stage: 'Working on it', artifacts: [] });
    if (job.script.fail)
      return send(res, 200, {
        id: m[1],
        type: job.type,
        status: 'failed',
        stage: 'Failed',
        error_code: job.script.fail.code,
        error_message: job.script.fail.message,
        artifacts: [],
      });
    return send(res, 200, {
      id: m[1],
      type: job.type,
      status: 'ready',
      stage: 'Done',
      artifacts: Object.keys(job.script.artifacts ?? {}),
      result: job.script.result ?? {},
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { ...fake, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) } as FakeWorker;
}

/** supertest parser that keeps any response body as raw bytes. */
export function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (e: Error) => cb(e, Buffer.alloc(0)));
}

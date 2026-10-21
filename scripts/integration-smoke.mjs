// Real CPU worker -> API -> converted project -> .mcaddon. No model fakes.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { BLOCK_TEMPLATE } from '@blockwright/bedrock-export';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, 'services/ai-worker/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const scratch = await mkdtemp(path.join(tmpdir(), 'bw-integration-'));
const token = randomBytes(32).toString('hex');
const children = [];
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function waitHealth(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Service did not become healthy: ${url}`);
}
function start(command, args, env, cwd = root) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  child.on('error', (error) => console.error(error.message));
  children.push(child);
  return child;
}
try {
  const workerPort = await freePort();
  const apiPort = await freePort();
  const workerUrl = `http://127.0.0.1:${workerPort}`;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  start(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(workerPort)],
    {
      AI_WORKER_TOKEN: token,
      WORKER_DATA_DIR: path.join(scratch, 'worker'),
      ENABLE_SKING: 'false',
      ENABLE_TRIPOSR: 'false',
    },
    path.join(root, 'services/ai-worker'),
  );
  await waitHealth(`${workerUrl}/health`);
  start(process.execPath, ['apps/api/dist/server.js'], {
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    DATA_DIR: path.join(scratch, 'api'),
    AI_WORKER_URL: workerUrl,
    AI_WORKER_TOKEN: token,
    ENABLE_SKING: 'false',
    ENABLE_TRIPOSR: 'false',
    LOG_LEVEL: 'warn',
  });
  await waitHealth(`${apiUrl}/health`);
  let session;
  async function request(route, body, method = 'POST') {
    const response = await fetch(`${apiUrl}/api/v1${route}`, {
      method,
      headers: { ...(session ? { 'X-Session-Token': session } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    const envelope = await response.json();
    assert(response.ok, `${route}: ${JSON.stringify(envelope.error)}`);
    return envelope.data;
  }
  session = (await request('/sessions')).token;
  const caps = await request('/capabilities', null, 'GET');
  assert(caps.providers.find((p) => p.id === 'mesh-cuboids-v1')?.available);
  const project = (
    await request('/projects/entity', {
      state: {
        displayName: 'CPU converted model',
        identifier: 'blockwright_test:converted',
        templateId: 'block',
        ...BLOCK_TEMPLATE.build(),
        behavior: { profile: 'static', health: 20, movementSpeed: 0.25 },
        references: [],
        provenance: { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] },
      },
    })
  ).project;
  const meshPath = path.join(scratch, 'mesh.glb');
  const generated = spawnSync(
    python,
    ['-c', 'import sys,trimesh; m=trimesh.creation.box(extents=[1,2,1]); m.visual.vertex_colors=[40,190,90,255]; m.export(sys.argv[1])', meshPath],
    { stdio: 'inherit' },
  );
  assert.equal(generated.status, 0);
  const form = new FormData();
  form.append('file', new Blob([await readFile(meshPath)]), 'mesh.glb');
  const mesh = (await request('/assets/meshes', form)).mesh;
  let job = (await request('/jobs/mesh-to-cuboids', { projectId: project.id, source: { kind: 'mesh-asset', assetId: mesh.id }, resolution: 'low' })).job;
  const deadline = Date.now() + 45_000;
  while (!['ready', 'failed', 'cancelled'].includes(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    job = (await request(`/jobs/${job.id}`, null, 'GET')).job;
  }
  assert.equal(job.status, 'ready', JSON.stringify(job));
  const applied = (await request(`/projects/${project.id}/apply`, { baseRevision: 1, artifactId: job.result.cuboidArtifactId })).project;
  assert.equal(applied.provenance.origin, 'import');
  const exported = await request('/exports/bedrock-addon', { projectId: project.id, revision: applied.revision });
  assert(exported.validation.ok);
  const download = await fetch(`${apiUrl}/api/v1/artifacts/${exported.artifact.id}/download`, { headers: { 'X-Session-Token': session } });
  assert(download.ok);
  const output = path.join(root, 'fixtures/generated');
  await mkdir(output, { recursive: true });
  const artifact = path.join(output, 'converted.mcaddon');
  await writeFile(artifact, new Uint8Array(await download.arrayBuffer()));
  const checked = spawnSync(python, [path.join(root, 'scripts/verify_exports.py'), artifact], { stdio: 'inherit' });
  assert.equal(checked.status, 0);
  await request('/sessions/current', null, 'DELETE');
  console.log('PASS real API/worker: upload GLB -> CPU voxel conversion -> apply -> validated .mcaddon -> delete session');
} finally {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await once(child, 'exit');
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  await rm(scratch, { recursive: true, force: true });
}

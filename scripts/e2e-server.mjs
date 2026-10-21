// Isolated production server: never touch a developer's projects or session secret.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'blockwright-e2e-'));
const child = spawn(process.execPath, ['apps/api/dist/server.js'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: '4173',
    WEB_ORIGIN: 'http://127.0.0.1:4173',
    DATA_DIR: dataDir,
    SERVE_WEB_DIST: path.join(root, 'apps/web/dist'),
    ENABLE_SKING: 'false',
    ENABLE_TRIPOSR: 'false',
    AI_WORKER_URL: 'http://127.0.0.1:9',
    AI_WORKER_TOKEN: '',
    LOG_LEVEL: 'warn',
    RATE_LIMIT_MAX: '100000',
    UPLOAD_RATE_LIMIT_MAX: '10000',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', async (error) => {
  console.error(error);
  await rm(dataDir, { recursive: true, force: true });
  process.exit(1);
});
child.on('exit', async (code, signal) => {
  await rm(dataDir, { recursive: true, force: true });
  process.exit(signal ? 0 : (code ?? 1));
});

#!/usr/bin/env node
// Run the Python worker from its own virtualenv (created by `uv sync` in services/ai-worker).
//   node scripts/worker.mjs dev     uvicorn with reload
//   node scripts/worker.mjs start   uvicorn without reload
//   node scripts/worker.mjs test    pytest
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(root, 'services', 'ai-worker');
const python =
  process.platform === 'win32' ? path.join(workerDir, '.venv', 'Scripts', 'python.exe') : path.join(workerDir, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(`Worker virtualenv not found at ${python}.\nCreate it with:  cd services/ai-worker && uv sync`);
  process.exit(1);
}

// host/port: environment first, then services/ai-worker/.env, then defaults
const fileEnv = {};
const envFile = path.join(workerDir, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) fileEnv[m[1]] = m[2];
  }
}
const host = process.env.WORKER_HOST ?? fileEnv.WORKER_HOST ?? '127.0.0.1';
const port = process.env.WORKER_PORT ?? fileEnv.WORKER_PORT ?? '8000';

const mode = process.argv[2] ?? 'dev';
const args =
  mode === 'test'
    ? ['-m', 'pytest', ...process.argv.slice(3)]
    : ['-m', 'uvicorn', 'app.main:app', '--app-dir', workerDir, '--host', host, '--port', port, ...(mode === 'dev' ? ['--reload', '--reload-dir', path.join(workerDir, 'app')] : [])];

const child = spawn(python, args, { cwd: workerDir, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

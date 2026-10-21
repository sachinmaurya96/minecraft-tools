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
const python = process.platform === 'win32' ? path.join(workerDir, '.venv', 'Scripts', 'python.exe') : path.join(workerDir, '.venv', 'bin', 'python');

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
    : [
        '-m',
        'uvicorn',
        'app.main:app',
        '--app-dir',
        workerDir,
        '--host',
        host,
        '--port',
        port,
        ...(mode === 'dev' ? ['--reload', '--reload-dir', path.join(workerDir, 'app')] : []),
      ];

// Give the worker/reloader its own process group so Ctrl+C is forwarded once.
// Otherwise npm/concurrently and the terminal can signal it repeatedly, leaving
// the reload supervisor holding its listening socket after its server exits.
const grouped = process.platform !== 'win32';
const child = spawn(python, args, { cwd: workerDir, stdio: 'inherit', detached: grouped });
let stopping = false;
let shutdownTimer;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  shutdownTimer = setTimeout(() => {
    try {
      if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(`Worker shutdown failed: ${error.message}`);
    }
  }, 5000);
  shutdownTimer.unref();
}

child.on('error', (error) => {
  console.error(`Could not start the worker: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  clearTimeout(shutdownTimer);
  process.exit(stopping ? 0 : signal ? 1 : (code ?? 1));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));

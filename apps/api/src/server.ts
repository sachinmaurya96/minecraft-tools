import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createServices } from './container.js';

// Load apps/api/.env, then the repo-root .env, without overriding real environment variables.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [path.resolve(here, '../.env'), path.resolve(here, '../../../.env')]) {
  if (existsSync(candidate)) process.loadEnvFile(candidate);
}

const config = loadConfig();
const deps = await createServices(config);
const { logger, store, jobs } = deps;

if (config.NODE_ENV === 'production' && !config.SESSION_SECRET) {
  logger.warn('SESSION_SECRET is not set; using a generated secret stored in DATA_DIR/secret.');
}
if (!config.AI_WORKER_TOKEN) logger.warn('AI_WORKER_TOKEN is empty: AI/geometry worker features will report "unavailable".');

const removed = await store.sweepExpired();
await jobs.init();
const sweep = setInterval(() => {
  store
    .sweepExpired()
    .then((n) => n && logger.info({ removed: n }, 'expired records removed'))
    .catch((err) => logger.error({ err }, 'sweep failed'));
}, 10 * 60 * 1000);
sweep.unref();

const app = createApp(deps);
const server = app.listen(config.API_PORT, config.API_HOST, () => {
  logger.info({ port: config.API_PORT, host: config.API_HOST, dataDir: config.dataDir, sweptOnStart: removed }, 'API listening');
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  jobs.stop();
  clearInterval(sweep);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

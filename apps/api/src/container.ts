import { pino, type Logger } from 'pino';
import type { AppDeps } from './app.js';
import type { Config } from './config.js';
import { ExportService } from './exporters/exportService.js';
import { JobManager } from './jobs/jobManager.js';
import { CapabilitiesService } from './services/capabilities.js';
import { ImageService } from './services/images.js';
import { MeshService } from './services/meshes.js';
import { ProjectService } from './services/projects.js';
import { loadSessionSecret, SessionService } from './services/sessions.js';
import { WorkerClient } from './services/workerClient.js';
import { FsStore } from './storage/store.js';

export async function createServices(config: Config, logger?: Logger, worker?: WorkerClient): Promise<AppDeps> {
  const log = logger ?? pino({ level: config.LOG_LEVEL });
  const store = new FsStore(config.dataDir);
  await store.init();
  const sessions = new SessionService(await loadSessionSecret(config.dataDir, config.SESSION_SECRET));
  const workerClient = worker ?? new WorkerClient(config.AI_WORKER_URL, config.AI_WORKER_TOKEN);
  const capabilities = new CapabilitiesService(config, workerClient);
  const images = new ImageService(config, store);
  const meshes = new MeshService(config, store);
  const projects = new ProjectService(config, store, images);
  const exports = new ExportService(config, store, projects);
  const jobs = new JobManager({ config, store, worker: workerClient, capabilities, images, meshes, projects, exports, logger: log });
  return { config, logger: log, store, sessions, worker: workerClient, capabilities, images, meshes, projects, exports, jobs };
}

import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { sendData, sendError } from './http/envelope.js';
import { errorHandler, notFoundHandler, requestId, requireSession } from './middleware/core.js';
import type { CapabilitiesService } from './services/capabilities.js';
import type { SessionService } from './services/sessions.js';
import type { FsStore } from './storage/store.js';
import type { WorkerClient } from './services/workerClient.js';
import { assetRoutes } from './routes/assets.js';
import { projectRoutes } from './routes/projects.js';
import { exportRoutes } from './routes/exports.js';
import { jobRoutes } from './routes/jobs.js';
import type { ImageService } from './services/images.js';
import type { ProjectService } from './services/projects.js';
import type { ExportService } from './exporters/exportService.js';
import type { JobManager } from './jobs/jobManager.js';
import type { MeshService } from './services/meshes.js';
import { sessionRoutes } from './routes/sessions.js';

export const API_VERSION = '0.1.0';

export interface AppDeps {
  config: Config;
  logger: Logger;
  store: FsStore;
  sessions: SessionService;
  worker: WorkerClient;
  capabilities: CapabilitiesService;
  images: ImageService;
  meshes: MeshService;
  projects: ProjectService;
  exports: ExportService;
  jobs: JobManager;
}

export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/health' },
      // minimal access log: never headers (session tokens), never bodies (user content)
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'blob:', 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          // must stay off for plain-HTTP deployments (e.g. localhost); terminate TLS in front instead
          upgradeInsecureRequests: null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  const corsMiddleware = cors({
    origin: config.webOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Session-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'X-Artifact-Sha256'],
    maxAge: 600,
  });

  app.get('/health', corsMiddleware, (req, res) => {
    sendData(req, res, { status: 'ok', service: 'blockwright-api', version: API_VERSION, uptimeS: Math.round(process.uptime()) });
  });

  const limiter = (limit: number) =>
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_S * 1000,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) => sendError(req, res, 429, { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute and try again.' }),
    });

  const api = Router();
  api.use(corsMiddleware);
  api.use(limiter(config.RATE_LIMIT_MAX));
  api.use(sessionRoutes(deps));
  api.get('/capabilities', async (req, res) => {
    sendData(req, res, await deps.capabilities.get());
  });
  const authed = Router();
  authed.use(requireSession(deps.sessions));
  authed.use('/assets', limiter(config.UPLOAD_RATE_LIMIT_MAX), assetRoutes(deps));
  authed.use('/projects', projectRoutes(deps));
  authed.use('/exports', exportRoutes(deps));
  authed.use('/artifacts', exportRoutes.artifacts(deps));
  authed.use('/jobs', jobRoutes(deps, limiter(config.JOB_RATE_LIMIT_MAX)));
  api.use(authed);
  app.use('/api/v1', api);
  app.use('/api', notFoundHandler);

  if (config.SERVE_WEB_DIST) {
    const dist = path.resolve(config.SERVE_WEB_DIST);
    if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`SERVE_WEB_DIST has no index.html: ${dist}`);
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } }));
    // SPA fallback: every non-API GET renders the app; the client router shows its own 404.
    app.get(/.*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

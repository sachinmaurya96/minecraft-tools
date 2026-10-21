import express, { Router, type RequestHandler } from 'express';
import type { JobType } from '@blockwright/shared';
import type { AppDeps } from '../app.js';
import { sendData } from '../http/envelope.js';

export function jobRoutes(deps: AppDeps, createLimiter: RequestHandler): Router {
  const r = Router();
  const json = express.json({ limit: '8kb' });
  for (const type of ['skin-generate', 'mesh-generate', 'mesh-to-cuboids'] as JobType[]) {
    // 202 Accepted: the job runs in the background; poll GET /jobs/:id
    r.post(`/${type}`, createLimiter, json, async (req, res) => {
      sendData(req, res, { job: await deps.jobs.create(req.session!.ownerId, type, req.body) }, 202);
    });
  }
  r.get('/:id', async (req, res) => {
    sendData(req, res, { job: await deps.jobs.get(req.session!.ownerId, req.params.id) });
  });
  r.post('/:id/cancel', async (req, res) => {
    sendData(req, res, { job: await deps.jobs.cancel(req.session!.ownerId, req.params.id) });
  });
  return r;
}

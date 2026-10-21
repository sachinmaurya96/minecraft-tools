import express, { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { sendData } from '../http/envelope.js';
import { toArtifactInfo } from '../exporters/exportService.js';

const ExportBody = z.object({
  projectId: z.string(),
  revision: z.number().int().positive(),
  includeRaw: z.boolean().default(false),
});

export function exportRoutes(deps: AppDeps): Router {
  const r = Router();
  r.use(express.json({ limit: '4kb' }));

  r.post('/skin', async (req, res) => {
    const body = ExportBody.parse(req.body);
    sendData(req, res, await deps.exports.exportSkin(req.session!.ownerId, body.projectId, body.revision), 201);
  });

  r.post('/bedrock-addon', async (req, res) => {
    const body = ExportBody.parse(req.body);
    sendData(req, res, await deps.exports.exportAddon(req.session!.ownerId, body.projectId, body.revision, body.includeRaw), 201);
  });
  return r;
}

/** Owner-scoped artifact metadata and downloads. */
exportRoutes.artifacts = function artifactRoutes(deps: AppDeps): Router {
  const r = Router();
  r.get('/:id', async (req, res) => {
    const { record } = await deps.exports.getArtifact(req.session!.ownerId, req.params.id);
    sendData(req, res, { artifact: toArtifactInfo(record) });
  });
  r.get('/:id/download', async (req, res) => {
    const { record, bytes } = await deps.exports.getArtifact(req.session!.ownerId, req.params.id);
    res.setHeader('Content-Type', record.mime);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`);
    res.setHeader('X-Artifact-Sha256', record.sha256);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });
  return r;
};

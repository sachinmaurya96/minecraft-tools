import { Router } from 'express';
import multer from 'multer';
import { ImagePurposeSchema } from '@blockwright/shared';
import type { AppDeps } from '../app.js';
import { AppError } from '../http/errors.js';
import { sendData } from '../http/envelope.js';
import { toImageAsset } from '../services/images.js';

export function assetRoutes(deps: AppDeps): Router {
  const r = Router();
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.maxImageBytes, files: 1, fields: 4, parts: 6, fieldSize: 1024 },
  });
  const meshUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.maxMeshBytes, files: 1, fields: 2, parts: 4, fieldSize: 1024 },
  });

  r.post('/images', imageUpload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError(400, 'BAD_REQUEST', 'Send the image as multipart field "file".');
    const purpose = ImagePurposeSchema.catch('reference').parse(req.body?.purpose);
    const record = await deps.images.ingest(req.session!.ownerId, {
      bytes: req.file.buffer,
      originalName: req.file.originalname,
      declaredMime: req.file.mimetype,
      purpose,
    });
    sendData(req, res, { asset: toImageAsset(record) }, 201);
  });

  r.get('/images/:id', async (req, res) => {
    sendData(req, res, { asset: toImageAsset(await deps.images.get(req.session!.ownerId, req.params.id)) });
  });

  r.get('/images/:id/content', async (req, res) => {
    const variant = req.query.variant === 'thumb' ? 'thumb' : 'full';
    const { record, bytes } = await deps.images.getBytes(req.session!.ownerId, req.params.id, variant);
    res.setHeader('Content-Type', record.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.send(bytes);
  });

  r.delete('/images/:id', async (req, res) => {
    await deps.images.delete(req.session!.ownerId, req.params.id);
    sendData(req, res, { deleted: true });
  });

  r.post('/meshes', meshUpload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError(400, 'BAD_REQUEST', 'Send the mesh as multipart field "file".');
    const rec = await deps.meshes.ingest(req.session!.ownerId, req.file.buffer, req.file.originalname);
    sendData(req, res, { mesh: { id: rec.id, format: rec.format, originalName: rec.originalName, sizeBytes: rec.sizeBytes, expiresAt: rec.expiresAt } }, 201);
  });

  r.delete('/meshes/:id', async (req, res) => {
    await deps.meshes.delete(req.session!.ownerId, req.params.id);
    sendData(req, res, { deleted: true });
  });

  return r;
}

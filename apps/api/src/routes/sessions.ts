import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { sendData } from '../http/envelope.js';
import { requireSession } from '../middleware/core.js';
import { RECORD_KINDS, type BaseRecord } from '../storage/store.js';

export function sessionRoutes(deps: AppDeps): Router {
  const r = Router();

  /** Issue an anonymous session token. Nothing is stored server-side until the client uploads or saves. */
  r.post('/sessions', (req, res) => {
    const { token } = deps.sessions.issue();
    sendData(req, res, { token, retentionHours: deps.config.PROJECT_TTL_HOURS }, 201);
  });

  r.get('/sessions/current', requireSession(deps.sessions), (req, res) => {
    sendData(req, res, { valid: true, retentionHours: deps.config.PROJECT_TTL_HOURS });
  });

  /** Privacy: delete every upload, project, job and export of this session right now. */
  r.delete('/sessions/current', requireSession(deps.sessions), async (req, res) => {
    const ownerId = req.session!.ownerId;
    const deleted: Record<string, number> = {};
    await deps.jobs.withOwnerJobsStopped(ownerId, async () => {
      for (const kind of RECORD_KINDS) {
        deleted[kind] = 0;
        for (const rec of await deps.store.listRecords<BaseRecord>(kind, true)) {
          if (rec.ownerId !== ownerId) continue;
          await deps.store.deleteRecord(kind, rec.id);
          deleted[kind]!++;
        }
      }
    });
    sendData(req, res, { deleted });
  });

  return r;
}

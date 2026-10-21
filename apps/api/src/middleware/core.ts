import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
import { AppError } from '../http/errors.js';
import { sendError } from '../http/envelope.js';
import type { SessionService } from '../services/sessions.js';

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export function requireSession(sessions: SessionService): RequestHandler {
  return (req, res, next) => {
    const session = sessions.verify(req.get('x-session-token'));
    if (!session) {
      sendError(req, res, 401, {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid session token. Create one with POST /api/v1/sessions.',
      });
      return;
    }
    req.session = { id: session.sessionId, ownerId: session.ownerId };
    next();
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(req, res, 404, { code: 'NOT_FOUND', message: `No route ${req.method} ${req.originalUrl.split('?')[0]}` });
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (res.headersSent) {
      logger.error({ err, requestId: req.requestId }, 'error after headers were sent');
      return;
    }
    if (err instanceof AppError) {
      sendError(req, res, err.status, { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) });
      return;
    }
    if (err instanceof ZodError) {
      sendError(req, res, 400, {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        sendError(req, res, 413, { code: 'IMAGE_TOO_LARGE', message: 'File is larger than the configured limit.' });
      } else {
        sendError(req, res, 400, { code: 'BAD_REQUEST', message: `Upload rejected: ${err.message}` });
      }
      return;
    }
    const type = (err as { type?: string }).type;
    if (type === 'entity.too.large') {
      sendError(req, res, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
      return;
    }
    if (type === 'entity.parse.failed') {
      sendError(req, res, 400, { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' });
      return;
    }
    logger.error({ err, requestId: req.requestId }, 'unhandled error');
    sendError(req, res, 500, { code: 'INTERNAL', message: 'Internal server error. Reference the request id when reporting it.' });
  };
}

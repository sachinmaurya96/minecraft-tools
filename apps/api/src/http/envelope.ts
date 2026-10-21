import type { Request, Response } from 'express';
import type { ApiEnvelope, ApiError } from '@blockwright/shared';

export function sendData<T>(req: Request, res: Response, data: T, status = 200): void {
  const body: ApiEnvelope<T> = { data, error: null, requestId: req.requestId };
  res.status(status).json(body);
}

export function sendError(req: Request, res: Response, status: number, error: ApiError): void {
  const body: ApiEnvelope<null> = { data: null, error, requestId: req.requestId };
  res.status(status).json(body);
}

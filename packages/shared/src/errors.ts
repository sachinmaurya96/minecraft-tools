/**
 * Error codes used in the `{ data, error, requestId }` API envelope (PLAN §7).
 * Keep this list in sync with docs/API.md.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'BAD_IMAGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'IMAGE_TOO_LARGE',
  'PAYLOAD_TOO_LARGE',
  'INVALID_SKIN',
  'INVALID_UV',
  'INVALID_IDENTIFIER',
  'ROLE_CONFLICT',
  'LIMIT_EXCEEDED',
  'MODEL_TOO_COMPLEX',
  'EXPORT_INVALID',
  'GPU_UNAVAILABLE',
  'MODEL_NOT_CONFIGURED',
  'WORKER_UNAVAILABLE',
  'JOB_FAILED',
  'JOB_NOT_CANCELLABLE',
  'REVISION_CONFLICT',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'EXPIRED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: ApiError | null;
  requestId: string;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

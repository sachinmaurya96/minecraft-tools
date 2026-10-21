import path from 'node:path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim().toLowerCase())
  .pipe(z.enum(['', 'true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  DATA_DIR: z.string().default('./data'),
  MAX_IMAGE_MB: z.coerce.number().positive().max(50).default(10),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().max(100_000_000).default(20_000_000),
  MAX_IMAGES_PER_PROJECT: z.coerce.number().int().min(1).max(4).default(4),
  MAX_MESH_MB: z.coerce.number().positive().max(100).default(25),
  MAX_RUNNING_JOBS: z.coerce.number().int().min(1).max(8).default(1),
  MAX_QUEUED_JOBS: z.coerce.number().int().min(1).max(200).default(10),
  MAX_JOBS_PER_SESSION: z.coerce.number().int().min(1).max(50).default(2),
  JOB_TIMEOUT_S: z.coerce.number().int().min(10).max(7200).default(900),
  PROJECT_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(24),
  AI_WORKER_URL: z.string().url().default('http://127.0.0.1:8000'),
  AI_WORKER_TOKEN: z.string().default(''),
  ENABLE_SKING: bool,
  ENABLE_TRIPOSR: bool,
  SESSION_SECRET: z.string().optional(),
  /** Optional: serve the built web app (apps/web/dist) with SPA fallback from the API process. */
  SERVE_WEB_DIST: z.string().optional(),
  /** Express "trust proxy" setting when running behind a reverse proxy (e.g. "1"). */
  TRUST_PROXY: z.string().optional(),
  RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  JOB_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  dataDir: string;
  webOrigins: string[];
  maxImageBytes: number;
  maxMeshBytes: number;
  ttlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API configuration: ${problems}`);
  }
  const e = parsed.data;
  return {
    ...e,
    dataDir: path.resolve(cwd, e.DATA_DIR),
    webOrigins: e.WEB_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxImageBytes: Math.round(e.MAX_IMAGE_MB * 1024 * 1024),
    maxMeshBytes: Math.round(e.MAX_MESH_MB * 1024 * 1024),
    ttlMs: e.PROJECT_TTL_HOURS * 3600 * 1000,
  };
}

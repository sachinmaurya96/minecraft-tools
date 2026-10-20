import { z } from 'zod';
import { ImageRoleSchema } from './images.js';
import { GenerationModeSchema } from './projects.js';

export const GenerationKindSchema = z.enum(['skin', 'entity']);
export type GenerationKind = z.infer<typeof GenerationKindSchema>;

/**
 * Provider readiness as reported by `/api/v1/capabilities` (PLAN §4.5).
 * `available` is a runtime check (worker reachable, weights present, hardware
 * present, self-test passed) — never just a feature flag.
 */
export const ProviderStatusSchema = z.enum(['ready', 'disabled', 'unavailable', 'error']);
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

export const ProviderCapabilitiesSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: GenerationKindSchema,
  mode: GenerationModeSchema,
  available: z.boolean(),
  status: ProviderStatusSchema,
  /** Human-readable reason when not available (shown in the UI as-is). */
  reason: z.string().optional(),
  requiresGpu: z.boolean(),
  requiresWorker: z.boolean(),
  acceptedImageRoles: z.array(ImageRoleSchema),
  acceptedInputFormat: z.string(),
  outputFormat: z.string(),
  limitations: z.array(z.string()),
  license: z.string().optional(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const CapabilitiesResponseSchema = z.object({
  providers: z.array(ProviderCapabilitiesSchema),
  worker: z.object({
    reachable: z.boolean(),
    checkedAt: z.string(),
    error: z.string().optional(),
    device: z.string().optional(),
  }),
  retentionHours: z.number(),
  limits: z.object({
    maxImageMb: z.number(),
    maxImagePixels: z.number(),
    maxImagesPerProject: z.number(),
    maxCubes: z.number(),
    maxAtlasSize: z.number(),
  }),
});
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponseSchema>;

export const JOB_STATUSES = ['queued', 'preprocessing', 'running', 'validating', 'ready', 'failed', 'cancelled'] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['ready', 'failed', 'cancelled'];

export const JobTypeSchema = z.enum(['skin-generate', 'mesh-generate', 'mesh-to-cuboids']);
export type JobType = z.infer<typeof JobTypeSchema>;

export const GenerationJobSchema = z.object({
  id: z.string(),
  type: JobTypeSchema,
  kind: GenerationKindSchema,
  mode: GenerationModeSchema,
  providerId: z.string(),
  status: JobStatusSchema,
  /** Stage name only — the backend never invents progress percentages. */
  progressStage: z.string(),
  projectId: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  artifactIds: z.array(z.string()).optional(),
  /** Job-type specific result summary (e.g. cuboid count, warnings, timings). */
  result: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
export type GenerationJob = z.infer<typeof GenerationJobSchema>;

export const MESH_RESOLUTIONS = ['low', 'medium', 'high'] as const;
export const MeshResolutionSchema = z.enum(MESH_RESOLUTIONS);
export type MeshResolution = z.infer<typeof MeshResolutionSchema>;

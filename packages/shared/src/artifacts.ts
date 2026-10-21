import { z } from 'zod';

export const ARTIFACT_KINDS = [
  'skin-png',
  'mcaddon',
  'geo-json',
  'entity-texture',
  'raw-mesh',
  'cuboid-model',
] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactInfoSchema = z.object({
  id: z.string(),
  kind: ArtifactKindSchema,
  filename: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  /** False for intermediate files such as a raw `.glb` mesh: not usable in Minecraft as-is. */
  minecraftNative: z.boolean(),
  label: z.string(),
  projectId: z.string().optional(),
  projectRevision: z.number().int().optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ArtifactInfo = z.infer<typeof ArtifactInfoSchema>;

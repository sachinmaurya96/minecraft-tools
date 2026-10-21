import { z } from 'zod';

export const IMAGE_ROLES = ['front', 'back', 'left', 'right'] as const;
export const ImageRoleSchema = z.enum(IMAGE_ROLES);
export type ImageRole = z.infer<typeof ImageRoleSchema>;

/** Formats accepted for upload. SVG, GIF, HEIC and everything else are rejected. */
export const ACCEPTED_UPLOAD_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const UploadMimeSchema = z.enum(ACCEPTED_UPLOAD_MIME);
export type UploadMime = z.infer<typeof UploadMimeSchema>;

/** The server re-encodes every upload into one of these (metadata stripped). */
export const NormalizedMimeSchema = z.enum(['image/png', 'image/jpeg']);

export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Rotation = z.infer<typeof RotationSchema>;

/** Crop rectangle in pixels of the normalized image *after* rotation is applied. */
export const CropRectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type CropRect = z.infer<typeof CropRectSchema>;

export const ImagePurposeSchema = z.enum(['reference', 'composite']);
export type ImagePurpose = z.infer<typeof ImagePurposeSchema>;

/** Metadata the server returns for an uploaded, validated and normalized image asset. */
export const ImageAssetSchema = z.object({
  id: z.string(),
  /** `reference` photos are downscaled to <= 2048 px; `composite` (AI input) keeps up to 4096 px as PNG. */
  purpose: ImagePurposeSchema,
  originalName: z.string().max(200),
  originalMime: UploadMimeSchema,
  mime: NormalizedMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().length(64),
  hasAlpha: z.boolean(),
  exifOrientationApplied: z.boolean(),
  metadataStripped: z.literal(true),
  createdAt: z.string(),
  expiresAt: z.string(),
  warnings: z.array(z.string()),
});
export type ImageAsset = z.infer<typeof ImageAssetSchema>;

/** A reference photo as referenced from a project (PLAN §6.1). */
export const ReferenceImageSchema = z.object({
  id: z.string().min(1).max(64),
  role: ImageRoleSchema,
  originalName: z.string().max(200),
  mime: NormalizedMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(),
  temporaryAssetId: z.string().min(1).max(64),
  rotationDegrees: RotationSchema,
  crop: CropRectSchema.optional(),
  isPrimary: z.boolean().optional(),
});
export type ReferenceImage = z.infer<typeof ReferenceImageSchema>;

/** Roles must be unique within a project; replacing a role is an explicit action. */
export const ReferenceListSchema = z
  .array(ReferenceImageSchema)
  .max(4)
  .superRefine((refs, ctx) => {
    const seen = new Set<string>();
    for (const [index, ref] of refs.entries()) {
      if (seen.has(ref.role)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate image role "${ref.role}"`, path: [index, 'role'] });
      }
      seen.add(ref.role);
    }
    if (refs.filter((r) => r.isPrimary).length > 1) {
      ctx.addIssue({ code: 'custom', message: 'Only one reference image can be primary' });
    }
  });

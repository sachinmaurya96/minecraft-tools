import { z } from 'zod';
import { ReferenceListSchema } from './images.js';
import { LIMITS } from './limits.js';

// ---------------------------------------------------------------------------
// Provenance (PLAN §0.5): every result is labelled AI-generated, Photo-assisted,
// Manual or Demo sample. The label is derived from `origin`, never from UI state.
// ---------------------------------------------------------------------------

export const GENERATION_MODES = ['manual', 'photo-assisted', 'ai'] as const;
export const GenerationModeSchema = z.enum(GENERATION_MODES);
export type GenerationMode = z.infer<typeof GenerationModeSchema>;

export const ORIGINS = ['template', 'blank', 'import', 'sample', 'photo-assisted', 'ai'] as const;
export const OriginSchema = z.enum(ORIGINS);
export type Origin = z.infer<typeof OriginSchema>;

export const ProvenanceSchema = z.object({
  origin: OriginSchema,
  /** e.g. `photo-projection-v1`, `sking-v101c`, `triposr+voxel-cuboids-v1`. */
  providerId: z.string().max(64).optional(),
  jobId: z.string().max(64).optional(),
  /** True once the user manually changed a generated/sampled result. */
  editedAfterGeneration: z.boolean().default(false),
  /** Regions that were inferred rather than copied from a photo (e.g. `head.back`). */
  inferredRegions: z.array(z.string().max(64)).max(256).default([]),
  notes: z.array(z.string().max(300)).max(20).default([]),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export type ProvenanceLabel = 'AI-generated' | 'Photo-assisted' | 'Manual' | 'Demo sample';

export function provenanceLabel(p: Pick<Provenance, 'origin'>): ProvenanceLabel {
  switch (p.origin) {
    case 'ai':
      return 'AI-generated';
    case 'photo-assisted':
      return 'Photo-assisted';
    case 'sample':
      return 'Demo sample';
    default:
      return 'Manual';
  }
}

export function generationModeFor(p: Pick<Provenance, 'origin'>): GenerationMode {
  if (p.origin === 'ai') return 'ai';
  if (p.origin === 'photo-assisted') return 'photo-assisted';
  return 'manual';
}

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.maxDisplayNameLength)
  // printable characters only: no control chars / newlines (these end up in .lang files)
  .regex(/^[^\p{Cc}\p{Cf}=]+$/u, 'Use printable characters only (no "=" or line breaks)');

const ProjectMetaShape = {
  id: z.string(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
};

// ---------------------------------------------------------------------------
// Skin project (PLAN §6.2)
// ---------------------------------------------------------------------------

export const SKIN_MODELS = ['classic', 'slim'] as const;
export const SkinModelSchema = z.enum(SKIN_MODELS);
export type SkinModel = z.infer<typeof SkinModelSchema>;

/** Fields the editor is allowed to change. */
export const SkinProjectStateSchema = z.object({
  displayName: DisplayNameSchema,
  model: SkinModelSchema,
  provenance: ProvenanceSchema,
  references: ReferenceListSchema,
});
export type SkinProjectState = z.infer<typeof SkinProjectStateSchema>;

export const SkinProjectSchema = SkinProjectStateSchema.extend({
  ...ProjectMetaShape,
  type: z.literal('skin'),
  generationMode: GenerationModeSchema,
  /** Server-side PNG asset for this revision; never a client URL. */
  skinAssetId: z.string(),
});
export type SkinProject = z.infer<typeof SkinProjectSchema>;

// ---------------------------------------------------------------------------
// Entity project (PLAN §6.3). App-internal representation: coordinates are in
// Bedrock geometry space (model pixels, Y up, origin = cube min corner, pivots
// absolute). The exporter converts this to `.geo.json`; the 3D preview renders
// the exporter's output, so preview and export cannot drift apart.
// ---------------------------------------------------------------------------

export const VOXEL_FACES = ['north', 'south', 'east', 'west', 'up', 'down'] as const;
export const VoxelFaceSchema = z.enum(VOXEL_FACES);
export type VoxelFace = z.infer<typeof VoxelFaceSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i, 'Expected #rrggbb or #rrggbbaa');

const finite = z.number().finite();
const coord = finite.min(-LIMITS.maxCoordinate).max(LIMITS.maxCoordinate);
export const Vec3Schema = z.tuple([coord, coord, coord]);
export type Vec3 = [number, number, number];
const angle = finite.min(-360).max(360);
export const RotationVecSchema = z.tuple([angle, angle, angle]);
const cubeEdge = finite.min(0).max(LIMITS.maxCubeSize);

/**
 * Paint for one cube face. `pixels` is a row-major RGBA bitmap (base64) as seen
 * from outside the cube, upright; see packages/bedrock-export/src/faces.ts for
 * the exact orientation of each face.
 */
export const FacePaintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: HexColorSchema }),
  /** Face not drawn (omitted from the per-face UV map), e.g. an internal face. */
  z.object({ kind: z.literal('hidden') }),
  z.object({
    kind: z.literal('pixels'),
    width: z.number().int().min(1).max(LIMITS.maxFaceBitmapSize),
    height: z.number().int().min(1).max(LIMITS.maxFaceBitmapSize),
    rgba: z.string().max(LIMITS.maxFaceBitmapSize * LIMITS.maxFaceBitmapSize * 4 * 2),
  }),
]);
export type FacePaint = z.infer<typeof FacePaintSchema>;

export const FacePaintMapSchema = z.object({
  north: FacePaintSchema.optional(),
  south: FacePaintSchema.optional(),
  east: FacePaintSchema.optional(),
  west: FacePaintSchema.optional(),
  up: FacePaintSchema.optional(),
  down: FacePaintSchema.optional(),
});
export type FacePaintMap = z.infer<typeof FacePaintMapSchema>;

export const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const CubeSchema = z.object({
  id: IdSchema,
  boneId: IdSchema,
  name: z.string().max(40).optional(),
  origin: Vec3Schema,
  size: z.tuple([cubeEdge, cubeEdge, cubeEdge]),
  rotation: RotationVecSchema.optional(),
  pivot: Vec3Schema.optional(),
  inflate: finite.min(-4).max(4).optional(),
  /** Default colour for faces without their own paint. */
  color: HexColorSchema,
  faces: FacePaintMapSchema.optional(),
});
export type Cube = z.infer<typeof CubeSchema>;

export const BONE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export const BoneSchema = z.object({
  id: IdSchema,
  name: z.string().regex(BONE_NAME_RE, 'Bone names use letters, digits and underscores (max 32)'),
  parentId: IdSchema.optional(),
  pivot: Vec3Schema,
  rotation: RotationVecSchema.optional(),
});
export type Bone = z.infer<typeof BoneSchema>;

export const ENTITY_NAMESPACE_RE = /^[a-z][a-z0-9_]{1,31}$/;
export const ENTITY_SLUG_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const RESERVED_NAMESPACES = ['minecraft', 'minecon', 'mojang'] as const;

export function checkEntityIdentifier(identifier: string): string | null {
  const parts = identifier.split(':');
  if (parts.length !== 2) return 'Identifier must look like namespace:entity_name';
  const [ns, slug] = parts as [string, string];
  if (!ENTITY_NAMESPACE_RE.test(ns)) return 'Namespace: 2–32 chars, lowercase letters, digits, underscores; starts with a letter';
  if ((RESERVED_NAMESPACES as readonly string[]).includes(ns)) return `The "${ns}" namespace is reserved`;
  if (!ENTITY_SLUG_RE.test(slug)) return 'Entity name: lowercase letters, digits, underscores; starts with a letter';
  return null;
}

export const EntityIdentifierSchema = z.string().superRefine((value, ctx) => {
  const problem = checkEntityIdentifier(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

export const BEHAVIOR_PROFILES = ['static', 'wander'] as const;
export const EntityBehaviorSchema = z.object({
  profile: z.enum(BEHAVIOR_PROFILES),
  health: z.number().int().min(1).max(200),
  /** Ground movement speed; 0.25 is the regular speed of most animals. Ignored for static. */
  movementSpeed: finite.min(0.05).max(0.5),
});
export type EntityBehavior = z.infer<typeof EntityBehaviorSchema>;

export const EntityProjectStateSchema = z.object({
  displayName: DisplayNameSchema,
  identifier: EntityIdentifierSchema,
  templateId: z.string().max(40),
  bones: z.array(BoneSchema).min(1).max(LIMITS.maxBones),
  cubes: z.array(CubeSchema).max(LIMITS.maxCubes),
  behavior: EntityBehaviorSchema,
  spawnEgg: z.object({ baseColor: HexColorSchema, overlayColor: HexColorSchema }),
  provenance: ProvenanceSchema,
  references: ReferenceListSchema,
  /** Raw, non-Minecraft-native mesh artifact this model was converted from (if any). */
  sourceMeshArtifactId: z.string().max(64).optional(),
});
export type EntityProjectState = z.infer<typeof EntityProjectStateSchema>;

export const EntityProjectSchema = EntityProjectStateSchema.extend({
  ...ProjectMetaShape,
  type: z.literal('entity'),
  generationMode: GenerationModeSchema,
});
export type EntityProject = z.infer<typeof EntityProjectSchema>;

export type AnyProject = SkinProject | EntityProject;

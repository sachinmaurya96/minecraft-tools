/**
 * Hard limits shared by the browser editor, API validation and exporters.
 * The API is the authority: it re-validates every bound, the browser only uses
 * these to give early feedback.
 */
export const LIMITS = {
  maxImagesPerProject: 4,
  /** Longest side of the normalized reference image the server keeps. */
  normalizedImageMaxSide: 2048,
  /** Minimum side for a reference photo to be useful for sampling. */
  minImageSide: 32,

  maxCubes: 512,
  /** Above this cube count the editor shows a performance warning. */
  warnCubes: 200,
  maxBones: 64,
  /** Absolute bound for any origin/pivot component, in model pixels (1/16 block). */
  maxCoordinate: 512,
  /** Largest edge of a single cube, in model pixels. */
  maxCubeSize: 256,
  /** Largest edge of a per-face bitmap painted or sampled onto a cube face. */
  maxFaceBitmapSize: 128,
  /** Largest texture atlas edge the exporter will write. */
  maxAtlasSize: 1024,

  maxDisplayNameLength: 48,
  maxProjectJsonBytes: 4 * 1024 * 1024,
} as const;

export const SKIN_SIZE = 64;

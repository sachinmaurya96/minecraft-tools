import { bytesToBase64, createImage, setPixel, type EntityProjectState, type FacePaint, type VoxelFace } from '@blockwright/shared';
import { HUMANOID_TEMPLATE, type EntityTemplate } from './templates.js';

/** Test-only: a full project state from a template. */
export function stateFrom(t: EntityTemplate = HUMANOID_TEMPLATE, identifier = 'test_ns:test_bot'): EntityProjectState {
  return {
    displayName: 'Test Bot',
    identifier,
    templateId: t.id,
    ...t.build(),
    behavior: { profile: 'wander', health: 20, movementSpeed: 0.25 },
    provenance: { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] },
    references: [],
  };
}

/** Test-only: a face bitmap filled with `base`, with distinct colours in the top-left and top-right texels. */
export function markedBitmap(w: number, h: number, base: [number, number, number], seed: number): FacePaint {
  const img = createImage(w, h, [...base, 255]);
  setPixel(img, 0, 0, [255, seed, 0, 255]);
  if (w > 1) setPixel(img, w - 1, 0, [0, seed, 255, 255]);
  if (h > 1) setPixel(img, 0, h - 1, [seed, 255, 0, 255]);
  return { kind: 'pixels', width: w, height: h, rgba: bytesToBase64(img.data) };
}

export const ALL_FACES: VoxelFace[] = ['north', 'south', 'east', 'west', 'up', 'down'];

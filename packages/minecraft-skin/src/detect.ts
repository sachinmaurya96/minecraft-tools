import type { RgbaImage, SkinModel } from '@blockwright/shared';

/**
 * Areas that belong to a classic (4-px) arm but are unused by a slim (3-px) arm:
 * the 4th column of the arm top/bottom and of the back face.
 */
const SLIM_ONLY_UNUSED: Array<[number, number, number, number]> = [
  [50, 16, 2, 4],
  [54, 20, 2, 12],
  [42, 48, 2, 4],
  [46, 52, 2, 12],
];

function areaIs(img: RgbaImage, [x0, y0, w, h]: [number, number, number, number], pred: (i: number) => boolean) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!pred((y * img.width + x) * 4)) return false;
  return true;
}

/**
 * Heuristic used by launchers and viewers: a skin whose classic-only arm columns
 * are all transparent (or all solid black, which is how opaque-forced copies look)
 * was almost certainly authored for the slim model. Only a suggestion — the
 * user always confirms the model.
 */
export function suggestModel(img: RgbaImage): SkinModel {
  if (img.width !== 64 || img.height !== 64) return 'classic';
  const transparent = SLIM_ONLY_UNUSED.every((a) => areaIs(img, a, (i) => img.data[i + 3] === 0));
  const black = SLIM_ONLY_UNUSED.every((a) =>
    areaIs(img, a, (i) => img.data[i] === 0 && img.data[i + 1] === 0 && img.data[i + 2] === 0 && img.data[i + 3] === 255),
  );
  return transparent || black ? 'slim' : 'classic';
}

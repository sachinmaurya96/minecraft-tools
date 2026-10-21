import { useEffect, useMemo, useRef, useState } from 'react';
import { borderBackgroundMask, type ImageRole, type ReferenceImage, type RgbaImage, type SkinModel } from '@blockwright/shared';
import {
  defaultBodyGuides,
  defaultSideGuides,
  fitGuides,
  PART_LABELS,
  projectPhotosToSkin,
  subjectBounds,
  type BodyGuides,
  type BodyPart,
  type PhotoProjectionResult,
  type SideGuides,
} from '@blockwright/minecraft-skin';
import { Button, Callout, Dialog, Spinner, cx } from '../../../components/ui';
import { loadReferenceRgba, ROLE_LABELS } from '../services/references';
import { GuideBoxEditor } from './GuideBoxEditor';
import { ReferencePanel } from './ReferencePanel';

const SIDE_LABELS: Record<keyof SideGuides, string> = { head: 'Head', arm: 'Near arm', leg: 'Near leg' };
const PART_SHORT: Record<BodyPart, string> = { head: 'Head', body: 'Torso', rightArm: 'R arm', leftArm: 'L arm', rightLeg: 'R leg', leftLeg: 'L leg' };

type Views = Partial<Record<ImageRole, { image: RgbaImage; mask?: Uint8Array }>>;

function SkinThumb({ image }: { image: RgbaImage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const d = ctx.createImageData(64, 64);
    d.data.set(image.data);
    ctx.putImageData(d, 0, 0);
  }, [image]);
  return <canvas ref={ref} width={64} height={64} className="checker border-2 border-shadow" style={{ width: 256, height: 256 }} aria-label="Resulting skin atlas preview" />;
}

/**
 * Photo-assisted starter skin: place guide boxes on your photos; the colours
 * inside them are copied onto the matching skin faces. Everything not visible
 * in a photo is interpolated and listed as approximate. Deterministic, no AI.
 */
export function PhotoProjectionDialog({
  open,
  onClose,
  model,
  references,
  onReferencesChange,
  preserveOverlayFrom,
  onApply,
  applyLabel = 'Apply to skin',
}: {
  open: boolean;
  onClose: () => void;
  model: SkinModel;
  references: ReferenceImage[];
  onReferencesChange: (refs: ReferenceImage[]) => void;
  preserveOverlayFrom?: RgbaImage;
  onApply: (result: PhotoProjectionResult) => void;
  applyLabel?: string;
}) {
  const [views, setViews] = useState<Views>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useMask, setUseMask] = useState(true);
  const [tolerance, setTolerance] = useState(40);
  const [colors, setColors] = useState(0);
  const [active, setActive] = useState<ImageRole>('front');
  const [guides, setGuides] = useState<{ front: BodyGuides; back: BodyGuides; left: SideGuides; right: SideGuides }>(() => ({
    front: defaultBodyGuides(model, 'front'),
    back: defaultBodyGuides(model, 'back'),
    left: defaultSideGuides(),
    right: defaultSideGuides(),
  }));
  const refKey = references.map((r) => `${r.role}:${r.temporaryAssetId}:${r.rotationDegrees}:${JSON.stringify(r.crop ?? null)}`).join('|');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    Promise.all(references.map(async (r) => [r.role, await loadReferenceRgba(r)] as const))
      .then((pairs) => {
        if (!alive) return;
        const next: Views = {};
        for (const [role, image] of pairs) next[role] = { image };
        setViews(next);
      })
      .catch((e) => alive && setLoadError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refKey]);

  const masks = useMemo(() => {
    const out: Partial<Record<ImageRole, Uint8Array>> = {};
    if (!useMask) return out;
    for (const [role, v] of Object.entries(views) as Array<[ImageRole, { image: RgbaImage }]>) out[role] = borderBackgroundMask(v.image, tolerance);
    return out;
  }, [views, useMask, tolerance]);

  const [result, setResult] = useState<PhotoProjectionResult | null>(null);
  useEffect(() => {
    const front = views.front;
    if (!front) return setResult(null);
    const t = setTimeout(() => {
      const view = <G,>(role: ImageRole, g: G) => (views[role] ? { image: views[role]!.image, guides: g, ...(masks[role] ? { mask: masks[role] } : {}) } : undefined);
      setResult(
        projectPhotosToSkin({
          model,
          front: view('front', guides.front)!,
          ...(views.back ? { back: view('back', guides.back)! } : {}),
          ...(views.left ? { left: view('left', guides.left)! } : {}),
          ...(views.right ? { right: view('right', guides.right)! } : {}),
          ...(colors ? { quantizeColors: colors } : {}),
          ...(preserveOverlayFrom ? { preserveOverlayFrom } : {}),
        }),
      );
    }, 120);
    return () => clearTimeout(t);
  }, [views, masks, guides, colors, model, preserveOverlayFrom]);

  function fitToSubject() {
    const v = views[active];
    const m = masks[active] ?? (v ? borderBackgroundMask(v.image, tolerance) : undefined);
    if (!v || !m || (active !== 'front' && active !== 'back')) return;
    const bounds = subjectBounds(m, v.image.width, v.image.height);
    if (bounds) setGuides((g) => ({ ...g, [active]: fitGuides(defaultBodyGuides(model, active), bounds) }));
  }

  const roles = (['front', 'back', 'left', 'right'] as const).filter((r) => views[r]);
  const current = views[active];

  return (
    <Dialog open={open} onClose={onClose} title="Photo-assisted starter (no AI)" wide>
      <Callout className="mb-3">
        Place each box over the matching body part. Colours inside a box are averaged onto that part of the skin. Parts no photo shows (sides,
        top, bottom, and the back without a back photo) are <strong>approximated</strong> and marked in the editor. This does not recognise
        faces or clothing; it only copies colours from where you put the boxes.
      </Callout>
      {!references.some((r) => r.role === 'front') && (
        <div className="mb-4">
          <ReferencePanel references={references} onChange={onReferencesChange} />
          <p className="mt-2 text-sm text-gold">A front photo is required for the photo-assisted starter.</p>
        </div>
      )}
      {loading && <Spinner label="Loading photos" />}
      {loadError && <Callout tone="error">Could not load a photo: {loadError}. It may have expired; upload it again.</Callout>}
      {views.front && (
        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div>
            <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Photo view">
              {roles.map((r) => (
                <button key={r} role="tab" aria-selected={active === r} className={cx('px-btn px-btn-sm', active === r ? 'px-btn-primary' : 'px-btn-secondary')} onClick={() => setActive(r)}>
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            {current && (active === 'front' || active === 'back') && (
              <GuideBoxEditor<BodyPart>
                image={current.image}
                mask={masks[active]}
                boxes={guides[active]}
                labels={PART_SHORT}
                onChange={(b) => setGuides((g) => ({ ...g, [active]: b }))}
              />
            )}
            {current && (active === 'left' || active === 'right') && (
              <GuideBoxEditor<keyof SideGuides>
                image={current.image}
                mask={masks[active]}
                boxes={guides[active]}
                labels={SIDE_LABELS}
                onChange={(b) => setGuides((g) => ({ ...g, [active]: b }))}
              />
            )}
            <p className="mt-1 max-w-md text-xs text-muted">
              {active === 'back'
                ? 'Back view: the character’s right arm is on YOUR right.'
                : active === 'front'
                  ? 'Front view: the character’s right arm is on YOUR left.'
                  : 'Side view: only the near arm and leg are visible.'}
            </p>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={useMask} onChange={(e) => setUseMask(e.target.checked)} />
                Ignore plain background (tinted red)
              </label>
              {useMask && (
                <label className="text-sm">
                  Tolerance {tolerance}
                  <input type="range" min={10} max={120} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} className="block w-40" />
                </label>
              )}
              <label className="text-sm">
                Colours
                <select className="px-input mt-1 w-32" value={colors} onChange={(e) => setColors(Number(e.target.value))}>
                  <option value={0}>All (photo-like)</option>
                  <option value={24}>24 (pixel art)</option>
                  <option value={16}>16</option>
                  <option value={8}>8</option>
                </select>
              </label>
              {(active === 'front' || active === 'back') && (
                <Button size="sm" onClick={fitToSubject}>
                  Fit boxes to subject
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => setGuides({ front: defaultBodyGuides(model, 'front'), back: defaultBodyGuides(model, 'back'), left: defaultSideGuides(), right: defaultSideGuides() })}
              >
                Reset boxes
              </Button>
            </div>
            {result && (
              <div className="flex flex-wrap gap-4">
                <SkinThumb image={result.image} />
                <div className="min-w-56 flex-1 text-sm">
                  <p className="font-pixel mb-1">Copied from photos</p>
                  <p className="mb-2 text-muted">{result.sampledFaces.length} faces ({[...new Set(result.sampledFaces.map((k) => PART_LABELS[k.split('.')[0] as BodyPart]))].join(', ')})</p>
                  <p className="font-pixel mb-1 text-gold">Approximated</p>
                  <p className="mb-2 text-muted">{result.inferredFaces.length} faces (sides, tops, bottoms and anything no photo shows)</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!result}
          onClick={() => {
            if (result) onApply(result);
          }}
        >
          {applyLabel}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">Only the base layer is replaced; your outer layer is kept. You can undo this.</p>
    </Dialog>
  );
}

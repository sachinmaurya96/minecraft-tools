import { useEffect, useState } from 'react';
import { borderBackgroundMask, extractPalette, rgbaToHex, type Provenance } from '@blockwright/shared';
import { Button, Callout, Spinner } from '../../../components/ui';
import { loadReferenceRgba, ROLE_LABELS } from '../services/references';
import { useEntityEditor } from './store';

/**
 * Photo-assisted colours for any model: dominant colours of each reference
 * photo (plain background ignored). Applying one recolours the selected cube.
 * Shape is not inferred from photos.
 */
export function PhotoPalette() {
  const s = useEntityEditor();
  const [swatches, setSwatches] = useState<Array<{ role: string; colors: Array<{ hex: string; share: number }> }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = s.references.map((r) => r.temporaryAssetId + r.rotationDegrees + JSON.stringify(r.crop ?? null)).join('|');

  useEffect(() => {
    if (!s.references.length) return setSwatches([]);
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all(
      s.references.map(async (r) => {
        const img = await loadReferenceRgba(r);
        const pal = extractPalette(img, 8, borderBackgroundMask(img, 40));
        return { role: ROLE_LABELS[r.role], colors: pal.map((p) => ({ hex: rgbaToHex(p.color, false), share: p.share })) };
      }),
    )
      .then((v) => alive && setSwatches(v))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key]);

  function apply(hex: string) {
    const st = useEntityEditor.getState();
    const cube = st.cubes.find((c) => c.id === st.selectedCubeId);
    if (!cube) return;
    const faces = Object.fromEntries(Object.entries(cube.faces ?? {}).filter(([, p]) => p?.kind !== 'color'));
    st.updateCube(cube.id, { color: hex, faces });
    if (st.provenance.origin !== 'photo-assisted' && st.provenance.origin !== 'ai') {
      const provenance: Provenance = {
        origin: 'photo-assisted',
        providerId: 'photo-palette-entity-v1',
        editedAfterGeneration: false,
        inferredRegions: [],
        notes: ['Colours sampled from reference photos; the shape comes from the template and your edits.'],
      };
      useEntityEditor.setState((cur) => ({ provenance, version: cur.version + 1 }));
    }
  }

  if (!s.references.length) return <p className="text-sm text-muted">Upload reference photos to get a colour palette from them.</p>;
  return (
    <div className="space-y-2 text-sm">
      {loading && <Spinner label="Reading colours" />}
      {error && <Callout tone="error">{error}</Callout>}
      {swatches.map((sw) => (
        <div key={sw.role}>
          <p className="text-xs text-muted">{sw.role}</p>
          <div className="flex flex-wrap gap-1">
            {sw.colors.map((c) => (
              <Button
                key={c.hex}
                size="sm"
                disabled={!s.selectedCubeId}
                onClick={() => apply(c.hex)}
                aria-label={`Apply ${c.hex} (${Math.round(c.share * 100)}% of photo) to the selected cube`}
                title={`${c.hex} · ${Math.round(c.share * 100)}%`}
              >
                <span className="inline-block h-4 w-6 border border-shadow" style={{ background: c.hex }} />
              </Button>
            ))}
          </div>
        </div>
      ))}
      {!s.selectedCubeId && <p className="text-xs text-gold">Select a cube, then click a colour.</p>}
    </div>
  );
}

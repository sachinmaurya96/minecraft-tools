import { useEffect, useRef, useState } from 'react';
import { decodePngToRgba, type ReferenceImage, type RgbaImage } from '@blockwright/shared';
import { Button, Callout, ConfirmDialog, Dialog, Spinner } from '../../../components/ui';
import { api, ApiError } from '../../../lib/api';
import { useProvider } from '../../../lib/useCapabilities';
import { ProviderStatusBadge } from '../components/CapabilityList';
import { JobProgress, useJob } from '../components/JobProgress';
import { loadReferenceRgba, rgbaToCanvas, ROLE_LABELS } from '../services/references';

const SIZE = 1024;

/**
 * AI skin generation with Sking SKING_DDJ_v101c. Sking expects one square
 * "edited render": the front_left view on the left half and the back_left view
 * on the right half. We build that composite from images you choose, show it,
 * and require you to confirm it before anything runs. Disabled (with the
 * server's reason) whenever the model cannot actually run.
 */
export function SkingDialog({
  open,
  onClose,
  projectId,
  revision,
  references,
  onApplied,
  ensureSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  revision: number;
  references: ReferenceImage[];
  onApplied: (view: Awaited<ReturnType<typeof api.applyResult>>) => void;
  ensureSaved: () => Promise<boolean>;
}) {
  const { provider, loading } = useProvider('sking-v101c');
  const [left, setLeft] = useState<string>('front');
  const [right, setRight] = useState<string>('back');
  const [custom, setCustom] = useState<File | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [composite, setComposite] = useState<Blob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ image: RgbaImage; artifactId: string } | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const job = useJob(jobId);
  const ready = !!provider?.available;

  // build the side-by-side composite from two references (or use an uploaded composite)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setReviewed(false);
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (custom) {
        const bmp = await createImageBitmap(custom);
        ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
      } else {
        for (const [role, x] of [
          [left, 0],
          [right, SIZE / 2],
        ] as const) {
          const ref = references.find((r) => r.role === role);
          if (!ref) continue;
          const img = await loadReferenceRgba(ref);
          const s = Math.min(SIZE / 2 / img.width, SIZE / img.height);
          const w = img.width * s;
          const h = img.height * s;
          ctx.drawImage(rgbaToCanvas(img), x + (SIZE / 2 - w) / 2, (SIZE - h) / 2, w, h);
        }
      }
      if (alive) canvas.toBlob((b) => alive && setComposite(b), 'image/png');
    })().catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [open, left, right, custom, references]);

  // fetch the generated skin when the job finishes
  useEffect(() => {
    const j = job.data;
    if (!j || j.status !== 'ready' || result) return;
    const artifactId = j.result?.skinArtifactId as string | undefined;
    if (!artifactId) return;
    api
      .downloadArtifact(artifactId)
      .then(async ({ blob }) => setResult({ image: decodePngToRgba(new Uint8Array(await blob.arrayBuffer())).image, artifactId }))
      .catch((e) => setError((e as Error).message));
  }, [job.data, result]);

  async function generate() {
    setError(null);
    setResult(null);
    try {
      if (!composite) throw new Error('No composite to send.');
      if (!(await ensureSaved()) || !projectId) throw new Error('Save the project first.');
      const { asset } = await api.uploadImage(composite, 'composite', 'composite.png');
      const { job } = await api.createJob('skin-generate', { projectId, compositeAssetId: asset.id });
      setJobId(job.id);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message} (${e.code})` : (e as Error).message);
    }
  }

  async function apply() {
    setConfirmApply(false);
    try {
      const view = await api.applyResult(projectId!, revision, result!.artifactId);
      onApplied(view);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const choices = references.map((r) => ({ value: r.role, label: `${ROLE_LABELS[r.role]} (${r.originalName})` }));
  return (
    <Dialog open={open} onClose={onClose} title="AI skin (Sking)" wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {loading ? <Spinner label="Checking availability" /> : provider && <ProviderStatusBadge p={provider} />}
        <span className="text-sm text-muted">Model: Sking SKING_DDJ_v101c (AGPL-3.0) · runs only on a server with an NVIDIA CUDA GPU.</span>
      </div>
      {!ready && provider && (
        <Callout tone="warn" title="Not available on this server" className="mb-3">
          <p>{provider.reason}</p>
          <p className="mt-1">You can still prepare and inspect a composite here, and use the manual or photo-assisted tools for your skin.</p>
        </Callout>
      )}
      <Callout className="mb-3">
        Sking does not read raw photos directly. It needs one square image with a <strong>front-left view</strong> on the left half and a{' '}
        <strong>back-left view</strong> on the right half, in the style it was trained on. Straight-on photos may give poor results. Side photos are
        not used by the model.
      </Callout>
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="border-2 border-shadow" style={{ width: 360, height: 360 }} aria-label="Composite that will be sent to Sking" />
        <div className="space-y-3 text-sm">
          {!custom && (
            <>
              <label className="block">
                Left half (front-left view)
                <select className="px-input mt-1" value={left} onChange={(e) => setLeft(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Right half (back-left view)
                <select className="px-input mt-1" value={right} onChange={(e) => setRight(e.target.value)}>
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              {choices.length === 0 && <p className="text-gold">Upload reference photos first, or use a ready-made composite.</p>}
            </>
          )}
          <label className="block">
            Or upload a ready composite (square PNG, even size, 256–4096 px)
            <input type="file" accept="image/png" className="mt-1 block text-xs" onChange={(e) => setCustom(e.target.files?.[0] ?? null)} />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            <span>I checked the composite: left half is the front-left view, right half is the back-left view.</span>
          </label>
          <Button variant="primary" onClick={generate} disabled={!ready || !reviewed || !composite || (job.data && !['ready', 'failed', 'cancelled'].includes(job.data.status))}>
            Generate skin with AI
          </Button>
          {job.data && <JobProgress job={job.data} onCancel={() => api.cancelJob(job.data!.id)} />}
          {error && <Callout tone="error">{error}</Callout>}
          {result && (
            <div>
              <p className="font-pixel mb-1">AI result (not applied yet)</p>
              <canvas
                width={64}
                height={64}
                className="checker border-2 border-shadow"
                style={{ width: 192, height: 192 }}
                ref={(c) => {
                  const ctx = c?.getContext('2d');
                  if (!ctx) return;
                  const d = ctx.createImageData(64, 64);
                  d.data.set(result.image.data);
                  ctx.putImageData(d, 0, 0);
                }}
              />
              <Button className="mt-2" variant="primary" onClick={() => setConfirmApply(true)}>
                Use this result
              </Button>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmApply}
        title="Replace your skin with the AI result?"
        message="The AI result becomes a new revision labelled AI-generated. Your current skin stays in the history and can be restored."
        confirmLabel="Use AI result"
        onCancel={() => setConfirmApply(false)}
        onConfirm={apply}
      />
    </Dialog>
  );
}

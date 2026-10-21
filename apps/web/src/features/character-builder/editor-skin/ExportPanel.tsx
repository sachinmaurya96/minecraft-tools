import { useMemo, useState } from 'react';
import type { ValidationReport } from '@blockwright/shared';
import { makeBaseLayerOpaque, validateSkinImage } from '@blockwright/minecraft-skin';
import { Button, Callout, Panel, Spinner } from '../../../components/ui';
import { api, ApiError, saveBlob } from '../../../lib/api';
import { ValidationList } from '../components/ValidationList';
import { useSkinEditor } from './store';

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function ExportPanel({ flush }: { flush: () => Promise<boolean> }) {
  const s = useSkinEditor();
  const local = useMemo(() => validateSkinImage({ width: 64, height: 64, data: s.pixels }, s.model), [s.pixels, s.model]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ filename: string; sha256: string; report: ValidationReport } | null>(null);
  const [error, setError] = useState<{ message: string; report?: ValidationReport } | null>(null);
  const baseProblem = local.issues.some((i) => i.code === 'BASE_TRANSPARENT');

  async function exportPng() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (!(await flush())) throw new Error('The latest changes could not be saved, so the export would not match what you see. Check the save status and try again.');
      const st = useSkinEditor.getState();
      const { artifact, validation } = await api.exportSkin(st.projectId!, st.revision);
      const { blob } = await api.downloadArtifact(artifact.id);
      const digest = await sha256Hex(blob);
      if (digest !== artifact.sha256) throw new Error('The downloaded file does not match the validated export (checksum mismatch). Please retry.');
      saveBlob(new Blob([blob], { type: 'image/png' }), artifact.filename);
      setResult({ filename: artifact.filename, sha256: artifact.sha256, report: validation });
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Export failed.', ...(e instanceof ApiError && e.report ? { report: e.report } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-4">
      <h2 className="mb-2 text-lg">Export</h2>
      <ValidationList report={local} hideInfo />
      {baseProblem && (
        <Button size="sm" className="mt-2" onClick={() => s.replacePixels(makeBaseLayerOpaque({ width: 64, height: 64, data: s.pixels }, s.model).data)}>
          Make base layer opaque
        </Button>
      )}
      <div className="mt-3">
        <Button variant="primary" onClick={exportPng} disabled={busy || !local.ok} data-testid="export-skin">
          {busy ? <Spinner label="Validating on the server" /> : 'Download skin PNG'}
        </Button>
      </div>
      {result && (
        <Callout tone="ok" className="mt-3" title={`Downloaded ${result.filename}`}>
          <p>Validated on the server ({result.report.checks.length} checks). SHA-256 {result.sha256.slice(0, 16)}…</p>
        </Callout>
      )}
      {error && (
        <Callout tone="error" className="mt-3" title="Export failed">
          <p className="mb-1">{error.message}</p>
          {error.report && <ValidationList report={error.report} />}
        </Callout>
      )}
      <details className="mt-4 text-sm">
        <summary className="font-pixel cursor-pointer">How to use it in Minecraft</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>
            <strong className="text-ink">Java Edition:</strong> open the Minecraft Launcher → <em>Skins</em> → <em>New skin</em>. Choose the
            {s.model === 'slim' ? ' Slim' : ' Classic'} player model (it must match this skin), browse to the PNG, then <em>Save &amp; use</em>.
          </li>
          <li>
            <strong className="text-ink">Bedrock Edition:</strong> whether you can import a custom skin PNG depends on your device and platform;
            where it is offered it is in the Dressing Room&apos;s classic-skin section. Menu names change between versions, so check your
            platform. Blockwright has not verified Bedrock skin import.
          </li>
          <li>A skin only recolours the standard body. For a new shape, build a custom entity instead.</li>
        </ol>
      </details>
    </Panel>
  );
}

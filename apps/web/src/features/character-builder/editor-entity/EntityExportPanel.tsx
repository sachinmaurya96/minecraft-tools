import { useEffect, useState } from 'react';
import { LIMITS, type ValidationReport } from '@blockwright/shared';
import { AddonBuildError, buildAddon, validateAddonPacks, type AddonSummary } from '@blockwright/bedrock-export';
import { Button, Callout, Panel, Spinner } from '../../../components/ui';
import { api, ApiError, saveBlob, type AddonExportResult } from '../../../lib/api';
import { ValidationList } from '../components/ValidationList';
import { entityStateFrom, useEntityEditor } from './store';

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface LiveCheck {
  report: ValidationReport;
  summary?: AddonSummary;
  atlas?: { width: number; height: number; mode: string; texels: number };
  material?: string;
}

export function EntityExportPanel({ flush }: { flush: () => Promise<boolean> }) {
  const s = useEntityEditor();
  const [live, setLive] = useState<LiveCheck | null>(null);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AddonExportResult | null>(null);
  const [error, setError] = useState<{ message: string; report?: ValidationReport } | null>(null);

  // instant in-browser pre-check with the same builder + validator the server uses
  useEffect(() => {
    const t = setTimeout(() => {
      const state = entityStateFrom(useEntityEditor.getState());
      try {
        const addon = buildAddon(state);
        const v = validateAddonPacks(addon.behaviorPack, addon.resourcePack);
        setLive({
          report: v,
          summary: v.summary,
          atlas: { width: addon.atlas.width, height: addon.atlas.height, mode: addon.atlas.mode, texels: addon.atlas.usedTexels },
          material: addon.material,
        });
      } catch (e) {
        const message = e instanceof AddonBuildError ? e.message : (e as Error).message;
        setLive({ report: { ok: false, checks: ['build'], issues: [{ code: e instanceof AddonBuildError ? e.code : 'BUILD_FAILED', severity: 'error', message }] } });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [s.cubes, s.bones, s.identifier, s.displayName, s.behavior, s.spawnEgg]);

  async function exportAddon() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (!(await flush())) throw new Error('The latest changes could not be saved, so the export would not match what you see. Check the save status and try again.');
      const st = useEntityEditor.getState();
      const res = await api.exportAddon(st.projectId!, st.revision, includeRaw);
      const { blob } = await api.downloadArtifact(res.artifact.id);
      if ((await sha256Hex(blob)) !== res.artifact.sha256) throw new Error('The downloaded add-on does not match the validated export (checksum mismatch). Please retry.');
      // octet-stream keeps mobile browsers from renaming .mcaddon to .zip
      saveBlob(new Blob([blob], { type: 'application/octet-stream' }), res.artifact.filename);
      setDone(res);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Export failed.', ...(e instanceof ApiError && e.report ? { report: e.report } : {}) });
    } finally {
      setBusy(false);
    }
  }

  async function downloadRaw(id: string, filename: string) {
    const { blob } = await api.downloadArtifact(id);
    saveBlob(blob, filename);
  }

  const cubes = s.cubes.length;
  return (
    <Panel className="p-4">
      <h2 className="mb-2 text-lg">Export Bedrock add-on</h2>
      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Cubes</dt>
        <dd className={cubes > LIMITS.maxCubes ? 'text-redstone' : cubes > LIMITS.warnCubes ? 'text-gold' : ''}>
          {cubes} / {LIMITS.maxCubes}
        </dd>
        <dt className="text-muted">Bones</dt>
        <dd>{s.bones.length}</dd>
        {live?.atlas && (
          <>
            <dt className="text-muted">Texture</dt>
            <dd>
              {live.atlas.width}×{live.atlas.height} ({live.atlas.mode === 'exact' ? 'one texel per pixel' : 'shared colour swatches'})
            </dd>
            <dt className="text-muted">Material</dt>
            <dd>{live.material}</dd>
          </>
        )}
      </dl>
      {live ? <ValidationList report={live.report} hideInfo /> : <Spinner label="Checking" />}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} />
        Also give me the raw .geo.json and texture (for Blockbench)
      </label>
      <Button className="mt-3" variant="primary" onClick={exportAddon} disabled={busy || !live?.report.ok} data-testid="export-addon">
        {busy ? <Spinner label="Building, zipping and verifying" /> : 'Download .mcaddon'}
      </Button>
      {done && (
        <Callout tone="ok" className="mt-3" title={`Downloaded ${done.artifact.filename}`}>
          <p className="mb-1">
            Server checks passed ({done.validation.checks.length}). Structurally validated; in-game behaviour still needs your test.
          </p>
          <details>
            <summary className="cursor-pointer">Archive contents</summary>
            <ul className="mt-1 font-mono text-xs">
              {done.summary.archiveTree.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
          {done.raw.map((r) => (
            <Button key={r.id} size="sm" className="mt-2 mr-2" onClick={() => downloadRaw(r.id, r.filename)}>
              {r.filename}
            </Button>
          ))}
        </Callout>
      )}
      {error && (
        <Callout tone="error" className="mt-3" title="Export failed">
          <p className="mb-1">{error.message}</p>
          {error.report && <ValidationList report={error.report} />}
        </Callout>
      )}
      <details className="mt-4 text-sm">
        <summary className="font-pixel cursor-pointer">How to use it in Minecraft Bedrock</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          <li>Open the .mcaddon file with Minecraft (double-click on Windows; “Open with Minecraft” on phones). Both packs are imported.</li>
          <li>
            Edit or create a world → <em>Behavior Packs</em> → activate “{s.displayName} (Behaviors)”. Its resource pack is a dependency and is
            added too (check <em>Resource Packs</em>).
          </li>
          <li>
            Turn on cheats, then type <code>/summon {s.identifier}</code>, or use the spawn egg from the creative inventory.
          </li>
          <li>Invisible or missing? Enable the Content Log (Settings → Creator) and read the errors.</li>
          <li>Test in a copy of your world first. This add-on is static (no animations) and is not a Java Edition mod.</li>
        </ol>
      </details>
    </Panel>
  );
}

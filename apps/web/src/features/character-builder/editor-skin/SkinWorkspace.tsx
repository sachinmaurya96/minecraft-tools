import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { base64ToBytes, bytesToBase64, decodePngToRgba, encodeRgbaPng, type Provenance, type SkinModel, type SkinProjectState } from '@blockwright/shared';
import { PageMeta } from '../../../components/PageMeta';
import { Button, Callout, ConfirmDialog, Dialog, Panel, Spinner } from '../../../components/ui';
import { api, ApiError, type SkinProjectView } from '../../../lib/api';
import { storage } from '../../../lib/storage';
import { HistoryDialog } from '../components/HistoryDialog';
import { PhotoProjectionDialog } from '../components/PhotoProjectionDialog';
import { ProjectBar } from '../components/ProjectBar';
import { ReferencePanel } from '../components/ReferencePanel';
import { useAutosave } from '../hooks/useAutosave';
import { ExportPanel } from './ExportPanel';
import { NewSkinDialogBody, type SkinStart } from './NewSkinDialog';
import { PixelCanvas } from './PixelCanvas';
import { SkingDialog } from './SkingDialog';
import { SkinPreview3D } from './SkinPreview3D';
import { useSkinEditor } from './store';
import { ToolPanel } from './ToolPanel';

const PROJECT_KEY = 'bw.skinProject';
const DRAFT_KEY = 'bw.skinDraft';

interface Draft {
  projectId: string | null;
  revision: number;
  state: SkinProjectState;
  png: string;
  savedAt: number;
}

function fromView(view: SkinProjectView) {
  const { image } = decodePngToRgba(base64ToBytes(view.skinPngBase64));
  useSkinEditor.getState().loadProject({
    projectId: view.project.id,
    revision: view.project.revision,
    displayName: view.project.displayName,
    model: view.project.model,
    provenance: view.project.provenance,
    references: view.project.references,
    pixels: image.data,
  });
  storage.set(PROJECT_KEY, view.project.id);
}

const ORIGIN: Record<SkinStart['kind'], Provenance['origin']> = {
  template: 'template',
  blank: 'blank',
  sample: 'sample',
  import: 'import',
  photo: 'template',
  ai: 'template',
};

export function SkinWorkspace() {
  const [params, setParams] = useSearchParams();
  const s = useSkinEditor();
  const [phase, setPhase] = useState<'loading' | 'choose' | 'restore' | 'ready'>(() => (s.version > 0 && params.get('new') !== '1' ? 'ready' : 'loading'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialog, setDialog] = useState<'photo' | 'ai' | 'history' | 'new' | null>(null);
  const [pendingModel, setPendingModel] = useState<SkinModel | null>(null);
  const [zoom, setZoom] = useState(8);
  const [autoZoom, setAutoZoom] = useState(true);
  const centerRef = useRef<HTMLDivElement>(null);

  // initial load / resume / recovery
  useEffect(() => {
    if (phase !== 'loading') return;
    const id = storage.get(PROJECT_KEY);
    const localDraft = storage.getJson<Draft>(DRAFT_KEY);
    if (params.get('new') === '1' || !id) {
      setPhase('choose');
      return;
    }
    api
      .getProject<SkinProjectView>(id)
      .then((view) => {
        fromView(view);
        setPhase('ready');
      })
      .catch((e) => {
        if (localDraft && (!(e instanceof ApiError) || e.code === 'NOT_FOUND' || e.code === 'NETWORK')) {
          setDraft(localDraft);
          setPhase('restore');
        } else setPhase('choose');
      });
  }, [phase, params]);

  // responsive zoom for the pixel canvas
  useEffect(() => {
    const el = centerRef.current;
    if (!el || !autoZoom) return;
    const ro = new ResizeObserver(() => setZoom(Math.max(4, Math.min(12, Math.floor((el.clientWidth - 8) / 64)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [autoZoom, phase]);

  const save = useCallback(async () => {
    const st = useSkinEditor.getState();
    const version = st.version;
    const state: SkinProjectState = {
      displayName: st.displayName.trim() || 'My skin',
      model: st.model,
      provenance: st.provenance,
      references: st.references,
    };
    const png = bytesToBase64(encodeRgbaPng({ width: 64, height: 64, data: st.pixels }));
    storage.setJson(DRAFT_KEY, { projectId: st.projectId, revision: st.revision, state, png, savedAt: Date.now() } satisfies Draft);
    const view = st.projectId ? await api.updateProject<SkinProjectView>(st.projectId, st.revision, state, png) : await api.createSkinProject(state, png);
    storage.set(PROJECT_KEY, view.project.id);
    useSkinEditor.getState().setSaved(view.project.id, view.project.revision, version, view.project.provenance, view.project.references);
  }, []);

  const onSaveState = useCallback((state: 'saving' | 'saved' | 'offline' | 'conflict' | 'error', message?: string) => {
    if (state !== 'saved') useSkinEditor.getState().setSaveState(state, message);
  }, []);
  const dirty = s.version !== s.savedVersion;
  const { flush, unblock } = useAutosave({ enabled: phase === 'ready', dirty, save, onState: onSaveState });

  // keyboard shortcuts
  useEffect(() => {
    if (phase !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      const st = useSkinEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (!mod && !e.altKey) {
        const map: Record<string, () => void> = {
          b: () => st.set('tool', 'pencil'),
          e: () => st.set('tool', 'eraser'),
          g: () => st.set('tool', 'fill'),
          i: () => st.set('tool', 'picker'),
          m: () => st.set('mirror', !st.mirror),
        };
        map[e.key.toLowerCase()]?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  function start(choice: SkinStart) {
    const notes = choice.kind === 'import' ? choice.notes : [];
    useSkinEditor.getState().loadProject({
      projectId: null,
      revision: 0,
      displayName: choice.name,
      model: choice.model,
      provenance: { origin: ORIGIN[choice.kind], editedAfterGeneration: false, inferredRegions: [], notes },
      references: [],
      pixels: choice.pixels,
      dirty: true,
    });
    storage.remove(PROJECT_KEY);
    unblock();
    setParams({}, { replace: true });
    setPhase('ready');
    setDialog(choice.kind === 'photo' ? 'photo' : choice.kind === 'ai' ? 'ai' : null);
  }

  function restoreDraft(d: Draft) {
    const { image } = decodePngToRgba(base64ToBytes(d.png));
    useSkinEditor.getState().loadProject({
      projectId: null,
      revision: 0,
      displayName: d.state.displayName,
      model: d.state.model,
      // the server copy expired: references are gone too, and only the server may attest AI provenance
      provenance:
        d.state.provenance.origin === 'ai'
          ? { ...d.state.provenance, origin: 'import', notes: ['Restored from a local draft of an AI-generated skin.'] }
          : d.state.provenance,
      references: [],
      pixels: image.data,
      dirty: true,
    });
    storage.remove(PROJECT_KEY);
    setPhase('ready');
  }

  async function resolveConflict(useServer: boolean) {
    const st = useSkinEditor.getState();
    unblock();
    if (useServer && st.projectId) {
      fromView(await api.getProject<SkinProjectView>(st.projectId));
    } else {
      st.loadProject({ ...st, projectId: null, revision: 0, references: st.references, dirty: true });
      storage.remove(PROJECT_KEY);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <Spinner label="Opening your last skin" />
      </div>
    );
  }

  if (phase === 'choose' || phase === 'restore') {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageMeta title="New player skin" description="Start a 64×64 Minecraft player skin from a template, an existing skin or your photos." />
        <nav aria-label="Breadcrumb" className="mb-3 text-sm">
          <Link to="/tools/character-builder">Character Builder</Link> <span className="text-muted">/ Player skin</span>
        </nav>
        <h1 className="mb-4 text-3xl">New player skin</h1>
        {phase === 'restore' && draft && (
          <Callout tone="warn" title="Your last skin is no longer on the server" className="mb-4">
            <p className="mb-2">
              It may have expired after the retention period or been deleted. This browser kept a draft from {new Date(draft.savedAt).toLocaleString()}.
              Reference photos are not part of the draft.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => restoreDraft(draft)}>
                Restore draft
              </Button>
              <Button
                onClick={() => {
                  storage.remove(DRAFT_KEY);
                  setPhase('choose');
                }}
              >
                Discard it
              </Button>
            </div>
          </Callout>
        )}
        <NewSkinDialogBody onStart={start} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[96rem] px-3 py-4 sm:px-4">
      <PageMeta title="Skin editor" description="Edit a 64×64 Minecraft player skin with a live 3D preview." />
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link to="/tools/character-builder">Character Builder</Link> <span className="text-muted">/ Player skin</span>
      </nav>
      <ProjectBar
        kindLabel="Player skin"
        name={s.displayName}
        onRename={s.setDisplayName}
        provenance={s.provenance}
        saveState={s.saveState}
        saveMessage={s.saveMessage}
        revision={s.revision}
        dirty={dirty}
        canUndo={s.undoStack.length > 0}
        canRedo={s.redoStack.length > 0}
        onUndo={s.undo}
        onRedo={s.redo}
        onHistory={s.projectId ? () => setDialog('history') : undefined}
      >
        <Button size="sm" onClick={() => setDialog('new')}>
          New…
        </Button>
      </ProjectBar>
      {s.saveState === 'conflict' && (
        <Callout tone="error" title="This project changed in another tab or device" className="mb-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => resolveConflict(true)}>
              Load the saved version (discard my changes)
            </Button>
            <Button size="sm" onClick={() => resolveConflict(false)}>
              Keep mine as a new project
            </Button>
          </div>
        </Callout>
      )}
      {s.notice && (
        <Callout tone="warn" className="mb-3">
          {s.notice}
        </Callout>
      )}
      {s.provenance.inferredRegions.length > 0 && (
        <Callout className="mb-3">
          Photo-assisted: {s.provenance.inferredRegions.length} faces were approximated (hatched in yellow on the atlas). Check the back and sides in the 3D
          view.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(18rem,24rem)]">
        <Panel as="aside" className="order-2 min-w-0 p-3 lg:order-1" aria-label="Tools">
          <ToolPanel onModelChange={(m) => setPendingModel(m)} />
        </Panel>
        <div ref={centerRef} className="order-1 min-w-0 lg:order-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Button size="sm" aria-label="Zoom out" onClick={() => (setAutoZoom(false), setZoom((z) => Math.max(3, z - 1)))}>
              −
            </Button>
            <span className="text-sm text-muted">{zoom}×</span>
            <Button size="sm" aria-label="Zoom in" onClick={() => (setAutoZoom(false), setZoom((z) => Math.min(16, z + 1)))}>
              +
            </Button>
            <Button size="sm" onClick={() => setDialog('photo')}>
              Photo-assisted…
            </Button>
            <Button size="sm" onClick={() => setDialog('ai')}>
              AI skin…
            </Button>
          </div>
          <PixelCanvas zoom={zoom} />
        </div>
        <div className="order-3 space-y-4">
          <Panel className="p-3">
            <h2 className="mb-2 text-lg">3D preview</h2>
            <SkinPreview3D pixels={s.pixels} model={s.model} showBase={s.showBase} showOverlay={s.showOverlay} hiddenParts={s.hiddenParts} height={340} />
          </Panel>
          <ExportPanel flush={flush} />
        </div>
      </div>

      <details className="px-panel mt-4 p-3" open={s.references.length > 0}>
        <summary className="font-pixel cursor-pointer text-lg">Reference photos</summary>
        <div className="mt-3">
          <ReferencePanel references={s.references} onChange={s.setReferences} />
        </div>
      </details>

      <PhotoProjectionDialog
        open={dialog === 'photo'}
        onClose={() => setDialog(null)}
        model={s.model}
        references={s.references}
        onReferencesChange={s.setReferences}
        preserveOverlayFrom={{ width: 64, height: 64, data: s.pixels }}
        onApply={(result) => {
          useSkinEditor.getState().replacePixels(result.image.data, {
            provenance: {
              origin: 'photo-assisted',
              providerId: 'photo-projection-v1',
              editedAfterGeneration: false,
              inferredRegions: result.inferredFaces,
              notes: result.warnings,
            },
          });
          setDialog(null);
        }}
      />
      <SkingDialog
        open={dialog === 'ai'}
        onClose={() => setDialog(null)}
        projectId={s.projectId}
        revision={s.revision}
        references={s.references}
        ensureSaved={flush}
        onApplied={(view) => fromView(view as SkinProjectView)}
      />
      {s.projectId && (
        <HistoryDialog
          projectId={s.projectId}
          currentRevision={s.revision}
          open={dialog === 'history'}
          onClose={() => setDialog(null)}
          onRestore={async (rev) => {
            if (!(await flush())) return;
            const st = useSkinEditor.getState();
            fromView(await api.revert<SkinProjectView>(st.projectId!, st.revision, rev));
            setDialog(null);
          }}
        />
      )}
      <Dialog open={dialog === 'new'} onClose={() => setDialog(null)} title="Start a new skin" wide>
        <p className="mb-3 text-sm text-muted">Your current skin stays saved on the server for its retention period; this opens a separate project.</p>
        <NewSkinDialogBody onStart={start} />
      </Dialog>
      <ConfirmDialog
        open={!!pendingModel}
        title={`Switch to ${pendingModel === 'slim' ? 'slim (3 px)' : 'classic (4 px)'} arms?`}
        message="The pixels stay the same, but arms are laid out differently in each model, so arm textures may need repainting. You can undo by switching back."
        confirmLabel="Switch model"
        onCancel={() => setPendingModel(null)}
        onConfirm={() => {
          useSkinEditor.getState().setModel(pendingModel!);
          setPendingModel(null);
        }}
      />
    </div>
  );
}

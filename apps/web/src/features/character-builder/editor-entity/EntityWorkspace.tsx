import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { checkEntityIdentifier, type EntityProjectState } from '@blockwright/shared';
import { buildGeometry, geometryToRenderModel, packAtlas, skinToHumanoid, validateEntityModel } from '@blockwright/bedrock-export';
import { PageMeta } from '../../../components/PageMeta';
import { Button, Callout, Dialog, Panel, Spinner, cx } from '../../../components/ui';
import { api, ApiError, type EntityProjectView } from '../../../lib/api';
import { storage } from '../../../lib/storage';
import { HistoryDialog } from '../components/HistoryDialog';
import { PhotoProjectionDialog } from '../components/PhotoProjectionDialog';
import { ProjectBar } from '../components/ProjectBar';
import { ReferencePanel } from '../components/ReferencePanel';
import { ValidationList } from '../components/ValidationList';
import { useAutosave } from '../hooks/useAutosave';
import { EntityExportPanel } from './EntityExportPanel';
import { EntityViewport, type ViewPreset } from './EntityViewport';
import { BoneInspector, CubeInspector, EntitySettings } from './Inspector';
import { MeshDialog } from './MeshDialog';
import { NewEntityBody, type EntityStart } from './NewEntityBody';
import { Outliner } from './Outliner';
import { PhotoPalette } from './PhotoPalette';
import { entityStateFrom, useEntityEditor } from './store';

const PROJECT_KEY = 'bw.entityProject';
const DRAFT_KEY = 'bw.entityDraft';

interface Draft {
  state: EntityProjectState;
  savedAt: number;
}

function fromView(view: EntityProjectView) {
  const p = view.project;
  useEntityEditor.getState().loadProject({ ...p, projectId: p.id, revision: p.revision });
  storage.set(PROJECT_KEY, p.id);
}

function defaultNamespace(): string {
  const saved = storage.get('bw.namespace');
  if (saved && !checkEntityIdentifier(`${saved}:x`)) return saved;
  const ns = `my_${Math.random()
    .toString(36)
    .slice(2, 6)
    .replace(/[^a-z0-9]/g, 'a')}`;
  storage.set('bw.namespace', ns);
  return ns;
}

const VIEWS: ViewPreset[] = ['front', 'back', 'left', 'right', 'top', 'iso'];

export function EntityWorkspace() {
  const [params, setParams] = useSearchParams();
  const s = useEntityEditor();
  const [phase, setPhase] = useState<'loading' | 'choose' | 'restore' | 'ready'>(() => (s.version > 0 && params.get('new') !== '1' ? 'ready' : 'loading'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dialog, setDialog] = useState<'new' | 'history' | 'mesh' | 'ai' | 'photo' | null>(null);
  const [view, setView] = useState<{ preset: ViewPreset; nonce: number }>({ preset: 'iso', nonce: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [tab, setTab] = useState<'entity' | 'selection' | 'photos'>('selection');

  useEffect(() => {
    if (phase !== 'loading') return;
    const id = storage.get(PROJECT_KEY);
    const localDraft = storage.getJson<Draft>(DRAFT_KEY);
    if (params.get('new') === '1' || !id) return setPhase('choose');
    api
      .getProject<EntityProjectView>(id)
      .then((v) => {
        fromView(v);
        setPhase('ready');
      })
      .catch((e) => {
        if (localDraft && (!(e instanceof ApiError) || e.code === 'NOT_FOUND' || e.code === 'NETWORK')) {
          setDraft(localDraft);
          setPhase('restore');
        } else setPhase('choose');
      });
  }, [phase, params]);

  const save = useCallback(async () => {
    const st = useEntityEditor.getState();
    const version = st.version;
    const state = entityStateFrom(st);
    storage.setJson(DRAFT_KEY, { state, savedAt: Date.now() } satisfies Draft);
    const v = st.projectId ? await api.updateProject<EntityProjectView>(st.projectId, st.revision, state) : await api.createEntityProject(state);
    storage.set(PROJECT_KEY, v.project.id);
    useEntityEditor.getState().setSaved(v.project.id, v.project.revision, version, v.project.provenance, v.project.references);
  }, []);
  const onSaveState = useCallback((state: 'saving' | 'saved' | 'offline' | 'conflict' | 'error', message?: string) => {
    if (state !== 'saved') useEntityEditor.getState().setSaveState(state, message);
  }, []);
  const idProblem = checkEntityIdentifier(s.identifier);
  const dirty = s.version !== s.savedVersion;
  const { flush, unblock } = useAutosave({ enabled: phase === 'ready' && !idProblem, dirty, save, onState: onSaveState });

  // what the 3D view shows is the exporter's own output, parsed back
  const built = useMemo(() => {
    const report = validateEntityModel({ bones: s.bones, cubes: s.cubes });
    if (s.cubes.length === 0) return { report };
    try {
      const atlas = packAtlas(s.cubes);
      const { geo, cubeOrder } = buildGeometry({ bones: s.bones, cubes: s.cubes }, atlas, 'geometry.preview.model');
      return { report, atlas, render: geometryToRenderModel(geo), cubeOrder };
    } catch (e) {
      return { report, error: (e as Error).message };
    }
  }, [s.bones, s.cubes]);

  useEffect(() => {
    if (phase !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, dialog')) return;
      const st = useEntityEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedCubeId) {
        e.preventDefault();
        st.deleteCube(st.selectedCubeId);
      } else if (mod && e.key.toLowerCase() === 'd' && st.selectedCubeId) {
        e.preventDefault();
        st.duplicateCube(st.selectedCubeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  function start(choice: EntityStart) {
    const ns = defaultNamespace();
    const identifier = choice.suggestedIdentifier ?? `${ns}:${choice.slug}`;
    useEntityEditor.getState().loadProject(
      {
        projectId: null,
        revision: 0,
        displayName: choice.displayName,
        identifier,
        templateId: choice.templateId,
        bones: choice.model.bones,
        cubes: choice.model.cubes,
        behavior: { profile: 'wander', health: 20, movementSpeed: 0.25 },
        spawnEgg: choice.spawnEgg ?? { baseColor: '#5f9e4f', overlayColor: '#3d2b1f' },
        provenance: choice.provenance,
        references: [],
        sourceMeshArtifactId: undefined,
      },
      true,
    );
    storage.remove(PROJECT_KEY);
    unblock();
    setParams({}, { replace: true });
    setPhase('ready');
    setDialog(choice.then === 'mesh' ? 'mesh' : choice.then === 'ai' ? 'ai' : choice.then === 'photo' ? 'photo' : null);
    if (choice.then === 'photo') setTab('photos');
  }

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <Spinner label="Opening your last entity" />
      </div>
    );
  }

  if (phase === 'choose' || phase === 'restore') {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageMeta
          title="New custom entity"
          description="Build a spawnable Minecraft Bedrock custom entity (.mcaddon) from templates, skins, models or photos."
        />
        <nav aria-label="Breadcrumb" className="mb-3 text-sm">
          <Link to="/tools/character-builder">Character Builder</Link> <span className="text-muted">/ Custom entity</span>
        </nav>
        <h1 className="mb-4 text-3xl">New custom entity (Bedrock)</h1>
        {phase === 'restore' && draft && (
          <Callout tone="warn" title="Your last entity is no longer on the server" className="mb-4">
            <p className="mb-2">
              It may have expired or been deleted. This browser kept a draft from {new Date(draft.savedAt).toLocaleString()} (without reference photos).
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const st = draft.state;
                  useEntityEditor.getState().loadProject(
                    {
                      ...st,
                      projectId: null,
                      revision: 0,
                      references: [],
                      sourceMeshArtifactId: undefined,
                      provenance:
                        st.provenance.origin === 'ai'
                          ? { ...st.provenance, origin: 'import', notes: ['Restored from a local draft of an AI-assisted model.'] }
                          : st.provenance,
                    },
                    true,
                  );
                  setPhase('ready');
                }}
              >
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
        <NewEntityBody onStart={start} />
      </div>
    );
  }

  const selectedIndex = built.cubeOrder?.indexOf(s.selectedCubeId ?? '') ?? -1;
  return (
    <div className="mx-auto max-w-[96rem] px-3 py-4 sm:px-4">
      <PageMeta title="Entity editor" description="Edit a Minecraft Bedrock custom entity made of cuboids." />
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link to="/tools/character-builder">Character Builder</Link> <span className="text-muted">/ Custom entity</span>
      </nav>
      <ProjectBar
        kindLabel="Bedrock entity"
        name={s.displayName}
        onRename={(displayName) => s.setEntity({ displayName })}
        provenance={s.provenance}
        saveState={idProblem ? 'error' : s.saveState}
        saveMessage={idProblem ? `Not saved: fix the identifier (${idProblem}).` : s.saveMessage}
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
            <Button
              size="sm"
              onClick={async () => {
                unblock();
                fromView(await api.getProject<EntityProjectView>(s.projectId!));
              }}
            >
              Load the saved version (discard my changes)
            </Button>
            <Button
              size="sm"
              onClick={() => {
                unblock();
                useEntityEditor.getState().loadProject({ ...entityStateFrom(useEntityEditor.getState()), projectId: null, revision: 0 }, true);
                storage.remove(PROJECT_KEY);
              }}
            >
              Keep mine as a new project
            </Button>
          </div>
        </Callout>
      )}

      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)_22rem]">
        <Panel as="aside" className="p-3" aria-label="Model hierarchy">
          <h2 className="mb-2 text-lg">Model</h2>
          <Outliner />
          <div className="mt-3 flex flex-wrap gap-1">
            <Button size="sm" onClick={() => setDialog('mesh')}>
              Mesh / AI…
            </Button>
            <Button size="sm" onClick={() => setDialog('photo')}>
              Photo humanoid…
            </Button>
          </div>
        </Panel>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Camera views">
            {VIEWS.map((v) => (
              <Button key={v} size="sm" onClick={() => setView((p) => ({ preset: v, nonce: p.nonce + 1 }))}>
                {v[0]!.toUpperCase() + v.slice(1)}
              </Button>
            ))}
            <label className="ml-2 flex items-center gap-1 text-sm">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Grid & axes
            </label>
          </div>
          {built.render && built.atlas ? (
            <EntityViewport
              render={built.render}
              atlas={built.atlas}
              selectedIndex={selectedIndex}
              onSelectIndex={(i) => built.cubeOrder && s.select(built.cubeOrder[i] ?? null)}
              view={view}
              showGrid={showGrid}
              cubes={s.cubes}
              bones={s.bones}
            />
          ) : (
            <Callout tone={built.error ? 'error' : 'info'}>{built.error ?? 'The model has no cubes yet. Add one from the Model panel.'}</Callout>
          )}
          {!built.report.ok && (
            <div className="mt-2">
              <ValidationList report={built.report} hideInfo />
            </div>
          )}
          <p className="mt-1 text-xs text-muted">
            The preview renders the exact geometry and texture that the export writes. Front = the side that faces you when it spawns looking at you.
          </p>
        </div>
        <div className="space-y-4">
          <Panel className="p-3">
            <div className="mb-2 flex gap-1" role="tablist">
              {(['selection', 'entity', 'photos'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={cx('px-btn px-btn-sm', tab === t ? 'px-btn-primary' : 'px-btn-secondary')}
                  onClick={() => setTab(t)}
                >
                  {t === 'selection' ? 'Selection' : t === 'entity' ? 'Entity' : 'Photo colours'}
                </button>
              ))}
            </div>
            {tab === 'selection' && (
              <>
                <CubeInspector />
                <BoneInspector />
              </>
            )}
            {tab === 'entity' && <EntitySettings />}
            {tab === 'photos' && <PhotoPalette />}
          </Panel>
          <EntityExportPanel flush={flush} />
        </div>
      </div>

      <details className="px-panel mt-4 p-3" open={s.references.length > 0}>
        <summary className="font-pixel cursor-pointer text-lg">Reference photos</summary>
        <div className="mt-3">
          <ReferencePanel references={s.references} onChange={s.setReferences} />
        </div>
      </details>

      <MeshDialog
        open={dialog === 'mesh' || dialog === 'ai'}
        initialMode={dialog === 'ai' ? 'ai' : 'file'}
        onClose={() => setDialog(null)}
        projectId={s.projectId}
        revision={s.revision}
        references={s.references}
        ensureSaved={flush}
        onApplied={fromView}
      />
      <PhotoProjectionDialog
        open={dialog === 'photo'}
        onClose={() => setDialog(null)}
        model="classic"
        references={s.references}
        onReferencesChange={s.setReferences}
        applyLabel="Build humanoid from photos"
        onApply={(result) => {
          const m = skinToHumanoid(result.image, 'classic');
          useEntityEditor.getState().replaceModel(m, {
            templateId: 'humanoid',
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
      {s.projectId && (
        <HistoryDialog
          projectId={s.projectId}
          currentRevision={s.revision}
          open={dialog === 'history'}
          onClose={() => setDialog(null)}
          onRestore={async (rev) => {
            if (!(await flush())) return;
            const st = useEntityEditor.getState();
            fromView(await api.revert<EntityProjectView>(st.projectId!, st.revision, rev));
            setDialog(null);
          }}
        />
      )}
      <Dialog open={dialog === 'new'} onClose={() => setDialog(null)} title="Start a new entity" wide>
        <p className="mb-3 text-sm text-muted">Your current entity stays saved on the server for its retention period.</p>
        <NewEntityBody onStart={start} />
      </Dialog>
    </div>
  );
}

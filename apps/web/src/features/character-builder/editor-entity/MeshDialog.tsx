import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { Box3, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Bone, Cube, MeshResolution, ReferenceImage } from '@blockwright/shared';
import { buildGeometry, geometryToRenderModel, packAtlas } from '@blockwright/bedrock-export';
import { Button, Callout, ConfirmDialog, Dialog, cx } from '../../../components/ui';
import { api, ApiError, saveBlob, type EntityProjectView } from '../../../lib/api';
import { useProvider } from '../../../lib/useCapabilities';
import { hasWebGL } from '../../../lib/webgl';
import { ProviderStatusBadge } from '../components/CapabilityList';
import { JobProgress, useJob } from '../components/JobProgress';
import { ROLE_LABELS } from '../services/references';
import { EntityViewport } from './EntityViewport';

function FitCamera({ object }: { object: Object3D }) {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length() || 1;
    camera.position.copy(center.clone().add(new Vector3(0.6, 0.4, 1).normalize().multiplyScalar(size * 1.4)));
    const c = new OrbitControls(camera, gl.domElement);
    c.target.copy(center);
    c.update();
    c.addEventListener('change', () => invalidate());
    invalidate();
    return () => c.dispose();
  }, [object, camera, gl, invalidate]);
  return null;
}

/** Raw generic mesh preview. This is NOT a Minecraft model and is labelled so everywhere. */
function RawMeshPreview({ glb }: { glb: ArrayBuffer }) {
  const [scene, setScene] = useState<Object3D | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    new GLTFLoader().parse(glb, '', (g) => setScene(g.scene), (e) => setError(String((e as unknown as Error)?.message ?? e)));
  }, [glb]);
  if (error) return <Callout tone="error">Could not display the mesh: {error}</Callout>;
  if (!scene || !hasWebGL()) return null;
  return (
    <div className="px-inset h-64 w-full">
      <Canvas frameloop="demand" camera={{ fov: 40 }}>
        <ambientLight intensity={1.4} />
        <directionalLight position={[2, 4, 3]} intensity={1} />
        <primitive object={scene} />
        <FitCamera object={scene} />
      </Canvas>
    </div>
  );
}

function CuboidPreview({ bones, cubes }: { bones: Bone[]; cubes: Cube[] }) {
  const built = useMemo(() => {
    const atlas = packAtlas(cubes);
    const { geo } = buildGeometry({ bones, cubes }, atlas, 'geometry.preview.model');
    return { atlas, render: geometryToRenderModel(geo) };
  }, [bones, cubes]);
  return (
    <EntityViewport render={built.render} atlas={built.atlas} selectedIndex={-1} onSelectIndex={() => undefined} view={{ preset: 'iso', nonce: 0 }} showGrid cubes={cubes} bones={bones} />
  );
}

export function MeshDialog({
  open,
  initialMode,
  onClose,
  projectId,
  revision,
  references,
  ensureSaved,
  onApplied,
}: {
  open: boolean;
  initialMode: 'file' | 'ai';
  onClose: () => void;
  projectId: string | null;
  revision: number;
  references: ReferenceImage[];
  ensureSaved: () => Promise<boolean>;
  onApplied: (view: EntityProjectView) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const meshP = useProvider('mesh-cuboids-v1');
  const aiP = useProvider('triposr');
  const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState<string>(references.find((r) => r.isPrimary)?.role ?? references[0]?.role ?? 'front');
  const [removeBg, setRemoveBg] = useState(true);
  const [resolution, setResolution] = useState<MeshResolution>('medium');
  const [maxCubes, setMaxCubes] = useState(300);
  const [genJobId, setGenJobId] = useState<string | null>(null);
  const [convJobId, setConvJobId] = useState<string | null>(null);
  const [rawMesh, setRawMesh] = useState<{ id: string; glb: ArrayBuffer } | null>(null);
  const [model, setModel] = useState<{ bones: Bone[]; cubes: Cube[]; artifactId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const gen = useJob(genJobId);
  const conv = useJob(convJobId);

  useEffect(() => setMode(initialMode), [initialMode, open]);

  // generated mesh -> fetch for preview
  useEffect(() => {
    const id = gen.data?.status === 'ready' ? (gen.data.result?.meshArtifactId as string | undefined) : undefined;
    if (!id || rawMesh?.id === id) return;
    api
      .downloadArtifact(id)
      .then(async ({ blob }) => setRawMesh({ id, glb: await blob.arrayBuffer() }))
      .catch((e) => setError((e as Error).message));
  }, [gen.data, rawMesh]);

  // converted cuboids -> fetch for preview
  useEffect(() => {
    const id = conv.data?.status === 'ready' ? (conv.data.result?.cuboidArtifactId as string | undefined) : undefined;
    if (!id || model?.artifactId === id) return;
    api
      .downloadArtifact(id)
      .then(async ({ blob }) => setModel({ ...(JSON.parse(await blob.text()) as { bones: Bone[]; cubes: Cube[] }), artifactId: id }))
      .catch((e) => setError((e as Error).message));
  }, [conv.data, model]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      if (!(await ensureSaved()) || !projectId) throw new Error('Save the project first.');
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message} (${e.code})` : (e as Error).message);
    }
  };

  const convertFile = () =>
    run(async () => {
      if (!file) throw new Error('Choose a .glb or .obj file.');
      setModel(null);
      const { mesh } = await api.uploadMesh(file);
      const { job } = await api.createJob('mesh-to-cuboids', { projectId, source: { kind: 'mesh-asset', assetId: mesh.id }, resolution, maxCubes });
      setConvJobId(job.id);
    });

  const generate = () =>
    run(async () => {
      const ref = references.find((r) => r.role === role);
      if (!ref) throw new Error('Choose a reference photo.');
      setRawMesh(null);
      setModel(null);
      setConvJobId(null);
      const { job } = await api.createJob('mesh-generate', {
        projectId,
        imageAssetId: ref.temporaryAssetId,
        rotationDegrees: ref.rotationDegrees,
        ...(ref.crop ? { crop: ref.crop } : {}),
        removeBackground: removeBg,
      });
      setGenJobId(job.id);
    });

  const convertGenerated = () =>
    run(async () => {
      if (!rawMesh) return;
      setModel(null);
      const { job } = await api.createJob('mesh-to-cuboids', { projectId, source: { kind: 'artifact', artifactId: rawMesh.id }, resolution, maxCubes });
      setConvJobId(job.id);
    });

  async function apply() {
    setConfirm(false);
    try {
      const view = await api.applyResult<EntityProjectView>(projectId!, revision, model!.artifactId);
      onApplied(view);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const busy = (j?: { status: string }) => !!j && !['ready', 'failed', 'cancelled'].includes(j.status);
  return (
    <Dialog open={open} onClose={onClose} title="Mesh → Minecraft cuboids" wide>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        <button role="tab" aria-selected={mode === 'file'} className={cx('px-btn px-btn-sm', mode === 'file' ? 'px-btn-primary' : 'px-btn-secondary')} onClick={() => setMode('file')}>
          Convert a mesh file
        </button>
        <button role="tab" aria-selected={mode === 'ai'} className={cx('px-btn px-btn-sm', mode === 'ai' ? 'px-btn-primary' : 'px-btn-secondary')} onClick={() => setMode('ai')}>
          AI from a photo (TripoSR)
        </button>
      </div>

      {mode === 'file' && (
        <div className="mb-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">{meshP.provider && <ProviderStatusBadge p={meshP.provider} />} {meshP.provider?.reason}</div>
          <input type="file" accept=".glb,.obj,model/gltf-binary,text/plain" aria-label="Mesh file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-muted">glTF binary (+Y up, front facing +Z) or OBJ. The result is labelled Manual (imported mesh).</p>
        </div>
      )}
      {mode === 'ai' && (
        <div className="mb-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">{aiP.provider && <ProviderStatusBadge p={aiP.provider} />} {aiP.provider?.reason}</div>
          <Callout>TripoSR reconstructs a generic mesh from ONE photo. Other views are not used; hidden sides are guessed. The mesh is converted to cuboids before it can become an entity.</Callout>
          <label className="block">
            Photo
            <select className="px-input mt-1 max-w-sm" value={role} onChange={(e) => setRole(e.target.value)}>
              {references.map((r) => (
                <option key={r.role} value={r.role}>
                  {ROLE_LABELS[r.role]} ({r.originalName})
                </option>
              ))}
            </select>
          </label>
          {references.length === 0 && <p className="text-gold">Upload a reference photo first (Reference photos section).</p>}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Remove background automatically (rembg, part of TripoSR)
          </label>
          <Button variant="primary" disabled={!aiP.provider?.available || !references.length || busy(gen.data)} onClick={generate}>
            Generate 3D mesh with AI
          </Button>
          {gen.data && <JobProgress job={gen.data} onCancel={() => api.cancelJob(gen.data!.id)} />}
          {rawMesh && (
            <div>
              <p className="font-pixel text-gold">Raw AI mesh — NOT a Minecraft model (inspection only)</p>
              <RawMeshPreview glb={rawMesh.glb} />
              <Button size="sm" className="mt-1" onClick={() => saveBlob(new Blob([rawMesh.glb]), 'triposr-mesh.glb')}>
                Download raw .glb (not usable in Minecraft)
              </Button>
            </div>
          )}
        </div>
      )}

      <fieldset className="mb-3 flex flex-wrap items-end gap-4 text-sm">
        <label>
          Detail
          <select className="px-input mt-1" value={resolution} onChange={(e) => setResolution(e.target.value as MeshResolution)}>
            <option value="low">Low (12 voxels tall, chunky)</option>
            <option value="medium">Medium (16 voxels)</option>
            <option value="high">High (32 voxels)</option>
          </select>
        </label>
        <label>
          Cube budget
          <input type="number" className="px-input mt-1 w-28" min={8} max={512} value={maxCubes} onChange={(e) => setMaxCubes(Math.max(8, Math.min(512, Number(e.target.value) || 300)))} />
        </label>
        {mode === 'file' ? (
          <Button variant="primary" disabled={!file || !meshP.provider?.available || busy(conv.data)} onClick={convertFile}>
            Convert to cuboids
          </Button>
        ) : (
          <Button variant="primary" disabled={!rawMesh || busy(conv.data)} onClick={convertGenerated}>
            Convert AI mesh to cuboids
          </Button>
        )}
      </fieldset>
      {conv.data && <JobProgress job={conv.data} onCancel={() => api.cancelJob(conv.data!.id)} />}
      {conv.data?.status === 'ready' && Array.isArray(conv.data.result?.warnings) && (
        <ul className="mt-2 list-disc pl-5 text-sm text-gold">
          {(conv.data.result!.warnings as string[]).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {model && (
        <div className="mt-3">
          <p className="font-pixel mb-1">
            Minecraft cuboid result: {model.cubes.length} cubes (this is what will be exported)
          </p>
          <CuboidPreview bones={model.bones} cubes={model.cubes} />
          <Button className="mt-2" variant="primary" onClick={() => setConfirm(true)}>
            Use this model
          </Button>
        </div>
      )}
      {error && (
        <Callout tone="error" className="mt-3">
          {error}
        </Callout>
      )}
      <ConfirmDialog
        open={confirm}
        title="Replace your model with the converted cuboids?"
        message="Your current model stays in the project history and can be restored."
        confirmLabel="Use converted model"
        onCancel={() => setConfirm(false)}
        onConfirm={apply}
      />
    </Dialog>
  );
}

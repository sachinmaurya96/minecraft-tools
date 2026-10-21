import { useState } from 'react';
import { BONE_NAME_RE, checkEntityIdentifier, VOXEL_FACES, type Cube, type Vec3, type VoxelFace } from '@blockwright/shared';
import { FACE_LABELS } from '@blockwright/bedrock-export';
import { Button, cx } from '../../../components/ui';
import { FacePainterDialog } from './FacePainterDialog';
import { useEntityEditor } from './store';

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="block text-xs text-muted">
      {label}
      <input
        type="number"
        className="px-input mt-0.5 text-sm"
        step={step}
        min={min}
        max={max}
        value={text ?? String(value)}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.max(min ?? -512, Math.min(max ?? 512, v)));
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

function Vec3Field({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <fieldset className="mb-2">
      <legend className="text-sm text-ink">{label}</legend>
      <div className="grid grid-cols-3 gap-1">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <NumberField
            key={axis}
            label={axis.toUpperCase()}
            value={value[i]!}
            step={step}
            min={min}
            max={max}
            onChange={(v) => {
              const next = [...value] as Vec3;
              next[i] = v;
              onChange(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function EntitySettings() {
  const s = useEntityEditor();
  const [ns, slug] = s.identifier.split(':') as [string, string];
  const problem = checkEntityIdentifier(s.identifier);
  const setId = (n: string, sl: string) => s.setEntity({ identifier: `${n.toLowerCase()}:${sl.toLowerCase()}` });
  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        <span className="px-label">Display name (shown in game)</span>
        <input
          className="px-input"
          value={s.displayName}
          maxLength={48}
          onChange={(e) => s.setEntity({ displayName: e.target.value.replace(/[=\n\r\t]/g, '') })}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="px-label">Namespace</span>
          <input className="px-input font-mono" value={ns ?? ''} onChange={(e) => setId(e.target.value.replace(/[^a-z0-9_]/gi, ''), slug ?? '')} />
        </label>
        <label className="block">
          <span className="px-label">Entity name</span>
          <input className="px-input font-mono" value={slug ?? ''} onChange={(e) => setId(ns ?? '', e.target.value.replace(/[^a-z0-9_]/gi, ''))} />
        </label>
      </div>
      <p className={cx('font-mono text-xs', problem ? 'text-redstone' : 'text-muted')} role={problem ? 'alert' : undefined}>
        {problem ? problem : `Summon with /summon ${s.identifier}`}
      </p>
      <fieldset>
        <legend className="px-label">Behaviour</legend>
        <label className="mr-4 inline-flex items-center gap-2">
          <input type="radio" checked={s.behavior.profile === 'wander'} onChange={() => s.setBehavior({ profile: 'wander' })} />
          Wanders around
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" checked={s.behavior.profile === 'static'} onChange={() => s.setBehavior({ profile: 'static' })} />
          Stands still
        </label>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Health" value={s.behavior.health} min={1} max={200} onChange={(v) => s.setBehavior({ health: Math.round(v) })} />
        <NumberField
          label="Speed (0.25 = animal)"
          value={s.behavior.movementSpeed}
          step={0.05}
          min={0.05}
          max={0.5}
          onChange={(v) => s.setBehavior({ movementSpeed: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['baseColor', 'overlayColor'] as const).map((k) => (
          <label key={k} className="block text-xs text-muted">
            Spawn egg {k === 'baseColor' ? 'base' : 'spots'}
            <input
              type="color"
              className="mt-0.5 block h-8 w-full border-2 border-shadow bg-transparent"
              value={s.spawnEgg[k]}
              onChange={(e) => s.setEntity({ spawnEgg: { ...s.spawnEgg, [k]: e.target.value } })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function FaceRow({ cube, face, onPaint }: { cube: Cube; face: VoxelFace; onPaint: () => void }) {
  const s = useEntityEditor();
  const paint = cube.faces?.[face];
  const setFace = (p: NonNullable<Cube['faces']>[VoxelFace] | undefined) => {
    const faces = { ...(cube.faces ?? {}) };
    if (p) faces[face] = p;
    else delete faces[face];
    s.updateCube(cube.id, { faces });
  };
  const color = paint?.kind === 'color' ? paint.color.slice(0, 7) : cube.color;
  return (
    <li className="flex items-center gap-2 py-0.5 text-xs">
      <span className="w-28 text-muted">{FACE_LABELS[face]}</span>
      {paint?.kind === 'hidden' ? (
        <span className="text-muted">hidden</span>
      ) : paint?.kind === 'pixels' ? (
        <span className="text-gold">painted</span>
      ) : (
        <input
          type="color"
          aria-label={`${FACE_LABELS[face]} colour`}
          className="h-6 w-8 border border-shadow bg-transparent"
          value={color}
          onChange={(e) => setFace({ kind: 'color', color: e.target.value })}
        />
      )}
      <Button size="sm" onClick={onPaint} aria-label={`Paint pixels on ${FACE_LABELS[face]}`}>
        Paint
      </Button>
      {paint && (
        <Button size="sm" onClick={() => setFace(undefined)} aria-label={`Reset ${FACE_LABELS[face]} to cube colour`}>
          Reset
        </Button>
      )}
      {paint?.kind !== 'hidden' && (
        <Button
          size="sm"
          onClick={() => setFace({ kind: 'hidden' })}
          aria-label={`Hide ${FACE_LABELS[face]}`}
          title="Hidden faces are not drawn (use for faces nobody can see)"
        >
          Hide
        </Button>
      )}
    </li>
  );
}

export function CubeInspector() {
  const s = useEntityEditor();
  const cube = s.cubes.find((c) => c.id === s.selectedCubeId);
  const [painting, setPainting] = useState<VoxelFace | null>(null);
  if (!cube) return <p className="text-sm text-muted">Select a cube in the 3D view or the list to edit it.</p>;
  const merge = (key: string) => key;
  return (
    <div className="text-sm">
      <label className="mb-2 block">
        <span className="px-label">Cube name</span>
        <input className="px-input" value={cube.name ?? ''} maxLength={40} onChange={(e) => s.updateCube(cube.id, { name: e.target.value }, merge('name'))} />
      </label>
      <label className="mb-2 block">
        <span className="px-label">Bone</span>
        <select className="px-input" value={cube.boneId} onChange={(e) => s.updateCube(cube.id, { boneId: e.target.value })}>
          {s.bones.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <Vec3Field label="Position (min corner, px)" value={cube.origin} step={0.5} onChange={(v) => s.updateCube(cube.id, { origin: v }, merge('origin'))} />
      <Vec3Field
        label="Size (px; 16 px = 1 block)"
        value={cube.size}
        step={0.5}
        min={0}
        max={256}
        onChange={(v) => s.updateCube(cube.id, { size: v }, merge('size'))}
      />
      <Vec3Field
        label="Rotation (degrees)"
        value={cube.rotation ?? [0, 0, 0]}
        step={5}
        min={-180}
        max={180}
        onChange={(v) => s.updateCube(cube.id, { rotation: v }, merge('rotation'))}
      />
      <Vec3Field
        label="Rotation pivot (px)"
        value={cube.pivot ?? (cube.origin.map((o, i) => o + cube.size[i]! / 2) as Vec3)}
        step={0.5}
        onChange={(v) => s.updateCube(cube.id, { pivot: v }, merge('pivot'))}
      />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <NumberField
          label="Inflate (px)"
          value={cube.inflate ?? 0}
          step={0.25}
          min={-4}
          max={4}
          onChange={(v) => s.updateCube(cube.id, { inflate: v || undefined }, merge('inflate'))}
        />
        <label className="block text-xs text-muted">
          Cube colour
          <input
            type="color"
            className="mt-0.5 block h-8 w-full border-2 border-shadow bg-transparent"
            value={cube.color.slice(0, 7)}
            onChange={(e) => s.updateCube(cube.id, { color: e.target.value }, merge('color'))}
          />
        </label>
      </div>
      <p className="font-pixel mb-1">Faces</p>
      <ul>
        {VOXEL_FACES.map((f) => (
          <FaceRow key={f} cube={cube} face={f} onPaint={() => setPainting(f)} />
        ))}
      </ul>
      {painting && <FacePainterDialog cube={cube} face={painting} onClose={() => setPainting(null)} />}
    </div>
  );
}

export function BoneInspector() {
  const s = useEntityEditor();
  const bone = s.bones.find((b) => b.id === s.selectedBoneId);
  if (!bone || s.selectedCubeId) return null;
  const nameOk = BONE_NAME_RE.test(bone.name) && s.bones.filter((b) => b.name.toLowerCase() === bone.name.toLowerCase()).length === 1;
  return (
    <div className="text-sm">
      <label className="mb-2 block">
        <span className="px-label">Bone name</span>
        <input
          className={cx('px-input font-mono', !nameOk && 'border-redstone')}
          value={bone.name}
          maxLength={32}
          onChange={(e) => s.updateBone(bone.id, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') }, 'name')}
        />
        {!nameOk && <span className="text-xs text-redstone">Names must be unique and use letters, digits or underscores.</span>}
      </label>
      <label className="mb-2 block">
        <span className="px-label">Parent</span>
        <select className="px-input" value={bone.parentId ?? ''} onChange={(e) => s.updateBone(bone.id, { parentId: e.target.value || undefined })}>
          <option value="">(none — root bone)</option>
          {s.bones
            .filter((b) => b.id !== bone.id)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
      </label>
      <Vec3Field label="Pivot (px)" value={bone.pivot} step={0.5} onChange={(v) => s.updateBone(bone.id, { pivot: v }, 'pivot')} />
      <Vec3Field
        label="Rotation (degrees)"
        value={bone.rotation ?? [0, 0, 0]}
        step={5}
        min={-180}
        max={180}
        onChange={(v) => s.updateBone(bone.id, { rotation: v }, 'rotation')}
      />
      <Button size="sm" variant="danger" disabled={s.bones.length <= 1} onClick={() => s.deleteBone(bone.id)}>
        Delete bone (cubes move to parent)
      </Button>
    </div>
  );
}

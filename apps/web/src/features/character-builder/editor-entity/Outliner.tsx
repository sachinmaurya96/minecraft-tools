import { useMemo } from 'react';
import type { Bone } from '@blockwright/shared';
import { Button, cx } from '../../../components/ui';
import { useEntityEditor } from './store';

export function Outliner() {
  const s = useEntityEditor();
  const children = useMemo(() => {
    const m = new Map<string | undefined, Bone[]>();
    for (const b of s.bones) m.set(b.parentId, [...(m.get(b.parentId) ?? []), b]);
    return m;
  }, [s.bones]);

  const renderBone = (bone: Bone, depth: number) => {
    const cubes = s.cubes.filter((c) => c.boneId === bone.id);
    return (
      <li key={bone.id}>
        <button
          type="button"
          className={cx(
            'font-pixel flex w-full items-center gap-1 px-2 py-1 text-left text-sm hover:bg-panel-2',
            s.selectedBoneId === bone.id && !s.selectedCubeId && 'bg-panel-2 text-gold',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => s.select(null, bone.id)}
          aria-label={`Bone ${bone.name}`}
        >
          <span aria-hidden>▾</span> {bone.name}
        </button>
        <ul>
          {cubes.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={cx(
                  'flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-panel-2',
                  s.selectedCubeId === c.id && 'bg-panel-2 text-gold',
                )}
                style={{ paddingLeft: 24 + depth * 14 }}
                onClick={() => s.select(c.id, bone.id)}
                aria-label={`Cube ${c.name ?? c.id}`}
                aria-current={s.selectedCubeId === c.id}
              >
                <span aria-hidden className="inline-block h-3 w-3 border border-shadow" style={{ background: c.color }} />
                {c.name ?? c.id}
                <span className="ml-auto text-xs text-muted">{c.size.join('×')}</span>
              </button>
            </li>
          ))}
          {(children.get(bone.id) ?? []).map((b) => renderBone(b, depth + 1))}
        </ul>
      </li>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        <Button size="sm" disabled={!s.selectedBoneId} onClick={() => s.selectedBoneId && s.addCube(s.selectedBoneId)}>
          + Cube
        </Button>
        <Button size="sm" onClick={() => s.addBone(s.selectedBoneId ?? undefined)}>
          + Bone
        </Button>
        <Button size="sm" disabled={!s.selectedCubeId} onClick={() => s.selectedCubeId && s.duplicateCube(s.selectedCubeId)}>
          Duplicate
        </Button>
        <Button size="sm" variant="danger" disabled={!s.selectedCubeId} onClick={() => s.selectedCubeId && s.deleteCube(s.selectedCubeId)}>
          Delete cube
        </Button>
      </div>
      <ul className="px-inset max-h-[50vh] overflow-auto py-1" aria-label="Model hierarchy">
        {(children.get(undefined) ?? []).map((b) => renderBone(b, 0))}
      </ul>
      <p className="mt-1 text-xs text-muted">
        {s.cubes.length} cubes · {s.bones.length} bones
      </p>
    </div>
  );
}

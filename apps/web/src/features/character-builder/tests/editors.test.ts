import { beforeEach, describe, expect, it } from 'vitest';
import { createTemplateSkin, findRegion, mirrorPixel } from '@blockwright/minecraft-skin';
import { HUMANOID_TEMPLATE } from '@blockwright/bedrock-export';
import { erasePixels, fillRegion, linePoints, paintPixels } from '../editor-skin/paint';
import { useSkinEditor } from '../editor-skin/store';
import { useEntityEditor } from '../editor-entity/store';

const px = (p: Uint8ClampedArray, x: number, y: number) => Array.from(p.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));

describe('skin paint operations', () => {
  const base = createTemplateSkin('classic').data;

  it('pencil forces full opacity on the base layer but keeps alpha on the outer layer', () => {
    const r = paintPixels(
      base,
      'classic',
      [
        [9, 9],
        [41, 9],
      ],
      [10, 20, 30, 128],
      false,
    );
    expect(px(r.pixels, 9, 9)).toEqual([10, 20, 30, 255]); // head front (base)
    expect(px(r.pixels, 41, 9)).toEqual([10, 20, 30, 128]); // hat (overlay)
    expect(r.changed).toBe(2);
    expect(px(base, 9, 9)).not.toEqual([10, 20, 30, 255]); // input untouched (undo snapshots stay valid)
  });

  it('mirror paints the symmetric pixel on the other limb', () => {
    const r = paintPixels(base, 'classic', [[44, 20]], [1, 2, 3, 255], true);
    const m = mirrorPixel('classic', 44, 20)!;
    expect(px(r.pixels, m.x, m.y)).toEqual([1, 2, 3, 255]);
  });

  it('eraser refuses the base layer and clears the outer layer', () => {
    const withHat = paintPixels(base, 'classic', [[41, 9]], [9, 9, 9, 255], false).pixels;
    const r = erasePixels(
      withHat,
      'classic',
      [
        [9, 9],
        [41, 9],
      ],
      false,
    );
    expect(r.refused).toMatch(/base layer/);
    expect(px(r.pixels, 9, 9)[3]).toBe(255);
    expect(px(r.pixels, 41, 9)).toEqual([0, 0, 0, 0]);
  });

  it('fill stays inside the clicked face region', () => {
    const flat = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    const r = fillRegion(flat, 'classic', 9, 9, [5, 5, 5, 255], false);
    const front = findRegion('classic', 'head', 'base', 'front');
    expect(r.changed).toBe(front.w * front.h);
    expect(px(r.pixels, front.x - 1, front.y)).toEqual([255, 255, 255, 255]); // neighbouring face untouched
  });

  it('lines between pointer samples have no gaps', () => {
    expect(linePoints(0, 0, 3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
  });
});

describe('skin store', () => {
  beforeEach(() => {
    useSkinEditor.getState().loadProject({
      projectId: null,
      revision: 0,
      displayName: 't',
      model: 'classic',
      provenance: { origin: 'import', editedAfterGeneration: false, inferredRegions: [], notes: [] },
      references: [],
      pixels: createTemplateSkin('classic').data,
    });
  });

  it('one stroke is one undo step; redo restores; edits mark imported work as edited', () => {
    const s = useSkinEditor.getState();
    const before = s.pixels;
    s.beginStroke();
    s.applyTool([
      [9, 9],
      [10, 9],
    ]);
    expect(useSkinEditor.getState().provenance.editedAfterGeneration).toBe(true);
    const after = useSkinEditor.getState().pixels;
    useSkinEditor.getState().undo();
    expect(useSkinEditor.getState().pixels).toBe(before);
    useSkinEditor.getState().redo();
    expect(useSkinEditor.getState().pixels).toBe(after);
  });

  it('marks the project dirty after a change and clean after setSaved', () => {
    const s = useSkinEditor.getState();
    expect(s.version).toBe(s.savedVersion);
    s.beginStroke();
    s.applyTool([[9, 9]]);
    const v = useSkinEditor.getState().version;
    expect(v).not.toBe(useSkinEditor.getState().savedVersion);
    useSkinEditor.getState().setSaved('prj_x', 2, v);
    expect(useSkinEditor.getState().savedVersion).toBe(v);
  });
});

describe('entity store', () => {
  beforeEach(() => {
    const t = HUMANOID_TEMPLATE.build();
    useEntityEditor.getState().loadProject({ bones: t.bones, cubes: t.cubes, projectId: null, revision: 0 });
  });

  it('adds, duplicates and deletes cubes as undoable steps', () => {
    const s = useEntityEditor.getState();
    const n = s.cubes.length;
    s.addCube('body');
    expect(useEntityEditor.getState().cubes).toHaveLength(n + 1);
    useEntityEditor.getState().duplicateCube(useEntityEditor.getState().selectedCubeId!);
    expect(useEntityEditor.getState().cubes).toHaveLength(n + 2);
    useEntityEditor.getState().undo();
    useEntityEditor.getState().undo();
    expect(useEntityEditor.getState().cubes).toHaveLength(n);
  });

  it('coalesces rapid edits of the same field into one undo step', () => {
    const s = useEntityEditor.getState();
    s.updateCube('torso', { size: [9, 12, 4] }, 'size');
    useEntityEditor.getState().updateCube('torso', { size: [10, 12, 4] }, 'size');
    expect(useEntityEditor.getState().undoStack).toHaveLength(1);
    useEntityEditor.getState().undo();
    expect(useEntityEditor.getState().cubes.find((c) => c.id === 'torso')!.size).toEqual([8, 12, 4]);
  });

  it('refuses parent changes that would create a cycle', () => {
    useEntityEditor.getState().updateBone('body', { parentId: 'head' }); // head is a child of body
    expect(useEntityEditor.getState().bones.find((b) => b.id === 'body')!.parentId).toBeUndefined();
  });

  it('deleting a bone moves its cubes to the parent', () => {
    useEntityEditor.getState().deleteBone('head');
    const st = useEntityEditor.getState();
    expect(st.bones.some((b) => b.id === 'head')).toBe(false);
    expect(st.cubes.find((c) => c.id === 'head')!.boneId).toBe('body');
  });
});

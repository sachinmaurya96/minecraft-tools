import { create } from 'zustand';
import type { Bone, Cube, EntityBehavior, EntityProjectState, Provenance, ReferenceImage } from '@blockwright/shared';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

interface ModelSnapshot {
  bones: Bone[];
  cubes: Cube[];
}

const MAX_UNDO = 100;

export interface EntityEditorState extends Omit<EntityProjectState, 'sourceMeshArtifactId'> {
  sourceMeshArtifactId?: string;
  projectId: string | null;
  revision: number;
  version: number;
  savedVersion: number;
  saveState: SaveState;
  saveMessage?: string;
  undoStack: ModelSnapshot[];
  redoStack: ModelSnapshot[];
  lastMerge?: { key: string; at: number };
  selectedCubeId: string | null;
  selectedBoneId: string | null;

  loadProject(p: Partial<EntityEditorState> & Pick<EntityProjectState, 'bones' | 'cubes'>, dirty?: boolean): void;
  setSaved(projectId: string, revision: number, savedVersion: number, provenance?: Provenance, references?: ReferenceImage[]): void;
  setSaveState(s: SaveState, message?: string): void;
  /** Apply a model change as one undo step; consecutive edits with the same mergeKey within 1 s are merged. */
  commit(mutate: (m: ModelSnapshot) => ModelSnapshot, mergeKey?: string): void;
  updateCube(id: string, patch: Partial<Cube>, mergeKey?: string): void;
  updateBone(id: string, patch: Partial<Bone>, mergeKey?: string): void;
  addCube(boneId: string): void;
  duplicateCube(id: string): void;
  deleteCube(id: string): void;
  addBone(parentId?: string): void;
  deleteBone(id: string): void;
  replaceModel(m: ModelSnapshot, patch?: Partial<Pick<EntityEditorState, 'provenance' | 'templateId' | 'spawnEgg' | 'identifier'>>): void;
  setEntity(patch: Partial<Pick<EntityEditorState, 'displayName' | 'identifier' | 'behavior' | 'spawnEgg'>>): void;
  setBehavior(patch: Partial<EntityBehavior>): void;
  setReferences(refs: ReferenceImage[]): void;
  select(cubeId: string | null, boneId?: string | null): void;
  undo(): void;
  redo(): void;
}

let counter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

function markEdited(p: Provenance): Provenance {
  return p.origin === 'template' || p.origin === 'blank' || p.editedAfterGeneration ? p : { ...p, editedAfterGeneration: true };
}

function isDescendant(bones: Bone[], candidate: string, ancestor: string): boolean {
  let cur = bones.find((b) => b.id === candidate);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    if (cur.parentId === ancestor) return true;
    seen.add(cur.id);
    cur = bones.find((b) => b.id === cur!.parentId);
  }
  return false;
}

export const useEntityEditor = create<EntityEditorState>()((set, get) => ({
  displayName: 'My creature',
  identifier: 'my_addon:creature',
  templateId: 'humanoid',
  bones: [],
  cubes: [],
  behavior: { profile: 'wander', health: 20, movementSpeed: 0.25 },
  spawnEgg: { baseColor: '#3f7fbf', overlayColor: '#c9a27e' },
  provenance: { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] },
  references: [],
  projectId: null,
  revision: 0,
  version: 0,
  savedVersion: 0,
  saveState: 'idle',
  undoStack: [],
  redoStack: [],
  selectedCubeId: null,
  selectedBoneId: null,

  loadProject: (p, dirty = false) =>
    set((s) => ({
      ...p,
      projectId: p.projectId ?? null,
      revision: p.revision ?? 0,
      version: s.version + 1,
      savedVersion: dirty ? s.version : s.version + 1,
      saveState: dirty ? 'idle' : 'saved',
      saveMessage: undefined,
      undoStack: [],
      redoStack: [],
      selectedCubeId: p.cubes[0]?.id ?? null,
      selectedBoneId: p.cubes[0]?.boneId ?? p.bones[0]?.id ?? null,
    })),

  setSaved: (projectId, revision, savedVersion, provenance, references) =>
    set({
      projectId,
      revision,
      savedVersion,
      saveState: 'saved',
      saveMessage: undefined,
      ...(provenance ? { provenance } : {}),
      ...(references ? { references } : {}),
    }),

  setSaveState: (saveState, saveMessage) => set({ saveState, saveMessage }),

  commit: (mutate, mergeKey) => {
    const s = get();
    const now = Date.now();
    const merge = !!mergeKey && s.lastMerge?.key === mergeKey && now - s.lastMerge.at < 1000;
    const next = mutate({ bones: s.bones, cubes: s.cubes });
    set({
      ...next,
      undoStack: merge ? s.undoStack : [...s.undoStack.slice(-(MAX_UNDO - 1)), { bones: s.bones, cubes: s.cubes }],
      redoStack: [],
      version: s.version + 1,
      provenance: markEdited(s.provenance),
      lastMerge: mergeKey ? { key: mergeKey, at: now } : undefined,
    });
  },

  updateCube: (id, patch, mergeKey) =>
    get().commit((m) => ({ ...m, cubes: m.cubes.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), mergeKey && `cube:${id}:${mergeKey}`),

  updateBone: (id, patch, mergeKey) => {
    if (patch.parentId && (patch.parentId === id || isDescendant(get().bones, patch.parentId, id))) return; // no cycles
    get().commit((m) => ({ ...m, bones: m.bones.map((b) => (b.id === id ? { ...b, ...patch } : b)) }), mergeKey && `bone:${id}:${mergeKey}`);
  },

  addCube: (boneId) => {
    const bone = get().bones.find((b) => b.id === boneId);
    const id = newId('c');
    const cube: Cube = {
      id,
      boneId,
      origin: [bone ? bone.pivot[0] - 2 : -2, bone ? bone.pivot[1] : 0, bone ? bone.pivot[2] - 2 : -2],
      size: [4, 4, 4],
      color: '#9aa0a6',
      name: 'cube',
    };
    get().commit((m) => ({ ...m, cubes: [...m.cubes, cube] }));
    set({ selectedCubeId: id, selectedBoneId: boneId });
  },

  duplicateCube: (id) => {
    const src = get().cubes.find((c) => c.id === id);
    if (!src) return;
    const copy: Cube = { ...src, id: newId('c'), origin: [src.origin[0] + 1, src.origin[1], src.origin[2]], name: `${src.name ?? 'cube'} copy` };
    get().commit((m) => ({ ...m, cubes: [...m.cubes, copy] }));
    set({ selectedCubeId: copy.id });
  },

  deleteCube: (id) => {
    get().commit((m) => ({ ...m, cubes: m.cubes.filter((c) => c.id !== id) }));
    if (get().selectedCubeId === id) set({ selectedCubeId: null });
  },

  addBone: (parentId) => {
    const used = new Set(get().bones.map((b) => b.name.toLowerCase()));
    let n = 1;
    while (used.has(`bone${n}`)) n++;
    const parent = get().bones.find((b) => b.id === parentId);
    const bone: Bone = { id: newId('b'), name: `bone${n}`, pivot: parent ? [...parent.pivot] : [0, 0, 0], ...(parentId ? { parentId } : {}) };
    get().commit((m) => ({ ...m, bones: [...m.bones, bone] }));
    set({ selectedBoneId: bone.id, selectedCubeId: null });
  },

  /** Deleting a bone moves its cubes and child bones to its parent (or the first other bone). */
  deleteBone: (id) => {
    const s = get();
    const bone = s.bones.find((b) => b.id === id);
    if (!bone || s.bones.length <= 1) return;
    const heir = bone.parentId ?? s.bones.find((b) => b.id !== id)!.id;
    get().commit((m) => ({
      bones: m.bones
        .filter((b) => b.id !== id)
        .map((b) => (b.parentId === id ? { ...b, ...(bone.parentId ? { parentId: bone.parentId } : { parentId: undefined }) } : b)),
      cubes: m.cubes.map((c) => (c.boneId === id ? { ...c, boneId: heir } : c)),
    }));
    set({ selectedBoneId: heir });
  },

  replaceModel: (m, patch) =>
    set((s) => ({
      ...m,
      ...(patch ?? {}),
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), { bones: s.bones, cubes: s.cubes }],
      redoStack: [],
      version: s.version + 1,
      selectedCubeId: m.cubes[0]?.id ?? null,
      selectedBoneId: m.cubes[0]?.boneId ?? m.bones[0]?.id ?? null,
    })),

  setEntity: (patch) => set((s) => ({ ...patch, version: s.version + 1 })),
  setBehavior: (patch) => set((s) => ({ behavior: { ...s.behavior, ...patch }, version: s.version + 1 })),
  setReferences: (references) => set((s) => ({ references, version: s.version + 1 })),
  select: (cubeId, boneId) =>
    set((s) => ({ selectedCubeId: cubeId, selectedBoneId: boneId ?? s.cubes.find((c) => c.id === cubeId)?.boneId ?? s.selectedBoneId })),

  undo: () =>
    set((s) => {
      const prev = s.undoStack[s.undoStack.length - 1];
      if (!prev) return {};
      return {
        ...prev,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, { bones: s.bones, cubes: s.cubes }],
        version: s.version + 1,
        lastMerge: undefined,
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.redoStack[s.redoStack.length - 1];
      if (!next) return {};
      return {
        ...next,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { bones: s.bones, cubes: s.cubes }],
        version: s.version + 1,
        lastMerge: undefined,
      };
    }),
}));

export function entityStateFrom(s: EntityEditorState): EntityProjectState {
  return {
    displayName: s.displayName.trim() || 'My creature',
    identifier: s.identifier,
    templateId: s.templateId,
    bones: s.bones,
    cubes: s.cubes,
    behavior: s.behavior,
    spawnEgg: s.spawnEgg,
    provenance: s.provenance,
    references: s.references,
    ...(s.sourceMeshArtifactId ? { sourceMeshArtifactId: s.sourceMeshArtifactId } : {}),
  };
}

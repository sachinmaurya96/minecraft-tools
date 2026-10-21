import { create } from 'zustand';
import type { Provenance, ReferenceImage, Rgba, SkinModel } from '@blockwright/shared';
import type { BodyPart } from '@blockwright/minecraft-skin';
import { erasePixels, fillRegion, paintPixels, pickColor, type SkinPixels } from './paint';

export type SkinTool = 'pencil' | 'eraser' | 'fill' | 'picker';
export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict' | 'error';

const MAX_UNDO = 100;

export interface SkinEditorState {
  projectId: string | null;
  revision: number;
  displayName: string;
  model: SkinModel;
  provenance: Provenance;
  references: ReferenceImage[];
  pixels: SkinPixels;
  /** Bumped on every content change; autosave compares it to `savedVersion`. */
  version: number;
  savedVersion: number;
  saveState: SaveState;
  saveMessage?: string;
  undoStack: SkinPixels[];
  redoStack: SkinPixels[];
  tool: SkinTool;
  color: Rgba;
  recentColors: string[];
  mirror: boolean;
  showBase: boolean;
  showOverlay: boolean;
  hiddenParts: BodyPart[];
  showGrid: boolean;
  showGuides: boolean;
  showInferred: boolean;
  notice?: string;

  loadProject(p: {
    projectId: string | null;
    revision: number;
    displayName: string;
    model: SkinModel;
    provenance: Provenance;
    references: ReferenceImage[];
    pixels: SkinPixels;
    dirty?: boolean;
  }): void;
  setSaved(projectId: string, revision: number, savedVersion: number, provenance?: Provenance, references?: ReferenceImage[]): void;
  setSaveState(s: SaveState, message?: string): void;
  beginStroke(): void;
  applyTool(points: Array<[number, number]>): void;
  /** Replace the whole image as one undoable step (imports, photo projection, AI results...). */
  replacePixels(pixels: SkinPixels, patch?: Partial<Pick<SkinEditorState, 'provenance' | 'model'>>): void;
  undo(): void;
  redo(): void;
  set<K extends keyof SkinEditorState>(key: K, value: SkinEditorState[K]): void;
  setColor(c: Rgba): void;
  togglePart(part: BodyPart): void;
  setModel(m: SkinModel): void;
  setReferences(refs: ReferenceImage[]): void;
  setDisplayName(name: string): void;
}

const hex = (c: Rgba) =>
  `#${c
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;

function markEdited(p: Provenance): Provenance {
  return p.origin === 'template' || p.origin === 'blank' || p.editedAfterGeneration ? p : { ...p, editedAfterGeneration: true };
}

export const useSkinEditor = create<SkinEditorState>()((set, get) => ({
  projectId: null,
  revision: 0,
  displayName: 'My skin',
  model: 'classic',
  provenance: { origin: 'template', editedAfterGeneration: false, inferredRegions: [], notes: [] },
  references: [],
  pixels: new Uint8ClampedArray(64 * 64 * 4),
  version: 0,
  savedVersion: 0,
  saveState: 'idle',
  undoStack: [],
  redoStack: [],
  tool: 'pencil',
  color: [63, 143, 90, 255],
  recentColors: [],
  mirror: false,
  showBase: true,
  showOverlay: true,
  hiddenParts: [],
  showGrid: true,
  showGuides: true,
  showInferred: true,

  loadProject: (p) =>
    set((s) => ({
      projectId: p.projectId,
      revision: p.revision,
      displayName: p.displayName,
      model: p.model,
      provenance: p.provenance,
      references: p.references,
      pixels: p.pixels,
      version: s.version + 1,
      savedVersion: p.dirty ? s.version : s.version + 1,
      undoStack: [],
      redoStack: [],
      saveState: p.dirty ? 'idle' : 'saved',
      notice: undefined,
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

  beginStroke: () => set((s) => ({ undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), s.pixels], redoStack: [], notice: undefined })),

  applyTool: (points) => {
    const s = get();
    if (!points.length) return;
    if (s.tool === 'picker') {
      const [x, y] = points[points.length - 1]!;
      const c = pickColor(s.pixels, x, y);
      if (c) get().setColor(c);
      return;
    }
    const res =
      s.tool === 'pencil'
        ? paintPixels(s.pixels, s.model, points, s.color, s.mirror)
        : s.tool === 'eraser'
          ? erasePixels(s.pixels, s.model, points, s.mirror)
          : fillRegion(s.pixels, s.model, points[0]![0], points[0]![1], s.color, s.mirror);
    if (res.changed === 0) {
      if (res.refused) set({ notice: res.refused });
      return;
    }
    set({ pixels: res.pixels, version: s.version + 1, provenance: markEdited(s.provenance), ...(res.refused ? { notice: res.refused } : {}) });
  },

  replacePixels: (pixels, patch) =>
    set((s) => ({
      undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), s.pixels],
      redoStack: [],
      pixels,
      version: s.version + 1,
      ...(patch ?? {}),
    })),

  undo: () =>
    set((s) => {
      const prev = s.undoStack[s.undoStack.length - 1];
      if (!prev) return {};
      return { pixels: prev, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, s.pixels], version: s.version + 1 };
    }),

  redo: () =>
    set((s) => {
      const next = s.redoStack[s.redoStack.length - 1];
      if (!next) return {};
      return { pixels: next, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, s.pixels], version: s.version + 1 };
    }),

  set: (key, value) => set({ [key]: value } as Partial<SkinEditorState>),

  setColor: (c) =>
    set((s) => ({
      color: c,
      recentColors: [hex(c), ...s.recentColors.filter((h) => h !== hex(c))].slice(0, 12),
      tool: s.tool === 'picker' ? 'pencil' : s.tool,
    })),

  togglePart: (part) => set((s) => ({ hiddenParts: s.hiddenParts.includes(part) ? s.hiddenParts.filter((p) => p !== part) : [...s.hiddenParts, part] })),

  setModel: (model) => set((s) => (s.model === model ? {} : { model, version: s.version + 1 })),

  setReferences: (references) => set((s) => ({ references, version: s.version + 1 })),

  setDisplayName: (displayName) => set((s) => ({ displayName, version: s.version + 1 })),
}));

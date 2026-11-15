import { create } from 'zustand';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  createProject,
  projectDuration,
  redo as redoHistory,
  undo as undoHistory,
  type Frame,
  type History,
  type Project,
  type MediaDTO,
  type TemplateDefinition,
  type UploadedBy,
} from '@ve/core';

export interface LibraryTemplate {
  def: TemplateDefinition;
  thumbnail: string | null;
  builtIn: boolean;
  /** For shared libraries: who added the template. */
  uploadedBy?: UploadedBy;
  /** Display order (manifest order for built-ins, import order for user files). */
  order: number;
}

export type DragPayload =
  | { type: 'template'; id: string; label: string; thumbnail: string | null }
  | { type: 'media'; id: string; label: string; thumbnail: string | null }
  | { type: 'image'; id: string; label: string; thumbnail: string | null }
  | { type: 'audio'; id: string; label: string; thumbnail: string | null }
  | { type: 'text'; id: string; label: string; thumbnail: string | null };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
}

export interface DropTarget {
  trackId: string | null; // null → create a new track of the right kind
  frame: Frame;
  duration: Frame;
}

/** Where the template library comes from on this page. */
export type LibraryInfo =
  | { kind: 'loading' }
  | { kind: 'demo' }
  | { kind: 'share'; name: string; token: string; allowUploads: boolean }
  | { kind: 'error'; message: string };

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

/** The saved composition being edited (customer mode). */
export interface OpenComposition {
  token: string;
  id: string;
  name: string;
  revision: number;
}

export type SaveState =
  | { kind: 'saved'; at: number }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' };

export interface Upload {
  id: string;
  name: string;
  progress: number;
}

interface EditorState {
  history: History;
  /** Uncommitted project shown while dragging/trimming. */
  draft: Project | null;
  selection: string | null;
  playhead: Frame;
  playing: boolean;
  /** Timeline zoom in pixels per second. */
  zoom: number;
  templates: LibraryTemplate[];
  templatesLoading: boolean;
  library: LibraryInfo;
  mediaThumbs: Record<string, string>;
  drag: DragState | null;
  dropTarget: DropTarget | null;
  exportOpen: boolean;
  toasts: Toast[];
  composition: OpenComposition | null;
  saveState: SaveState;
  /** Media stored in the customer project (shared by all its compositions). */
  serverMedia: MediaDTO[];
  uploads: Upload[];

  apply: (fn: (p: Project) => Project, label: string, mergeKey?: string) => void;
  setDraft: (p: Project | null) => void;
  commitDraft: (label: string) => void;
  undo: () => void;
  redo: () => void;
  select: (clipId: string | null) => void;
  setPlayhead: (f: Frame) => void;
  setPlaying: (v: boolean) => void;
  setZoom: (z: number) => void;
  setTemplates: (t: LibraryTemplate[]) => void;
  addTemplate: (t: LibraryTemplate) => void;
  setTemplatesLoading: (v: boolean) => void;
  setLibrary: (l: LibraryInfo) => void;
  setMediaThumb: (assetId: string, url: string) => void;
  setDrag: (d: DragState | null) => void;
  setDropTarget: (t: DropTarget | null) => void;
  setExportOpen: (v: boolean) => void;
  /** Replace the whole document (opening a composition); clears undo history. */
  loadProject: (p: Project) => void;
  setComposition: (c: OpenComposition | null) => void;
  setSaveState: (s: SaveState) => void;
  setServerMedia: (m: MediaDTO[]) => void;
  setUpload: (u: Upload) => void;
  endUpload: (id: string) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

export const MIN_ZOOM = 4;
export const MAX_ZOOM = 600;
let toastId = 0;

export const useEditor = create<EditorState>()((set, get) => ({
  history: createHistory(createProject()),
  draft: null,
  selection: null,
  playhead: 0,
  playing: false,
  zoom: 60,
  templates: [],
  templatesLoading: true,
  library: { kind: 'loading' },
  mediaThumbs: {},
  drag: null,
  dropTarget: null,
  exportOpen: false,
  toasts: [],
  composition: null,
  saveState: { kind: 'saved', at: 0 },
  serverMedia: [],
  uploads: [],

  apply: (fn, label, mergeKey) => {
    const { history } = get();
    let next: Project;
    try {
      next = fn(history.present.project);
    } catch (e) {
      get().toast(e instanceof Error ? e.message : String(e), 'error');
      return;
    }
    set({ history: commit(history, next, label, mergeKey), draft: null });
  },
  setDraft: (p) => set({ draft: p }),
  commitDraft: (label) => {
    const { draft, history } = get();
    if (!draft) return;
    set({ history: commit(history, draft, label), draft: null });
  },
  undo: () => {
    const h = get().history;
    if (canUndo(h)) set({ history: undoHistory(h), draft: null });
  },
  redo: () => {
    const h = get().history;
    if (canRedo(h)) set({ history: redoHistory(h), draft: null });
  },
  select: (clipId) => set({ selection: clipId }),
  setPlayhead: (f) => set({ playhead: Math.max(0, Math.round(f)) }),
  setPlaying: (v) => set({ playing: v }),
  setZoom: (z) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) }),
  setTemplates: (t) => set({ templates: t }),
  addTemplate: (t) =>
    set({ templates: [...get().templates.filter((x) => x.def.id !== t.def.id), t].sort((a, b) => a.order - b.order) }),
  setTemplatesLoading: (v) => set({ templatesLoading: v }),
  setLibrary: (l) => set({ library: l }),
  setMediaThumb: (assetId, url) => set({ mediaThumbs: { ...get().mediaThumbs, [assetId]: url } }),
  setDrag: (d) => set({ drag: d }),
  setDropTarget: (t) => set({ dropTarget: t }),
  setExportOpen: (v) => set({ exportOpen: v }),
  loadProject: (p) => set({ history: createHistory(p), draft: null, selection: null, playhead: 0 }),
  setComposition: (c) => set({ composition: c }),
  setSaveState: (s) => set({ saveState: s }),
  setServerMedia: (m) => set({ serverMedia: m }),
  setUpload: (u) => set({ uploads: [...get().uploads.filter((x) => x.id !== u.id), u] }),
  endUpload: (id) => set({ uploads: get().uploads.filter((x) => x.id !== id) }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** The project to display: the draft while editing, else the committed one. */
export function useProject(): Project {
  return useEditor((s) => s.draft ?? s.history.present.project);
}

export function currentProject(): Project {
  const s = useEditor.getState();
  return s.draft ?? s.history.present.project;
}

export function committedProject(): Project {
  return useEditor.getState().history.present.project;
}

export function useProjectDuration(): Frame {
  return useEditor((s) => projectDuration(s.draft ?? s.history.present.project));
}

/** Expose the store for automated tests and debugging. */
if (typeof window !== 'undefined') (window as unknown as { __editor: typeof useEditor }).__editor = useEditor;

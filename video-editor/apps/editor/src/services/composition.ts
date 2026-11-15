import { PROJECT_VERSION, type MediaDTO, type Project } from '@ve/core';
import { ApiError, ConflictError, customerApi } from './api';
import { media } from './media';
import { useEditor } from '../state/store';

const SAVE_DELAY_MS = 1000;
const RETRY_DELAY_MS = 5000;
const THUMB_INTERVAL_MS = 15_000;
const THUMB_WIDTH = 480;

/**
 * Persistence for a customer composition: load, autosave with optimistic
 * concurrency (revision numbers), conflict handling and thumbnails.
 */
class CompositionSession {
  private savedProject: Project | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private unsub: (() => void) | null = null;
  private lastThumb = 0;

  async open(token: string, id: string): Promise<void> {
    const store = useEditor.getState();
    const [comp, mediaList] = await Promise.all([customerApi.composition(token, id), customerApi.media(token)]);
    const project = comp.project as Project;
    if (!project || project.version !== PROJECT_VERSION) throw new Error('Kompositionen har ett okänt format');
    this.registerMedia(mediaList);
    store.setServerMedia(mediaList);
    store.loadProject(project);
    store.setComposition({ token, id, name: comp.name, revision: comp.revision });
    store.setSaveState({ kind: 'saved', at: Date.parse(comp.updatedAt) });
    this.savedProject = project;
    this.lastThumb = comp.thumbnailUrl ? Date.now() : 0;
    this.watch();
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  registerMedia(list: MediaDTO[]) {
    for (const m of list) media.registerRemote(m.id, m.url, m.name, m.size);
  }

  private watch() {
    this.unsub?.();
    this.unsub = useEditor.subscribe((s, prev) => {
      if (!s.composition) return;
      const p = s.history.present.project;
      if (p === prev.history.present.project || p === this.savedProject) return;
      if (s.saveState.kind === 'conflict') return; // wait for the user's decision
      if (s.saveState.kind !== 'saving') s.setSaveState({ kind: 'dirty' });
      this.schedule(SAVE_DELAY_MS);
    });
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), ms);
  }

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    const k = useEditor.getState().saveState.kind;
    if (k === 'dirty' || k === 'saving' || k === 'error') {
      void this.save();
      e.preventDefault();
    }
  };

  /** Save now if there are unsaved changes. */
  async save(force = false): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inFlight) {
      await this.inFlight;
      if (!force && useEditor.getState().history.present.project === this.savedProject) return;
    }
    const s = useEditor.getState();
    const comp = s.composition;
    if (!comp) return;
    const project = s.history.present.project;
    if (!force && project === this.savedProject) return;
    if (s.saveState.kind === 'conflict' && !force) return;

    s.setSaveState({ kind: 'saving' });
    this.inFlight = (async () => {
      try {
        const res = await customerApi.saveComposition(comp.token, comp.id, comp.revision, project);
        this.savedProject = project;
        const st = useEditor.getState();
        st.setComposition({ ...comp, revision: res.revision });
        const dirty = st.history.present.project !== project;
        st.setSaveState(dirty ? { kind: 'dirty' } : { kind: 'saved', at: Date.now() });
        if (dirty) this.schedule(SAVE_DELAY_MS);
        if (Date.now() - this.lastThumb > THUMB_INTERVAL_MS) void this.uploadThumbnail();
      } catch (e) {
        const st = useEditor.getState();
        if (e instanceof ConflictError) {
          st.setSaveState({ kind: 'conflict' });
        } else {
          st.setSaveState({ kind: 'error', message: e instanceof ApiError ? e.message : 'Kunde inte spara' });
          this.schedule(RETRY_DELAY_MS);
        }
      } finally {
        this.inFlight = null;
      }
    })();
    await this.inFlight;
  }

  /** Wait until everything is saved (e.g. before leaving the editor). */
  async flush(): Promise<boolean> {
    await this.save();
    const k = useEditor.getState().saveState.kind;
    return k === 'saved';
  }

  /** After a conflict: keep this version (overwrite) or load the other one. */
  async resolveConflict(choice: 'overwrite' | 'reload'): Promise<void> {
    const s = useEditor.getState();
    const comp = s.composition;
    if (!comp) return;
    if (choice === 'reload') {
      await this.open(comp.token, comp.id);
      return;
    }
    const latest = await customerApi.composition(comp.token, comp.id);
    s.setComposition({ ...comp, revision: latest.revision });
    s.setSaveState({ kind: 'dirty' });
    await this.save(true);
  }

  async rename(name: string): Promise<void> {
    const s = useEditor.getState();
    const comp = s.composition;
    if (!comp || !name.trim() || name === comp.name) return;
    try {
      await customerApi.renameComposition(comp.token, comp.id, name.trim());
      s.setComposition({ ...useEditor.getState().composition!, name: name.trim() });
    } catch (e) {
      s.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  /** Snapshot of the viewer, shown in the project manager. */
  async uploadThumbnail(): Promise<void> {
    const comp = useEditor.getState().composition;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]');
    if (!comp || !canvas || canvas.width < 2) return;
    this.lastThumb = Date.now();
    try {
      const h = Math.round((THUMB_WIDTH * canvas.height) / canvas.width);
      const off = new OffscreenCanvas(THUMB_WIDTH, h);
      off.getContext('2d')!.drawImage(canvas, 0, 0, THUMB_WIDTH, h);
      const blob = await off.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
      await customerApi.uploadThumbnail(comp.token, comp.id, blob);
    } catch (e) {
      console.warn('Miniatyr kunde inte sparas', e);
    }
  }

  close() {
    this.unsub?.();
    this.unsub = null;
    if (this.timer) clearTimeout(this.timer);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }
}

export const composition = new CompositionSession();

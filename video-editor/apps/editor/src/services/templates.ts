import riveWasmUrl from '@rive-app/canvas-advanced/rive.wasm?url';
import type { TemplateDefinition, TemplateManifest } from '@ve/core';
import { loadRiveRuntime, renderTemplateThumbnail, TemplateRegistry, type RiveCanvas } from '@ve/rive';
import { useEditor, type LibraryTemplate } from '../state/store';

export const RIVE_WASM_URL = new URL(riveWasmUrl, location.href).href;

const THUMB_W = 320;
const THUMB_H = 180;

/**
 * Templates on the main thread: loading the built-in library, importing
 * user .riv files and rendering thumbnails.
 */
class TemplateService {
  private ready: Promise<{ rive: RiveCanvas; registry: TemplateRegistry }> | null = null;
  private imported = 0;

  init() {
    this.ready ??= (async () => {
      const rive = await loadRiveRuntime(RIVE_WASM_URL);
      return { rive, registry: new TemplateRegistry(rive) };
    })();
    return this.ready;
  }

  async registry(): Promise<TemplateRegistry> {
    return (await this.init()).registry;
  }

  /** Load the templates listed in /templates/index.json. */
  async loadBuiltIns(): Promise<void> {
    const store = useEditor.getState();
    store.setTemplatesLoading(true);
    try {
      const base = new URL('templates/', new URL(import.meta.env.BASE_URL, location.href));
      const index = (await (await fetch(new URL('index.json', base))).json()) as { templates: TemplateManifest[] };
      const fileCache = new Map<string, Promise<Uint8Array>>();
      const load = (file: string) => {
        let p = fileCache.get(file);
        if (!p) {
          p = fetch(new URL(file, base)).then(async (r) => {
            if (!r.ok) throw new Error(`${file}: ${r.status}`);
            return new Uint8Array(await r.arrayBuffer());
          });
          fileCache.set(file, p);
        }
        return p;
      };
      const results = await Promise.allSettled(
        index.templates.map(async (m, i) => this.add(await load(m.file), m, m.id ?? m.file, true, i)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) console.warn('Mallar som inte kunde laddas', failed.map((f) => String((f as PromiseRejectedResult).reason)));
    } catch (e) {
      store.toast('Kunde inte ladda mallbiblioteket', 'error');
      console.error(e);
    } finally {
      useEditor.getState().setTemplatesLoading(false);
    }
  }

  /** Import a .riv file chosen by the user. */
  async importFile(file: File): Promise<TemplateDefinition> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/\.riv$/i, '');
    const id = `user-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${bytes.length.toString(36)}`;
    return this.add(bytes, { file: file.name, name, category: 'Mina mallar' }, id, false, 1000 + this.imported++);
  }

  private async add(bytes: Uint8Array, manifest: TemplateManifest, id: string, builtIn: boolean, order: number): Promise<TemplateDefinition> {
    const { rive, registry } = await this.init();
    const def = await registry.add({ id, bytes, manifest });
    let thumbnail: string | null = null;
    try {
      const entry = registry.get(def.id)!;
      const blob = await renderTemplateThumbnail(rive, entry.file, def, THUMB_W, THUMB_H);
      thumbnail = URL.createObjectURL(blob);
    } catch (e) {
      console.warn('Miniatyr misslyckades', def.id, e);
    }
    const item: LibraryTemplate = { def, thumbnail, builtIn, order };
    useEditor.getState().addTemplate(item);
    return def;
  }
}

export const templates = new TemplateService();

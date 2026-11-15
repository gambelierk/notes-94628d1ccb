import { settingsToManifest, type TemplateDTO, type TemplateDefinition } from '@ve/core';
import { inspectTemplate, loadRiveFile, renderTemplateThumbnail, type RiveFile } from '@ve/rive';
import { api } from '../services/api';
import { templates } from '../services/templates';

export interface AdminInspection {
  artboards: string[];
  def: TemplateDefinition | null;
  thumbnail: string | null;
  error: string | null;
}

const files = new Map<string, Promise<RiveFile>>();

function riveFile(t: TemplateDTO): Promise<RiveFile> {
  let p = files.get(t.sha256);
  if (!p) {
    p = (async () => {
      const { rive } = await templates.init();
      const r = await fetch(api.templateFileUrl(t.id), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`Filen kunde inte hämtas (${r.status})`);
      return loadRiveFile(rive, new Uint8Array(await r.arrayBuffer()));
    })();
    p.catch(() => files.delete(t.sha256));
    files.set(t.sha256, p);
  }
  return p;
}

/**
 * Inspect an uploaded template in the browser with the same code the editor
 * uses: which artboards exist, which fields the customer will be able to
 * edit, how it animates, and a thumbnail.
 */
export async function inspectForAdmin(t: TemplateDTO): Promise<AdminInspection> {
  try {
    const { rive } = await templates.init();
    const file = await riveFile(t);
    const artboards: string[] = [];
    for (let i = 0; i < file.artboardCount(); i++) {
      const ab = file.artboardByIndex(i);
      artboards.push(ab.name);
      ab.delete();
    }
    // Inspect without field overrides so the admin sees every field the file exposes.
    const def = inspectTemplate(file, settingsToManifest({ ...t, fields: null }, t.fileName, t.id), t.id);
    const blob = await renderTemplateThumbnail(rive, file, def, 320, 180);
    return { artboards, def, thumbnail: URL.createObjectURL(blob), error: null };
  } catch (e) {
    return { artboards: [], def: null, thumbnail: null, error: e instanceof Error ? e.message : String(e) };
  }
}

import {
  findAsset,
  mediaPlacement,
  templatePlacement,
  textPlacement,
  transformAt,
  type Clip,
  type Placement,
  type Project,
} from '@ve/core';
import { layoutText } from '@ve/render';
import type { LibraryTemplate } from '../state/store';

/** Natural size of a visual clip's content (before transform), in pixels. Null for sound-only clips. */
export function sourceSize(project: Project, clip: Clip, templates: LibraryTemplate[]): { w: number; h: number } | null {
  if (clip.kind === 'video' || clip.kind === 'image') {
    const a = findAsset(project, clip.assetId);
    return a && a.kind !== 'audio' ? { w: a.width, h: a.height } : null;
  }
  if (clip.kind === 'text') {
    const L = layoutText(clip.text, clip.style, project.settings.width, project.settings.height);
    return { w: L.width, h: L.height };
  }
  if (clip.kind === 'audio') return null;
  const def = templates.find((t) => t.def.id === clip.templateId)?.def;
  return def ? { w: def.width, h: def.height } : null;
}

/** Where a clip is drawn in the output frame (project pixels). Same math as the renderer. */
export function clipPlacement(project: Project, clip: Clip, templates: LibraryTemplate[]): Placement | null {
  const { width: W, height: H } = project.settings;
  if (clip.kind === 'audio') return null;
  const t = transformAt(clip);
  if (clip.kind === 'template') {
    const def = templates.find((x) => x.def.id === clip.templateId)?.def;
    if (!def) return null;
    return templatePlacement(def.layout, def.width, def.height, W, H, t);
  }
  const s = sourceSize(project, clip, templates);
  if (!s) return null;
  return clip.kind === 'text' ? textPlacement(s.w, s.h, W, H, t) : mediaPlacement(s.w, s.h, W, H, t);
}

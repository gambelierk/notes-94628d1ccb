import {
  findAsset,
  mediaPlacement,
  templatePlacement,
  transformAt,
  type Clip,
  type Placement,
  type Project,
} from '@ve/core';
import type { LibraryTemplate } from '../state/store';

/** Natural size of a visual clip's content (before transform), in pixels. */
export function sourceSize(project: Project, clip: Clip, templates: LibraryTemplate[]): { w: number; h: number } | null {
  if (clip.kind === 'video' || clip.kind === 'image') {
    const a = findAsset(project, clip.assetId);
    return a ? { w: a.width, h: a.height } : null;
  }
  const def = templates.find((t) => t.def.id === clip.templateId)?.def;
  return def ? { w: def.width, h: def.height } : null;
}

/** Where a clip is drawn in the output frame (project pixels). Same math as the renderer. */
export function clipPlacement(project: Project, clip: Clip, templates: LibraryTemplate[]): Placement | null {
  const { width: W, height: H } = project.settings;
  const t = transformAt(clip);
  if (clip.kind === 'template') {
    const def = templates.find((x) => x.def.id === clip.templateId)?.def;
    if (!def) return null;
    return templatePlacement(def.layout, def.width, def.height, W, H, t);
  }
  const s = sourceSize(project, clip, templates);
  return s ? mediaPlacement(s.w, s.h, W, H, t) : null;
}

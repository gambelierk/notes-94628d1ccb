import { findAsset, type Clip, type Project } from '@ve/core';
import type { LibraryTemplate } from '../state/store';

/** A short human name for a clip, for labels and screen readers. */
export function clipName(project: Project, clip: Clip | undefined, templates: LibraryTemplate[]): string {
  if (!clip) return 'klippet';
  if (clip.kind === 'text') return `”${clip.text.split('\n')[0]}”`;
  if (clip.kind === 'template') return templates.find((t) => t.def.id === clip.templateId)?.def.name ?? 'mallen';
  return findAsset(project, clip.assetId)?.name ?? 'klippet';
}

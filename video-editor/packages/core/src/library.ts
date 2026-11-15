import type { TemplateLayout, TemplateManifest } from './template';

/**
 * Shapes exchanged between the server and the editor/admin UI.
 * A "workspace" is a customer project (kundprojekt): a set of templates
 * that can be shared with one customer through a secret link.
 */

export interface WorkspaceDTO {
  id: string;
  name: string;
  shareToken: string;
  sharingEnabled: boolean;
  /** May the customer upload their own .riv templates to this project? */
  allowCustomerUploads: boolean;
  templateCount: number;
  compositionCount: number;
  mediaCount: number;
  /** Bytes used by the customer's uploaded media. */
  mediaBytes: number;
  createdAt: string;
  updatedAt: string;
}

export type UploadedBy = 'admin' | 'customer';

/** Per-field override: a customer-friendly label, or hide the field entirely. */
export interface FieldOverride {
  key: string;
  label?: string;
  hidden?: boolean;
}

/** Settings an admin can change per template. */
export interface TemplateSettings {
  name: string;
  category: string;
  artboard: string | null;
  defaultDuration: number | null;
  layout: TemplateLayout | null;
  fields: FieldOverride[] | null;
}

export interface TemplateDTO extends TemplateSettings {
  id: string;
  workspaceId: string;
  uploadedBy: UploadedBy;
  fileName: string;
  size: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedTemplateDTO {
  id: string;
  uploadedBy: UploadedBy;
  /** URL of the .riv file, relative to the site root. */
  url: string;
  sha256: string;
  manifest: TemplateManifest;
}

export interface SharedLibraryDTO {
  workspace: { id: string; name: string; allowCustomerUploads: boolean };
  templates: SharedTemplateDTO[];
}

/** A saved edit ("composition"): one timeline with its own media and templates. */
export interface CompositionSummaryDTO {
  id: string;
  name: string;
  revision: number;
  width: number;
  height: number;
  durationSeconds: number;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompositionDTO extends CompositionSummaryDTO {
  /** The serialised editor project (see `Project` in types.ts). */
  project: unknown;
}

export interface MediaDTO {
  id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: string;
}

export function settingsToManifest(s: TemplateSettings, file: string, id: string): TemplateManifest {
  return {
    id,
    file,
    name: s.name,
    category: s.category,
    ...(s.artboard ? { artboard: s.artboard } : {}),
    ...(s.defaultDuration ? { defaultDuration: s.defaultDuration } : {}),
    ...(s.layout ? { layout: s.layout } : {}),
    ...(s.fields?.length ? { fields: s.fields } : {}),
  };
}

export const LAYOUT_ANCHORS: TemplateLayout['anchor'][] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

export function isValidLayout(v: unknown): v is TemplateLayout {
  if (!v || typeof v !== 'object') return false;
  const l = v as Record<string, unknown>;
  return (
    LAYOUT_ANCHORS.includes(l.anchor as TemplateLayout['anchor']) &&
    typeof l.widthPercent === 'number' &&
    l.widthPercent > 0 &&
    l.widthPercent <= 100 &&
    typeof l.marginPercent === 'number' &&
    l.marginPercent >= 0 &&
    l.marginPercent <= 50
  );
}

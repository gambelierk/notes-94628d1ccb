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
  /** Look of the customer's pages. File URLs point to the admin API. */
  branding: BrandingDTO;
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
  workspace: { id: string; name: string; allowCustomerUploads: boolean; branding: BrandingDTO };
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

/* ------------------------------------------------------------- branding */

/**
 * How a customer's pages look (project manager and editor): an accent
 * colour, typefaces and a logo, set by the admin per customer project.
 */
export const BRAND_FONT_PRESETS = [
  { id: 'plex-sans', label: 'IBM Plex Sans (standard)', stack: "'IBM Plex Sans Variable', 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" },
  { id: 'plex-mono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, monospace" },
  { id: 'system', label: 'Systemets typsnitt', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif" },
  { id: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
] as const;

export type BrandFontPresetId = (typeof BRAND_FONT_PRESETS)[number]['id'];
export type BrandFontSlot = 'heading' | 'body';
export type BrandFontFormat = 'woff2' | 'woff' | 'truetype' | 'opentype';

export interface BrandFontDTO {
  /** Used when no own font file is uploaded (and as fallback while it loads). */
  preset: BrandFontPresetId;
  /** The customer's own font file, e.g. their brand typeface. */
  custom: { name: string; format: BrandFontFormat; url: string } | null;
}

export interface BrandingDTO {
  /** #rrggbb for primary buttons, selection and focus; null keeps the grey default. */
  accent: string | null;
  heading: BrandFontDTO;
  body: BrandFontDTO;
  logo: { url: string; mime: string } | null;
  /** A plate behind the logo, so a dark logo is visible on the dark interface. */
  logoPlate: BrandLogoPlate;
}

export const BRAND_LOGO_PLATES = [
  { id: 'none', label: 'Ingen (för ljusa logotyper)' },
  { id: 'accent', label: 'Accentfärg' },
  { id: 'light', label: 'Vit' },
] as const;
export type BrandLogoPlate = (typeof BRAND_LOGO_PLATES)[number]['id'];

export const DEFAULT_BRANDING: BrandingDTO = {
  accent: null,
  heading: { preset: 'plex-sans', custom: null },
  body: { preset: 'plex-sans', custom: null },
  logo: null,
  logoPlate: 'none',
};

export function isBrandFontPreset(v: unknown): v is BrandFontPresetId {
  return typeof v === 'string' && BRAND_FONT_PRESETS.some((p) => p.id === v);
}

export function brandFontStack(preset: BrandFontPresetId): string {
  return (BRAND_FONT_PRESETS.find((p) => p.id === preset) ?? BRAND_FONT_PRESETS[0]).stack;
}

/** Relative luminance (WCAG) of #rrggbb. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Black or white text on an accent colour, whichever reads better. */
export function textOn(hex: string): '#0c0c0c' | '#ffffff' {
  return contrastRatio(hex, '#0c0c0c') >= contrastRatio(hex, '#ffffff') ? '#0c0c0c' : '#ffffff';
}

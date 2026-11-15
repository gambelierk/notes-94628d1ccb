import { brandFontStack, contrastRatio, textOn, type BrandFontDTO, type BrandingDTO } from '@ve/core';

/**
 * A customer project's look on its pages (project manager and editor):
 * accent colour, heading and body typefaces and logo. The admin sets it per
 * customer; the default is the grey Klipp look.
 */

/** Background the accent must stand out against (the dark panels). */
const PANEL = '#151515';
/** Below this the accent would be hard to see as an outline or marker on the dark UI. */
export const MIN_ACCENT_CONTRAST = 3;

/** Mix a #rrggbb colour towards white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const ch = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - a) + target * a));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Font family name for an uploaded font, unique per page/preview so two customers never clash. */
const familyName = (scope: string, slot: 'heading' | 'body') => `KlippBrand-${scope}-${slot}`;

function fontStack(f: BrandFontDTO, scope: string, slot: 'heading' | 'body'): string {
  const preset = brandFontStack(f.preset);
  return f.custom ? `'${familyName(scope, slot)}', ${preset}` : preset;
}

/** CSS custom properties for a branding (apply on :root or on a preview container). */
export function brandVariables(b: BrandingDTO, scope: string): Record<string, string> {
  const vars: Record<string, string> = {
    '--font': fontStack(b.body, scope, 'body'),
    '--font-heading': fontStack(b.heading, scope, 'heading'),
  };
  if (b.accent) {
    const visible = contrastRatio(b.accent, PANEL) >= MIN_ACCENT_CONTRAST;
    vars['--accent'] = b.accent;
    vars['--accent-2'] = shade(b.accent, textOn(b.accent) === '#ffffff' ? 0.15 : -0.12);
    vars['--on-accent'] = textOn(b.accent);
    // a dark brand colour still fills buttons, but outlines and focus rings stay light so they remain visible
    vars['--focus'] = visible ? b.accent : '#d4d4d4';
  }
  return vars;
}

const loaded = new Map<string, { face: FontFace; url: string }>();

/** Register the uploaded fonts (if any) so the stacks above can use them. */
export async function loadBrandFonts(b: BrandingDTO, scope: string): Promise<void> {
  await Promise.all(
    (['heading', 'body'] as const).map(async (slot) => {
      const f = b[slot].custom;
      const family = familyName(scope, slot);
      const prev = loaded.get(family);
      if (prev && prev.url === f?.url) return; // already there
      if (prev) {
        document.fonts.delete(prev.face);
        loaded.delete(family);
      }
      if (!f) return;
      const face = new FontFace(family, `url(${JSON.stringify(f.url)}) format('${f.format}')`, { display: 'swap' });
      loaded.set(family, { face, url: f.url });
      document.fonts.add(face);
      try {
        await face.load();
      } catch {
        console.warn(`Typsnittet ${f.name} kunde inte läsas`);
      }
    }),
  );
}

let applied: string[] = [];
let defaultIcon: string | null = null;

/** Apply a customer's branding to the whole page (null restores the default look). */
export function applyBranding(b: BrandingDTO | null): void {
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  applied = [];
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (icon && defaultIcon === null) defaultIcon = icon.href;
  if (!b) {
    if (icon && defaultIcon) icon.href = defaultIcon;
    return;
  }
  const vars = brandVariables(b, 'page');
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  if (icon && b.logo) icon.href = b.logo.url; // the customer's logo in the browser tab
  void loadBrandFonts(b, 'page');
}

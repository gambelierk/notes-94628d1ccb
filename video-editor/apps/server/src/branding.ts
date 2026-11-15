import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BlobStore } from './blobs.ts';
import { cleanText, HttpError, readJson, sendBlob, sniffFont, sniffMedia, uploadFileName } from './http.ts';
import type { BrandFontPresetId, BrandLogoPlate, BrandTopbarDTO } from '@ve/core';
import { BRAND_TOPBAR_KEY_LIST, isBrandFontPreset, isBrandLogoPlate, isHexColor, type Repo, type StoredBrand } from './repo.ts';

/** Logos and font files are small; anything bigger is a mistake. */
export const MAX_BRAND_FILE_BYTES = 5 * 1024 * 1024;
const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

const slotOf = (c: Context): 'heading' | 'body' => {
  const s = c.req.param('slot');
  if (s !== 'heading' && s !== 'body') throw new HttpError(404, 'Okänt typsnitt');
  return s;
};

const sizeLimit = bodyLimit({
  maxSize: MAX_BRAND_FILE_BYTES,
  onError: () => {
    throw new HttpError(413, `Filen är för stor (max ${MAX_BRAND_FILE_BYTES / 1024 / 1024} MB)`);
  },
});

/** Send a logo or font file of a workspace's branding. */
export async function sendBrandFile(c: Context, blobs: BlobStore, brand: StoredBrand, part: 'logo' | 'heading' | 'body'): Promise<Response> {
  if (part === 'logo') {
    if (!brand.logo) throw new HttpError(404, 'Ingen logotyp');
    return sendBlob(c, blobs, brand.logo.key, brand.logo.mime, 'private, max-age=31536000, immutable');
  }
  const f = brand[part].custom;
  if (!f) throw new HttpError(404, 'Inget eget typsnitt');
  const mime = { woff2: 'font/woff2', woff: 'font/woff', truetype: 'font/ttf', opentype: 'font/otf' }[f.format];
  return sendBlob(c, blobs, f.key, mime, 'private, max-age=31536000, immutable');
}

/**
 * Admin routes for a customer project's look: accent colour, heading and
 * body typefaces (a preset or the customer's own font file) and a logo.
 * Mounted under /api/admin (behind the admin check).
 */
export function brandingAdminRoutes(repo: Repo, blobs: BlobStore) {
  const r = new Hono();

  const brandOf = (c: Context) => {
    const b = repo.getBrand(c.req.param('id') ?? '');
    if (!b) throw new HttpError(404, 'Kundprojektet finns inte');
    return b;
  };
  /**
   * Apply a change to the stored branding. Read and write happen together
   * (no await in between), so two changes at once – a colour and a slow logo
   * upload – never overwrite each other.
   */
  const save = async (c: Context, change: (b: StoredBrand) => StoredBrand) => {
    const res = repo.setBrand(c.req.param('id') ?? '', change(brandOf(c)));
    if (!res) throw new HttpError(404, 'Kundprojektet finns inte');
    for (const k of res.dropped) if (!repo.blobInUse(k)) await blobs.delete(k);
    return c.json(res.workspace);
  };

  // colour and font presets
  r.put('/workspaces/:id/branding', async (c) => {
    brandOf(c); // 404 before reading the body
    const body = await readJson(c);
    let accent: string | null | undefined;
    if ('accent' in body) {
      if (body.accent !== null && !(typeof body.accent === 'string' && /^#[0-9a-f]{6}$/i.test(body.accent)))
        throw new HttpError(400, 'Färgen måste anges som #rrggbb');
      accent = body.accent === null ? null : (body.accent as string).toLowerCase();
    }
    const presets: Partial<Record<'heading' | 'body', BrandFontPresetId>> = {};
    for (const slot of ['heading', 'body'] as const) {
      const key = `${slot}Preset`;
      if (!(key in body)) continue;
      if (!isBrandFontPreset(body[key])) throw new HttpError(400, 'Okänt typsnitt');
      presets[slot] = body[key];
    }
    let logoPlate: BrandLogoPlate | undefined;
    if ('logoPlate' in body) {
      if (!isBrandLogoPlate(body.logoPlate)) throw new HttpError(400, 'Okänd platta för logotypen');
      logoPlate = body.logoPlate;
    }
    const topbar: Partial<BrandTopbarDTO> = {};
    if ('topbar' in body) {
      const t = body.topbar;
      if (!t || typeof t !== 'object' || Array.isArray(t)) throw new HttpError(400, 'topbar måste vara ett objekt');
      for (const k of BRAND_TOPBAR_KEY_LIST) {
        if (!(k in t)) continue;
        const v = (t as Record<string, unknown>)[k];
        if (v !== null && !isHexColor(v)) throw new HttpError(400, 'Färgen måste anges som #rrggbb');
        topbar[k] = v === null ? null : v.toLowerCase();
      }
    }
    return save(c, (b) => ({
      ...b,
      topbar: { ...b.topbar, ...topbar },
      logoPlate: logoPlate ?? b.logoPlate,
      accent: accent === undefined ? b.accent : accent,
      heading: { ...b.heading, preset: presets.heading ?? b.heading.preset },
      body: { ...b.body, preset: presets.body ?? b.body.preset },
    }));
  });

  r.post('/workspaces/:id/branding/logo', sizeLimit, async (c) => {
    brandOf(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const kind = sniffMedia(bytes.subarray(0, 4096));
    if (!kind || !LOGO_MIMES.has(kind.mime)) throw new HttpError(415, 'Logotypen måste vara SVG, PNG, JPEG eller WebP');
    const stored = await blobs.put(bytes);
    return save(c, (b) => ({ ...b, logo: { key: stored.key, mime: kind.mime } }));
  });

  r.delete('/workspaces/:id/branding/logo', async (c) => save(c, (b) => ({ ...b, logo: null })));

  r.post('/workspaces/:id/branding/fonts/:slot', sizeLimit, async (c) => {
    brandOf(c);
    const slot = slotOf(c);
    const fileName = uploadFileName(c, 'typsnitt');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const font = sniffFont(bytes);
    if (!font) throw new HttpError(415, 'Typsnittet måste vara WOFF2, WOFF, TTF eller OTF');
    const name = cleanText(fileName.replace(/\.(woff2?|ttf|otf)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Eget typsnitt', 'Namn');
    const stored = await blobs.put(bytes);
    return save(c, (b) => ({ ...b, [slot]: { ...b[slot], custom: { key: stored.key, name, format: font.format } } }));
  });

  r.delete('/workspaces/:id/branding/fonts/:slot', async (c) => {
    const slot = slotOf(c);
    return save(c, (b) => ({ ...b, [slot]: { ...b[slot], custom: null } }));
  });

  r.get('/workspaces/:id/branding/logo', (c) => sendBrandFile(c, blobs, brandOf(c), 'logo'));
  r.get('/workspaces/:id/branding/fonts/:slot', (c) => sendBrandFile(c, blobs, brandOf(c), slotOf(c)));

  return r;
}

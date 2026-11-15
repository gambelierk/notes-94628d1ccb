import type { Context } from 'hono';
import type { FieldOverride, TemplateLayout, TemplateSettings } from '@ve/core';
import type { BlobStore } from './blobs.ts';

export class HttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429;
  constructor(status: HttpError['status'], message: string) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------- validation */

export function cleanText(v: unknown, field: string, max = 120): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} måste vara text`);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) throw new HttpError(400, `${field} får inte vara tomt`);
  if (s.length > max) throw new HttpError(400, `${field} får vara högst ${max} tecken`);
  return s;
}

const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

export function parseLayout(v: unknown): TemplateLayout | null {
  if (v === null) return null;
  const l = v as Record<string, unknown>;
  if (
    !l ||
    typeof l !== 'object' ||
    !ANCHORS.includes(l.anchor as string) ||
    typeof l.widthPercent !== 'number' ||
    !(l.widthPercent > 0 && l.widthPercent <= 100) ||
    typeof l.marginPercent !== 'number' ||
    !(l.marginPercent >= 0 && l.marginPercent <= 50)
  ) {
    throw new HttpError(400, 'Ogiltig placering');
  }
  return { anchor: l.anchor as TemplateLayout['anchor'], widthPercent: l.widthPercent, marginPercent: l.marginPercent };
}

export function parseFields(v: unknown): FieldOverride[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length > 200) throw new HttpError(400, 'Ogiltiga fältinställningar');
  return v.map((f) => {
    const o = f as Record<string, unknown>;
    if (!o || typeof o !== 'object') throw new HttpError(400, 'Ogiltiga fältinställningar');
    const out: FieldOverride = { key: cleanText(o.key, 'Fältnyckel', 200) };
    if (o.label !== undefined && o.label !== '') out.label = cleanText(o.label, 'Fältnamn', 60);
    if (o.hidden !== undefined) {
      if (typeof o.hidden !== 'boolean') throw new HttpError(400, 'hidden måste vara true/false');
      if (o.hidden) out.hidden = true;
    }
    return out;
  });
}

export function parseTemplatePatch(body: unknown): Partial<TemplateSettings> {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Ogiltig data');
  const b = body as Record<string, unknown>;
  const out: Partial<TemplateSettings> = {};
  if ('name' in b) out.name = cleanText(b.name, 'Namn');
  if ('category' in b) out.category = cleanText(b.category, 'Kategori', 60);
  if ('artboard' in b) out.artboard = b.artboard === null ? null : cleanText(b.artboard, 'Artboard', 200);
  if ('defaultDuration' in b) {
    const d = b.defaultDuration;
    if (d !== null && (typeof d !== 'number' || !(d >= 0.1 && d <= 600))) throw new HttpError(400, 'Längden måste vara 0,1–600 sekunder');
    out.defaultDuration = d as number | null;
  }
  if ('layout' in b) out.layout = parseLayout(b.layout);
  if ('fields' in b) out.fields = parseFields(b.fields);
  return out;
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let v: unknown;
  try {
    v = await c.req.json();
  } catch {
    throw new HttpError(400, 'Ogiltig JSON');
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Ogiltig data');
  return v as Record<string, unknown>;
}

/** The uploaded file name from the `x-file-name` header, stripped of any path. */
export function uploadFileName(c: Context, fallback: string): string {
  let raw = fallback;
  try {
    raw = decodeURIComponent(c.req.header('x-file-name') ?? fallback);
  } catch {
    /* keep fallback */
  }
  return cleanText(raw.split(/[\\/]/).pop() || fallback, 'Filnamn', 200);
}

/* ------------------------------------------------------------- formats */

const RIV_MAGIC = [0x52, 0x49, 0x56, 0x45]; // "RIVE"

export function isRiv(head: Uint8Array): boolean {
  return head.byteLength >= 8 && RIV_MAGIC.every((b, i) => head[i] === b);
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Identify uploaded media from its first bytes; never trust the client's type. */
export function sniffMedia(head: Uint8Array): { kind: 'video' | 'image'; mime: string } | null {
  if (head.byteLength < 12) return null;
  const box = ascii(head, 4, 8);
  if (box === 'ftyp') {
    const brand = ascii(head, 8, 12);
    return { kind: 'video', mime: brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4' };
  }
  if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(box)) return { kind: 'video', mime: 'video/quicktime' };
  if (head[0] === 0x89 && ascii(head, 1, 4) === 'PNG') return { kind: 'image', mime: 'image/png' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  return null;
}

/* ------------------------------------------------------------- file responses */

/**
 * Send a stored file. Supports conditional requests and single byte ranges,
 * which lets the editor stream large videos (seek without downloading all).
 */
export async function sendBlob(c: Context, blobs: BlobStore, key: string, mime: string, cache: string): Promise<Response> {
  const etag = `"${key}"`;
  const size = await blobs.size(key);
  if (size === null) throw new HttpError(404, 'Filen saknas');
  const base: Record<string, string> = {
    ETag: etag,
    'Cache-Control': cache,
    'Accept-Ranges': 'bytes',
    'Content-Type': mime,
  };
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers: base });

  const range = c.req.header('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2]) && size > 0) {
    let start: number;
    let end: number;
    if (m[1] === '') {
      const suffix = Number(m[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    return new Response(blobs.stream(key, start, end), {
      status: 206,
      headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
    });
  }
  return new Response(c.req.method === 'HEAD' ? null : blobs.stream(key), {
    status: 200,
    headers: { ...base, 'Content-Length': String(size) },
  });
}

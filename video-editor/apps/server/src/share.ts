import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { CompositionSummaryDTO, MediaDTO, SharedLibraryDTO, SharedTemplateDTO, TemplateDTO, WorkspaceDTO } from '@ve/core';
import { TooLargeError, type BlobStore, type StoredBlob } from './blobs.ts';
import type { Config } from './config.ts';
import { ConversionFailedError, ConversionUnavailableError, postscriptToPdf } from './convert.ts';
import { cleanText, HttpError, isRiv, readJson, sendBlob, sniffMedia, uploadFileName } from './http.ts';
import { RevisionConflict, type CompositionRecord, type MediaRecord, type ProjectMeta, type Repo } from './repo.ts';

/** PostScript is converted in memory; larger files are refused. */
const MAX_POSTSCRIPT_BYTES = 200 * 1024 * 1024;

type ShareConfig = Pick<Config, 'maxUploadBytes' | 'maxMediaBytes' | 'workspaceQuotaBytes'> & Partial<Pick<Config, 'ghostscript'>>;

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Customer-facing API. Every route is scoped by the secret share token in
 * the path: it is the customer's only credential, and it can only reach the
 * workspace it belongs to (and only while sharing is enabled).
 */
export function shareRoutes(repo: Repo, blobs: BlobStore, config: ShareConfig) {
  const r = new Hono();

  const workspace = (c: Context): WorkspaceDTO => {
    const w = repo.getSharedWorkspace(c.req.param('token') ?? '');
    if (!w) throw new HttpError(404, 'Länken är ogiltig eller har stängts av');
    return w;
  };
  const base = (c: Context) => `/api/share/${encodeURIComponent(c.req.param('token') ?? '')}`;

  const templateDTO = (c: Context, t: TemplateDTO): SharedTemplateDTO => ({
    id: t.id,
    uploadedBy: t.uploadedBy,
    url: `${base(c)}/templates/${t.id}/file?v=${t.sha256.slice(0, 12)}`,
    sha256: t.sha256,
    manifest: {
      id: t.id,
      file: t.fileName,
      name: t.name,
      category: t.category,
      ...(t.artboard ? { artboard: t.artboard } : {}),
      ...(t.defaultDuration ? { defaultDuration: t.defaultDuration } : {}),
      ...(t.layout ? { layout: t.layout } : {}),
      ...(t.fields?.length ? { fields: t.fields } : {}),
    },
  });

  const mediaDTO = (c: Context, m: MediaRecord): MediaDTO => ({
    id: m.id,
    kind: m.kind,
    name: m.name,
    mime: m.mime,
    size: m.size,
    url: `${base(c)}/media/${m.id}`,
    createdAt: m.createdAt,
  });

  const summary = (c: Context, x: CompositionRecord): CompositionSummaryDTO => ({
    id: x.id,
    name: x.name,
    revision: x.revision,
    width: x.width,
    height: x.height,
    durationSeconds: x.durationSeconds,
    thumbnailUrl: x.thumbKey ? `${base(c)}/compositions/${x.id}/thumbnail?v=${x.thumbKey.slice(0, 12)}` : null,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
  });

  const ownComposition = (c: Context, w: WorkspaceDTO) => {
    const x = repo.getComposition(c.req.param('id') ?? '');
    if (!x || x.workspaceId !== w.id) throw new HttpError(404, 'Kompositionen finns inte');
    return x;
  };

  async function storeUpload(c: Context, maxBytes: number): Promise<StoredBlob> {
    const declared = Number(c.req.header('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, `Filen är för stor (max ${mb(maxBytes)})`);
    const body = c.req.raw.body;
    if (!body) throw new HttpError(400, 'Ingen fil skickades');
    try {
      return await blobs.putStream(body, maxBytes);
    } catch (e) {
      if (e instanceof TooLargeError) throw new HttpError(413, `Filen är för stor (max ${mb(maxBytes)})`);
      throw e;
    }
  }

  async function discard(key: string) {
    if (!repo.blobInUse(key)) await blobs.delete(key);
  }

  async function convertPostscript(stored: StoredBlob, fileName: string): Promise<StoredBlob> {
    try {
      if (stored.size > MAX_POSTSCRIPT_BYTES) throw new HttpError(413, `${fileName}: EPS-filer kan vara högst ${mb(MAX_POSTSCRIPT_BYTES)}`);
      const bytes = await blobs.get(stored.key);
      if (!bytes) throw new ConversionFailedError('Filen saknas');
      return await blobs.put(await postscriptToPdf(bytes, config.ghostscript ?? null));
    } catch (e) {
      if (e instanceof ConversionUnavailableError) throw new HttpError(415, `${fileName}: ${e.message}. Spara filen som PDF eller SVG.`);
      if (e instanceof ConversionFailedError) throw new HttpError(415, `${fileName}: ${e.message}`);
      throw e;
    } finally {
      await discard(stored.key); // only the converted PDF is kept
    }
  }

  /* ------------------------------------------------------------ library */

  r.get('/:token', (c) => {
    const w = workspace(c);
    const body: SharedLibraryDTO = {
      workspace: { id: w.id, name: w.name, allowCustomerUploads: w.allowCustomerUploads },
      templates: repo.listTemplates(w.id).map((t) => templateDTO(c, t)),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  r.get('/:token/templates/:id/file', async (c) => {
    const w = workspace(c);
    const t = repo.getTemplate(c.req.param('id'));
    if (!t || t.workspaceId !== w.id) throw new HttpError(404, 'Filen finns inte');
    return sendBlob(c, blobs, t.blobKey, 'application/octet-stream', 'private, max-age=3600');
  });

  r.post('/:token/templates', async (c) => {
    const w = workspace(c);
    if (!w.allowCustomerUploads) throw new HttpError(403, 'Uppladdning av egna mallar är inte aktiverad för det här projektet');
    const fileName = uploadFileName(c, 'mall.riv');
    // customers never see the file format: messages talk about templates ("mallar")
    const label = fileName.replace(/\.riv$/i, '');
    if (!/\.riv$/i.test(fileName)) throw new HttpError(400, `${label} är inte en mall`);
    const stored = await storeUpload(c, config.maxUploadBytes);
    if (!isRiv(stored.head)) {
      await discard(stored.key);
      throw new HttpError(415, `${label} är inte en giltig mall`);
    }
    const t = repo.createTemplate({
      workspaceId: w.id,
      name: fileName.replace(/\.riv$/i, '').replace(/[_-]+/g, ' ').trim() || 'Mall',
      category: 'Egna mallar',
      fileName,
      blobKey: stored.key,
      sha256: stored.sha256,
      size: stored.size,
      uploadedBy: 'customer',
    });
    return c.json(templateDTO(c, t), 201);
  });

  r.delete('/:token/templates/:id', async (c) => {
    const w = workspace(c);
    const t = repo.getTemplate(c.req.param('id'));
    if (!t || t.workspaceId !== w.id) throw new HttpError(404, 'Mallen finns inte');
    if (t.uploadedBy !== 'customer') throw new HttpError(403, 'Mallen hanteras av administratören');
    const res = repo.deleteTemplate(t.id);
    if (res?.orphanedKey) await blobs.delete(res.orphanedKey);
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------------ media */

  r.get('/:token/media', (c) => {
    const w = workspace(c);
    return c.json(repo.listMedia(w.id).map((m) => mediaDTO(c, m)));
  });

  r.post('/:token/media', async (c) => {
    const w = workspace(c);
    const left = config.workspaceQuotaBytes - repo.mediaBytes(w.id);
    if (left <= 0) throw new HttpError(413, `Projektets lagringsutrymme är fullt (${mb(config.workspaceQuotaBytes)})`);
    const fileName = uploadFileName(c, 'media');
    const stored = await storeUpload(c, Math.min(config.maxMediaBytes, left));
    let kind = sniffMedia(stored.head);
    if (!kind) {
      await discard(stored.key);
      throw new HttpError(415, `${fileName}: filtypen stöds inte (film: MP4/MOV, bild: PNG/JPEG/WebP, grafik: SVG/PDF/AI/EPS, ljud: MP3/WAV/M4A/Ogg/FLAC)`);
    }
    let file = stored;
    if (kind.mime === 'application/postscript') {
      // EPS / PostScript Illustrator: browsers can't read it, so it is stored as PDF (still vectors, still transparent)
      file = await convertPostscript(stored, fileName);
      kind = { kind: 'image', mime: 'application/pdf' };
    }
    const m = repo.createMedia({ workspaceId: w.id, kind: kind.kind, name: fileName, mime: kind.mime, size: file.size, blobKey: file.key });
    return c.json(mediaDTO(c, m), 201);
  });

  const getMediaFile = async (c: Context) => {
    const w = workspace(c);
    const m = repo.getMedia(c.req.param('id') ?? '');
    if (!m || m.workspaceId !== w.id) throw new HttpError(404, 'Filen finns inte');
    return sendBlob(c, blobs, m.blobKey, m.mime, 'private, max-age=86400');
  };
  r.get('/:token/media/:id', getMediaFile);
  r.on('HEAD', '/:token/media/:id', getMediaFile);

  r.delete('/:token/media/:id', async (c) => {
    const w = workspace(c);
    const m = repo.getMedia(c.req.param('id'));
    if (!m || m.workspaceId !== w.id) throw new HttpError(404, 'Filen finns inte');
    const res = repo.deleteMedia(m.id);
    if (res?.orphanedKey) await blobs.delete(res.orphanedKey);
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------------ compositions */

  const projectLimit = bodyLimit({
    maxSize: MAX_PROJECT_BYTES,
    onError: () => {
      throw new HttpError(413, 'Kompositionen är för stor');
    },
  });

  r.get('/:token/compositions', (c) => {
    const w = workspace(c);
    c.header('Cache-Control', 'no-store');
    return c.json(repo.listCompositions(w.id).map((x) => summary(c, x)));
  });

  r.post('/:token/compositions', projectLimit, async (c) => {
    const w = workspace(c);
    const body = await readJson(c);
    const name = cleanText(body.name, 'Namn');
    const { json, meta } = parseProject(body.project);
    const x = repo.createComposition(w.id, name, json, meta);
    return c.json({ ...summary(c, x), project: x.project }, 201);
  });

  r.get('/:token/compositions/:id', (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    c.header('Cache-Control', 'no-store');
    return c.json({ ...summary(c, x), project: x.project });
  });

  r.put('/:token/compositions/:id', projectLimit, async (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    const body = await readJson(c);
    if (typeof body.baseRevision !== 'number') throw new HttpError(400, 'baseRevision saknas');
    const { json, meta } = parseProject(body.project);
    const name = body.name === undefined ? undefined : cleanText(body.name, 'Namn');
    try {
      const saved = repo.saveComposition(x.id, body.baseRevision, json, meta, name);
      return c.json(summary(c, saved!));
    } catch (e) {
      if (e instanceof RevisionConflict) {
        return c.json({ error: 'Kompositionen har ändrats i ett annat fönster', revision: e.current }, 409);
      }
      throw e;
    }
  });

  r.patch('/:token/compositions/:id', async (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    const body = await readJson(c);
    return c.json(summary(c, repo.renameComposition(x.id, cleanText(body.name, 'Namn'))!));
  });

  r.post('/:token/compositions/:id/duplicate', async (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    const copy = repo.createComposition(w.id, `${x.name} (kopia)`.slice(0, 120), JSON.stringify(x.project), {
      width: x.width,
      height: x.height,
      durationSeconds: x.durationSeconds,
    });
    return c.json(summary(c, copy), 201);
  });

  r.delete('/:token/compositions/:id', async (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    const res = repo.deleteComposition(x.id);
    if (res?.orphanedKey) await blobs.delete(res.orphanedKey);
    return c.json({ ok: true });
  });

  r.put('/:token/compositions/:id/thumbnail', async (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    const stored = await storeUpload(c, MAX_THUMB_BYTES);
    if (sniffMedia(stored.head)?.kind !== 'image') {
      await discard(stored.key);
      throw new HttpError(415, 'Miniatyren måste vara en bild');
    }
    const old = repo.setCompositionThumb(x.id, stored.key);
    if (old && old !== stored.key) await discard(old);
    return c.json(summary(c, repo.getComposition(x.id)!));
  });

  r.get('/:token/compositions/:id/thumbnail', async (c) => {
    const w = workspace(c);
    const x = ownComposition(c, w);
    if (!x.thumbKey) throw new HttpError(404, 'Ingen miniatyr');
    const head = (await blobs.get(x.thumbKey))?.subarray(0, 16);
    const mime = head ? (sniffMedia(head)?.mime ?? 'image/jpeg') : 'image/jpeg';
    return sendBlob(c, blobs, x.thumbKey, mime, 'private, max-age=86400');
  });

  return r;
}

/**
 * Light structural check of a serialised editor project. The server stores
 * it as an opaque document but derives listing metadata from it.
 */
function parseProject(p: unknown): { json: string; meta: ProjectMeta } {
  const proj = p as {
    version?: unknown;
    settings?: { width?: unknown; height?: unknown; fps?: { num?: unknown; den?: unknown } };
    tracks?: unknown;
    assets?: unknown;
  };
  if (!proj || typeof proj !== 'object' || proj.version !== 1 || !Array.isArray(proj.tracks) || !Array.isArray(proj.assets)) {
    throw new HttpError(400, 'Ogiltigt projektformat');
  }
  const s = proj.settings;
  const width = Number(s?.width);
  const height = Number(s?.height);
  const num = Number(s?.fps?.num);
  const den = Number(s?.fps?.den);
  if (!(width >= 16 && width <= 8192 && height >= 16 && height <= 8192 && num > 0 && den > 0)) {
    throw new HttpError(400, 'Ogiltiga projektinställningar');
  }
  let frames = 0;
  for (const t of proj.tracks as Array<{ clips?: Array<{ start?: unknown; duration?: unknown }> }>) {
    for (const c of t?.clips ?? []) {
      const end = Number(c?.start) + Number(c?.duration);
      if (Number.isFinite(end)) frames = Math.max(frames, end);
    }
  }
  return {
    json: JSON.stringify(p),
    meta: { width: Math.round(width), height: Math.round(height), durationSeconds: (frames * den) / num },
  };
}

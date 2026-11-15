import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { FieldOverride, SharedLibraryDTO, TemplateLayout, TemplateSettings } from '@ve/core';
import { hashToken, LoginLimiter, newSessionToken, PasswordCheck } from './auth.ts';
import type { BlobStore } from './blobs.ts';
import type { Config } from './config.ts';
import type { Repo } from './repo.ts';

const COOKIE = 've_admin';
const RIV_MAGIC = [0x52, 0x49, 0x56, 0x45]; // "RIVE"
const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

export interface AppDeps {
  repo: Repo;
  blobs: BlobStore;
  config: Pick<Config, 'adminPassword' | 'cookieSecure' | 'trustProxy' | 'maxUploadBytes' | 'sessionDays'>;
}

class HttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429;
  constructor(status: HttpError['status'], message: string) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------- validation */

function cleanText(v: unknown, field: string, max = 120): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} måste vara text`);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s) throw new HttpError(400, `${field} får inte vara tomt`);
  if (s.length > max) throw new HttpError(400, `${field} får vara högst ${max} tecken`);
  return s;
}

function parseLayout(v: unknown): TemplateLayout | null {
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

function parseFields(v: unknown): FieldOverride[] | null {
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

function parseTemplatePatch(body: unknown): Partial<TemplateSettings> {
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

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'Ogiltig JSON');
  }
}

/* ------------------------------------------------------------- app */

export function createApp({ repo, blobs, config }: AppDeps) {
  const app = new Hono();
  const password = new PasswordCheck(config.adminPassword);
  const limiter = new LoginLimiter();

  const clientKey = (c: Context) =>
    (config.trustProxy ? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() : undefined) ??
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ??
    'local';

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Internt fel' }, 500);
  });

  // Security headers on everything.
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer'); // share links carry their key in the URL
    c.header('X-Frame-Options', 'DENY');
  });

  /* ------------------------------------------------------------ admin auth */

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    // CSRF: the cookie is SameSite=Strict; additionally reject cross-origin writes.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
      if (origin && host && new URL(origin).host !== host) throw new HttpError(403, 'Fel ursprung');
    }
    const token = getCookie(c, COOKIE);
    if (!token || !repo.sessionValid(hashToken(token))) throw new HttpError(401, 'Inte inloggad');
    await next();
  };

  app.post('/api/admin/login', async (c) => {
    const key = clientKey(c);
    if (limiter.blocked(key)) throw new HttpError(429, 'För många försök. Vänta en stund.');
    const body = (await readJson(c)) as { password?: unknown };
    if (!password.verify(String(body?.password ?? ''))) {
      limiter.fail(key);
      throw new HttpError(401, 'Fel lösenord');
    }
    limiter.succeed(key);
    repo.purgeExpiredSessions();
    const token = newSessionToken();
    repo.createSession(hashToken(token), config.sessionDays);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: config.cookieSecure,
      path: '/',
      maxAge: config.sessionDays * 86_400,
    });
    return c.json({ ok: true });
  });

  app.post('/api/admin/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) repo.deleteSession(hashToken(token));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/admin/me', (c) => {
    const token = getCookie(c, COOKIE);
    return c.json({ authenticated: !!token && repo.sessionValid(hashToken(token)) });
  });

  /* ------------------------------------------------------------ workspaces */

  const admin = new Hono();
  admin.use('*', requireAdmin);

  admin.get('/workspaces', (c) => c.json(repo.listWorkspaces()));

  admin.post('/workspaces', async (c) => {
    const body = (await readJson(c)) as { name?: unknown };
    return c.json(repo.createWorkspace(cleanText(body?.name, 'Namn')), 201);
  });

  admin.get('/workspaces/:id', (c) => {
    const w = repo.getWorkspace(c.req.param('id'));
    if (!w) throw new HttpError(404, 'Kundprojektet finns inte');
    return c.json({ workspace: w, templates: repo.listTemplates(w.id) });
  });

  admin.patch('/workspaces/:id', async (c) => {
    const body = (await readJson(c)) as { name?: unknown; sharingEnabled?: unknown };
    const patch: { name?: string; sharingEnabled?: boolean } = {};
    if (body && 'name' in body) patch.name = cleanText(body.name, 'Namn');
    if (body && 'sharingEnabled' in body) {
      if (typeof body.sharingEnabled !== 'boolean') throw new HttpError(400, 'sharingEnabled måste vara true/false');
      patch.sharingEnabled = body.sharingEnabled;
    }
    const w = repo.updateWorkspace(c.req.param('id'), patch);
    if (!w) throw new HttpError(404, 'Kundprojektet finns inte');
    return c.json(w);
  });

  admin.post('/workspaces/:id/rotate-link', (c) => {
    const w = repo.rotateShareToken(c.req.param('id'));
    if (!w) throw new HttpError(404, 'Kundprojektet finns inte');
    return c.json(w);
  });

  admin.delete('/workspaces/:id', async (c) => {
    const keys = repo.deleteWorkspace(c.req.param('id'));
    if (!keys) throw new HttpError(404, 'Kundprojektet finns inte');
    for (const k of new Set(keys)) if (!repo.blobInUse(k)) await blobs.delete(k);
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------------ templates */

  admin.post(
    '/workspaces/:id/templates',
    bodyLimit({
      maxSize: config.maxUploadBytes,
      onError: () => {
        throw new HttpError(413, `Filen är för stor (max ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB)`);
      },
    }),
    async (c) => {
      const w = repo.getWorkspace(c.req.param('id'));
      if (!w) throw new HttpError(404, 'Kundprojektet finns inte');
      const rawName = decodeURIComponent(c.req.header('x-file-name') ?? 'mall.riv');
      const fileName = cleanText(rawName.split(/[\\/]/).pop() ?? 'mall.riv', 'Filnamn', 200);
      if (!/\.riv$/i.test(fileName)) throw new HttpError(400, 'Endast .riv-filer kan laddas upp');
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength < 8 || RIV_MAGIC.some((b, i) => bytes[i] !== b)) throw new HttpError(400, `${fileName} är inte en giltig Rive-fil`);
      const stored = await blobs.put(bytes);
      const t = repo.createTemplate({
        workspaceId: w.id,
        name: fileName.replace(/\.riv$/i, '').replace(/[_-]+/g, ' ').trim() || 'Mall',
        category: 'Mallar',
        fileName,
        blobKey: stored.key,
        sha256: stored.sha256,
        size: stored.size,
      });
      return c.json(t, 201);
    },
  );

  admin.patch('/templates/:id', async (c) => {
    const t = repo.updateTemplate(c.req.param('id'), parseTemplatePatch(await readJson(c)));
    if (!t) throw new HttpError(404, 'Mallen finns inte');
    return c.json(t);
  });

  admin.delete('/templates/:id', async (c) => {
    const r = repo.deleteTemplate(c.req.param('id'));
    if (!r) throw new HttpError(404, 'Mallen finns inte');
    if (r.orphanedKey) await blobs.delete(r.orphanedKey);
    return c.json({ ok: true });
  });

  admin.get('/templates/:id/file', async (c) => {
    const t = repo.getTemplate(c.req.param('id'));
    if (!t) throw new HttpError(404, 'Mallen finns inte');
    return sendRiv(c, t.blobKey, t.sha256, 'private, no-cache');
  });

  app.route('/api/admin', admin);

  /* ------------------------------------------------------------ public share */

  app.get('/api/share/:token', (c) => {
    const w = repo.getSharedWorkspace(c.req.param('token'));
    if (!w) throw new HttpError(404, 'Länken är ogiltig eller har stängts av');
    const token = encodeURIComponent(c.req.param('token'));
    const body: SharedLibraryDTO = {
      workspace: { id: w.id, name: w.name },
      templates: repo.listTemplates(w.id).map((t) => ({
        id: t.id,
        url: `/api/share/${token}/templates/${t.id}/file?v=${t.sha256.slice(0, 12)}`,
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
      })),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  });

  app.get('/api/share/:token/templates/:id/file', async (c) => {
    const w = repo.getSharedWorkspace(c.req.param('token'));
    const t = repo.getTemplate(c.req.param('id'));
    if (!w || !t || t.workspaceId !== w.id) throw new HttpError(404, 'Filen finns inte');
    return sendRiv(c, t.blobKey, t.sha256, 'private, max-age=3600');
  });

  async function sendRiv(c: Context, key: string, sha: string, cache: string) {
    const etag = `"${sha}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ETag: etag, 'Cache-Control': cache });
    const bytes = await blobs.get(key);
    if (!bytes) throw new HttpError(404, 'Filen saknas');
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/octet-stream',
      ETag: etag,
      'Cache-Control': cache,
    });
  }

  app.all('/api/*', () => {
    throw new HttpError(404, 'Okänd adress');
  });

  return app;
}

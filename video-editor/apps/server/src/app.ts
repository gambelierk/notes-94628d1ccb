import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { hashToken, LoginLimiter, newSessionToken, PasswordCheck } from './auth.ts';
import type { BlobStore } from './blobs.ts';
import type { Config } from './config.ts';
import { cleanText, HttpError, isRiv, parseTemplatePatch, readJson, sendBlob, uploadFileName } from './http.ts';
import type { Repo } from './repo.ts';
import { shareRoutes } from './share.ts';

const COOKIE = 've_admin';

export interface AppDeps {
  repo: Repo;
  blobs: BlobStore;
  config: Pick<
    Config,
    'adminPassword' | 'cookieSecure' | 'trustProxy' | 'maxUploadBytes' | 'maxMediaBytes' | 'workspaceQuotaBytes' | 'sessionDays'
  > &
    Partial<Pick<Config, 'ghostscript'>>;
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
    const body = await readJson(c);
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
    const body = await readJson(c);
    return c.json(repo.createWorkspace(cleanText(body.name, 'Namn')), 201);
  });

  admin.get('/workspaces/:id', (c) => {
    const w = repo.getWorkspace(c.req.param('id'));
    if (!w) throw new HttpError(404, 'Kundprojektet finns inte');
    const compositions = repo.listCompositions(w.id).map(({ project: _p, thumbKey: _t, workspaceId: _w, ...rest }) => ({
      ...rest,
      thumbnailUrl: null,
    }));
    return c.json({ workspace: w, templates: repo.listTemplates(w.id), compositions });
  });

  admin.patch('/workspaces/:id', async (c) => {
    const body = await readJson(c);
    const patch: { name?: string; sharingEnabled?: boolean; allowCustomerUploads?: boolean } = {};
    if ('name' in body) patch.name = cleanText(body.name, 'Namn');
    for (const k of ['sharingEnabled', 'allowCustomerUploads'] as const) {
      if (!(k in body)) continue;
      if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} måste vara true/false`);
      patch[k] = body[k] as boolean;
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
      const fileName = uploadFileName(c, 'mall.riv');
      if (!/\.riv$/i.test(fileName)) throw new HttpError(400, 'Endast .riv-filer kan laddas upp');
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (!isRiv(bytes)) throw new HttpError(400, `${fileName} är inte en giltig Rive-fil`);
      const stored = await blobs.put(bytes);
      const t = repo.createTemplate({
        workspaceId: w.id,
        name: fileName.replace(/\.riv$/i, '').replace(/[_-]+/g, ' ').trim() || 'Mall',
        category: 'Mallar',
        fileName,
        blobKey: stored.key,
        sha256: stored.sha256,
        size: stored.size,
        uploadedBy: 'admin',
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
    return sendBlob(c, blobs, t.blobKey, 'application/octet-stream', 'private, no-cache');
  });

  app.route('/api/admin', admin);

  /* ------------------------------------------------------------ customer (share link) */

  app.route('/api/share', shareRoutes(repo, blobs, config));

  app.all('/api/*', () => {
    throw new HttpError(404, 'Okänd adress');
  });

  return app;
}

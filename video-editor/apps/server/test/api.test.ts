import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { DiskBlobStore } from '../src/blobs.ts';
import { openDb } from '../src/db.ts';
import { Repo } from '../src/repo.ts';

const RIV = new Uint8Array([0x52, 0x49, 0x56, 0x45, 7, 0, 1, 2, 3, 4, 5, 6]);

let dir: string;
let app: ReturnType<typeof createApp>;
let cookie = '';

async function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { cookie, ...headers } };
  if (body instanceof Uint8Array) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  return app.request(url, init);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rj(r: Promise<Response>): Promise<any> {
  return (await r).json();
}

async function login() {
  const r = await req('POST', '/api/admin/login', { password: 'hemligt-lösen-123' });
  expect(r.status).toBe(200);
  cookie = r.headers.get('set-cookie')!.split(';')[0]!;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'klipp-'));
  cookie = '';
  app = createApp({
    repo: new Repo(openDb(':memory:')),
    blobs: new DiskBlobStore(dir),
    config: { adminPassword: 'hemligt-lösen-123', cookieSecure: false, trustProxy: false, maxUploadBytes: 1024, sessionDays: 1 },
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('admin auth', () => {
  it('rejects unauthenticated and wrong passwords', async () => {
    expect((await req('GET', '/api/admin/workspaces')).status).toBe(401);
    expect((await req('POST', '/api/admin/login', { password: 'fel' })).status).toBe(401);
  });

  it('throttles repeated failures', async () => {
    for (let i = 0; i < 5; i++) await req('POST', '/api/admin/login', { password: 'fel' });
    expect((await req('POST', '/api/admin/login', { password: 'hemligt-lösen-123' })).status).toBe(429);
  });

  it('sets a strict httpOnly cookie and supports logout', async () => {
    const r = await req('POST', '/api/admin/login', { password: 'hemligt-lösen-123' });
    const sc = r.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Strict/);
    cookie = sc.split(';')[0]!;
    expect((await req('GET', '/api/admin/workspaces')).status).toBe(200);
    await req('POST', '/api/admin/logout');
    expect((await req('GET', '/api/admin/workspaces')).status).toBe(401);
  });

  it('rejects cross-origin writes', async () => {
    await login();
    const r = await req('POST', '/api/admin/workspaces', { name: 'X' }, { origin: 'https://evil.example', host: 'app.example' });
    expect(r.status).toBe(403);
  });
});

describe('workspaces and sharing', () => {
  it('creates a workspace, uploads a template and shares it', async () => {
    await login();
    const w = await rj(req('POST', '/api/admin/workspaces', { name: 'AM Berglund' }));
    expect(w.name).toBe('AM Berglund');
    expect(w.shareToken.length).toBeGreaterThanOrEqual(24);

    const up = await req('POST', `/api/admin/workspaces/${w.id}/templates`, RIV, { 'x-file-name': encodeURIComponent('lower_third.riv') });
    expect(up.status).toBe(201);
    const t = await rj(Promise.resolve(up));
    expect(t.name).toBe('lower third');

    const patched = await rj(req('PATCH', `/api/admin/templates/${t.id}`, {
        name: 'Namnskylt',
        category: 'Lower thirds',
        defaultDuration: 6,
        layout: { anchor: 'bottom-left', widthPercent: 40, marginPercent: 8 },
        fields: [{ key: 'name', label: 'Namn' }, { key: 'debug', hidden: true }],
      }));
    expect(patched.layout.anchor).toBe('bottom-left');

    // public, without cookie
    cookie = '';
    const shared = await rj(req('GET', `/api/share/${w.shareToken}`));
    expect(shared.workspace.name).toBe('AM Berglund');
    expect(shared.templates).toHaveLength(1);
    expect(shared.templates[0].manifest).toMatchObject({
      name: 'Namnskylt',
      category: 'Lower thirds',
      defaultDuration: 6,
      fields: [{ key: 'name', label: 'Namn' }, { key: 'debug', hidden: true }],
    });
    const file = await req('GET', shared.templates[0].url);
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(RIV);
    // nothing about other admin data leaks
    expect(JSON.stringify(shared)).not.toContain('shareToken');
  });

  it('hides templates from other workspaces and honours disabled/rotated links', async () => {
    await login();
    const a = await rj(req('POST', '/api/admin/workspaces', { name: 'A' }));
    const b = await rj(req('POST', '/api/admin/workspaces', { name: 'B' }));
    const tb = await rj(req('POST', `/api/admin/workspaces/${b.id}/templates`, RIV, { 'x-file-name': 'b.riv' }));

    expect((await req('GET', `/api/share/${a.shareToken}/templates/${tb.id}/file`)).status).toBe(404);

    await req('PATCH', `/api/admin/workspaces/${b.id}`, { sharingEnabled: false });
    expect((await req('GET', `/api/share/${b.shareToken}`)).status).toBe(404);
    await req('PATCH', `/api/admin/workspaces/${b.id}`, { sharingEnabled: true });

    const rotated = await rj(req('POST', `/api/admin/workspaces/${b.id}/rotate-link`));
    expect(rotated.shareToken).not.toBe(b.shareToken);
    expect((await req('GET', `/api/share/${b.shareToken}`)).status).toBe(404);
    expect((await req('GET', `/api/share/${rotated.shareToken}`)).status).toBe(200);
  });

  it('validates uploads', async () => {
    await login();
    const w = await rj(req('POST', '/api/admin/workspaces', { name: 'A' }));
    const url = `/api/admin/workspaces/${w.id}/templates`;
    expect((await req('POST', url, RIV, { 'x-file-name': 'x.png' })).status).toBe(400);
    expect((await req('POST', url, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { 'x-file-name': 'x.riv' })).status).toBe(400);
    const big = new Uint8Array(4096);
    big.set(RIV);
    expect((await req('POST', url, big, { 'x-file-name': 'x.riv', 'content-length': '4096' })).status).toBe(413);
  });

  it('deletes workspaces with their files', async () => {
    await login();
    const w = await rj(req('POST', '/api/admin/workspaces', { name: 'A' }));
    const t = await rj(req('POST', `/api/admin/workspaces/${w.id}/templates`, RIV, { 'x-file-name': 'a.riv' }));
    expect((await req('DELETE', `/api/admin/workspaces/${w.id}`)).status).toBe(200);
    expect((await req('GET', `/api/admin/templates/${t.id}/file`)).status).toBe(404);
    expect((await req('GET', '/api/admin/workspaces')).status).toBe(200);
  });

  it('rejects invalid template settings', async () => {
    await login();
    const w = await rj(req('POST', '/api/admin/workspaces', { name: 'A' }));
    const t = await rj(req('POST', `/api/admin/workspaces/${w.id}/templates`, RIV, { 'x-file-name': 'a.riv' }));
    expect((await req('PATCH', `/api/admin/templates/${t.id}`, { layout: { anchor: 'nowhere', widthPercent: 10, marginPercent: 1 } })).status).toBe(400);
    expect((await req('PATCH', `/api/admin/templates/${t.id}`, { name: '' })).status).toBe(400);
    expect((await req('PATCH', `/api/admin/templates/${t.id}`, { defaultDuration: -1 })).status).toBe(400);
  });
});

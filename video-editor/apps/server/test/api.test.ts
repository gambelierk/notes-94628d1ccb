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
    config: {
      adminPassword: 'hemligt-lösen-123',
      cookieSecure: false,
      trustProxy: false,
      maxUploadBytes: 1024,
      maxMediaBytes: 4096,
      workspaceQuotaBytes: 6000,
      sessionDays: 1,
    },
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

/* ------------------------------------------------------------- customer features */

const MP4 = (() => {
  const b = new Uint8Array(3000);
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ....ftypisom
  for (let i = 12; i < b.length; i++) b[i] = i % 251;
  return b;
})();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3, 4]);

const project = (frames = 90) => ({
  version: 1,
  id: 'p',
  name: 'x',
  settings: { width: 1920, height: 1080, fps: { num: 30, den: 1 }, sampleRate: 48000, background: '#000000' },
  assets: [],
  tracks: [{ id: 't', kind: 'video', name: 'V1', muted: false, hidden: false, clips: [{ id: 'c', start: 0, duration: frames }] }],
});

async function setupShared(allowUploads = false) {
  await login();
  const w = await rj(req('POST', '/api/admin/workspaces', { name: 'Kund' }));
  if (allowUploads) await req('PATCH', `/api/admin/workspaces/${w.id}`, { allowCustomerUploads: true });
  cookie = ''; // the customer has no admin session
  return { w, s: `/api/share/${w.shareToken}` };
}

describe('customer template uploads', () => {
  it('are refused unless the admin allows them', async () => {
    const { s } = await setupShared(false);
    expect((await req('POST', `${s}/templates`, RIV, { 'x-file-name': 'egen.riv' })).status).toBe(403);
  });

  it('are stored in the project, flagged and deletable only by the customer', async () => {
    const { w, s } = await setupShared(true);
    const lib0 = await rj(req('GET', s));
    expect(lib0.workspace.allowCustomerUploads).toBe(true);
    const t = await rj(req('POST', `${s}/templates`, RIV, { 'x-file-name': 'egen_mall.riv' }));
    expect(t.uploadedBy).toBe('customer');
    expect(t.manifest.category).toBe('Egna mallar');
    expect((await rj(req('GET', s))).templates).toHaveLength(1);
    expect((await req('POST', `${s}/templates`, PNG, { 'x-file-name': 'fake.riv' })).status).toBe(415);

    // admin template cannot be deleted by the customer
    await login();
    const adminT = await rj(req('POST', `/api/admin/workspaces/${w.id}/templates`, RIV, { 'x-file-name': 'admin.riv' }));
    const listed = await rj(req('GET', `/api/admin/workspaces/${w.id}`));
    expect(listed.templates.map((x: { uploadedBy: string }) => x.uploadedBy).sort()).toEqual(['admin', 'customer']);
    cookie = '';
    expect((await req('DELETE', `${s}/templates/${adminT.id}`)).status).toBe(403);
    expect((await req('DELETE', `${s}/templates/${t.id}`)).status).toBe(200);
  });
});

describe('customer media', () => {
  it('uploads, lists, serves byte ranges and deletes', async () => {
    const { s } = await setupShared();
    const m = await rj(req('POST', `${s}/media`, MP4, { 'x-file-name': encodeURIComponent('Min film.mp4') }));
    expect(m).toMatchObject({ kind: 'video', mime: 'video/mp4', name: 'Min film.mp4', size: 3000 });
    expect(await rj(req('GET', `${s}/media`))).toHaveLength(1);

    const full = await req('GET', m.url);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(MP4);

    const part = await req('GET', m.url, undefined, { range: 'bytes=100-199' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 100-199/3000');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP4.slice(100, 200));

    const tail = await req('GET', m.url, undefined, { range: 'bytes=-10' });
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(MP4.slice(2990));
    expect((await req('GET', m.url, undefined, { range: 'bytes=5000-' })).status).toBe(416);

    expect((await req('DELETE', `${s}/media/${m.id}`)).status).toBe(200);
    expect((await req('GET', m.url)).status).toBe(404);
  });

  it('rejects unknown formats, oversized files and full quotas', async () => {
    const { s } = await setupShared();
    expect((await req('POST', `${s}/media`, new Uint8Array(64), { 'x-file-name': 'x.mp4' })).status).toBe(415);
    expect((await req('POST', `${s}/media`, new Uint8Array(5000), { 'x-file-name': 'x.mp4' })).status).toBe(413);
    await req('POST', `${s}/media`, MP4, { 'x-file-name': 'a.mp4' });
    const second = MP4.slice();
    second[20] = 1; // different content
    await req('POST', `${s}/media`, second, { 'x-file-name': 'b.mp4' }); // 6000 bytes used → quota full
    expect((await req('POST', `${s}/media`, PNG, { 'x-file-name': 'c.png' })).status).toBe(413);
  });

  it('is isolated between customers', async () => {
    const a = await setupShared();
    const m = await rj(req('POST', `${a.s}/media`, MP4, { 'x-file-name': 'a.mp4' }));
    const b = await setupShared();
    expect((await req('GET', `${b.s}/media/${m.id}`)).status).toBe(404);
    expect((await req('DELETE', `${b.s}/media/${m.id}`)).status).toBe(404);
  });
});

describe('compositions', () => {
  it('create, list, open, save with revisions, rename, duplicate and delete', async () => {
    const { w, s } = await setupShared();
    const c = await rj(req('POST', `${s}/compositions`, { name: 'Reklamfilm', project: project(90) }));
    expect(c).toMatchObject({ name: 'Reklamfilm', revision: 1, width: 1920, height: 1080, durationSeconds: 3 });

    const saved = await rj(req('PUT', `${s}/compositions/${c.id}`, { baseRevision: 1, project: project(150) }));
    expect(saved).toMatchObject({ revision: 2, durationSeconds: 5 });

    // a stale tab saving on top of revision 1 is rejected
    const stale = await req('PUT', `${s}/compositions/${c.id}`, { baseRevision: 1, project: project(30) });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { revision: number }).revision).toBe(2);

    const opened = await rj(req('GET', `${s}/compositions/${c.id}`));
    expect(opened.project.tracks[0].clips[0].duration).toBe(150);

    await req('PATCH', `${s}/compositions/${c.id}`, { name: 'Reklamfilm v2' });
    const dup = await rj(req('POST', `${s}/compositions/${c.id}/duplicate`));
    expect(dup.name).toBe('Reklamfilm v2 (kopia)');
    const list = await rj(req('GET', `${s}/compositions`));
    expect(list.map((x: { name: string }) => x.name).sort()).toEqual(['Reklamfilm v2', 'Reklamfilm v2 (kopia)']);
    expect(list[0].project).toBeUndefined(); // summaries only

    const thumb = await rj(req('PUT', `${s}/compositions/${c.id}/thumbnail`, PNG));
    expect(thumb.thumbnailUrl).toMatch(/thumbnail\?v=/);
    expect((await req('GET', thumb.thumbnailUrl)).status).toBe(200);

    // admin sees the customer's compositions
    await login();
    const adm = await rj(req('GET', `/api/admin/workspaces/${w.id}`));
    expect(adm.workspace.compositionCount).toBe(2);
    cookie = '';

    expect((await req('DELETE', `${s}/compositions/${dup.id}`)).status).toBe(200);
    expect(await rj(req('GET', `${s}/compositions`))).toHaveLength(1);
  });

  it('validates projects and is isolated between customers', async () => {
    const a = await setupShared();
    expect((await req('POST', `${a.s}/compositions`, { name: 'x', project: { version: 2 } })).status).toBe(400);
    expect((await req('POST', `${a.s}/compositions`, { name: '', project: project() })).status).toBe(400);
    const c = await rj(req('POST', `${a.s}/compositions`, { name: 'A', project: project() }));
    const b = await setupShared();
    expect((await req('GET', `${b.s}/compositions/${c.id}`)).status).toBe(404);
    expect((await req('PUT', `${b.s}/compositions/${c.id}`, { baseRevision: 1, project: project() })).status).toBe(404);
    expect((await req('DELETE', `${b.s}/compositions/${c.id}`)).status).toBe(404);
  });
});

import { sniffMedia } from '../src/http.ts';
describe('media sniffing', () => {
  const b = (...xs: (number | string)[]) => {
    const out: number[] = [];
    for (const x of xs) typeof x === 'string' ? out.push(...[...x].map((c) => c.charCodeAt(0))) : out.push(x);
    while (out.length < 16) out.push(0);
    return new Uint8Array(out);
  };
  it('recognises audio formats', () => {
    expect(sniffMedia(b('ID3', 4, 0))?.mime).toBe('audio/mpeg');
    expect(sniffMedia(b(0xff, 0xfb, 0x90, 0x64))?.mime).toBe('audio/mpeg');
    expect(sniffMedia(b(0xff, 0xf1, 0x50, 0x80))?.mime).toBe('audio/aac');
    expect(sniffMedia(b('RIFF', 0, 0, 0, 0, 'WAVE'))?.mime).toBe('audio/wav');
    expect(sniffMedia(b('OggS', 0))?.mime).toBe('audio/ogg');
    expect(sniffMedia(b('fLaC', 0))?.mime).toBe('audio/flac');
    expect(sniffMedia(b(0, 0, 0, 0x20, 'ftypM4A '))?.kind).toBe('audio');
    expect(sniffMedia(b(0, 0, 0, 0x20, 'ftypisom'))?.kind).toBe('video');
  });
});

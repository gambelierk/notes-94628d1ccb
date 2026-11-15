// Create (or update) a customer project with its look from a profile folder:
//
//   ADMIN_PASSWORD=… node scripts/customer-profile.mjs customers/kid-collective [--url http://localhost:8787]
//
// The folder holds profile.json (name, accent colour, logo, logo plate, fonts)
// and the files it names. Running it again updates the same customer project
// (matched by name) instead of creating a second one. Prints the share link.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const urlAt = args.indexOf('--url');
const base = (urlAt >= 0 ? args[urlAt + 1] : (process.env.KLIPP_URL ?? 'http://localhost:8787')).replace(/\/$/, '');
const password = process.env.ADMIN_PASSWORD;
if (!dir || !password) {
  console.error('Användning: ADMIN_PASSWORD=… node scripts/customer-profile.mjs <mapp med profile.json> [--url <serverns adress>]');
  process.exit(2);
}

const profile = JSON.parse(readFileSync(path.join(dir, 'profile.json'), 'utf8'));
if (typeof profile.name !== 'string' || !profile.name.trim()) throw new Error('profile.json saknar "name"');

let cookie = '';
async function call(method, url, body, headers = {}) {
  const init = { method, headers: { cookie, origin: base, ...headers } };
  if (body instanceof Uint8Array) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const r = await fetch(base + url, init);
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {}
    throw new Error(`${method} ${url}: ${msg}`);
  }
  return r;
}
const upload = (url, file) =>
  call('POST', url, new Uint8Array(readFileSync(path.join(dir, file))), {
    'content-type': 'application/octet-stream',
    'x-file-name': encodeURIComponent(path.basename(file)),
  });

const login = await call('POST', '/api/admin/login', { password });
cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

const all = await (await call('GET', '/api/admin/workspaces')).json();
let ws = all.find((w) => w.name === profile.name);
const created = !ws;
if (!ws) ws = await (await call('POST', '/api/admin/workspaces', { name: profile.name })).json();
const b = `/api/admin/workspaces/${ws.id}/branding`;

const patch = {};
if ('accent' in profile) patch.accent = profile.accent;
if (profile.logoPlate) patch.logoPlate = profile.logoPlate;
if (profile.fontPresets?.heading) patch.headingPreset = profile.fontPresets.heading;
if (profile.fontPresets?.body) patch.bodyPreset = profile.fontPresets.body;
if (Object.keys(patch).length) await call('PUT', b, patch);
if (profile.logo) await upload(`${b}/logo`, profile.logo);
for (const slot of ['heading', 'body']) if (profile.fonts?.[slot]) await upload(`${b}/fonts/${slot}`, profile.fonts[slot]);

ws = (await (await call('GET', `/api/admin/workspaces/${ws.id}`)).json()).workspace;
await call('POST', '/api/admin/logout').catch(() => undefined);

console.log(`${created ? 'Skapade' : 'Uppdaterade'} kundprojektet "${ws.name}"`);
console.log(`  accentfärg: ${ws.branding.accent ?? 'standard'}`);
console.log(`  rubriker:   ${ws.branding.heading.custom?.name ?? ws.branding.heading.preset}`);
console.log(`  text:       ${ws.branding.body.custom?.name ?? ws.branding.body.preset}`);
console.log(`  logotyp:    ${ws.branding.logo ? `ja (platta: ${ws.branding.logoPlate})` : 'nej'}`);
console.log(`Kundens länk: ${base}/p/${ws.shareToken}`);

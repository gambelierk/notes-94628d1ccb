// End-to-end: admin creates a customer project, uploads Rive files and shares
// the link; the customer opens it, sees only those templates, uses one and
// exports. Then sharing is disabled and the link rotated.
//
// Requires: pnpm build, Playwright with Chromium, ffmpeg/ffprobe.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.e2e');
mkdirSync(out, { recursive: true });
const clip = path.join(out, 'clipA.mp4');
if (!existsSync(clip))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
const tplDir = path.join(root, 'apps/editor/public/templates');

const PORT = 4180;
const PASSWORD = 'e2e-lösenord-12345';
const dataDir = mkdtempSync(path.join(tmpdir(), 'klipp-e2e-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/main.ts'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD, NODE_ENV: 'production', COOKIE_SECURE: 'false' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const base = `http://localhost:${PORT}`;

let failed = false;
const check = (cond, msg) => {
  if (!cond) failed = true;
  console.log(cond ? '✓' : '✗', msg);
};

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/admin/me`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servern startade inte');
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const errors = [];

  /* ---------------------------------------------------------------- admin */
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  admin.on('pageerror', (e) => errors.push('admin: ' + e));
  await admin.goto(`${base}/admin`);

  await admin.getByLabel('Lösenord').fill('fel');
  await admin.getByRole('button', { name: 'Logga in' }).click();
  await admin.getByRole('alert').waitFor();
  check((await admin.getByRole('alert').textContent()).includes('Fel lösenord'), 'fel lösenord avvisas');
  await admin.getByLabel('Lösenord').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Logga in' }).click();

  await admin.getByLabel('Namn på nytt kundprojekt').fill('Testkund AB');
  await admin.getByRole('button', { name: 'Skapa kundprojekt' }).click();
  await admin.getByTestId('workspace-view').waitFor();
  check((await admin.getByLabel('Kundprojektets namn').inputValue()) === 'Testkund AB', 'kundprojekt skapat');

  // A second customer whose templates must not leak
  await admin.getByLabel('Namn på nytt kundprojekt').fill('Annan kund');
  await admin.getByRole('button', { name: 'Skapa kundprojekt' }).click();
  await admin.waitForFunction(() => document.querySelector('[aria-label="Kundprojektets namn"]')?.value === 'Annan kund');
  await admin.getByTestId('riv-upload').setInputFiles(path.join(tplDir, 'car_widgets_v01.riv'));
  await admin.getByTestId('admin-template').first().waitFor();
  await admin.getByRole('button', { name: /Testkund AB/ }).click();
  await admin.waitForFunction(() => document.querySelector('[aria-label="Kundprojektets namn"]')?.value === 'Testkund AB');

  await admin.getByTestId('riv-upload').setInputFiles([path.join(tplDir, 'inventory_demo_test_v2.riv'), path.join(tplDir, 'bankcard.riv')]);
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid=admin-template]').length === 2, null, { timeout: 20000 });
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid=admin-template] .thumb img').length === 2, null, { timeout: 20000 });
  check(true, 'två .riv-filer uppladdade och inspekterade (tumnaglar visas)');

  // Configure the first: artboard, name, category, placement
  const card = admin.getByTestId('admin-template').first();
  await card.getByLabel('Artboard').selectOption('Data content');
  await admin.waitForTimeout(400);
  await card.getByLabel('Namn', { exact: true }).fill('Namnskylt');
  await card.getByLabel('Kategori', { exact: true }).fill('Lower thirds');
  await card.getByLabel('Placering').selectOption('bottom-left');
  await admin.waitForTimeout(300);
  await card.getByLabel('Namn', { exact: true }).click();
  await admin.waitForFunction(
    () => !!document.querySelector('[aria-label="Etikett för name"]') && !!document.querySelector('[aria-label="Etikett för value"]'),
    null,
    { timeout: 10000 },
  );
  check(true, 'artboard valt – fälten (name/value) identifieras i admin');
  // Customer-friendly labels: rename "name" → "Namn", hide "value"
  await card.getByLabel('Etikett för name').fill('Namn');
  await card.getByLabel('Etikett för name').blur();
  await admin.waitForTimeout(300);
  await card.getByLabel('Visa value för kunden').uncheck();
  await admin.waitForTimeout(400);
  await admin.screenshot({ path: path.join(out, 'admin-01.png') });

  const link = await admin.getByTestId('share-link').inputValue();
  check(/\/p\/[A-Za-z0-9_-]{20,}$/.test(link), `delningslänk: ${link.replace(/[^/]+$/, '…')}`);

  /* ---------------------------------------------------------------- customer */
  const custCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const cust = await custCtx.newPage();
  cust.on('pageerror', (e) => errors.push('kund: ' + e));
  await cust.goto(link);
  await cust.waitForFunction(() => window.__editor?.getState().templates.length === 2 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });
  check((await cust.getByTestId('customer-name').textContent()) === 'Testkund AB', 'kunden ser projektets namn');
  const names = await cust.evaluate(() => window.__editor.getState().templates.map((t) => `${t.def.category}/${t.def.name}`));
  check(names.includes('Lower thirds/Namnskylt') && names.length === 2, `kunden ser exakt projektets mallar: ${names.join(', ')}`);
  check((await cust.getByRole('button', { name: 'Importera .riv' }).count()) === 0, 'kunden kan inte importera egna mallar');
  const adminApi = await cust.evaluate(async () => (await fetch('/api/admin/workspaces')).status);
  check(adminApi === 401, 'kunden når inte admin-API:t');

  // Use the template
  await cust.getByRole('tab', { name: 'Media' }).click();
  await cust.locator('input[type=file][accept*="mp4"]').setInputFiles(clip);
  await cust.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 1);
  await cust.locator('[data-asset-id]').first().hover();
  await cust.locator('[data-asset-id]').first().getByRole('button').click();
  await cust.getByRole('tab', { name: 'Mallar' }).click();
  await cust.evaluate(() => window.__editor.getState().setPlayhead(15));
  const tile = cust.locator('.lib-item', { hasText: 'Namnskylt' });
  await tile.hover();
  await tile.getByRole('button').click();
  await cust.getByLabel('Namn', { exact: true }).fill('Kund Kundsson');
  check((await cust.getByTestId('template-inspector').getByLabel('Value').count()) === 0, 'dolt fält visas inte för kunden, omdöpt fält heter "Namn"');
  await cust.evaluate(() => window.__editor.getState().setPlayhead(90));
  await cust.waitForTimeout(700);
  await cust.screenshot({ path: path.join(out, 'kund-01.png') });

  await cust.getByRole('button', { name: 'Exportera' }).first().click();
  await cust.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await cust.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 180000 });
  if (await cust.getByTestId('export-error').count()) throw new Error('Export: ' + (await cust.getByTestId('export-error').textContent()));
  const dlP = cust.waitForEvent('download');
  await cust.getByTestId('export-download').click();
  const file = path.join(out, 'kund-export.mp4');
  await (await dlP).saveAs(file);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,nb_frames', '-of', 'json', file]).toString());
  check(probe.streams.some((s) => s.codec_name === 'h264' && Number(s.nb_frames) === 240), 'kundens export: giltig H.264 med 240 bildrutor');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '3', '-i', file, '-frames:v', '1', path.join(out, 'kund-frame.png')]);

  /* ---------------------------------------------------------------- revoke */
  await admin.getByRole('checkbox', { name: /^Delning/ }).uncheck();
  await admin.waitForTimeout(400);
  await cust.reload();
  await cust.getByRole('heading', { name: 'Länken fungerar inte' }).waitFor({ timeout: 15000 });
  check(true, 'avstängd delning: kunden får ett tydligt felmeddelande');

  await admin.getByRole('checkbox', { name: /^Delning/ }).check();
  await admin.waitForTimeout(300);
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: 'Skapa ny länk' }).click();
  await admin.waitForFunction((old) => document.querySelector('[data-testid=share-link]').value !== old, link);
  const newLink = await admin.getByTestId('share-link').inputValue();
  await cust.goto(link);
  await cust.getByRole('heading', { name: 'Länken fungerar inte' }).waitFor({ timeout: 15000 });
  await cust.goto(newLink);
  await cust.getByTestId('customer-name').waitFor({ timeout: 15000 });
  check(true, 'ny länk: den gamla slutar fungera och den nya fungerar');

  check(errors.length === 0, `inga sidfel${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

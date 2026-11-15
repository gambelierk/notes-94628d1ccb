// End-to-end: admin sets up a customer project; the customer manages
// compositions (create, edit, autosave, reopen, export, duplicate, reuse media)
// and uploads their own template when allowed. Then permissions are revoked.
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
const state = (page, fn) => page.evaluate(fn);

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/admin/me`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('servern startade inte');
}

/** Average brightness of the preview canvas (0–255): proves video is drawn. */
async function previewBrightness(page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid=preview-canvas]');
    const o = new OffscreenCanvas(64, 36);
    const x = o.getContext('2d');
    x.drawImage(c, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  });
}

async function waitSaved(page) {
  await page.waitForFunction(() => window.__editor.getState().saveState.kind === 'saved' && window.__editor.getState().uploads.length === 0, null, {
    timeout: 30000,
  });
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const errors = [];

  /* ================================================================ admin */
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  admin.on('pageerror', (e) => errors.push('admin: ' + e));
  await admin.goto(`${base}/admin`);

  await admin.getByLabel('Lösenord').fill('fel');
  await admin.getByRole('button', { name: 'Logga in' }).click();
  await admin.getByRole('alert').waitFor();
  check((await admin.getByRole('alert').textContent()).includes('Fel lösenord'), 'admin: fel lösenord avvisas');
  await admin.getByLabel('Lösenord').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Logga in' }).click();

  // A second customer whose templates must not leak
  await admin.getByLabel('Namn på nytt kundprojekt').fill('Annan kund');
  await admin.getByRole('button', { name: 'Skapa kundprojekt' }).click();
  await admin.waitForFunction(() => document.querySelector('[aria-label="Kundprojektets namn"]')?.value === 'Annan kund');
  await admin.getByTestId('riv-upload').setInputFiles(path.join(tplDir, 'car_widgets_v01.riv'));
  await admin.getByTestId('admin-template').first().waitFor();

  await admin.getByLabel('Namn på nytt kundprojekt').fill('Testkund AB');
  await admin.getByRole('button', { name: 'Skapa kundprojekt' }).click();
  await admin.waitForFunction(() => document.querySelector('[aria-label="Kundprojektets namn"]')?.value === 'Testkund AB');

  await admin.getByTestId('riv-upload').setInputFiles([path.join(tplDir, 'inventory_demo_test_v2.riv'), path.join(tplDir, 'bankcard.riv')]);
  await admin.waitForFunction(() => document.querySelectorAll('[data-testid=admin-template] .thumb img').length === 2, null, { timeout: 20000 });
  const card = admin.getByTestId('admin-template').first();
  await card.getByLabel('Artboard').selectOption('Data content');
  await admin.waitForFunction(() => !!document.querySelector('[aria-label="Etikett för name"]'), null, { timeout: 10000 });
  await card.getByLabel('Namn', { exact: true }).fill('Namnskylt');
  await card.getByLabel('Kategori', { exact: true }).fill('Lower thirds');
  await card.getByLabel('Placering').selectOption('bottom-left');
  await card.getByLabel('Etikett för name').fill('Namn');
  await card.getByLabel('Etikett för name').blur();
  await card.getByLabel('Visa value för kunden').uncheck();
  await admin.getByRole('checkbox', { name: 'Kunden får ladda upp egna Rive-mallar' }).check();
  await admin.waitForTimeout(500);
  check(true, 'admin: kundprojekt med två konfigurerade mallar, kunduppladdning påslagen');
  const link = await admin.getByTestId('share-link').inputValue();

  /* ================================================================ customer: project manager */
  const custCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const cust = await custCtx.newPage();
  cust.on('pageerror', (e) => errors.push('kund: ' + e));
  await cust.goto(link);
  await cust.getByTestId('project-manager').waitFor();
  await cust.waitForFunction(() => window.__editor.getState().templates.length === 2 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });
  check((await cust.getByTestId('customer-name').textContent()) === 'Testkund AB', 'kund: projekthanteraren visar kundens namn');
  check((await cust.evaluate(async () => (await fetch('/api/admin/workspaces')).status)) === 401, 'kund: når inte admin-API:t');

  await cust.getByTestId('customer-riv-upload').setInputFiles(path.join(tplDir, 'data_binding_test.riv'));
  await cust.waitForFunction(() => window.__editor.getState().templates.some((t) => t.uploadedBy === 'customer'), null, { timeout: 20000 });
  check((await cust.locator('.lib-cat', { hasText: 'Egna mallar' }).count()) === 1, 'kund: egen .riv uppladdad och listad under "Egna mallar"');

  await cust.getByRole('button', { name: 'Ny komposition' }).first().click();
  await cust.getByLabel('Namn', { exact: true }).fill('Reklamfilm');
  await cust.locator('.format-opt', { hasText: 'Liggande 16:9' }).click();
  await cust.getByRole('button', { name: 'Skapa och öppna' }).click();
  await cust.waitForURL(/\/p\/[^/]+\/c\/cmp_/);
  const compUrl = cust.url();
  await cust.waitForFunction(() => window.__editor?.getState().composition?.name === 'Reklamfilm', null, { timeout: 20000 });
  check(true, 'kund: ny komposition skapad och öppnad i editorn');

  /* ================================================================ customer: editor */
  await cust.waitForFunction(() => window.__editor.getState().templates.length === 3 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });
  await cust.getByRole('tab', { name: 'Media' }).click();
  await cust.locator('input[type=file][accept*="mp4"]').setInputFiles(clip);
  await cust.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 1, null, { timeout: 30000 });
  check((await state(cust, () => window.__editor.getState().serverMedia.length)) === 1, 'kund: filmen laddades upp till projektet');
  await cust.locator('[data-asset-id]').first().hover();
  await cust.locator('[data-asset-id]').first().getByRole('button').click();

  await cust.getByRole('tab', { name: 'Mallar' }).click();
  await cust.evaluate(() => window.__editor.getState().setPlayhead(15));
  const tile = cust.locator('.lib-item', { hasText: 'Namnskylt' });
  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  await tile.getByRole('button').click();
  await cust.getByLabel('Namn', { exact: true }).fill('Kund Kundsson');
  check((await cust.getByTestId('template-inspector').getByLabel('Value').count()) === 0, 'kund: dolt fält syns inte, omdöpt fält heter "Namn"');
  check((await cust.locator('.lib-cat', { hasText: 'Egna mallar' }).count()) === 1, 'kund: egen mall finns i editorns mallpanel');
  const settings = await state(cust, () => window.__editor.getState().history.present.project.settings);
  check(settings.width === 1920 && settings.height === 1080 && settings.autoFormat === false, 'kund: valt format 1920×1080 behålls');

  await cust.evaluate(() => window.__editor.getState().setPlayhead(90));
  await waitSaved(cust);
  check((await cust.getByTestId('save-state').textContent()).startsWith('Sparat'), 'kund: autosparning visar "Sparat"');
  await cust.screenshot({ path: path.join(out, 'kund-editor.png') });

  /* ---- reopen: everything must come back from the server ---- */
  await cust.reload();
  await cust.waitForFunction(() => window.__editor?.getState().composition?.name === 'Reklamfilm', null, { timeout: 20000 });
  const reopened = await state(cust, () => {
    const p = window.__editor.getState().history.present.project;
    const clips = p.tracks.flatMap((t) => t.clips);
    const lt = clips.find((c) => c.kind === 'template');
    return { kinds: clips.map((c) => c.kind).sort(), name: lt?.props.name?.value.value, assets: p.assets.length };
  });
  check(
    reopened.kinds.join() === 'template,video' && reopened.name === 'Kund Kundsson' && reopened.assets === 1,
    `kund: efter omladdning finns film, mall och text kvar (${JSON.stringify(reopened)})`,
  );
  await cust.evaluate(() => window.__editor.getState().setPlayhead(60));
  await cust.waitForTimeout(1500);
  const bright = await previewBrightness(cust);
  check(bright > 40, `kund: filmen strömmas från servern och visas i förhandsvisningen (ljushet ${bright.toFixed(0)})`);

  // Export reads the video from the server URL in the worker
  await cust.getByRole('button', { name: 'Exportera' }).first().click();
  check((await cust.getByLabel('Filnamn').inputValue()) === 'Reklamfilm', 'kund: exportens filnamn = kompositionens namn');
  await cust.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await cust.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 180000 });
  if (await cust.getByTestId('export-error').count()) throw new Error('Export: ' + (await cust.getByTestId('export-error').textContent()));
  const dlP = cust.waitForEvent('download');
  await cust.getByTestId('export-download').click();
  const file = path.join(out, 'kund-export.mp4');
  await (await dlP).saveAs(file);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,nb_frames', '-of', 'json', file]).toString());
  check(
    probe.streams.some((s) => s.codec_name === 'h264' && Number(s.nb_frames) === 240) && probe.streams.some((s) => s.codec_name === 'aac'),
    'kund: export av återöppnad komposition (media från servern) – H.264 + AAC, 240 bildrutor',
  );
  await cust.getByTestId('export-dialog').getByRole('button', { name: 'Stäng' }).click();

  /* ---- back to the project manager ---- */
  await cust.getByRole('link', { name: '← Kompositioner' }).click();
  await cust.getByTestId('project-manager').waitFor();
  await cust.getByTestId('composition-card').first().waitFor();
  check((await cust.getByTestId('composition-card').locator('img').count()) === 1, 'kund: kompositionen listas med förhandsbild');
  await cust.getByRole('button', { name: 'Duplicera' }).click();
  await cust.waitForFunction(() => document.querySelectorAll('[data-testid=composition-card]').length === 2);
  check(true, 'kund: duplicering skapar en kopia');

  // New vertical composition reusing the uploaded film from the project bin
  await cust.getByRole('button', { name: 'Ny komposition' }).first().click();
  await cust.getByLabel('Namn', { exact: true }).fill('Story');
  await cust.locator('.format-opt', { hasText: 'Stående 9:16' }).click();
  await cust.getByRole('button', { name: 'Skapa och öppna' }).click();
  await cust.waitForFunction(() => window.__editor?.getState().composition?.name === 'Story', null, { timeout: 20000 });
  await cust.getByRole('tab', { name: 'Media' }).click();
  await cust.locator('[data-asset-id]').first().waitFor();
  check((await cust.locator('[data-asset-id]').count()) === 1, 'kund: projektets film finns i mediapanelen i en ny komposition');
  await cust.locator('[data-asset-id]').first().hover();
  await cust.locator('[data-asset-id]').first().getByRole('button').click();
  await cust.waitForFunction(() => window.__editor.getState().history.present.project.tracks[0].clips.length === 1, null, { timeout: 20000 });
  await waitSaved(cust);
  const st = await state(cust, () => window.__editor.getState().history.present.project.settings);
  check(st.width === 1080 && st.height === 1920, 'kund: återanvänd film i stående komposition, formatet behålls');
  await cust.waitForTimeout(800);
  await cust.screenshot({ path: path.join(out, 'kund-story.png') });
  await cust.getByRole('link', { name: '← Kompositioner' }).click();
  await cust.waitForFunction(() => document.querySelectorAll('[data-testid=composition-card]').length === 3, null, { timeout: 15000 });
  await cust.waitForTimeout(800);
  await cust.screenshot({ path: path.join(out, 'kund-pm.png') });
  check(true, 'kund: tre kompositioner sparade');

  /* ================================================================ admin overview + revoke */
  await admin.reload();
  await admin.getByTestId('ws-stats').waitFor();
  const stats = await admin.getByTestId('ws-stats').textContent();
  check(stats.includes('3 kompositioner') && stats.includes('1 mediefiler'), `admin: översikt "${stats.trim()}"`);
  check((await admin.locator('.pill', { hasText: 'Kunduppladdad' }).count()) === 1, 'admin: kundens mall markeras som kunduppladdad');
  await admin.screenshot({ path: path.join(out, 'admin-01.png') });

  await admin.getByRole('checkbox', { name: 'Kunden får ladda upp egna Rive-mallar' }).uncheck();
  await admin.waitForTimeout(400);
  await cust.reload();
  await cust.getByTestId('composition-card').first().waitFor();
  await cust.waitForFunction(() => !window.__editor.getState().templatesLoading);
  check((await cust.getByTestId('customer-riv-upload').count()) === 0, 'avstängd kunduppladdning: knappen försvinner');
  const forbidden = await cust.evaluate(async (l) => {
    const t = new URL(l).pathname.split('/')[2];
    return (await fetch(`/api/share/${t}/templates`, { method: 'POST', body: new Uint8Array([82, 73, 86, 69, 1, 2, 3, 4]), headers: { 'x-file-name': 'x.riv' } })).status;
  }, link);
  check(forbidden === 403, 'avstängd kunduppladdning: servern nekar (403)');

  await admin.getByRole('checkbox', { name: /^Delning/ }).uncheck();
  await admin.waitForTimeout(400);
  await cust.goto(compUrl);
  await cust.getByRole('heading', { name: 'Länken fungerar inte' }).waitFor({ timeout: 15000 });
  check(true, 'avstängd delning: även en komposition kräver giltig länk');

  await admin.getByRole('checkbox', { name: /^Delning/ }).check();
  await admin.waitForTimeout(300);
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: 'Skapa ny länk' }).click();
  await admin.waitForFunction((old) => document.querySelector('[data-testid=share-link]').value !== old, link);
  const newLink = await admin.getByTestId('share-link').inputValue();
  await cust.goto(link);
  await cust.getByRole('heading', { name: 'Länken fungerar inte' }).waitFor({ timeout: 15000 });
  await cust.goto(newLink);
  await cust.waitForFunction(() => document.querySelectorAll('[data-testid=composition-card]').length === 3, null, { timeout: 15000 });
  check(true, 'ny länk: gamla slutar fungera, nya visar samma kompositioner');

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

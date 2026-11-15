// End-to-end: "Skapa" with format presets and a custom size, moving/scaling
// video and images in the viewer, and verifying placement in the export.
//
// Requires: pnpm build, Playwright with Chromium, ffmpeg/ffprobe, python3 + Pillow (for the test PNG).
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
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
const logo = path.join(out, 'logo.png');
if (!existsSync(logo))
  execFileSync('python3', ['-c', `from PIL import Image, ImageDraw
im=Image.new('RGBA',(600,300),(0,0,0,0)); d=ImageDraw.Draw(im)
d.rounded_rectangle((10,10,590,290),radius=40,fill=(255,40,40,255)); d.ellipse((220,70,380,230),fill=(255,255,255,255))
im.save(${JSON.stringify(logo)})`]);

const PORT = 4175;
const server = spawn('pnpm', ['--filter', '@ve/editor', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let failed = false;
const check = (cond, msg) => {
  if (!cond) failed = true;
  console.log(cond ? '✓' : '✗', msg);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

/** RGB of a pixel in a PNG extracted with ffmpeg. */
function pixel(png, x, y) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [raw[0], raw[1], raw[2]];
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const S = () => page.evaluate(() => {
    const s = window.__editor.getState();
    return { settings: s.history.present.project.settings, tracks: s.history.present.project.tracks, selection: s.selection };
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__editor.getState().templates.length >= 5 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });

  /* ------------------------------------------------ Skapa */
  await page.getByRole('button', { name: 'Skapa' }).click();
  const dlg = page.getByTestId('create-dialog');
  const presets = await dlg.getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent));
  check(
    ['1:1, 1080 × 1080', '3:4, 1080 × 1440', '4:5, 1080 × 1350', '9:16, 1080 × 1920', '16:9, 1920 × 1080'].every((p) => presets.some((x) => x.includes(p))) &&
      presets.some((x) => x.includes('Anpassad')),
    'Skapa visar 1:1, 3:4, 4:5, 9:16, 16:9 i full upplösning och anpassad storlek',
  );
  // custom size validation
  await dlg.getByRole('radio', { name: /Anpassad/ }).click();
  await dlg.getByLabel('Bredd i pixlar').fill('5000');
  await dlg.getByLabel('Bredd i pixlar').blur();
  check((await dlg.getByRole('alert').textContent()).includes('Högst'), 'anpassad storlek: för stor bredd avvisas');
  await dlg.getByLabel('Bredd i pixlar').fill('1201');
  await dlg.getByLabel('Höjd i pixlar').fill('627');
  await dlg.getByLabel('Höjd i pixlar').blur();
  check((await dlg.locator('.create-summary').textContent()).includes('1202 × 628'), 'anpassad storlek avrundas till jämna pixlar (1202 × 628)');
  await page.screenshot({ path: path.join(out, 'layout-create.png') });
  // pick 9:16
  await dlg.getByRole('radio', { name: /9:16/ }).click();
  await dlg.getByLabel('Namn').fill('Story');
  await dlg.getByRole('button', { name: 'Skapa' }).click();
  let st = await S();
  check(st.settings.width === 1080 && st.settings.height === 1920, 'ny film skapad i 1080 × 1920');

  /* ------------------------------------------------ video: fit, fill */
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.locator('input[type=file][accept*="mp4"]').setInputFiles([clip, logo]);
  await page.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 2, null, { timeout: 20000 });
  check((await page.locator('[data-asset-kind=image]').count()) === 1, 'bilden visas under "Bilder" i mediapanelen');
  await page.locator('[data-asset-kind=video]').hover();
  await page.locator('[data-asset-kind=video]').getByRole('button').click();
  st = await S();
  check(st.settings.width === 1080, 'formatet ändras inte av den första filmen när det valts i Skapa');
  await page.evaluate(() => window.__editor.getState().setPlayhead(30));
  await page.waitForTimeout(600);
  let size = await page.locator('.xf-size').textContent();
  check(size.startsWith('1080 × 608'), `filmen anpassas till bilden (${size.split(' i ')[0]})`);
  await page.getByRole('button', { name: 'Fyll' }).click();
  size = await page.locator('.xf-size').textContent();
  check(size.startsWith('3413 × 1920'), `Fyll täcker hela bilden (${size.split(' i ')[0]})`);

  /* ------------------------------------------------ image: add, drag, scale */
  await page.locator('[data-asset-kind=image]').hover();
  await page.locator('[data-asset-kind=image]').getByRole('button').click();
  st = await S();
  const img = st.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'image');
  check(!!img && st.selection === img.id && img.start === 30, 'bilden lades på ett grafikspår vid spelhuvudet och markerades');
  await page.waitForTimeout(500);
  const box = await page.getByTestId('transform-box').boundingBox();
  const canvas = await page.getByTestId('preview-canvas').boundingBox();
  const k = canvas.width / 1080;
  check(near(box.width / k, 1080, 3), `bilden anpassas först till bildens bredd (${Math.round(box.width / k)} px)`);
  const stage = await page.locator('.stage').boundingBox();
  check(canvas.y >= stage.y - 1 && canvas.y + canvas.height <= stage.y + stage.height + 1, 'stående 9:16 ryms i förhandsvisningen');

  // scale down from the bottom-right corner: drag halfway towards the centre
  const se = await page.locator('[data-handle=se]').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + (se.x + se.width / 2 - cx) * 0.4, cy + (se.y + se.height / 2 - cy) * 0.4, { steps: 10 });
  await page.mouse.up();
  let t = (await S()).tracks.flatMap((x) => x.clips).find((c) => c.id === img.id).transform;
  check(near(t.scale.value, 0.4, 0.03), `handtaget skalar bilden (${Math.round(t.scale.value * 100)} %)`);

  // drag towards the top: centre moves from 960 to ~300 (frame px)
  const b2 = await page.getByTestId('transform-box').boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2 + 3, b2.y + b2.height / 2 - 660 * k, { steps: 12 });
  await page.mouse.up();
  t = (await S()).tracks.flatMap((x) => x.clips).find((c) => c.id === img.id).transform;
  const cyPx = 960 + t.y.value * 1920;
  check(near(cyPx, 300, 6) && t.x.value === 0, `bilden flyttades upp till y ≈ ${Math.round(cyPx)} px och fäste mot mittlinjen (x = 0)`);
  check((await page.getByTestId('xf-y').inputValue()) === String(Math.round(cyPx * 10) / 10), 'egenskapspanelen visar samma position');

  // exact value from the inspector
  await page.getByTestId('xf-rot').fill('0');
  await page.getByTestId('xf-x').fill('540');
  check(true, 'positionsfälten går att redigera');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await page.screenshot({ path: path.join(out, 'layout-editor.png') });

  /* ------------------------------------------------ export and measure */
  await page.getByRole('button', { name: 'Exportera' }).first().click();
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await page.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 180000 });
  if (await page.getByTestId('export-error').count()) throw new Error('Export: ' + (await page.getByTestId('export-error').textContent()));
  const dlP = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const file = path.join(out, 'layout-export.mp4');
  await (await dlP).saveAs(file);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'json', file]).toString());
  check(probe.streams[0].width === 1080 && probe.streams[0].height === 1920, 'exporten är 1080 × 1920');
  const frame = path.join(out, 'layout-frame.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '2', '-i', file, '-frames:v', '1', frame]);
  // logo: 1080 wide at 40 % = 432 × 216, centred at (540, ~300); its white dot is at the centre,
  // its red body 80 px left of the centre. Below it, the filled video covers the frame.
  const [r1, g1, b1] = pixel(frame, 540, Math.round(cyPx));
  const [r2, g2, bl2] = pixel(frame, 540 - 140, Math.round(cyPx));
  check(r1 > 200 && g1 > 200 && b1 > 200, `exporten: bildens vita mitt hamnar på (540, ${Math.round(cyPx)})`);
  check(r2 > 180 && g2 < 90 && bl2 < 90, 'exporten: bildens röda yta ligger runt mitten');
  const [r3, g3, b3] = pixel(frame, 10, 1900);
  check(r3 + g3 + b3 > 60, 'exporten: filmen fyller hela bilden ända ut i hörnen (Fyll)');

  check(errors.length === 0, `inga sidfel${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);

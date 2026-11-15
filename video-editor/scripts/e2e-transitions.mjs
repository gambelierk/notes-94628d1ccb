// End-to-end: transitions are opt-in. Buttons at cuts and clip ends create a
// cross-dissolve between touching clips or a fade to/from black at free ends.
// Verified in the export (picture blend, audio cross-fade, black at the ends)
// together with Delete/Backspace for transitions and clips.
//
// Requires: pnpm build, Playwright with Chromium, ffmpeg/ffprobe, python3 + Pillow.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.e2e');
mkdirSync(out, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const clipA = path.join(out, 'clipA.mp4');
const clipB = path.join(out, 'clipB.mp4');
if (!existsSync(clipA))
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipA]);
if (!existsSync(clipB))
  ff(['-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=30', '-t', '6', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '1', '-shortest', clipB]);

const PORT = 4177;
const server = spawn('pnpm', ['--filter', '@ve/editor', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
let failed = false;
const check = (cond, msg) => {
  if (!cond) failed = true;
  console.log(cond ? '✓' : '✗', msg);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

function level(file, freq, from, dur) {
  const other = freq === 440 ? 660 : 440;
  const notch = Array(3).fill(`bandreject=f=${other}:width_type=q:width=1`).join(',');
  const res = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(dur), '-i', file, '-af', `${notch},bandpass=f=${freq}:width_type=q:width=8,astats=measure_perchannel=none`, '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(res.stderr);
  return !m || m[1] === '-inf' ? -200 : Number(m[1]);
}

/** Grab one frame at `t` from a file as PNG (scaled to 320×180). */
function grab(file, t, name) {
  const png = path.join(out, name);
  ff(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=320:180', png]);
  return png;
}

/** Python/Pillow helpers: mean luminance and blend comparison. */
function py(code) {
  return execFileSync('python3', ['-c', code]).toString().trim();
}
const luma = (png) => Number(py(`from PIL import Image, ImageStat; print(ImageStat.Stat(Image.open('${png}').convert('L')).mean[0])`));

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const P = () => page.evaluate(() => window.__editor.getState().history.present.project);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__editor.getState().templates.length >= 5 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });

  await page.getByRole('button', { name: 'Skapa' }).click();
  await page.getByTestId('create-dialog').getByRole('radio', { name: /16:9/ }).click();
  await page.getByTestId('create-dialog').getByRole('button', { name: 'Skapa' }).click();

  await page.getByRole('tab', { name: 'Media' }).click();
  await page.locator('input[type=file][accept*="mp4"]').setInputFiles([clipA, clipB]);
  await page.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 2, null, { timeout: 20000 });
  for (const i of [0, 1]) {
    const tile = page.locator('[data-asset-kind=video]').nth(i);
    await tile.hover();
    await tile.getByRole('button').click();
  }
  // Trim like a real edit so both clips have spare media at the cut:
  // A ends at 7 s (1 s of film left after it), B starts 1 s into its file, then B is moved up against A.
  const zoom = await page.evaluate(() => window.__editor.getState().zoom);
  const px = zoom / 30; // px per frame
  const dragBy = async (locator, dxFrames, pos) => {
    const b = await locator.boundingBox();
    const x = pos === 'r' ? b.x + b.width - 3 : pos === 'l' ? b.x + 3 : b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dxFrames * px, y, { steps: 10 });
    await page.mouse.up();
  };
  await dragBy(page.locator('.clip.video').nth(0), -30, 'r');
  await dragBy(page.locator('.clip.video').nth(1), 30, 'l');
  await dragBy(page.locator('.clip.video').nth(1), -60, 'body');
  let p = await P();
  check(
    p.tracks[0].clips.map((c) => [c.start, c.duration, c.sourceStart]).join() === '0,210,0,210,150,1000000',
    'klippen trimmade och flyttade: A 0–7 s, B 7–12 s (B börjar 1 s in i sin fil)',
  );
  check(p.tracks[0].clips.every((c) => !c.fadeIn && !c.fadeOut && !c.transitionIn), 'inga övergångar som standard');
  check(p.tracks[0].clips.length === 2, 'två klipp som möts vid 7 s');

  /* ------------------------------------------------ buttons and edge highlight */
  const row = page.locator('[data-track-kind=video]').first();
  await row.hover();
  check(
    (await row.getByTestId('joint-start').count()) === 1 && (await row.getByTestId('joint-cut').count()) === 1 && (await row.getByTestId('joint-end').count()) === 1,
    'knappar vid början, skarven och slutet',
  );
  check((await row.getByTestId('joint-cut').getAttribute('aria-label')).includes('mellan clipA.mp4 och clipB.mp4'), 'skarvknappen beskriver vilka klipp som möts');
  await row.getByTestId('joint-cut').hover();
  const hi = await page.evaluate(() =>
    [...document.querySelectorAll('.clip-edge-hi')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className.split(' ')[1]),
  );
  check(hi.sort().join() === 'l,r', 'båda klippändarna vid skarven markeras när knappen hålls över');
  await page.screenshot({ path: path.join(out, 'trans-hover.png') });

  /* ------------------------------------------------ create transitions */
  await row.getByTestId('joint-cut').click();
  await page.getByTestId('transition-inspector').waitFor();
  check((await page.getByTestId('transition-inspector').textContent()).includes('Övertoning'), 'klick skapar en övertoning och markerar den');
  await page.getByTestId('transition-inspector').getByRole('button', { name: '2 s' }).click();
  await row.hover();
  await row.getByTestId('joint-start').click();
  await row.hover();
  await row.getByTestId('joint-end').click();
  p = await P();
  const [A, B] = p.tracks[0].clips;
  check(B.transitionIn?.duration === 60 && A.fadeIn === 30 && B.fadeOut === 30, 'övertoning 2 s, tona in 1 s från svart, tona ut 1 s till svart');
  check((await row.getByTestId(/^transition-/).count()) === 3, 'tre övergångsmarkörer på tidslinjen');

  /* ------------------------------------------------ delete with keyboard */
  await row.getByTestId('transition-end').click();
  await page.keyboard.press('Delete');
  p = await P();
  check(!p.tracks[0].clips[1].fadeOut, 'markerad övergång tas bort med Delete');
  await page.keyboard.press('Control+z');
  p = await P();
  check(p.tracks[0].clips[1].fadeOut === 30, 'ångra återställer övergången');

  await page.locator('.clip.video').nth(1).click({ position: { x: 60, y: 40 } });
  await page.keyboard.press('Backspace');
  p = await P();
  check(p.tracks[0].clips.length === 1, 'markerat klipp tas bort med Backspace');
  await page.keyboard.press('Control+z');
  await page.locator('.clip.video').nth(1).click({ position: { x: 60, y: 40 } });
  await page.keyboard.press('Delete');
  p = await P();
  check(p.tracks[0].clips.length === 1, 'markerat klipp tas bort med Delete');
  await page.keyboard.press('Control+z');
  p = await P();
  check(p.tracks[0].clips.length === 2 && p.tracks[0].clips[1].transitionIn?.duration === 60, 'ångra återställer klippet med sin övertoning');

  await page.evaluate(() => window.__editor.getState().setPlayhead(210));
  await page.locator('body').click({ position: { x: 700, y: 30 } });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'trans-editor.png') });

  /* ------------------------------------------------ export and measure */
  await page.getByRole('button', { name: 'Exportera' }).first().click();
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await page.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 180000 });
  if (await page.getByTestId('export-error').count()) throw new Error('Export: ' + (await page.getByTestId('export-error').textContent()));
  const dlP = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const file = path.join(out, 'transitions.mp4');
  await (await dlP).saveAs(file);

  // picture: black at the start and the end, blend at the cut
  const start = luma(grab(file, 0, 'tr-start.png'));
  const normal = luma(grab(file, 3, 'tr-normal.png'));
  const end = luma(grab(file, 11.95, 'tr-end.png'));
  check(start < 8 && normal > 60 && end < 20, `tonar från och till svart (ljushet ${start.toFixed(0)} → ${normal.toFixed(0)} → ${end.toFixed(0)})`);

  // at the cut (7 s) A shows its source at 7 s and B its source at 1 s
  const mid = grab(file, 7.0, 'tr-mid.png');
  const aLast = grab(clipA, 7.0, 'tr-a.png');
  const bFirst = grab(clipB, 1.0, 'tr-b.png');
  const cmp = py(`from PIL import Image, ImageChops, ImageStat
m=Image.open('${mid}').convert('RGB'); a=Image.open('${aLast}').convert('RGB'); b=Image.open('${bFirst}').convert('RGB')
mae=lambda x,y: sum(ImageStat.Stat(ImageChops.difference(x,y)).mean)/3
print(mae(m, Image.blend(a,b,0.5)), mae(m,a), mae(m,b))`).split(' ').map(Number);
  console.log(`· avvikelse mitt i övertoningen: mot 50/50-blandning ${cmp[0].toFixed(1)}, mot A ${cmp[1].toFixed(1)}, mot B ${cmp[2].toFixed(1)}`);
  check(cmp[0] < 12 && cmp[0] < cmp[1] / 3 && cmp[0] < cmp[2] / 3, 'mitt i övertoningen är bilden en blandning av båda klippen');

  // sound: A alone, both at the cut (cross-fade), B alone
  const srcA = level(clipA, 440, 3, 1);
  const srcB = level(clipB, 660, 3, 1);
  // dissolve 2 s centred on the cut: 6–8 s
  const a6 = level(file, 440, 4.5, 1);
  const b6 = level(file, 660, 4.5, 1);
  const aMid = level(file, 440, 6.95, 0.1);
  const bMid = level(file, 660, 6.95, 0.1);
  const a10 = level(file, 440, 9, 1);
  const b10 = level(file, 660, 9, 1);
  console.log(`· ljud: före ${a6.toFixed(1)}/${b6.toFixed(1)} · vid skarven ${aMid.toFixed(1)}/${bMid.toFixed(1)} · efter ${a10.toFixed(1)}/${b10.toFixed(1)} dB (440/660 Hz)`);
  check(Math.abs(a6 - srcA) < 0.5 && b6 < -70, 'före övertoningen hörs bara klipp A');
  check(Math.abs(aMid - (srcA - 6)) < 1.5 && Math.abs(bMid - (srcB - 6)) < 1.5, 'vid skarven hörs båda på ungefär halv nivå (ljudet tonas över)');
  check(Math.abs(b10 - srcB) < 0.5 && a10 < -70, 'efter övertoningen hörs bara klipp B');

  check(errors.length === 0, `inga sidfel${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);

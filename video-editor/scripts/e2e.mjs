// End-to-end smoke test: import MP4s, drag a video and a Rive template onto
// the timeline, edit template fields, trim/split, export, and verify the MP4.
//
// Requires: a production build (pnpm build), Playwright with Chromium, ffmpeg/ffprobe.
// Usage: node scripts/e2e.mjs
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.e2e');
mkdirSync(out, { recursive: true });

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}
const clipA = path.join(out, 'clipA.mp4');
const clipB = path.join(out, 'clipB.mp4');
if (!existsSync(clipA))
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-shortest', clipA]);
if (!existsSync(clipB))
  ff(['-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=30', '-t', '6', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-ac', '1', '-shortest', clipB]);

const logo = path.join(out, 'logo.png');
if (!existsSync(logo)) ff(['-f', 'lavfi', '-i', 'smptebars=size=400x400', '-frames:v', '1', logo]);

const PORT = 4173;
const server = spawn('pnpm', ['--filter', '@ve/editor', 'exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
const log = (...a) => console.log('·', ...a);
let failed = false;
const check = (cond, msg) => {
  if (!cond) {
    failed = true;
    console.error('✗', msg);
  } else console.log('✓', msg);
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

async function dragTo(page, from, to) {
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);

  // 1. Template library loads with thumbnails
  await page.waitForFunction(() => window.__editor.getState().templates.length >= 5 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });
  const nTemplates = await page.evaluate(() => window.__editor.getState().templates.length);
  check(nTemplates >= 5, `mallbiblioteket laddade ${nTemplates} mallar`);
  await page.screenshot({ path: path.join(out, '01-start.png') });

  // 2. Import two MP4s
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.locator('input[type=file][accept*="mp4"]').setInputFiles([clipA, clipB]);
  await page.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 2, null, { timeout: 20000 });
  check(true, 'två MP4-filer importerade');

  // 3. Drag first video onto the video track at the start
  const scroll = page.getByTestId('timeline-scroll');
  const sb = await scroll.boundingBox();
  const videoRow = await page.locator('[data-track-kind=video]').first().boundingBox();
  await dragTo(page, page.locator('[data-asset-id]').first(), { x: sb.x + 5, y: videoRow.y + videoRow.height / 2 });
  // Add the second right after the first with the + button
  await page.locator('[data-asset-id]').nth(1).hover();
  await page.locator('[data-asset-id]').nth(1).getByRole('button').click();
  let state = await page.evaluate(() => {
    const p = window.__editor.getState().history.present.project;
    return { tracks: p.tracks.map((t) => t.clips.map((c) => [c.kind, c.start, c.duration])), settings: p.settings };
  });
  log('tidslinje', JSON.stringify(state.tracks));
  check(state.tracks[0].length === 2 && state.tracks[0][0][1] === 0 && state.tracks[0][1][1] === 240, 'två videoklipp efter varandra på V1');
  check(state.settings.width === 1280 && state.settings.fps.num === 30, 'projektet tog upplösning och fps från första klippet');

  // 4. Drag a template onto the graphics track at ~1 s
  await page.getByRole('tab', { name: 'Mallar' }).click();
  const zoom = await page.evaluate(() => window.__editor.getState().zoom);
  const gRow = await page.locator('[data-track-kind=graphics]').first().boundingBox();
  await dragTo(page, page.locator('[data-template-id="demo-lower-third"]'), { x: sb.x + zoom * 1, y: gRow.y + gRow.height / 2 });
  state = await page.evaluate(() => {
    const s = window.__editor.getState();
    const p = s.history.present.project;
    return { clips: p.tracks[1].clips, selection: s.selection };
  });
  check(state.clips.length === 1 && state.clips[0].templateId === 'demo-lower-third', 'mallen släpptes på grafikspåret');
  check(Math.abs(state.clips[0].start - 30) <= 2, `mallen hamnade vid ~1 s (bildruta ${state.clips[0].start})`);

  // 5. Edit fields in the inspector
  await page.getByLabel('Namn', { exact: true }).fill('Karl Johan');
  await page.getByLabel('Titel', { exact: true }).fill('Grundare');
  const props = await page.evaluate(() => window.__editor.getState().history.present.project.tracks[1].clips[0].props);
  check(props.name?.value.value === 'Karl Johan' && props.value?.value.value === 'Grundare', 'textfälten uppdaterade klippet');

  // Add a second template (colour field) with the + button at the playhead, set its colour
  await page.evaluate(() => window.__editor.getState().setPlayhead(200));
  await page.locator('[data-template-id="demo-progress"]').scrollIntoViewIfNeeded();
  await page.locator('[data-template-id="demo-progress"]').hover();
  await page.locator('[data-template-id="demo-progress"]').getByRole('button').click();
  await page.getByLabel('Färg', { exact: true }).fill('#2ec27e');
  await page.getByLabel('Färg', { exact: true }).press('Enter');
  const colour = await page.evaluate(() => {
    const p = window.__editor.getState().history.present.project;
    return p.tracks[1].clips.find((c) => c.templateId === 'demo-progress')?.props.Bar_Color?.value.value;
  });
  check(colour === '#2ec27eff', `färgfältet sattes (${colour})`);

  // Image field: new graphics track, drag "Bildram" onto it at 4 s, pick an image
  await page.getByRole('button', { name: 'Grafikspår' }).click();
  const g2 = await page.locator('[data-track-kind=graphics]').first().boundingBox(); // new track is on top
  await dragTo(page, page.locator('[data-template-id="demo-image-frame"]'), { x: sb.x + zoom * 4, y: g2.y + g2.height / 2 });
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles(logo);
  await page.waitForFunction(() => {
    const p = window.__editor.getState().history.present.project;
    const c = p.tracks[2]?.clips[0];
    return c && c.props.itemImage?.value.assetId;
  }, null, { timeout: 10000 });
  check(true, 'bildfältet fick en egen bild på nytt grafikspår G2');

  // 6. Undo / redo
  await page.locator('body').click({ position: { x: 700, y: 30 } });
  const before = await page.evaluate(() => window.__editor.getState().history.past.length);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  const after = await page.evaluate(() => window.__editor.getState().history.past.length);
  check(before === after, 'ångra + gör om återställer historiken');

  // 7. Trim the lower third's right edge by dragging, then split the first video at 3 s
  const lt = page.locator('.clip.template', { hasText: 'Namnskylt' }).first();
  const lb = await lt.boundingBox();
  await page.mouse.move(lb.x + lb.width - 3, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width - 3 - zoom, lb.y + lb.height / 2, { steps: 8 });
  await page.mouse.up();
  const trimmed = await page.evaluate(() => window.__editor.getState().history.present.project.tracks[1].clips[0].duration);
  check(trimmed < 150 && trimmed > 100, `mallklippet trimmades till ${trimmed} bildrutor`);
  await page.evaluate(() => {
    const s = window.__editor.getState();
    s.select(null);
    s.setPlayhead(90);
  });
  await page.keyboard.press('s');
  const v1 = await page.evaluate(() => window.__editor.getState().history.present.project.tracks[0].clips.map((c) => [c.start, c.duration, c.sourceStart]));
  check(v1.length === 3 && v1[1][0] === 90 && v1[1][2] === 3_000_000, 'delning vid 3 s skapar ett nytt klipp med rätt källtid');

  // 8. Preview a frame with the template on screen
  await page.evaluate(() => window.__editor.getState().setPlayhead(75));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, '02-editor.png') });
  await page.getByTestId('preview-canvas').screenshot({ path: path.join(out, '03-preview.png') });

  // 9. Playback advances the playhead
  await page.evaluate(() => window.__editor.getState().setPlayhead(0));
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  const ph = await page.evaluate(() => window.__editor.getState().playhead);
  check(ph > 20, `uppspelning flyttade spelhuvudet till bildruta ${ph}`);

  // 10. Export
  await page.getByRole('button', { name: 'Exportera' }).first().click();
  await page.getByLabel('Filnamn').fill('e2e-export');
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await page.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 240000 });
  if (await page.getByTestId('export-error').count()) throw new Error('Export: ' + (await page.getByTestId('export-error').textContent()));
  const downloadP = page.waitForEvent('download', { timeout: 30000 });
  await page.getByTestId('export-download').click();
  const dl = await downloadP;
  const file = path.join(out, 'export.mp4');
  await dl.saveAs(file);
  await page.screenshot({ path: path.join(out, '04-export.png') });
  log(await page.getByTestId('export-done').textContent());

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames,sample_rate,channels:format=duration', '-of', 'json', file]).toString());
  log(JSON.stringify(probe));
  const v = probe.streams.find((s) => s.codec_name === 'h264');
  const a = probe.streams.find((s) => s.codec_name === 'aac');
  check(v && v.width === 1280 && v.height === 720, 'export: H.264 1280×720');
  check(v && Number(v.nb_frames) === 420, `export: 420 bildrutor (fick ${v?.nb_frames})`);
  check(a && Number(a.sample_rate) === 48000 && a.channels === 2, 'export: AAC 48 kHz stereo');
  check(Math.abs(Number(probe.format.duration) - 14) < 0.1, `export: längd 14 s (fick ${probe.format.duration})`);
  for (const t of [2.5, 5, 7, 9]) ff(['-ss', String(t), '-i', file, '-frames:v', '1', path.join(out, `frame-${t}.png`)]);
  const vol = execFileSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  void vol;

  check(errors.length === 0, `inga fel i konsolen${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  server.kill();
}
writeFileSync(path.join(out, 'result.txt'), failed ? 'FAILED\n' : 'OK\n');
process.exit(failed ? 1 : 0);

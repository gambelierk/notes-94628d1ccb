// End-to-end: own sound files, per-clip and per-track volume, fades, mute,
// text clips and subtitles — verified by measuring the exported MP4.
//
// The film's audio is a 440 Hz tone and the music an 880 Hz tone, so each
// source can be isolated with a band-pass filter and its level measured.
//
// Requires: pnpm build, Playwright with Chromium, ffmpeg/ffprobe.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.e2e');
mkdirSync(out, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const clip = path.join(out, 'clipA.mp4');
if (!existsSync(clip))
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
const music = path.join(out, 'music.mp3');
if (!existsSync(music)) ff(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=6', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', music]);
const subs = path.join(out, 'subs.srt');
writeFileSync(subs, '1\n00:00:00,500 --> 00:00:02,000\nFörsta raden\n\n2\n00:00:02,500 --> 00:00:04,000\nAndra raden\nmed två rader\n');

const PORT = 4176;
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

/**
 * RMS level (dBFS) of one test tone in a time window. The other tone is
 * notched out first so the two sources don't leak into each other's reading.
 */
function level(file, freq, from, dur) {
  const other = freq === 440 ? 880 : 440;
  const notch = Array(3).fill(`bandreject=f=${other}:width_type=q:width=1`).join(',');
  const res = require('node:child_process').spawnSync(
    'ffmpeg',
    ['-hide_banner', '-ss', String(from), '-t', String(dur), '-i', file, '-af', `${notch},bandpass=f=${freq}:width_type=q:width=8,astats=measure_perchannel=none`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(res.stderr);
  return !m || m[1] === '-inf' ? -200 : Number(m[1]);
}
const dB = (g) => 20 * Math.log10(g);

/** Set a React-controlled range input. */
async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function exportTo(page, name) {
  await page.getByRole('button', { name: 'Exportera' }).first().click();
  await page.getByLabel('Filnamn').fill(name);
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await page.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 180000 });
  if (await page.getByTestId('export-error').count()) throw new Error('Export: ' + (await page.getByTestId('export-error').textContent()));
  const dlP = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const file = path.join(out, `${name}.mp4`);
  await (await dlP).saveAs(file);
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Stäng' }).click();
  return file;
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const P = () => page.evaluate(() => window.__editor.getState().history.present.project);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__editor.getState().templates.length >= 5 && !window.__editor.getState().templatesLoading, null, { timeout: 30000 });

  // 16:9 film
  await page.getByRole('button', { name: 'Skapa' }).click();
  await page.getByTestId('create-dialog').getByRole('radio', { name: /16:9/ }).click();
  await page.getByTestId('create-dialog').getByRole('button', { name: 'Skapa' }).click();

  /* ------------------------------------------------ import sound */
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.locator('input[type=file][accept*="mp4"]').setInputFiles([clip, music]);
  await page.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 2, null, { timeout: 20000 });
  check((await page.locator('[data-asset-kind=audio]').count()) === 1, 'ljudfilen (MP3) importerades och visas under "Ljud"');
  let p = await P();
  check(p.tracks.map((t) => t.kind).join() === 'video,graphics,audio', 'projektet har spåren V1, G1 och A1');

  await page.locator('[data-asset-kind=video]').hover();
  await page.locator('[data-asset-kind=video]').getByRole('button').click();
  await page.evaluate(() => window.__editor.getState().setPlayhead(0));
  await page.locator('[data-asset-kind=audio]').hover();
  await page.locator('[data-asset-kind=audio]').getByRole('button').click();
  p = await P();
  const a1 = p.tracks.find((t) => t.kind === 'audio');
  check(a1.clips.length === 1 && a1.clips[0].kind === 'audio' && a1.clips[0].duration === 180, 'musiken ligger på A1 (6 s = 180 bildrutor)');
  await page.locator('.clip.audio canvas.waveform').waitFor({ timeout: 20000 });
  await page.locator('.clip.video canvas.waveform').waitFor({ timeout: 20000 });
  check(true, 'ljudvågor ritas för ljudklippet och filmens ljud');

  /* ------------------------------------------------ volumes and fades */
  // music clip: fade in from silence with the transition button at its start (default 1 s)
  const audioRow = page.locator('[data-track-kind=audio]').first();
  await audioRow.hover();
  await audioRow.getByTestId('joint-start').click();
  // music track at 25 %
  await setRange(page.getByLabel(`Volym för spår ${a1.name}`), 0.25);
  // film clip at 50 %
  await page.locator('.clip.video').click({ position: { x: 20, y: 10 } });
  await setRange(page.getByLabel('Klippets volym'), 0.5);
  p = await P();
  const v = p.tracks[0].clips[0];
  const m = p.tracks.find((t) => t.kind === 'audio');
  check(v.volume.value === 0.5 && m.volume.value === 0.25 && m.clips[0].fadeIn === 30, 'klippvolym 50 %, spårvolym 25 %, intoning 1 s');
  check((await page.getByTestId('clip-volume').textContent()).includes('−6.0 dB'), 'volymen visas även i dB (−6.0 dB)');

  /* ------------------------------------------------ text and subtitles */
  await page.getByRole('tab', { name: 'Text' }).click();
  await page.evaluate(() => window.__editor.getState().setPlayhead(255)); // after the film: black background
  await page.locator('[data-text-preset=title]').hover();
  await page.locator('[data-text-preset=title]').getByRole('button').click();
  await page.getByLabel('Text', { exact: true }).fill('Hej Sverige');
  await page.getByTestId('text-size').fill('140');
  p = await P();
  const title = p.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text');
  check(title?.text === 'Hej Sverige' && Math.round(title.style.size * 1080) === 140, 'rubrik tillagd och redigerad (140 px)');

  await page.getByTestId('text-panel').locator('input[type=file]').setInputFiles(subs);
  await page.waitForFunction(() => window.__editor.getState().history.present.project.tracks.some((t) => t.role === 'subtitles'), null, { timeout: 5000 });
  p = await P();
  const subTrack = p.tracks.find((t) => t.role === 'subtitles');
  check(subTrack.clips.length === 2 && subTrack.clips[1].text === 'Andra raden\nmed två rader' && subTrack.clips[0].start === 15, 'SRT importerad: två undertexter på ett eget textspår');
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-srt').click();
  const srtFile = path.join(out, 'roundtrip.srt');
  await (await dl).saveAs(srtFile);
  check(readFileSync(srtFile, 'utf8').includes('00:00:02,500 --> 00:00:04,000\nAndra raden\nmed två rader'), 'undertexterna exporteras som .srt');
  await page.evaluate(() => window.__editor.getState().setPlayhead(45));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'audio-editor.png') });

  /* ------------------------------------------------ export 1: levels */
  const f1 = await exportTo(page, 'audio-mix');
  // expected = level in the source file + the gain we set
  const srcFilm = level(clip, 440, 2, 2);
  const srcMus = level(music, 880, 2, 2);
  const film = level(f1, 440, 2, 2);
  const mus = level(f1, 880, 2, 2);
  const musStart = level(f1, 880, 0.05, 0.2);
  console.log(`· källor: film ${srcFilm.toFixed(1)} dB, musik ${srcMus.toFixed(1)} dB · export: film ${film.toFixed(1)} dB, musik ${mus.toFixed(1)} dB`);
  check(Math.abs(film - (srcFilm + dB(0.5))) < 0.5, `filmens ljud vid klippvolym 50 %: ${(film - srcFilm).toFixed(2)} dB (väntat −6,02)`);
  check(Math.abs(mus - (srcMus + dB(0.25))) < 0.5, `musiken vid spårvolym 25 %: ${(mus - srcMus).toFixed(2)} dB (väntat −12,04)`);
  check(mus - musStart > 8, `musiken tonas in: ${(mus - musStart).toFixed(1)} dB tystare under första kvartssekunden`);
  const after = level(f1, 880, 6.5, 1);
  check(after < -70, `musiken slutar när ljudklippet slutar (${after.toFixed(0)} dB efter 6 s)`);

  // title rendered in the worker with the bundled font: white pixels in the middle, black corners
  const frame = path.join(out, 'audio-title.png');
  ff(['-ss', '9', '-i', f1, '-frames:v', '1', frame]);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', frame, '-vf', 'crop=600:160:660:460,scale=60:16', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const bright = [...raw].filter((x) => x > 200).length;
  const corner = execFileSync('ffmpeg', ['-v', 'error', '-i', frame, '-vf', 'crop=40:40:0:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  check(bright > 40 && Math.max(...corner) < 30, `rubriken syns i exporten (${bright} ljusa punkter i mitten, svarta hörn)`);

  /* ------------------------------------------------ export 2: muted music track */
  await page.getByLabel(`Stäng av ljud för ${a1.name}`).click();
  const f2 = await exportTo(page, 'audio-muted');
  const mus2 = level(f2, 880, 2, 2);
  const film2 = level(f2, 440, 2, 2);
  check(mus2 < -70 && Math.abs(film2 - film) < 0.3, `avstängt ljudspår hörs inte (${mus2.toFixed(0)} dB), filmens ljud oförändrat`);

  check(errors.length === 0, `inga sidfel${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);

// End-to-end: vector graphics (SVG, PDF, Illustrator, EPS) in a customer
// project – transparent over the film, sharp when scaled up (in the preview
// and in the exported MP4) – plus Space for play/pause and the customer never
// seeing the template file format.
//
// Requires: pnpm build, Playwright with Chromium, ffmpeg/ffprobe, Ghostscript (gs).
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.e2e');
mkdirSync(out, { recursive: true });

/* ---------------------------------------------------------- test files */
// a plain blue film, so "transparent" is easy to see: blue shows through
const film = path.join(out, 'blue.mp4');
if (!existsSync(film))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x2050ff:size=1920x1080:rate=25:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', film]);
// The same artwork in every format: a 100 × 50 artboard, transparent, with a red
// rectangle whose left edge is exactly in the middle (x = 50..90, y = 10..40).
const svg = path.join(out, 'logo.svg');
writeFileSync(
  svg,
  '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: test -->\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect x="50" y="10" width="40" height="30" fill="#ff0000"/></svg>\n',
);
const eps = path.join(out, 'logo.eps');
writeFileSync(eps, '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n%%EndComments\n1 0 0 setrgbcolor 50 10 40 30 rectfill\nshowpage\n%%EOF\n');
const pdf = path.join(out, 'logo.pdf');
execFileSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=pdfwrite', `-sOutputFile=${pdf}`, eps]);
const ai = path.join(out, 'logo.ai'); // modern Illustrator files are PDF inside
copyFileSync(pdf, ai);

/* ---------------------------------------------------------- server */
const PORT = 4181;
const PASSWORD = 'e2e-lösenord-12345';
const dataDir = mkdtempSync(path.join(tmpdir(), 'klipp-e2e-vec-'));
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

/** A row of RGB pixels from an image file. */
function row(png, x, y, w) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-vf', `crop=${w}:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const px = [];
  for (let i = 0; i < w; i++) px.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]);
  return px;
}
const isRed = ([r, g, b]) => r > 190 && g < 80 && b < 80;
const isBlue = ([r, g, b]) => b > 190 && r < 90 && g < 120;
/** Pixels that are neither the film's blue nor the artwork's red: the width of a soft edge. */
const blurWidth = (px) => px.filter((p) => !isRed(p) && !isBlue(p)).length;

try {
  await waitForServer();
  // admin: a customer project with its own template uploads allowed
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const adminReq = (method, url, body) =>
    fetch(`${base}${url}`, { method, headers: { cookie, origin: base, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  const ws = await adminReq('POST', '/api/admin/workspaces', { name: 'Grafikkund' });
  await adminReq('PATCH', `/api/admin/workspaces/${ws.id}`, { allowCustomerUploads: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/p/${ws.shareToken}`);
  await page.getByTestId('project-manager').waitFor();

  /* ------------------------------------------------ no file formats for templates */
  const pmText = await page.evaluate(() => document.body.innerText);
  check(!/\.riv|Rive/i.test(pmText) && pmText.includes('Ladda upp mall'), 'projekthanteraren nämner inte mallarnas filformat ("Ladda upp mall")');

  await page.getByRole('button', { name: 'Skapa' }).first().click();
  await page.getByLabel('Namn', { exact: true }).fill('Grafik');
  await page.getByTestId('create-dialog').getByRole('radio', { name: /16:9/ }).click();
  await page.getByRole('button', { name: 'Skapa och öppna' }).click();
  await page.waitForURL(/\/p\/[^/]+\/c\/cmp_/);
  await page.waitForFunction(() => window.__editor?.getState().composition?.name === 'Grafik', null, { timeout: 20000 });
  const edText = await page.evaluate(() => document.body.innerText);
  check(!/\.riv|Rive/i.test(edText) && edText.includes('Ladda upp mall'), 'mallpanelen i editorn nämner inte filformatet');

  /* ------------------------------------------------ import all formats */
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.locator('input[type=file][accept*="mp4"]').setInputFiles([film, svg, pdf, ai, eps]);
  await page.waitForFunction(() => window.__editor.getState().history.present.project.assets.length === 5 && window.__editor.getState().uploads.length === 0, null, {
    timeout: 60000,
  });
  const assets = await page.evaluate(() => window.__editor.getState().history.present.project.assets);
  const vec = (n) => assets.find((a) => a.name === n);
  check(vec('logo.svg')?.vector === 'svg' && vec('logo.pdf')?.vector === 'pdf' && vec('logo.ai')?.vector === 'pdf', 'SVG, PDF och AI importeras som vektorgrafik');
  check(vec('logo.eps')?.vector === 'pdf' && vec('logo.eps')?.mime === 'application/pdf', 'EPS konverteras till PDF av servern och används som vektorgrafik');
  check(assets.filter((a) => a.vector).every((a) => Math.abs(a.width / a.height - 2) < 0.01), 'grafikens proportioner läses ur filerna (2:1)');
  const media = await page.evaluate(() => window.__editor.getState().serverMedia.map((m) => m.mime).sort());
  check(media.join() === 'application/pdf,application/pdf,application/pdf,image/svg+xml,video/mp4', 'alla filer sparas i projektet på servern');
  await page.waitForFunction(() => document.querySelectorAll('[data-asset-kind=image] img').length === 4, null, { timeout: 20000 });
  check(true, 'miniatyrer för all vektorgrafik i mediapanelen');

  // film 0–6 s on V1; each graphic for 1 s on the graphics track
  const fps = await page.evaluate(() => {
    const f = window.__editor.getState().history.present.project.settings.fps;
    return f.num / f.den;
  });
  const add = async (name, sec) => {
    await page.evaluate((f) => window.__editor.getState().setPlayhead(f), Math.round(sec * fps));
    const tile = page.locator(`.lib-item[aria-label$=": ${name}"]`);
    await tile.hover();
    await tile.locator('.lib-add').click();
    await page.waitForTimeout(200);
  };
  await add('blue.mp4', 0);
  const plan = [
    ['logo.svg', 0, 800],
    ['logo.pdf', 1, 800],
    ['logo.ai', 2, 100],
    ['logo.eps', 3, 100],
  ];
  for (const [name, sec, scale] of plan) {
    await add(name, sec);
    // one second long
    await page.evaluate((d) => {
      const s = window.__editor.getState();
      const id = s.selection;
      s.apply((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => (x.id === id ? { ...x, duration: d } : x)) })) }), 'kortare');
    }, Math.round(fps));
    if (scale !== 100) await page.getByTestId('xf-scale').fill(String(scale));
  }
  const clips = await page.evaluate(() => window.__editor.getState().history.present.project.tracks.flatMap((t) => t.clips.map((c) => ({ kind: c.kind, start: c.start, scale: c.transform?.scale?.value ?? 1 }))));
  check(clips.filter((c) => c.kind === 'image').length === 4 && clips.some((c) => c.kind === 'image' && Math.abs(c.scale - 8) < 1e-6), 'fyra grafikklipp på tidslinjen, två uppskalade 800 %');
  check((await page.getByTestId('vector-note').count()) === 1, 'egenskapspanelen visar att klippet är vektorgrafik');

  /* ------------------------------------------------ preview: sharp and transparent */
  for (const [name, sec] of [
    ['SVG', 0.4],
    ['PDF', 1.4],
  ]) {
    await page.evaluate((f) => window.__editor.getState().setPlayhead(f), Math.round(sec * fps));
    await page.waitForTimeout(1500); // the sharp rendering arrives asynchronously
    const prev = await page.evaluate(() => {
      const c = document.querySelector('[data-testid=preview-canvas]');
      const o = new OffscreenCanvas(c.width, c.height);
      const x = o.getContext('2d');
      x.drawImage(c, 0, 0);
      const y = Math.round(c.height / 2);
      const d = x.getImageData(Math.round(c.width / 2) - 12, y, 24, 1).data;
      const px = [];
      for (let i = 0; i < 24; i++) px.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
      return px;
    });
    check(isBlue(prev[0]) && isRed(prev[23]), `förhandsvisning ${name}: film till vänster om kanten (genomskinligt), rött till höger`);
    check(blurWidth(prev) <= 2, `förhandsvisning ${name}: kanten är skarp vid 800 % (${blurWidth(prev)} px övergång)`);
  }
  await page.screenshot({ path: path.join(out, 'vector-preview.png') });

  /* ------------------------------------------------ Space: play and pause at the playhead */
  await page.evaluate(() => window.__editor.getState().setPlayhead(20));
  await page.evaluate(() => window.__editor.getState().select(null));
  await page.getByRole('button', { name: 'Spela upp' }).focus(); // Space must not also "click" a focused button
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__editor.getState().playing, null, { timeout: 5000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__editor.getState().playing, null, { timeout: 5000 });
  const stoppedAt = await page.evaluate(() => window.__editor.getState().playhead);
  check(stoppedAt > 20, `mellanslag spelar från tidsmarkören och pausar (stannade vid bildruta ${stoppedAt})`);
  await page.waitForTimeout(500);
  check((await page.evaluate(() => window.__editor.getState().playhead)) === stoppedAt, 'tidsmarkören står kvar där uppspelningen pausades');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__editor.getState().playing, null, { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__editor.getState().playing, null, { timeout: 5000 });
  const resumed = await page.evaluate(() => window.__editor.getState().playhead);
  check(resumed > stoppedAt && resumed < stoppedAt + 40, `mellanslag igen fortsätter från tidsmarkören (${stoppedAt} → ${resumed})`);

  /* ------------------------------------------------ export and measure */
  await page.getByRole('button', { name: 'Exportera' }).first().click();
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await page.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 240000 });
  if (await page.getByTestId('export-error').count()) throw new Error('Export: ' + (await page.getByTestId('export-error').textContent()));
  const dlP = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  const file = path.join(out, 'vector-export.mp4');
  await (await dlP).saveAs(file);
  const frameAt = (sec, name) => {
    const png = path.join(out, name);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(sec), '-i', file, '-frames:v', '1', png]);
    return png;
  };
  for (const [name, sec, scale] of plan) {
    const png = frameAt(sec + 0.4, `vector-${path.extname(name).slice(1)}.png`);
    if (scale === 800) {
      // at 800 % the rectangle's left edge is at the centre of the frame
      const px = row(png, 960 - 16, 540, 32);
      check(isBlue(px[0]) && isRed(px[31]) && blurWidth(px) <= 3, `export ${name} vid 800 %: skarp kant (${blurWidth(px)} px övergång), film syns genom det genomskinliga`);
    } else {
      // at 100 %: 1920 × 960, rectangle from x 960 to 1728, y 252 to 828
      const inside = row(png, 1300, 540, 1)[0];
      const outside = row(png, 500, 540, 1)[0];
      const edge = row(png, 960 - 6, 540, 12);
      check(isRed(inside) && isBlue(outside) && blurWidth(edge) <= 3, `export ${name}: rätt placering, genomskinlig bakgrund, skarp kant (${blurWidth(edge)} px)`);
    }
  }

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

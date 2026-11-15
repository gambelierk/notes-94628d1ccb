// End-to-end: the admin gives a customer project its own look (accent colour,
// heading font from a font file, logo) and the customer's pages show it,
// while the admin pages and other customers keep the default look.
//
// Requires: pnpm build, Playwright with Chromium, ffmpeg, python3 + Pillow.
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.e2e');
mkdirSync(out, { recursive: true });

const logo = path.join(out, 'brand-logo.svg');
writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30" viewBox="0 0 120 30"><rect width="30" height="30" rx="6" fill="#ff5a1f"/><rect x="38" y="8" width="80" height="14" fill="#ffffff"/></svg>');
// a real font file standing in for a customer's brand typeface
const fontDir = path.join(root, 'node_modules/.pnpm');
const plex = readdirSync(fontDir).find((d) => d.startsWith('@fontsource+ibm-plex-mono@'));
const font = path.join(out, 'Acme_Display-Bold.woff2');
copyFileSync(path.join(fontDir, plex, 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'), font);

const PORT = 4182;
const PASSWORD = 'e2e-lösenord-12345';
const dataDir = mkdtempSync(path.join(tmpdir(), 'klipp-e2e-brand-'));
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

/** Computed look of a page: accent, the primary button's colours, heading font and logo. */
const look = (page) =>
  page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const btn = document.querySelector('.btn.primary');
    const h = document.querySelector('h1, .project-name');
    const img = document.querySelector('[data-testid=brand-logo]');
    return {
      accent: css.getPropertyValue('--accent').trim(),
      button: btn ? getComputedStyle(btn).backgroundColor : null,
      buttonText: btn ? getComputedStyle(btn).color : null,
      heading: h ? getComputedStyle(h).fontFamily : null,
      logo: img ? { loaded: img.complete && img.naturalWidth > 0, src: img.getAttribute('src') } : null,
      icon: document.querySelector('link[rel~=icon]')?.getAttribute('href') ?? '',
      brandFontReady: [...document.fonts].some((f) => f.family.includes('KlippBrand-page-heading') && f.status === 'loaded'),
    };
  });

try {
  await waitForServer();
  const browser = await chromium.launch();
  const errors = [];

  /* ------------------------------------------------ admin */
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  admin.on('pageerror', (e) => errors.push('admin: ' + e));
  await admin.goto(`${base}/admin`);
  await admin.getByLabel('Lösenord').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Logga in' }).click();
  for (const name of ['Annan kund', 'Acme AB']) {
    await admin.getByLabel('Namn på nytt kundprojekt').fill(name);
    await admin.getByRole('button', { name: 'Skapa kundprojekt' }).click();
    await admin.waitForFunction((n) => document.querySelector('[aria-label="Kundprojektets namn"]')?.value === n, name);
  }
  const otherLink = await admin.evaluate(async () => {
    const ws = await (await fetch('/api/admin/workspaces')).json();
    return `${location.origin}/p/${ws.find((w) => w.name === 'Annan kund').shareToken}`;
  });
  const card = admin.getByTestId('branding-card');
  await card.waitFor();
  check((await card.getByLabel('Typsnitt för rubriker').inputValue()) === 'plex-sans', 'admin: standard är grått med IBM Plex Sans');

  await card.getByTestId('brand-hex').fill('#ff5a1f');
  await admin.waitForTimeout(900); // saved after a short pause
  await card.getByTestId('brand-logo-upload').setInputFiles(logo);
  await card.locator('.brand-logo-box img').waitFor();
  await card.getByTestId('brand-logo-plate').selectOption('accent');
  await admin.waitForFunction(() => document.querySelector('[data-testid=brand-preview] .brand-custom.plate-accent'));
  await card.getByTestId('brand-font-upload-heading').setInputFiles(font);
  await card.getByTestId('brand-font-heading').waitFor();
  check((await card.getByTestId('brand-font-heading').textContent()).includes('Acme Display Bold'), 'admin: eget rubriktypsnitt uppladdat ("Acme Display Bold", WOFF2)');
  await card.getByLabel('Typsnitt för text').selectOption('serif');
  await admin.waitForTimeout(400);

  // top section: its own background; text and buttons left on automatic must stay readable
  await card.getByTestId('brand-topbar-background').fill('#ffe14d');
  await admin.waitForTimeout(900);
  const prevTop = await card.getByTestId('brand-preview').locator('.bp-top').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
  check(prevTop[0] === 'rgb(255, 225, 77)' && prevTop[1] === 'rgb(12, 12, 12)', `admin: förhandsvisningen visar övre sektionens färg med mörk text (${prevTop.join(' / ')})`);

  const prevBtn = await card.getByTestId('brand-preview').locator('.bp-body .btn.primary').evaluate((e) => getComputedStyle(e).backgroundColor);
  check(prevBtn === 'rgb(255, 90, 31)', `admin: förhandsvisningen visar accentfärgen (${prevBtn})`);
  const adminLook = await look(admin);
  check(adminLook.accent === '#ececec', 'admin: adminsidorna behåller sitt eget utseende');
  await card.screenshot({ path: path.join(out, 'branding-admin.png') });
  const link = await admin.getByTestId('share-link').inputValue();

  /* ------------------------------------------------ customer */
  const cust = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 })).newPage();
  cust.on('pageerror', (e) => errors.push('kund: ' + e));
  await cust.goto(link);
  await cust.getByTestId('project-manager').waitFor();
  await cust.waitForFunction(() => document.querySelector('[data-testid=brand-logo]')?.complete, null, { timeout: 15000 });
  await cust.waitForFunction(() => [...document.fonts].some((f) => f.family.includes('KlippBrand-page-heading') && f.status === 'loaded'), null, { timeout: 15000 });
  let l = await look(cust);
  check(l.accent === '#ff5a1f' && l.button === 'rgb(255, 90, 31)', `kund: knappar i kundens accentfärg (${l.button})`);
  check(l.buttonText === 'rgb(12, 12, 12)', 'kund: texten på knapparna får läsbar kontrast (mörk på orange)');
  check(l.logo?.loaded && l.icon === l.logo.src, 'kund: kundens logotyp uppe till vänster och som flikikon');
  const plate = await cust.getByTestId('brand-mark').evaluate((e) => getComputedStyle(e).backgroundColor);
  check(plate === 'rgb(255, 90, 31)', `kund: logotypen ligger på en platta i accentfärgen (${plate})`);
  check(l.heading?.includes('KlippBrand-page-heading') && l.brandFontReady, 'kund: rubrikerna i kundens eget typsnitt');
  const bodyFont = await cust.evaluate(() => getComputedStyle(document.body).fontFamily);
  check(bodyFont.includes('Georgia'), 'kund: brödtexten i valt förval (Serif)');
  await cust.screenshot({ path: path.join(out, 'branding-customer.png') });

  // the editor too
  await cust.getByRole('button', { name: 'Skapa' }).first().click();
  await cust.getByLabel('Namn', { exact: true }).fill('Kampanj');
  await cust.getByRole('button', { name: 'Skapa och öppna' }).click();
  await cust.waitForURL(/\/c\/cmp_/);
  await cust.waitForFunction(() => document.querySelector('[data-testid=brand-logo]')?.complete, null, { timeout: 20000 });
  l = await look(cust);
  check(l.accent === '#ff5a1f' && l.logo?.loaded, 'kund: editorn har samma färg och logotyp');
  await cust.screenshot({ path: path.join(out, 'branding-editor.png') });

  // top section colours in the editor
  const top = () =>
    cust.getByTestId('topbar').evaluate((e) => {
      const b = e.querySelector('.btn.primary');
      return { bg: getComputedStyle(e).backgroundColor, text: getComputedStyle(e).color, btn: getComputedStyle(b).backgroundColor, btnText: getComputedStyle(b).color };
    });
  let tb = await top();
  check(tb.bg === 'rgb(255, 225, 77)' && tb.text === 'rgb(12, 12, 12)', `kund: övre sektionen i vald färg, texten väljs automatiskt mörk (${tb.bg})`);
  check(tb.btn === 'rgb(255, 90, 31)' && tb.btnText === 'rgb(12, 12, 12)', 'kund: knappen i övre sektionen behåller accentfärgen när inget annat valts');
  await card.getByTestId('brand-topbar-text').fill('#102030');
  await card.getByTestId('brand-topbar-button').fill('#000000');
  await card.getByTestId('brand-topbar-buttonText').fill('#ffee00');
  await admin.waitForTimeout(900);
  await cust.reload();
  await cust.waitForFunction(() => document.querySelector('[data-testid=brand-logo]')?.complete && window.__editor?.getState().composition, null, { timeout: 20000 });
  await cust.waitForFunction(() => [...document.fonts].some((f) => f.family === 'KlippBrand-page-heading' && f.status === 'loaded'), null, { timeout: 15000 });
  tb = await top();
  check(
    tb.text === 'rgb(16, 32, 48)' && tb.btn === 'rgb(0, 0, 0)' && tb.btnText === 'rgb(255, 238, 0)',
    `kund: egna färger på text, knappar och knapptext i övre sektionen (${tb.text} / ${tb.btn} / ${tb.btnText})`,
  );
  const mainBtn = await cust.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  check(mainBtn === '#ff5a1f', 'kund: resten av sidan behåller accentfärgen');

  /* ---- the customer's typeface in text presets, in the preview and in the exported film ---- */
  await cust.getByRole('tab', { name: 'Text' }).click();
  const sample = await cust.locator('[data-text-preset=title] .text-preset-sample').evaluate((e) => getComputedStyle(e).fontFamily);
  check(sample.includes('KlippBrand-page-heading'), 'kund: textmallarna visas i kundens typsnitt');
  await cust.locator('[data-text-preset=title]').hover();
  await cust.locator('[data-text-preset=title] .lib-add').click();
  await cust.getByTestId('text-inspector').locator('textarea').fill('illiilli');
  const clip = await cust.evaluate(() => {
    const s = window.__editor.getState();
    const p = s.history.present.project;
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.kind === 'text');
    const px = c.style.size * p.settings.height;
    const m = new OffscreenCanvas(1, 1).getContext('2d');
    const w = (fam) => {
      m.font = `${c.style.weight} ${px}px ${fam}`;
      return m.measureText('illiilli').width;
    };
    return { font: c.style.font, brand: w('"KlippBrand-page-heading"'), plex: w('"IBM Plex Sans Variable"'), W: p.settings.width };
  });
  check(clip.font === 'brand-heading', 'kund: en ny rubrik får kundens rubriktypsnitt');
  const opts = await cust.getByTestId('text-inspector').locator('select').first().locator('option').allTextContents();
  check(opts.some((o) => o.startsWith('Acme Display Bold')), `kund: kundens typsnitt går att välja för text (${opts.join(', ')})`);
  await cust.evaluate(() => window.__editor.getState().setPlayhead(10));
  await cust.waitForTimeout(1000);
  // width of the white text, in project pixels, in a picture
  const inkWidth = (png, W) => {
    const s = execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('L')
box = im.point(lambda v: 255 if v > 170 else 0).getbbox()
print((box[2] - box[0]) * float(sys.argv[2]) / im.width if box else 0)`, png, String(W)]);
    return Number(s.toString());
  };
  const prevPng = path.join(out, 'branding-text-preview.png');
  await cust.getByTestId('preview-canvas').screenshot({ path: prevPng });
  await cust.evaluate(() => window.__editor.getState().select(null));
  await cust.waitForTimeout(300);
  await cust.getByTestId('preview-canvas').screenshot({ path: prevPng });
  const pw = inkWidth(prevPng, clip.W);
  check(Math.abs(pw - clip.brand) < Math.abs(pw - clip.plex) && Math.abs(pw - clip.brand) / clip.brand < 0.08, `förhandsvisning: rubriken ritas i kundens typsnitt (bredd ${Math.round(pw)} px; kundens ${Math.round(clip.brand)}, standard ${Math.round(clip.plex)})`);

  await cust.getByRole('button', { name: 'Exportera' }).first().click();
  await cust.getByTestId('export-dialog').getByRole('button', { name: 'Exportera' }).click();
  await cust.locator('[data-testid=export-done], [data-testid=export-error]').first().waitFor({ timeout: 180000 });
  if (await cust.getByTestId('export-error').count()) throw new Error('Export: ' + (await cust.getByTestId('export-error').textContent()));
  const dlP = cust.waitForEvent('download');
  await cust.getByTestId('export-download').click();
  const mp4 = path.join(out, 'branding-export.mp4');
  await (await dlP).saveAs(mp4);
  const frame = path.join(out, 'branding-export.png');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', frame]);
  const ew = inkWidth(frame, clip.W);
  check(Math.abs(ew - clip.brand) < Math.abs(ew - clip.plex) && Math.abs(ew - clip.brand) / clip.brand < 0.08, `export: rubriken i filmen är satt i kundens typsnitt (bredd ${Math.round(ew)} px)`);
  await cust.keyboard.press('Escape');

  // another customer is not affected
  const other = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await other.goto(otherLink);
  await other.getByTestId('project-manager').waitFor();
  await other.waitForTimeout(500);
  l = await look(other);
  check(l.accent === '#ececec' && !l.logo, 'annan kund: standardutseendet, ingen logotyp');

  // the admin resets: back to default for the customer
  await card.getByRole('button', { name: 'Standard (grå)' }).click();
  await card.getByRole('button', { name: 'Ta bort logotypen' }).click();
  await admin.waitForTimeout(900);
  await cust.goto(link);
  await cust.getByTestId('project-manager').waitFor();
  await cust.waitForTimeout(500);
  l = await look(cust);
  check(l.accent === '#ececec' && !l.logo, 'återställt: kunden får standardfärg och Klipps logotyp igen');

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

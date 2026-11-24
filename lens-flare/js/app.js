(function () {
  const F = window.Flare;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ *
   *  Parametrar
   *  sim:true  → påverkar placering/livslängd (kräver ny simulering)
   *  sim:false → påverkar bara utseende (omedelbar)
   * ------------------------------------------------------------------ */
  const EASE_OPTS = [['linear', 'Linjär'], ['smooth', 'Mjuk (S-kurva)'], ['out', 'Snabb start, mjuk slut'], ['in', 'Mjuk start, snabb slut'], ['expo', 'Exponentiell ut']];

  const SCHEMA = [
    { title: 'Placering', open: true, items: [
      { k: 'seed', t: 'seed', label: 'Seed', sim: true, help: 'Samma seed ger exakt samma resultat. Slå tärningen för en ny variant.' },
      { k: 'rate', t: 'range', label: 'Frekvens (flares/sek)', min: 0, max: 40, step: 0.1, def: 4, sim: true },
      { k: 'maxActive', t: 'range', label: 'Max samtidiga', min: 1, max: 120, step: 1, def: 30, sim: true },
      { k: 'threshold', t: 'range', label: 'Highlight-tröskel', min: 1, max: 254, step: 1, def: 200, sim: true, help: 'Pixlar ljusare än detta (0–255) kan få en flare.' },
      { k: 'brightWeight', t: 'range', label: 'Ljusstyrkeviktning', min: 0, max: 6, step: 0.1, def: 1.5, sim: true, help: '0 = alla vita pixlar lika troliga. Högre = starkare förkärlek för de ljusaste.' },
      { k: 'variation', t: 'range', label: 'Variation (undvik upprepning)', min: 0, max: 1, step: 0.01, def: 0.95, sim: true, help: 'Hur starkt områden som nyligen använts undviks. 1 = aldrig samma ställe förrän återhämtningen är klar.' },
      { k: 'minDist', t: 'range', label: 'Minsta avstånd (% av bredd)', min: 0.5, max: 40, step: 0.5, def: 8, unit: '%', sim: true },
      { k: 'cooldown', t: 'range', label: 'Återhämtningstid (s)', min: 0, max: 20, step: 0.1, def: 3, unit: 's', sim: true, help: 'Hur lång tid ett område är "varmt" efter att en flare funnits där.' },
    ]},
    { title: 'Följ highlights', open: true, items: [
      { k: 'follow', t: 'range', label: 'Följ rörelse', min: 0, max: 1, step: 0.01, def: 1, sim: true, help: '0 = flaren står still där den föddes. 1 = följer highlightens rörelse fullt ut.' },
      { k: 'trackPatch', t: 'range', label: 'Spårningsyta (% av bredd)', min: 1, max: 15, step: 0.5, def: 4, unit: '%', sim: true, help: 'Området runt flaren som matchas mellan bildrutor.' },
      { k: 'trackRange', t: 'range', label: 'Spårningsräckvidd (%/ruta)', min: 0.5, max: 12, step: 0.5, def: 3, unit: '%', sim: true, help: 'Max rörelse per bildruta som kan följas.' },
      { k: 'loseFade', t: 'range', label: 'Tona ut när highlight försvinner', min: 0, max: 1, step: 0.01, def: 0.8 },
    ]},
    { title: 'Livslängd & animation', open: true, items: [
      { k: 'lifeMin', t: 'range', label: 'Livslängd min (s)', min: 0.05, max: 10, step: 0.05, def: 0.7, unit: 's', sim: true },
      { k: 'lifeMax', t: 'range', label: 'Livslängd max (s)', min: 0.05, max: 10, step: 0.05, def: 1.6, unit: 's', sim: true },
      { k: 'attack', t: 'range', label: 'Intoning (% av livet)', min: 1, max: 95, step: 1, def: 20, unit: '%', scale: 100 },
      { k: 'release', t: 'range', label: 'Utskalning (% av livet)', min: 1, max: 99, step: 1, def: 55, unit: '%', scale: 100, help: 'Tiden mellan in och ut är full storlek.' },
      { k: 'easeIn', t: 'select', label: 'Kurva in', opts: EASE_OPTS, def: 'out' },
      { k: 'easeOut', t: 'select', label: 'Kurva ut (skala → 0)', opts: EASE_OPTS, def: 'smooth' },
      { k: 'fade', t: 'range', label: 'Intensitet följer skala', min: 0, max: 1, step: 0.01, def: 0.5 },
      { k: 'twinkle', t: 'range', label: 'Flimmer', min: 0, max: 1, step: 0.01, def: 0.15 },
      { k: 'twinkleSpeed', t: 'range', label: 'Flimmerhastighet (Hz)', min: 0.2, max: 20, step: 0.1, def: 3, unit: 'Hz' },
    ]},
    { title: 'Rotation', open: true, items: [
      { k: 'rotTotal', t: 'range', label: 'Total rotation under livet (°)', min: -720, max: 720, step: 1, def: 60, unit: '°' },
      { k: 'rotRandom', t: 'range', label: 'Slumpad mängd', min: 0, max: 1, step: 0.01, def: 0.5 },
      { k: 'rotDir', t: 'select', label: 'Riktning', opts: [['random', 'Slumpad'], ['+', 'Medurs'], ['-', 'Moturs']], def: 'random' },
      { k: 'rotEase', t: 'select', label: 'Rotationskurva', opts: EASE_OPTS, def: 'smooth' },
      { k: 'rotStartRange', t: 'range', label: 'Slumpad startvinkel (±°)', min: 0, max: 180, step: 1, def: 90, unit: '°' },
    ]},
    { title: 'Storlek & intensitet', open: true, items: [
      { k: 'size', t: 'range', label: 'Storlek (px vid 1080p)', min: 5, max: 600, step: 1, def: 80, unit: 'px' },
      { k: 'sizeJitter', t: 'range', label: 'Storleksvariation', min: 0, max: 0.95, step: 0.01, def: 0.35 },
      { k: 'intensity', t: 'range', label: 'Intensitet', min: 0, max: 4, step: 0.01, def: 1 },
      { k: 'intJitter', t: 'range', label: 'Intensitetsvariation', min: 0, max: 1, step: 0.01, def: 0.4 },
    ]},
    { title: 'Strålar', open: true, items: [
      { k: 'rays', t: 'range', label: 'Antal strålar (linjer, ×2 spetsar)', min: 0, max: 16, step: 1, def: 7 },
      { k: 'rayLen', t: 'range', label: 'Strållängd (× storlek)', min: 0.2, max: 15, step: 0.05, def: 3.2 },
      { k: 'rayLenRand', t: 'range', label: 'Längdvariation', min: 0, max: 1, step: 0.01, def: 0.55 },
      { k: 'rayAsym', t: 'range', label: 'Asymmetri (sida mot sida)', min: 0, max: 1, step: 0.01, def: 0.6 },
      { k: 'rayThick', t: 'range', label: 'Tjocklek (% av storlek)', min: 0.1, max: 12, step: 0.1, def: 1.2, unit: '%' },
      { k: 'rayFalloff', t: 'range', label: 'Avtagande', min: 0.2, max: 4, step: 0.05, def: 1.3 },
      { k: 'rayInt', t: 'range', label: 'Stråleffekt', min: 0, max: 3, step: 0.01, def: 0.8 },
      { k: 'rayAngleJit', t: 'range', label: 'Vinkelslump', min: 0, max: 1, step: 0.01, def: 0.35 },
      { k: 'softness', t: 'range', label: 'Mjukhet', min: 0, max: 1, step: 0.01, def: 0.2, help: 'Gör strålar och streak bredare och mjukare.' },
    ]},
    { title: 'Kärna & glow', open: false, items: [
      { k: 'coreInt', t: 'range', label: 'Kärna – intensitet', min: 0, max: 5, step: 0.01, def: 1.2 },
      { k: 'coreSize', t: 'range', label: 'Kärna – storlek', min: 0.02, max: 1.5, step: 0.01, def: 0.12 },
      { k: 'bloomInt', t: 'range', label: 'Glow – intensitet', min: 0, max: 3, step: 0.01, def: 0.4 },
      { k: 'bloomSize', t: 'range', label: 'Glow – storlek', min: 0.1, max: 4, step: 0.01, def: 0.6 },
    ]},
    { title: 'Anamorfisk streak', open: false, items: [
      { k: 'streakInt', t: 'range', label: 'Intensitet', min: 0, max: 3, step: 0.01, def: 0.5 },
      { k: 'streakLen', t: 'range', label: 'Längd (× storlek)', min: 0.2, max: 20, step: 0.1, def: 3 },
      { k: 'streakThick', t: 'range', label: 'Tjocklek (× storlek)', min: 0.005, max: 0.5, step: 0.005, def: 0.04 },
      { k: 'streakAngle', t: 'range', label: 'Vinkel (°)', min: -90, max: 90, step: 1, def: 0, unit: '°' },
    ]},
    { title: 'Halo & ghosts', open: false, items: [
      { k: 'ringInt', t: 'range', label: 'Halo – intensitet', min: 0, max: 3, step: 0.01, def: 0 },
      { k: 'ringR', t: 'range', label: 'Halo – radie', min: 0.1, max: 4, step: 0.01, def: 0.9 },
      { k: 'ringW', t: 'range', label: 'Halo – tjocklek', min: 0.005, max: 1, step: 0.005, def: 0.06 },
      { k: 'ghostCount', t: 'range', label: 'Ghost-antal', min: 0, max: 3, step: 1, def: 0 },
      { k: 'ghostInt', t: 'range', label: 'Ghost – intensitet', min: 0, max: 3, step: 0.01, def: 0.5 },
      { k: 'ghostSize', t: 'range', label: 'Ghost – storlek (× storlek)', min: 0.1, max: 3, step: 0.01, def: 0.5 },
      { k: 'ghostDist', t: 'range', label: 'Ghost – avstånd från bildens mitt', min: -2, max: 2, step: 0.01, def: 0.8 },
    ]},
    { title: 'Färg', open: false, items: [
      { k: 'tint', t: 'color', label: 'Färgton', def: '#ffffff' },
      { k: 'chroma', t: 'range', label: 'Regnbågsspridning', min: 0, max: 1, step: 0.01, def: 0 },
    ]},
    { title: 'Efterbehandling', open: false, items: [
      { k: 'exposure', t: 'range', label: 'Exponering', min: 0.1, max: 4, step: 0.01, def: 1 },
      { k: 'rolloff', t: 'range', label: 'Mjuk clipping (highlight roll-off)', min: 0, max: 1, step: 0.01, def: 0.5 },
      { k: 'grain', t: 'range', label: 'Filmkorn', min: 0, max: 1, step: 0.01, def: 0.15 },
    ]},
  ];

  const DEFAULTS = {};
  for (const g of SCHEMA) for (const it of g.items) DEFAULTS[it.k] = it.t === 'seed' ? 1234 : it.def;
  // attack/release visas i procent men lagras som bråkdel
  DEFAULTS.attack = 0.2; DEFAULTS.release = 0.55;

  const PRESETS = {
    'Standard': {},
    'Referens – mjuk glow': { size: 95, rays: 7, rayLen: 3.6, rayThick: 0.9, rayInt: 0.75, rayLenRand: 0.6, softness: 0.3, bloomInt: 0.55, bloomSize: 0.8, coreInt: 1.3, streakInt: 0.35, streakLen: 3.5, chroma: 0.12, grain: 0.3, rolloff: 0.65, rate: 3, lifeMin: 0.9, lifeMax: 1.9 },
    'Skarp stjärna': { size: 70, rays: 4, rayLen: 5, rayThick: 0.5, rayFalloff: 0.9, rayInt: 1, rayLenRand: 0.25, rayAsym: 0.2, softness: 0, streakInt: 0, bloomInt: 0.25, grain: 0, rotTotal: 45 },
    'Anamorfisk streak': { size: 60, rays: 2, rayInt: 0.35, streakInt: 1.1, streakLen: 8, streakThick: 0.03, bloomInt: 0.5, coreInt: 1.4, rotTotal: 0, rotStartRange: 0, grain: 0.1 },
    'Glitter (många små)': { rate: 18, size: 28, lifeMin: 0.25, lifeMax: 0.7, rays: 5, rayLen: 4, minDist: 4, cooldown: 1.2, maxActive: 80, bloomInt: 0.2, streakInt: 0.2, rotTotal: 120, grain: 0.1 },
  };

  /* ------------------------------------------------------------------ */
  let P = Object.assign({}, DEFAULTS);
  const state = {
    file: null, W: 0, H: 0, duration: 0, fps: 30, an: null, sim: null,
    frame: 0, playing: false, raf: 0, cancel: false, busy: false, renderer: null, simTimer: 0, loadToken: 0,
  };
  const els = {};
  const controls = {}; // k → { set(v) }

  const vid = $('vid'), cv = $('cv');

  /* ---------------- UI-generering ---------------- */
  function decimals(step) { const s = String(step); return s.includes('.') ? s.split('.')[1].length : 0; }

  function buildPanel() {
    const host = $('schema');
    for (const g of SCHEMA) {
      const d = document.createElement('details');
      d.className = 'grp'; d.open = g.open;
      d.innerHTML = '<summary></summary><div class="grp-body"></div>';
      d.querySelector('summary').textContent = g.title;
      const body = d.querySelector('.grp-body');
      for (const it of g.items) body.appendChild(buildRow(it));
      host.appendChild(d);
    }
  }

  function buildRow(it) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('label');
    label.textContent = it.label;
    if (it.help) label.title = it.help;
    if (it.sim) { const tg = document.createElement('span'); tg.className = 'tag'; tg.textContent = 'sim'; tg.title = 'Ändring beräknar om placeringen'; label.appendChild(tg); }
    row.appendChild(label);

    const commit = (v) => { P[it.k] = v; onParamChange(it); };

    if (it.t === 'range') {
      const sc = it.scale || 1;
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step;
      const out = document.createElement('output');
      const dec = decimals(it.step);
      const show = (v) => (out.textContent = v.toFixed(dec) + (it.unit ? ' ' + it.unit : ''));
      inp.addEventListener('input', () => { const v = parseFloat(inp.value) / sc; show(parseFloat(inp.value)); commit(v); });
      inp.addEventListener('dblclick', () => { controls[it.k].set(DEFAULTS[it.k]); commit(DEFAULTS[it.k]); });
      controls[it.k] = { set: (v) => { inp.value = v * sc; show(v * sc); } };
      row.append(inp, out);
    } else if (it.t === 'select') {
      const sel = document.createElement('select');
      for (const [v, l] of it.opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
      sel.addEventListener('change', () => commit(sel.value));
      controls[it.k] = { set: (v) => (sel.value = v) };
      row.appendChild(sel);
    } else if (it.t === 'color') {
      const c = document.createElement('input'); c.type = 'color';
      c.addEventListener('input', () => commit(c.value));
      controls[it.k] = { set: (v) => (c.value = v) };
      row.appendChild(c);
    } else if (it.t === 'seed') {
      row.className = 'row simple';
      const wrap = document.createElement('div'); wrap.style.display = 'flex'; wrap.style.gap = '6px';
      const n = document.createElement('input'); n.type = 'number'; n.min = 0; n.step = 1; n.style.flex = '1';
      const b = document.createElement('button'); b.className = 'btn dice'; b.textContent = '🎲'; b.title = 'Slumpa ny seed';
      n.addEventListener('change', () => commit(Math.max(0, Math.floor(+n.value || 0))));
      b.addEventListener('click', () => { const v = Math.floor(Math.random() * 99999); n.value = v; commit(v); });
      controls[it.k] = { set: (v) => (n.value = v) };
      wrap.append(n, b); row.appendChild(wrap);
    }
    return row;
  }

  function syncControls() { for (const k in controls) controls[k].set(P[k]); }

  /* ---------------- parametrar → effekter ---------------- */
  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; draw(); });
  }

  function onParamChange(it) {
    if (it && it.k === 'lifeMin' && P.lifeMax < P.lifeMin) { P.lifeMax = P.lifeMin; controls.lifeMax.set(P.lifeMax); }
    if (it && it.k === 'lifeMax' && P.lifeMin > P.lifeMax) { P.lifeMin = P.lifeMax; controls.lifeMin.set(P.lifeMin); }
    persist();
    if (it && it.sim) scheduleSim(); else requestRender();
  }

  function persist() { try { localStorage.setItem('flare.params', JSON.stringify(P)); } catch (e) { /* ignore */ } }

  function scheduleSim() {
    clearTimeout(state.simTimer);
    state.simTimer = setTimeout(() => { runSim(); requestRender(); }, 220);
  }

  function runSim() {
    if (!state.an) return;
    const t0 = performance.now();
    state.sim = F.simulate(state.an, state.fps, P);
    state.simMs = performance.now() - t0;
    updateStatus();
  }

  function updateStatus() {
    if (!state.an) { $('status').textContent = ''; return; }
    const n = state.sim ? state.sim.flares.length : 0;
    $('status').textContent = n + ' flares totalt · ' + state.an.n + ' bildrutor · ' + state.W + '×' + state.H + ' @ ' + state.fps + ' fps' +
      (state.sim ? ' · simulering ' + Math.round(state.simMs) + ' ms' : '');
  }

  /* ---------------- rendering / förhandsvisning ---------------- */
  function previewSize() {
    const sel = $('previewScale').value;
    let s = sel === 'auto' ? Math.min(1, 1280 / state.W) : parseFloat(sel);
    return [Math.max(2, Math.round(state.W * s)), Math.max(2, Math.round(state.H * s))];
  }

  function draw() {
    if (!state.renderer || !state.sim) return;
    const [w, h] = previewSize();
    state.renderer.setSize(w, h);
    const inst = F.buildInstances(state.sim, state.frame, P, w, h);
    state.renderer.render(inst, P, state.frame, false);
    updateTimecode();
  }

  function updateTimecode() {
    const f = state.frame, fps = Math.round(state.fps);
    const s = Math.floor(f / state.fps), ff = f - Math.round(s * state.fps);
    const pad = (n) => String(Math.max(0, n)).padStart(2, '0');
    $('timecode').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60) + ':' + pad(ff) + '  (' + f + ')';
    if (document.activeElement !== $('scrub')) $('scrub').value = f;
    void fps;
  }

  function tick() {
    if (!state.playing) return;
    if (state.an) {
      const f = Math.min(state.an.n - 1, Math.floor(vid.currentTime * state.fps));
      if (f !== state.frame) { state.frame = f; draw(); $('scrub').value = f; }
    }
    state.raf = requestAnimationFrame(tick);
  }

  function setPlaying(on) {
    if (on && !state.an) return;
    state.playing = on;
    $('play').textContent = on ? '⏸' : '▶';
    if (on) { vid.play().catch(() => {}); state.raf = requestAnimationFrame(tick); }
    else { vid.pause(); cancelAnimationFrame(state.raf); }
  }

  function seekFrame(f) {
    state.frame = Math.max(0, Math.min(state.an.n - 1, f));
    vid.currentTime = Math.min(vid.duration - 0.001, (state.frame + 0.5) / state.fps);
    draw();
  }

  /* ---------------- laddning & analys ---------------- */
  function showBusy(text, on) {
    $('busy').hidden = !on; $('busyText').textContent = text; state.busy = on;
  }

  async function loadFile(file) {
    if (!file || !file.type.startsWith('video/')) { $('status').textContent = 'Välj en videofil.'; return; }
    const token = ++state.loadToken;
    setPlaying(false);
    state.an = null; state.sim = null;
    if (state.file) URL.revokeObjectURL(vid.src);
    state.file = file;
    vid.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = () => rej(new Error('Kunde inte läsa videon.')); }).catch((e) => { $('status').textContent = e.message; });
    if (token !== state.loadToken || !vid.videoWidth) return;
    state.W = vid.videoWidth; state.H = vid.videoHeight; state.duration = vid.duration;
    $('drop').hidden = true; $('stageWrap').hidden = false; $('transport').hidden = false;
    $('stage').style.aspectRatio = state.W + ' / ' + state.H;
    sizeStage();
    if (!state.renderer) {
      try { state.renderer = F.createRenderer(cv); } catch (e) { $('status').textContent = e.message; return; }
    }
    showBusy('Läser av bildfrekvens…', true); $('busyCancel').hidden = true;
    state.fps = await F.detectFps(vid);
    $('busyCancel').hidden = false;
    setFpsOption(state.fps);
    $('srcInfo').textContent = file.name + ' – ' + state.W + '×' + state.H + ', ' + state.duration.toFixed(2) + ' s';
    $('expBitrate').value = Math.max(8, Math.min(200, Math.round((state.W * state.H * state.fps * 0.3) / 1e6)));
    await runAnalysis(token);
  }

  function sizeStage() {
    const st = $('stage');
    const maxH = Math.max(240, window.innerHeight - 220);
    const wrapW = $('stageWrap').clientWidth || 800;
    const scale = Math.min(wrapW / state.W, maxH / state.H, 1.6);
    st.style.width = Math.round(state.W * scale) + 'px';
    st.style.height = Math.round(state.H * scale) + 'px';
  }

  async function runAnalysis(token) {
    state.cancel = false;
    setPlaying(false);
    showBusy('Analyserar highlights…', true);
    $('busyBar').value = 0;
    $('exportBtn').disabled = true;
    let an = null;
    try {
      an = await F.analyzeVideo(vid, {
        fps: state.fps, maskWidth: parseInt($('maskRes').value, 10),
        onProgress: (p) => { $('busyBar').value = p; },
        isCancelled: () => state.cancel || token !== state.loadToken,
      });
    } catch (e) { $('status').textContent = 'Analysfel: ' + e.message; }
    showBusy('', false);
    if (!an || token !== state.loadToken) { $('status').textContent = an ? '' : 'Analysen avbröts.'; return; }
    state.an = an;
    $('scrub').max = an.n - 1;
    state.frame = 0;
    runSim();
    seekFrame(0);
    $('exportBtn').disabled = false;
    updateStatus();
  }

  function setFpsOption(fps) {
    const sel = $('fps');
    if (![...sel.options].some((o) => Math.abs(+o.value - fps) < 0.001)) {
      const o = document.createElement('option'); o.value = fps; o.textContent = fps + ' fps'; sel.appendChild(o);
    }
    sel.value = [...sel.options].find((o) => Math.abs(+o.value - fps) < 0.001).value;
  }

  /* ---------------- presets ---------------- */
  const USER_KEY = 'flare.userPresets';
  function userPresets() { try { return JSON.parse(localStorage.getItem(USER_KEY) || '{}'); } catch (e) { return {}; } }
  function refreshPresetList(selected) {
    const sel = $('preset'); sel.innerHTML = '';
    const add = (name, label) => { const o = document.createElement('option'); o.value = name; o.textContent = label; sel.appendChild(o); };
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = 'Förinställningar…'; sel.appendChild(ph);
    Object.keys(PRESETS).forEach((n) => add('b:' + n, n));
    Object.keys(userPresets()).forEach((n) => add('u:' + n, '★ ' + n));
    sel.value = selected || '';
    $('presetDel').hidden = !(sel.value || '').startsWith('u:');
  }
  function applyParams(obj, keepSeed) {
    const seed = P.seed;
    P = Object.assign({}, DEFAULTS, obj);
    if (keepSeed && !('seed' in obj)) P.seed = seed;
    syncControls(); persist();
    scheduleSim(); requestRender();
  }

  /* ---------------- export ---------------- */
  async function doExport() {
    if (!state.an || !state.sim) return;
    const fmt = $('expFormat').value;
    const W = state.W & ~1, H = state.H & ~1;
    const canvas = document.createElement('canvas');
    const r = F.createRenderer(canvas);
    r.setSize(W, H);
    const alpha = fmt === 'png';
    const renderFrame = (i) => r.render(F.buildInstances(state.sim, i, P, W, H), P, i, alpha);
    state.cancel = false;
    $('exportBtn').disabled = true; $('expBar').hidden = false; $('expCancel').hidden = false; $('expBar').value = 0; $('expMsg').textContent = '';
    setPlaying(false);
    const stamp = 'lensflare_s' + P.seed + '_' + W + 'x' + H + '_' + state.fps + 'fps';
    try {
      let blob, name;
      const common = { frames: state.an.n, canvas, renderFrame, onProgress: (p) => { $('expBar').value = p; }, isCancelled: () => state.cancel };
      if (fmt === 'png') {
        blob = await F.exportPNGZip(Object.assign({ prefix: 'flare_' }, common));
        name = stamp + '_png-alpha.zip';
      } else {
        blob = await F.exportMP4(Object.assign({ width: W, height: H, fps: state.fps, codec: fmt, bitrate: Math.round((+$('expBitrate').value || 40) * 1e6) }, common));
        name = stamp + (fmt === 'vp9' ? '_vp9' : '') + '.mp4';
      }
      if (blob) { await F.download(blob, name); $('expMsg').textContent = 'Klar: ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' MB)'; }
      else $('expMsg').textContent = 'Exporten avbröts.';
    } catch (e) {
      console.error(e);
      $('expMsg').textContent = e && e.code === 'declined' ? 'Sparandet avbröts.' : 'Exportfel: ' + (e.message || e.code);
    }
    $('exportBtn').disabled = false; $('expBar').hidden = true; $('expCancel').hidden = true;
    r.gl.getExtension('WEBGL_lose_context') && r.gl.getExtension('WEBGL_lose_context').loseContext();
    draw();
  }

  function updateExportUI() {
    const f = $('expFormat').value;
    $('rowBitrate').hidden = f === 'png';
    $('expNote').innerHTML = f === 'png'
      ? 'PNG-bilder med transparens (rak alfa), en fil per bildruta i en .zip. Packa upp och importera som sekvens i After Effects.'
      : 'Flare på ren svart bakgrund. Lägg lagret i After Effects med blandningsläge <b>Add</b> eller <b>Screen</b>.';
  }

  /* ---------------- init ---------------- */
  function init() {
    buildPanel();
    try { const saved = JSON.parse(localStorage.getItem('flare.params') || 'null'); if (saved) P = Object.assign({}, DEFAULTS, saved); } catch (e) { /* ignore */ }
    syncControls();
    refreshPresetList('');

    const fpsSel = $('fps');
    [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v + ' fps'; fpsSel.appendChild(o); });
    fpsSel.value = '30';

    $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
    $('drop').addEventListener('click', () => $('file').click());
    ['dragover', 'dragenter'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.remove('over'); }));
    window.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

    $('busyCancel').addEventListener('click', () => { state.cancel = true; });
    $('fps').addEventListener('change', () => { state.fps = parseFloat($('fps').value); if (state.file) runAnalysis(state.loadToken); });
    $('maskRes').addEventListener('change', () => { if (state.file) runAnalysis(state.loadToken); });
    $('previewScale').addEventListener('change', requestRender);
    $('overlay').addEventListener('input', () => { vid.style.opacity = $('overlay').value; $('overlayOut').textContent = (+$('overlay').value).toFixed(2); });
    vid.style.opacity = $('overlay').value;

    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('scrub').addEventListener('input', () => { setPlaying(false); seekFrame(parseInt($('scrub').value, 10)); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); setPlaying(!state.playing); }
      if (state.an && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        if (e.code === 'ArrowRight') { setPlaying(false); seekFrame(state.frame + 1); }
        if (e.code === 'ArrowLeft') { setPlaying(false); seekFrame(state.frame - 1); }
      }
    });
    window.addEventListener('resize', () => { if (state.W) sizeStage(); });

    $('preset').addEventListener('change', () => {
      const v = $('preset').value;
      $('presetDel').hidden = !v.startsWith('u:');
      if (v.startsWith('b:')) applyParams(PRESETS[v.slice(2)], true);
      else if (v.startsWith('u:')) applyParams(userPresets()[v.slice(2)] || {}, false);
    });
    const savePreset = () => {
      const inp = $('presetName');
      if (inp.hidden) { inp.hidden = false; inp.focus(); return; }
      const name = inp.value.trim();
      inp.hidden = true; inp.value = '';
      if (!name) return;
      const all = userPresets(); all[name] = Object.assign({}, P);
      try { localStorage.setItem(USER_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
      refreshPresetList('u:' + name);
    };
    $('presetSave').addEventListener('click', savePreset);
    $('presetName').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') { $('presetName').hidden = true; } });
    $('presetDel').addEventListener('click', () => {
      const v = $('preset').value; if (!v.startsWith('u:')) return;
      const all = userPresets(); delete all[v.slice(2)];
      try { localStorage.setItem(USER_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
      refreshPresetList('');
    });
    $('jsonSave').addEventListener('click', () => Promise.resolve(F.download(new Blob([JSON.stringify({ app: 'lens-flare', version: 1, params: P }, null, 2)], { type: 'application/json' }), 'lensflare-preset.json')).catch(() => {}));
    $('jsonLoad').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); applyParams(j.params || j, false); } catch (err) { $('status').textContent = 'Ogiltig JSON.'; }
      e.target.value = '';
    });

    $('expFormat').addEventListener('change', updateExportUI);
    updateExportUI();
    $('exportBtn').addEventListener('click', doExport);
    $('expCancel').addEventListener('click', () => { state.cancel = true; });

    // för felsökning / automatiska tester
    window.FlareApp = { P: () => P, state, applyParams, loadFile, doExport, draw, setPlaying };
  }

  init();
})();

/*
 * Lens Flare Generator – engine
 *  - analyzeVideo: läser highlight-videon bildruta för bildruta till låg­upplösta masker
 *  - simulate:     deterministisk placering/spårning av flares (seed + masker + parametrar)
 *  - buildInstances: översätter simuleringen till instansdata för en given bildruta
 */
(function () {
  const F = (window.Flare = window.Flare || {});

  /* ---------- slump ---------- */
  F.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- easing ---------- */
  F.EASE = {
    linear: (x) => x,
    smooth: (x) => x * x * (3 - 2 * x),
    out: (x) => 1 - Math.pow(1 - x, 3),
    in: (x) => x * x * x,
    expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- analys av highlight-video ---------- */
  function seekTo(v, t) {
    return new Promise((resolve) => {
      if (Math.abs(v.currentTime - t) < 1e-6) return resolve();
      let done = false;
      const fin = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', fin);
        clearTimeout(to);
        resolve();
      };
      const to = setTimeout(fin, 2500);
      v.addEventListener('seeked', fin);
      v.currentTime = t;
    });
  }

  /**
   * Returnerar { masks:[Uint8Array], mw, mh, n } – en luminansmask per bildruta.
   * Varje maskpixel är maximum av ett 2×2-block, så små highlights inte försvinner vid nedskalning.
   */
  F.analyzeVideo = async function (video, opt) {
    const { fps, maskWidth, onProgress, isCancelled } = opt;
    const W = video.videoWidth, H = video.videoHeight;
    const mw = maskWidth;
    const mh = Math.max(1, Math.round((mw * H) / W));
    const cv = document.createElement('canvas');
    cv.width = mw * 2;
    cv.height = mh * 2;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    const n = Math.max(1, Math.round(video.duration * fps));
    const masks = [];
    video.pause();
    for (let i = 0; i < n; i++) {
      if (isCancelled && isCancelled()) return null;
      await seekTo(video, Math.min(video.duration - 0.001, (i + 0.5) / fps));
      ctx.drawImage(video, 0, 0, cv.width, cv.height);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const m = new Uint8Array(mw * mh);
      const rowStride = cv.width * 4;
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          let best = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const o = (y * 2 + dy) * rowStride + (x * 2 + dx) * 4;
              const l = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
              if (l > best) best = l;
            }
          }
          m[y * mw + x] = best;
        }
      }
      masks.push(m);
      if (onProgress && (i % 4 === 0 || i === n - 1)) onProgress((i + 1) / n);
    }
    return { masks, mw, mh, n };
  };

  /* ---------- simulering ---------- */
  /**
   * Parametrar som påverkar simuleringen (P.*): seed, rate, lifeMin, lifeMax, threshold,
   * brightWeight, variation, minDist, cooldown, maxActive, follow, trackPatch, trackRange.
   * Resultat: { flares:[{born,life,px[],py[],vis[],...slumptal}], n, mw, mh, fps }
   */
  F.simulate = function (an, fps, P) {
    const { masks, mw, mh, n } = an;
    const rnd = F.rng(P.seed | 0);
    const thr = clamp(P.threshold, 1, 255);
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) lut[v] = v < thr ? 0 : Math.pow(v / 255, P.brightWeight);

    const heat = new Float32Array(mw * mh);
    const weights = new Float32Array(mw * mh);
    const minR = Math.max(1, (P.minDist / 100) * mw);
    const decay = P.cooldown > 0 ? 1 / (P.cooldown * fps) : 1;
    const lambda = Math.max(0, P.rate) / fps;
    const patchR = Math.max(2, Math.round((P.trackPatch / 100) * mw));
    const searchR = Math.max(1, Math.round((P.trackRange / 100) * mw));
    const sadBuf = new Float32Array((2 * searchR + 1) * (2 * searchR + 1));

    const flares = [];
    let active = [];

    const poisson = (L) => {
      if (L <= 0) return 0;
      const e = Math.exp(-Math.min(L, 30));
      let k = 0, p = 1;
      do { k++; p *= rnd(); } while (p > e && k < 60);
      return k - 1;
    };

    const stamp = (x, y) => {
      const r2 = minR * minR;
      const x0 = Math.max(0, Math.floor(x - minR)), x1 = Math.min(mw - 1, Math.ceil(x + minR));
      const y0 = Math.max(0, Math.floor(y - minR)), y1 = Math.min(mh - 1, Math.ceil(y + minR));
      for (let yy = y0; yy <= y1; yy++) {
        const dy = yy + 0.5 - y;
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + 0.5 - x;
          if (dx * dx + dy * dy <= r2) heat[yy * mw + xx] = 1;
        }
      }
    };

    // Blockmatchning (SAD) mellan föregående och nuvarande maskbild runt flaren.
    const track = (fl, prev, cur) => {
      const cx = Math.round(fl.x), cy = Math.round(fl.y);
      const S = searchR, R = patchR, Wd = 2 * S + 1;
      let best = Infinity, bsx = 0, bsy = 0;
      for (let sy = -S; sy <= S; sy++) {
        for (let sx = -S; sx <= S; sx++) {
          let sum = 0, cnt = 0;
          for (let py = -R; py <= R; py += 2) {
            const y = cy + py, y2 = y + sy;
            if (y < 0 || y >= mh || y2 < 0 || y2 >= mh) continue;
            for (let px = -R; px <= R; px += 2) {
              const x = cx + px, x2 = x + sx;
              if (x < 0 || x >= mw || x2 < 0 || x2 >= mw) continue;
              sum += Math.abs(prev[y * mw + x] - cur[y2 * mw + x2]);
              cnt++;
            }
          }
          const v = cnt ? sum / cnt : 255;
          sadBuf[(sy + S) * Wd + sx + S] = v;
          const cost = v + 0.8 * (Math.abs(sx) + Math.abs(sy)); // föredra stillastående vid plana ytor
          if (cost < best) { best = cost; bsx = sx; bsy = sy; }
        }
      }
      let dx = 0, dy = 0;
      if (bsx > -S && bsx < S) {
        const i = (bsy + S) * Wd + bsx + S;
        const den = sadBuf[i - 1] - 2 * sadBuf[i] + sadBuf[i + 1];
        if (den > 1e-3) dx = clamp((0.5 * (sadBuf[i - 1] - sadBuf[i + 1])) / den, -0.5, 0.5);
      }
      if (bsy > -S && bsy < S) {
        const i = (bsy + S) * Wd + bsx + S;
        const den = sadBuf[i - Wd] - 2 * sadBuf[i] + sadBuf[i + Wd];
        if (den > 1e-3) dy = clamp((0.5 * (sadBuf[i - Wd] - sadBuf[i + Wd])) / den, -0.5, 0.5);
      }
      fl.x = clamp(fl.x + (bsx + dx) * P.follow, 0, mw - 0.001);
      fl.y = clamp(fl.y + (bsy + dy) * P.follow, 0, mh - 0.001);
    };

    const visibility = (fl, cur) => {
      const cx = Math.floor(fl.x), cy = Math.floor(fl.y);
      let v = 0;
      for (let y = Math.max(0, cy - 1); y <= Math.min(mh - 1, cy + 1); y++)
        for (let x = Math.max(0, cx - 1); x <= Math.min(mw - 1, cx + 1); x++)
          if (cur[y * mw + x] > v) v = cur[y * mw + x];
      return clamp((v / thr - 0.4) / 0.6, 0, 1);
    };

    for (let f = 0; f < n; f++) {
      const m = masks[f];
      for (let i = 0; i < heat.length; i++) {
        const h = heat[i] - decay;
        heat[i] = h > 0 ? h : 0;
      }

      // uppdatera befintliga flares
      const next = [];
      for (const fl of active) {
        if (f >= fl.born + fl.life) continue;
        if (P.follow > 0) track(fl, masks[f - 1], m);
        fl.px.push(fl.x); fl.py.push(fl.y); fl.vis.push(visibility(fl, m));
        stamp(fl.x, fl.y);
        next.push(fl);
      }
      active = next;

      // nya flares
      let count = poisson(lambda);
      while (count-- > 0 && active.length < P.maxActive) {
        let total = 0;
        for (let i = 0; i < m.length; i++) {
          const w = lut[m[i]] * (1 - Math.min(1, heat[i]) * P.variation);
          weights[i] = w;
          total += w;
        }
        if (total <= 1e-9) break;
        let r = rnd() * total, pick = -1;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r <= 0 && weights[i] > 0) { pick = i; break; }
        }
        if (pick < 0) { for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) { pick = i; break; } }
        if (pick < 0) break;
        const life = Math.max(2, Math.round((P.lifeMin + rnd() * Math.max(0, P.lifeMax - P.lifeMin)) * fps));
        const fl = {
          born: f, life,
          x: (pick % mw) + rnd(), y: Math.floor(pick / mw) + rnd(),
          px: [], py: [], vis: [],
          sizeR: rnd(), intR: rnd(), startR: rnd(), dirR: rnd(), rotAmtR: rnd(),
          phase: rnd(), seed: rnd() * 1000,
        };
        fl.px.push(fl.x); fl.py.push(fl.y); fl.vis.push(visibility(fl, m));
        stamp(fl.x, fl.y);
        flares.push(fl);
        active.push(fl);
      }
    }
    return { flares, n, mw, mh, fps };
  };

  /* ---------- instansdata per bildruta ---------- */
  /** Returnerar { data: Float32Array(8 per instans), count }.
   *  Layout: x, y, S(px), ext(px), intensity, rot(rad), seed, type(0=stjärna,1=ghost) */
  F.buildInstances = function (sim, f, P, W, H) {
    const fps = sim.fps;
    const sc = H / 1080;
    const mx = W / sim.mw, my = H / sim.mh;
    const out = [];

    let e = Math.max(P.coreSize * 3.2, 0.3);
    if (P.bloomInt > 0) e = Math.max(e, P.bloomSize * 3.2);
    if (P.rays > 0 && P.rayInt > 0) e = Math.max(e, P.rayLen * 1.02);
    if (P.streakInt > 0) e = Math.max(e, P.streakLen * 6.5, P.streakThick * 3.2 * (1 + 2 * P.softness));
    if (P.ringInt > 0) e = Math.max(e, P.ringR + P.ringW * 3.2);

    const att = clamp(P.attack, 0.001, 0.99);
    const rel = clamp(P.release, 0.001, 1 - att);
    const eIn = F.EASE[P.easeIn] || F.EASE.out;
    const eOut = F.EASE[P.easeOut] || F.EASE.smooth;
    const eRot = F.EASE[P.rotEase] || F.EASE.linear;
    const gK = [1, 0.55, 1.5], gS = [1, 0.6, 1.3], gI = [1, 0.7, 0.5];

    for (const fl of sim.flares) {
      if (f < fl.born || f >= fl.born + fl.life) continue;
      const age = f - fl.born;
      const u = (age + 0.5) / fl.life;
      let s;
      if (u < att) s = eIn(u / att);
      else if (u > 1 - rel) s = 1 - eOut((u - (1 - rel)) / rel);
      else s = 1;
      const size = P.size * sc * Math.max(0.05, 1 + P.sizeJitter * (2 * fl.sizeR - 1)) * s;
      if (size < 0.5) continue;

      const dir = P.rotDir === '+' ? 1 : P.rotDir === '-' ? -1 : fl.dirR < 0.5 ? -1 : 1;
      const amt = P.rotTotal * (1 - P.rotRandom * fl.rotAmtR);
      const rot = (((fl.startR - 0.5) * 2 * P.rotStartRange + dir * amt * eRot(u)) * Math.PI) / 180;

      const tw = 1 + P.twinkle * Math.sin(2 * Math.PI * (P.twinkleSpeed * (age / fps) + fl.phase));
      const vis = 1 - P.loseFade * (1 - fl.vis[Math.min(age, fl.vis.length - 1)]);
      const I = Math.max(0, P.intensity * (1 - P.intJitter * fl.intR) * (1 - P.fade + P.fade * s) * tw * vis);
      if (I <= 0) continue;

      const ai = Math.min(age, fl.px.length - 1);
      const x = fl.px[ai] * mx, y = fl.py[ai] * my;
      out.push(x, y, size, size * e + 2 * sc, I, rot, fl.seed, 0);

      const gc = Math.round(P.ghostCount);
      for (let j = 0; j < gc && j < 3; j++) {
        const k = P.ghostDist * gK[j];
        const gs = size * P.ghostSize * gS[j];
        out.push(W / 2 + (W / 2 - x) * k, H / 2 + (H / 2 - y) * k, gs, gs * 1.4 + 2 * sc, I * gI[j], 0, fl.seed + j * 13.7, 1);
      }
    }
    return { data: new Float32Array(out), count: out.length / 8 };
  };

  /* ---------- liten hjälp: fps-detektion ---------- */
  F.COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
  F.detectFps = function (v) {
    return new Promise((resolve) => {
      if (!v.requestVideoFrameCallback) return resolve(30);
      const times = [];
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        v.pause();
        v.currentTime = 0;
        let d = Infinity;
        for (let i = 1; i < times.length; i++) {
          const dt = times[i] - times[i - 1];
          if (dt > 1e-4 && dt < d) d = dt;
        }
        if (!isFinite(d)) return resolve(30);
        const fps = 1 / d;
        let best = 30, bd = Infinity;
        for (const c of F.COMMON_FPS) if (Math.abs(c - fps) < bd) { bd = Math.abs(c - fps); best = c; }
        resolve(bd / best < 0.03 ? best : Math.round(fps * 100) / 100);
      };
      const cb = (_now, meta) => {
        times.push(meta.mediaTime);
        if (times.length < 14) v.requestVideoFrameCallback(cb);
        else finish();
      };
      v.currentTime = 0;
      v.play().then(() => v.requestVideoFrameCallback(cb)).catch(finish);
      setTimeout(finish, 2500);
    });
  };
})();

/*
 * Export: MP4 (WebCodecs + mp4-muxer) och PNG-sekvens med alfa (zip utan komprimering).
 */
(function () {
  const F = (window.Flare = window.Flare || {});

  const sleep0 = () => new Promise((r) => setTimeout(r, 0));

  F.download = function (blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  /* ---------- MP4 ---------- */
  const CODECS = {
    h264: { mux: 'avc', tries: ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4D0028'] },
    vp9: { mux: 'vp9', tries: ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.10.08'] },
  };

  F.exportMP4 = async function (o) {
    // o: { width, height, fps, frames, codec, bitrate, canvas, renderFrame(i), onProgress(p), isCancelled() }
    if (!('VideoEncoder' in window)) throw new Error('Webbläsaren saknar WebCodecs (VideoEncoder). Använd Chrome/Edge, eller välj PNG-sekvens.');
    if (typeof Mp4Muxer === 'undefined') throw new Error('mp4-muxer saknas (vendor/mp4-muxer.js).');
    const W = o.width & ~1, H = o.height & ~1;
    const spec = CODECS[o.codec] || CODECS.h264;
    let cfg = null;
    for (const c of spec.tries) {
      const test = { codec: c, width: W, height: H, bitrate: o.bitrate, framerate: o.fps };
      try {
        const r = await VideoEncoder.isConfigSupported(test);
        if (r.supported) { cfg = r.config || test; break; }
      } catch (e) { /* prova nästa */ }
    }
    if (!cfg) throw new Error('Webbläsaren kan inte koda ' + (o.codec === 'h264' ? 'H.264' : 'VP9') + ' i ' + W + '×' + H + '. Välj PNG-sekvens eller en annan webbläsare.');

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: spec.mux, width: W, height: H, frameRate: o.fps },
      fastStart: 'in-memory',
    });
    let encError = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encError = e; },
    });
    enc.configure({ codec: cfg.codec, width: W, height: H, bitrate: cfg.bitrate, framerate: o.fps, latencyMode: 'quality' });

    const dur = Math.round(1e6 / o.fps);
    for (let i = 0; i < o.frames; i++) {
      if (o.isCancelled()) { enc.close(); return null; }
      if (encError) throw encError;
      o.renderFrame(i);
      const frame = new VideoFrame(o.canvas, { timestamp: Math.round((i * 1e6) / o.fps), duration: dur });
      enc.encode(frame, { keyFrame: i % 60 === 0 });
      frame.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 2 === 0) { o.onProgress((i + 1) / o.frames); await sleep0(); }
    }
    await enc.flush();
    if (encError) throw encError;
    enc.close();
    muxer.finalize();
    o.onProgress(1);
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  };

  /* ---------- ZIP (store) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  F.ZipWriter = function () {
    const parts = [], central = [];
    let offset = 0, count = 0;
    const enc = new TextEncoder();
    // fast DOS-tid: 2024-01-01 00:00
    const DOS_TIME = 0, DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;
    this.add = async function (name, blob) {
      const data = new Uint8Array(await blob.arrayBuffer());
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameBytes, blob);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBytes.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
      count++;
    };
    this.finish = function () {
      let csize = 0;
      for (const c of central) csize += c.length;
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
      end.setUint32(12, csize, true); end.setUint32(16, offset, true);
      return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    };
  };

  F.exportPNGZip = async function (o) {
    // o: { frames, canvas, renderFrame(i), onProgress, isCancelled, prefix }
    if (o.frames > 65000) throw new Error('För många bildrutor för zip.');
    const zip = new F.ZipWriter();
    for (let i = 0; i < o.frames; i++) {
      if (o.isCancelled()) return null;
      o.renderFrame(i);
      const blob = await new Promise((res) => o.canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('Kunde inte skapa PNG.');
      await zip.add(o.prefix + String(i).padStart(5, '0') + '.png', blob);
      o.onProgress((i + 1) / o.frames);
    }
    return zip.finish();
  };
})();

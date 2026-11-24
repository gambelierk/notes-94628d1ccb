/*
 * WebGL2-renderare. Alla flares ritas additivt (ONE, ONE) i en flyttals-FBO och
 * passerar sedan ett slutsteg (exponering, mjuk clipping, korn, valfri alfa).
 */
(function () {
  const F = (window.Flare = window.Flare || {});

  const VERT = `#version 300 es
in vec2 i_pos; in vec4 i_a; in vec2 i_b;
uniform vec2 u_res;
out vec2 v_local; flat out vec4 v_a; flat out vec2 v_b;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  vec2 local = c * i_a.y;
  vec2 s = i_pos + local;
  gl_Position = vec4(s.x / u_res.x * 2.0 - 1.0, 1.0 - s.y / u_res.y * 2.0, 0.0, 1.0);
  v_local = local; v_a = i_a; v_b = i_b;
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 v_local; flat in vec4 v_a; flat in vec2 v_b;
out vec4 o;
uniform float u_scalePx, u_rays, u_rayLen, u_rayThick, u_rayFalloff, u_rayInt, u_rayLenRand, u_rayAngleJit, u_rayAsym, u_soft;
uniform float u_coreSize, u_coreInt, u_bloomSize, u_bloomInt;
uniform float u_streakInt, u_streakLen, u_streakThick, u_streakAngle;
uniform float u_ringInt, u_ringR, u_ringW, u_ghostInt, u_chroma;
uniform vec3 u_tint;
const float PI = 3.14159265;
float h(float n){ return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
vec3 rainbow(float x){ return 0.5 + 0.5 * cos(6.28318 * (x + vec3(0.0, 0.33, 0.67))); }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main(){
  float S = v_a.x, ext = v_a.y, I = v_a.z, seed = v_b.x;
  float win = 1.0 - smoothstep(0.8, 1.0, max(abs(v_local.x), abs(v_local.y)) / ext);
  vec2 p = v_local;
  float r = length(p);
  vec3 col = vec3(0.0);
  float minpx = 0.6 * u_scalePx;
  if (v_b.y < 0.5) {
    vec2 pr = rot(p, -v_a.w);
    float cs = max(S * u_coreSize, 0.5); col += u_tint * u_coreInt * exp(-(r * r) / (cs * cs));
    float bs = max(S * u_bloomSize, 0.5); col += u_tint * u_bloomInt * exp(-(r * r) / (bs * bs));

    float len = S * u_rayLen;
    float th0 = max(u_rayThick * S, minpx) * (1.0 + 3.0 * u_soft);
    float ri = u_rayInt / (1.0 + 1.5 * u_soft);
    vec3 rc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (float(i) >= u_rays) break;
      float fi = float(i);
      float a = PI * fi / u_rays + (h(seed * 7.1 + fi * 1.37) - 0.5) * u_rayAngleJit * 2.0 * PI / u_rays;
      vec2 d = vec2(cos(a), sin(a));
      float al = dot(pr, d);
      float pe = abs(dot(pr, vec2(-d.y, d.x)));
      float sd = al > 0.0 ? 1.0 : 0.0;
      float lr = mix(h(seed * 3.3 + fi * 5.1), h(seed * 3.3 + fi * 5.1 + sd * 9.7 + 1.3), u_rayAsym);
      float l = len * (1.0 - u_rayLenRand * lr);
      float t = abs(al) / max(l, 1e-3);
      if (t < 1.0) {
        float th = max(th0 * (1.0 - 0.75 * t), minpx);
        float br = 1.0 - 0.5 * u_rayLenRand * h(seed * 1.9 + fi * 2.7);
        float v = pow(1.0 - t, u_rayFalloff) * br * exp(-pe * pe / (th * th));
        rc += v * mix(vec3(1.0), rainbow(t * 0.7 + fi / u_rays + seed), u_chroma);
      }
    }
    col += u_tint * ri * rc;

    vec2 sp = rot(p, -u_streakAngle);
    float sl = max(S * u_streakLen, 0.5);
    float st = max(S * u_streakThick, minpx) * (1.0 + 2.0 * u_soft);
    float sv = exp(-abs(sp.x) / sl) * exp(-(sp.y * sp.y) / (st * st));
    col += u_tint * u_streakInt * sv * mix(vec3(1.0), rainbow(sp.x / sl * 0.25 + 0.5), u_chroma * 0.6);

    float rw = max(S * u_ringW, minpx);
    float rr = S * u_ringR;
    float rv = exp(-pow((r - rr) / rw, 2.0));
    col += u_ringInt * rv * mix(u_tint, rainbow(atan(p.y, p.x) / 6.28318 + seed), u_chroma);
  } else {
    float q = r / max(S, 0.5);
    float disk = (1.0 - smoothstep(0.82, 1.0, q)) * 0.18;
    float edge = exp(-pow((q - 0.9) / 0.07, 2.0)) * 0.7;
    vec3 gc = mix(u_tint, rainbow(seed), 0.6 * u_chroma);
    col += gc * (disk + edge) * u_ghostInt;
  }
  o = vec4(col * I * win, 1.0);
}`;

  const FS_VERT = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_exposure, u_rolloff, u_grain, u_frame, u_alphaMode;
out vec4 o;
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texelFetch(u_tex, ivec2(gl_FragCoord.xy), 0).rgb * u_exposure;
  float k = 1.0 - u_rolloff;
  vec3 over = max(c - k, 0.0);
  vec3 shoulder = k + (1.0 - k) * (1.0 - exp(-over / max(1.0 - k, 1e-3)));
  c = mix(c, shoulder, step(vec3(k), c));
  float n = h2(gl_FragCoord.xy + vec2(u_frame * 17.1, u_frame * 31.7));
  float lum = dot(c, vec3(0.3333));
  c = max(c * (1.0 + (n - 0.5) * 2.0 * u_grain * smoothstep(0.0, 0.15, lum)), 0.0);
  c = min(c, vec3(1.0));
  float a = max(c.r, max(c.g, c.b));
  if (u_alphaMode > 0.5) o = vec4(c / max(a, 1e-4), a);
  else o = vec4(c, 1.0);
}`;

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const v = m ? parseInt(m[1], 16) : 0xffffff;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  F.createRenderer = function (canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 stöds inte i den här webbläsaren.');
    const floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));

    const flareProg = program(gl, VERT, FRAG);
    const finalProg = program(gl, FS_VERT, FS_FRAG);

    const U = {};
    const getU = (prog, names) => names.forEach((n) => (U[prog === flareProg ? 'f_' + n : 'p_' + n] = gl.getUniformLocation(prog, n)));
    getU(flareProg, ['u_res', 'u_scalePx', 'u_rays', 'u_rayLen', 'u_rayThick', 'u_rayFalloff', 'u_rayInt', 'u_rayLenRand',
      'u_rayAngleJit', 'u_rayAsym', 'u_soft', 'u_coreSize', 'u_coreInt', 'u_bloomSize', 'u_bloomInt', 'u_streakInt',
      'u_streakLen', 'u_streakThick', 'u_streakAngle', 'u_ringInt', 'u_ringR', 'u_ringW', 'u_ghostInt', 'u_chroma', 'u_tint']);
    getU(finalProg, ['u_tex', 'u_exposure', 'u_rolloff', 'u_grain', 'u_frame', 'u_alphaMode']);

    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const stride = 8 * 4;
    const loc = (n) => gl.getAttribLocation(flareProg, n);
    gl.enableVertexAttribArray(loc('i_pos')); gl.vertexAttribPointer(loc('i_pos'), 2, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(loc('i_pos'), 1);
    gl.enableVertexAttribArray(loc('i_a')); gl.vertexAttribPointer(loc('i_a'), 4, gl.FLOAT, false, stride, 8); gl.vertexAttribDivisor(loc('i_a'), 1);
    gl.enableVertexAttribArray(loc('i_b')); gl.vertexAttribPointer(loc('i_b'), 2, gl.FLOAT, false, stride, 24); gl.vertexAttribDivisor(loc('i_b'), 1);
    const emptyVao = gl.createVertexArray();

    let fbo = null, tex = null, W = 0, H = 0;
    function setSize(w, h) {
      if (w === W && h === H && fbo) return;
      W = w; H = h;
      canvas.width = w; canvas.height = h;
      if (tex) gl.deleteTexture(tex);
      if (fbo) gl.deleteFramebuffer(fbo);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (floatOk) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }

    /** inst = { data:Float32Array, count }; alphaMode: true → alfa = max(rgb) (rak alfa) */
    function render(inst, P, frame, alphaMode) {
      // flare-pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (inst.count > 0) {
        gl.useProgram(flareProg);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, inst.data, gl.DYNAMIC_DRAW);
        const u1 = (n, v) => gl.uniform1f(U['f_' + n], v);
        gl.uniform2f(U.f_u_res, W, H);
        u1('u_scalePx', H / 1080);
        u1('u_rays', Math.min(16, Math.round(P.rays)));
        u1('u_rayLen', P.rayLen); u1('u_rayThick', P.rayThick / 100); u1('u_rayFalloff', P.rayFalloff);
        u1('u_rayInt', P.rayInt); u1('u_rayLenRand', P.rayLenRand); u1('u_rayAngleJit', P.rayAngleJit);
        u1('u_rayAsym', P.rayAsym); u1('u_soft', P.softness);
        u1('u_coreSize', P.coreSize); u1('u_coreInt', P.coreInt);
        u1('u_bloomSize', P.bloomSize); u1('u_bloomInt', P.bloomInt);
        u1('u_streakInt', P.streakInt); u1('u_streakLen', P.streakLen); u1('u_streakThick', P.streakThick);
        u1('u_streakAngle', (P.streakAngle * Math.PI) / 180);
        u1('u_ringInt', P.ringInt); u1('u_ringR', P.ringR); u1('u_ringW', P.ringW);
        u1('u_ghostInt', P.ghostInt); u1('u_chroma', P.chroma);
        const c = hexToRgb(P.tint);
        gl.uniform3f(U.f_u_tint, c[0], c[1], c[2]);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.count);
        gl.disable(gl.BLEND);
      }
      // slutsteg
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(finalProg);
      gl.bindVertexArray(emptyVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.p_u_tex, 0);
      gl.uniform1f(U.p_u_exposure, P.exposure);
      gl.uniform1f(U.p_u_rolloff, P.rolloff);
      gl.uniform1f(U.p_u_grain, P.grain);
      gl.uniform1f(U.p_u_frame, frame % 1000);
      gl.uniform1f(U.p_u_alphaMode, alphaMode ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    return { gl, canvas, setSize, render, floatOk };
  };
})();

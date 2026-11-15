import type { Placement } from '@ve/core';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

const VERT = `#version 300 es
in vec2 a_pos;            // unit quad 0..1
uniform vec2 u_res;       // output size in pixels
uniform vec2 u_center;    // layer centre in pixels
uniform vec2 u_size;      // layer size in pixels
uniform vec2 u_rot;       // cos, sin of the clockwise rotation
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec2 local = (a_pos - 0.5) * u_size;
  // y points down in pixel space, so this rotates clockwise on screen
  vec2 r = vec2(local.x * u_rot.x - local.y * u_rot.y, local.x * u_rot.y + local.y * u_rot.x);
  vec2 p = u_center + r;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 outColor;
void main() {
  // textures are uploaded premultiplied
  outColor = texture(u_tex, v_uv) * u_opacity;
}`;

/**
 * WebGL2 compositor: draws layers bottom → top with premultiplied alpha.
 * Each layer is a quad with its own position, size and rotation.
 * Effects and transitions will be additional shaders here.
 */
export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private u: Record<'res' | 'center' | 'size' | 'rot' | 'opacity', WebGLUniformLocation>;
  /** Per-frame textures for changing sources (video, templates). */
  private textures: WebGLTexture[] = [];
  /** Textures for still sources (images), uploaded once with mipmaps. */
  private stills = new Map<string, WebGLTexture>();
  private layerIndex = 0;

  constructor(
    readonly canvas: AnyCanvas,
    width: number,
    height: number,
  ) {
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // the encoder and thumbnails read the canvas after drawing
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 stöds inte i den här webbläsaren');
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    const loc = (n: string) => gl.getUniformLocation(this.program, n)!;
    this.u = { res: loc('u_res'), center: loc('u_center'), size: loc('u_size'), rot: loc('u_rot'), opacity: loc('u_opacity') };

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_tex'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }

  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  begin(background: string) {
    const gl = this.gl;
    const [r, g, b] = parseHex(background);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height);
    this.layerIndex = 0;
  }

  /** Draw a changing source (video frame, rendered template). Default placement: full frame. */
  draw(source: TexImageSource, opacity = 1, placement?: Placement) {
    if (opacity <= 0) return;
    const gl = this.gl;
    const tex = this.frameTexture(this.layerIndex++);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.quad(opacity, placement);
  }

  /** Draw a still source cached under `key` (uploaded once, mipmapped for clean downscaling). */
  drawStill(key: string, source: TexImageSource, opacity = 1, placement?: Placement) {
    if (opacity <= 0) return;
    const gl = this.gl;
    let tex = this.stills.get(key);
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.stills.set(key, tex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    this.quad(opacity, placement);
  }

  releaseStill(key: string) {
    const t = this.stills.get(key);
    if (t) this.gl.deleteTexture(t);
    this.stills.delete(key);
  }

  private quad(opacity: number, p?: Placement) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const pl = p ?? { cx: W / 2, cy: H / 2, w: W, h: H, rotation: 0 };
    const rad = (pl.rotation * Math.PI) / 180;
    gl.uniform2f(this.u.center, pl.cx, pl.cy);
    gl.uniform2f(this.u.size, pl.w, pl.h);
    gl.uniform2f(this.u.rot, Math.cos(rad), Math.sin(rad));
    gl.uniform1f(this.u.opacity, Math.min(1, opacity));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  end() {
    this.gl.flush();
  }

  private frameTexture(i: number): WebGLTexture {
    let t = this.textures[i];
    if (!t) {
      const gl = this.gl;
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures[i] = t;
    }
    return t;
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.textures) gl.deleteTexture(t);
    for (const t of this.stills.values()) gl.deleteTexture(t);
    this.textures = [];
    this.stills.clear();
    gl.deleteProgram(this.program);
  }
}

function parseHex(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

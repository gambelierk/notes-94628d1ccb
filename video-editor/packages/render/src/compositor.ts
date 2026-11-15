type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface LayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const VERT = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rect; // x, y, w, h in clip space (0..1 of frame)
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
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
 * Minimal WebGL2 compositor: draws layers bottom → top with premultiplied
 * alpha blending. Effects and transitions will be additional shaders here.
 */
export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uRect: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;
  private textures: WebGLTexture[] = [];
  private layerIndex = 0;

  constructor(readonly canvas: AnyCanvas, width: number, height: number) {
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true, // the encoder reads the canvas after drawing
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 stöds inte i den här webbläsaren');
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    this.uRect = gl.getUniformLocation(this.program, 'u_rect')!;
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity')!;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

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
    this.layerIndex = 0;
  }

  /** Draw a layer. `rect` is in output pixels; default is the full frame. */
  draw(source: TexImageSource, opacity = 1, rect?: LayerRect) {
    if (opacity <= 0) return;
    const gl = this.gl;
    const tex = this.texture(this.layerIndex++);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const W = this.canvas.width;
    const H = this.canvas.height;
    const r = rect ?? { x: 0, y: 0, width: W, height: H };
    gl.uniform4f(this.uRect, r.x / W, r.y / H, r.width / W, r.height / H);
    gl.uniform1f(this.uOpacity, Math.min(1, opacity));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  end() {
    this.gl.flush();
  }

  private texture(i: number): WebGLTexture {
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
    this.textures = [];
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

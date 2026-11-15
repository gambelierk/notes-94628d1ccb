import {
  visibleLayersAt,
  evaluateParam,
  textPlacement,
  findAsset,
  framesToSeconds,
  mediaPlacement,
  sourceTimeAt,
  transformAt,
  type Frame,
  type ImageClip,
  type Project,
  type PropValue,
  type TemplateClip,
  type TextClip,
  type VideoAsset,
  type VideoClip,
} from '@ve/core';
import { VideoFrameReader, type MediaSource } from '@ve/media';
import type { ImageBytesResolver, TemplateRegistry, TemplateRenderer } from '@ve/rive';
import type { Compositor } from './compositor';
import { drawText, ensureFont } from './text';

export interface RenderResourcesOptions {
  /** Open (or return an already opened) media source for an asset. */
  openSource: (assetId: string) => Promise<MediaSource | null>;
  templates: TemplateRegistry;
  imageBytes: ImageBytesResolver;
  createCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
}

interface ReaderEntry {
  reader: VideoFrameReader;
  key: string;
  lastUsed: number;
}
interface TemplateEntry {
  renderer: TemplateRenderer;
  templateId: string;
  lastUsed: number;
}
interface ImageEntry {
  bitmap: Promise<ImageBitmap | null>;
  lastUsed: number;
}
interface TextEntry {
  key: string;
  canvas: OffscreenCanvas;
  lastUsed: number;
}

const IDLE_FRAMES_BEFORE_RELEASE = 300;
/** Decode video up to this multiple of the output size, so zooming in keeps detail. */
const VIDEO_OVERSAMPLE = 2;

/**
 * Per-clip decoders, template renderers and decoded images, created on
 * demand and released when unused for a while. One instance per output size.
 */
export class RenderResources {
  private readers = new Map<string, ReaderEntry>();
  private templates = new Map<string, TemplateEntry>();
  private images = new Map<string, ImageEntry>();
  private texts = new Map<string, TextEntry>();
  private tick = 0;
  /** Still-texture keys released since the last frame; the compositor drops their textures. */
  readonly releasedImages: string[] = [];

  constructor(
    private readonly opts: RenderResourcesOptions,
    private width: number,
    private height: number,
  ) {}

  setSize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.disposeAll();
  }

  async videoFrame(clip: VideoClip, timeSec: number) {
    const key = `${clip.assetId}@${this.width}x${this.height}`;
    let e = this.readers.get(clip.id);
    if (!e || e.key !== key) {
      if (e) void e.reader.dispose();
      const src = await this.opts.openSource(clip.assetId);
      if (!src?.video) return null;
      const sink = src.frameSink(this.width * VIDEO_OVERSAMPLE, this.height * VIDEO_OVERSAMPLE);
      e = { reader: new VideoFrameReader(sink), key, lastUsed: this.tick };
      this.readers.set(clip.id, e);
    }
    e.lastUsed = this.tick;
    return e.reader.frameAt(timeSec);
  }

  image(assetId: string): Promise<ImageBitmap | null> {
    let e = this.images.get(assetId);
    if (!e) {
      const bitmap = this.opts
        .imageBytes(assetId)
        .then((b) => (b ? createImageBitmap(new Blob([b as Uint8Array<ArrayBuffer>]), { premultiplyAlpha: 'premultiply' }) : null))
        .catch(() => null);
      e = { bitmap, lastUsed: this.tick };
      this.images.set(assetId, e);
    }
    e.lastUsed = this.tick;
    return e.bitmap;
  }

  /** Rendered text for a clip; re-rendered only when text, style or size change. */
  async text(clip: TextClip): Promise<{ key: string; canvas: OffscreenCanvas }> {
    const key = `text:${clip.id}:${this.width}x${this.height}:${clip.text}:${JSON.stringify(clip.style)}`;
    let e = this.texts.get(clip.id);
    if (!e || e.key !== key) {
      await ensureFont(clip.style, clip.text);
      if (e) this.releasedImages.push(e.key);
      e = { key, canvas: drawText(clip.text, clip.style, this.width, this.height).canvas, lastUsed: this.tick };
      this.texts.set(clip.id, e);
    }
    e.lastUsed = this.tick;
    return e;
  }

  template(clip: TemplateClip): TemplateRenderer | null {
    if (!this.opts.templates.has(clip.templateId)) return null;
    let e = this.templates.get(clip.id);
    if (!e || e.templateId !== clip.templateId) {
      e?.renderer.dispose();
      const canvas = this.opts.createCanvas(this.width, this.height);
      e = { renderer: this.opts.templates.createRenderer(clip.templateId, canvas), templateId: clip.templateId, lastUsed: this.tick };
      this.templates.set(clip.id, e);
    }
    e.lastUsed = this.tick;
    return e.renderer;
  }

  get imageBytes(): ImageBytesResolver {
    return this.opts.imageBytes;
  }

  /** Release resources for clips that have not been drawn recently. */
  collect() {
    this.tick++;
    const idle = (n: number) => this.tick - n > IDLE_FRAMES_BEFORE_RELEASE;
    for (const [id, e] of this.readers)
      if (idle(e.lastUsed)) {
        void e.reader.dispose();
        this.readers.delete(id);
      }
    for (const [id, e] of this.templates)
      if (idle(e.lastUsed)) {
        e.renderer.dispose();
        this.templates.delete(id);
      }
    for (const [id, e] of this.images)
      if (idle(e.lastUsed)) {
        void e.bitmap.then((b) => b?.close());
        this.images.delete(id);
        this.releasedImages.push(id);
      }
    for (const [id, e] of this.texts)
      if (idle(e.lastUsed)) {
        this.texts.delete(id);
        this.releasedImages.push(e.key);
      }
  }

  disposeAll() {
    for (const e of this.readers.values()) void e.reader.dispose();
    for (const e of this.templates.values()) e.renderer.dispose();
    for (const [id, e] of this.images) {
      void e.bitmap.then((b) => b?.close());
      this.releasedImages.push(id);
    }
    for (const e of this.texts.values()) this.releasedImages.push(e.key);
    this.readers.clear();
    this.templates.clear();
    this.images.clear();
    this.texts.clear();
  }
}

function propValues(clip: TemplateClip, frame: Frame): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [k, p] of Object.entries(clip.props)) out[k] = evaluateParam(p, frame);
  return out;
}

type Prepared =
  | { kind: 'video'; clip: VideoClip; asset: VideoAsset; frame: CanvasImageSource | null }
  | { kind: 'image'; clip: ImageClip; bitmap: ImageBitmap | null }
  | { kind: 'text'; clip: TextClip; key: string; canvas: OffscreenCanvas }
  | { kind: 'template'; clip: TemplateClip; renderer: TemplateRenderer | null; props: Record<string, PropValue> };

/**
 * Draw timeline frame `frame` of `project`. This single function is used by
 * the preview and by the exporter, so what you see is what you export.
 */
export async function renderFrame(project: Project, frame: Frame, compositor: Compositor, res: RenderResources): Promise<void> {
  const fps = project.settings.fps;
  const W = compositor.width;
  const H = compositor.height;
  // includes both clips during a dissolve; `mix` carries fades and dissolves
  const active = visibleLayersAt(project, frame);

  const prepare = async (clip: (typeof active)[number]['clip']): Promise<Prepared | null> => {
    if (clip.kind === 'video') {
      const asset = findAsset(project, clip.assetId);
      if (asset?.kind !== 'video') return null;
      // during a dissolve this may be past the clip's end or before its start; the reader holds the edge frame
      const f = await res.videoFrame(clip, sourceTimeAt(clip, frame, fps) / 1_000_000);
      return { kind: 'video', clip, asset, frame: f?.canvas ?? null };
    }
    if (clip.kind === 'image') return { kind: 'image', clip, bitmap: await res.image(clip.assetId) };
    if (clip.kind === 'text') {
      const t = await res.text(clip);
      return { kind: 'text', clip, key: t.key, canvas: t.canvas };
    }
    const r = res.template(clip);
    const props = propValues(clip, frame);
    if (r) await r.prepareImages(props, res.imageBytes);
    return { kind: 'template', clip, renderer: r, props };
  };

  // Decode everything first (async), then draw synchronously in layer order.
  const prepared = (
    await Promise.all(
      active.map(async ({ clip, mix }) => {
        const p = await prepare(clip);
        return p ? { ...p, mix } : null;
      }),
    )
  ).filter((x): x is Prepared & { mix: number } => !!x);

  for (const key of res.releasedImages.splice(0)) compositor.releaseStill(key);

  compositor.begin(project.settings.background);
  for (const layer of prepared) {
    const opacity = evaluateParam(layer.clip.opacity, frame) * layer.mix; // mix = fades and dissolves
    const t = transformAt(layer.clip, frame);
    if (layer.kind === 'video') {
      if (layer.frame) compositor.draw(layer.frame as TexImageSource, opacity, mediaPlacement(layer.asset.width, layer.asset.height, W, H, t));
    } else if (layer.kind === 'text') {
      compositor.drawStill(layer.key, layer.canvas, opacity, textPlacement(layer.canvas.width, layer.canvas.height, W, H, t));
    } else if (layer.kind === 'image') {
      const b = layer.bitmap;
      if (b) compositor.drawStill(layer.clip.assetId, b, opacity, mediaPlacement(b.width, b.height, W, H, t));
    } else if (layer.renderer) {
      const clip = layer.clip;
      layer.renderer.applyProps(layer.props);
      layer.renderer.render(framesToSeconds(frame - clip.start, fps), framesToSeconds(clip.duration, fps), t);
      compositor.draw(layer.renderer.canvas, opacity);
    }
  }
  compositor.end();
  res.collect();
}

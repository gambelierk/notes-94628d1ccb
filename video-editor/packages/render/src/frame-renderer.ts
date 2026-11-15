import {
  activeClipsAt,
  evaluateParam,
  framesToSeconds,
  sourceTimeAt,
  type Frame,
  type Project,
  type PropValue,
  type TemplateClip,
  type VideoClip,
} from '@ve/core';
import { VideoFrameReader, type MediaSource } from '@ve/media';
import type { ImageBytesResolver, TemplateRegistry, TemplateRenderer } from '@ve/rive';
import type { Compositor } from './compositor';

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

const IDLE_FRAMES_BEFORE_RELEASE = 300;

/**
 * Per-clip decoders and template renderers, created on demand and released
 * when a clip has not been drawn for a while. One instance per output size.
 */
export class RenderResources {
  private readers = new Map<string, ReaderEntry>();
  private templates = new Map<string, TemplateEntry>();
  private tick = 0;

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
      e = { reader: new VideoFrameReader(src.canvasSink(this.width, this.height)), key, lastUsed: this.tick };
      this.readers.set(clip.id, e);
    }
    e.lastUsed = this.tick;
    return e.reader.frameAt(timeSec);
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
    for (const [id, e] of this.readers)
      if (this.tick - e.lastUsed > IDLE_FRAMES_BEFORE_RELEASE) {
        void e.reader.dispose();
        this.readers.delete(id);
      }
    for (const [id, e] of this.templates)
      if (this.tick - e.lastUsed > IDLE_FRAMES_BEFORE_RELEASE) {
        e.renderer.dispose();
        this.templates.delete(id);
      }
  }

  disposeAll() {
    for (const e of this.readers.values()) void e.reader.dispose();
    for (const e of this.templates.values()) e.renderer.dispose();
    this.readers.clear();
    this.templates.clear();
  }
}

function propValues(clip: TemplateClip, frame: Frame): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [k, p] of Object.entries(clip.props)) out[k] = evaluateParam(p, frame);
  return out;
}

/**
 * Draw timeline frame `frame` of `project`. This single function is used by
 * the preview and by the exporter, so what you see is what you export.
 */
export async function renderFrame(project: Project, frame: Frame, compositor: Compositor, res: RenderResources): Promise<void> {
  const fps = project.settings.fps;
  const active = activeClipsAt(project, frame);

  // Decode everything first (async), then draw synchronously in layer order.
  const prepared = await Promise.all(
    active.map(async ({ clip }) => {
      if (clip.kind === 'video') {
        const f = await res.videoFrame(clip, sourceTimeAt(clip, frame, fps) / 1_000_000);
        return { clip, video: f?.canvas ?? null };
      }
      const r = res.template(clip);
      const props = propValues(clip, frame);
      if (r) await r.prepareImages(props, res.imageBytes);
      return { clip, template: r, props };
    }),
  );

  compositor.begin(project.settings.background);
  for (const layer of prepared) {
    const opacity = evaluateParam(layer.clip.opacity, frame);
    if ('video' in layer) {
      if (layer.video) compositor.draw(layer.video, opacity);
    } else if (layer.template) {
      const clip = layer.clip as TemplateClip;
      layer.template.applyProps(layer.props);
      layer.template.render(framesToSeconds(frame - clip.start, fps), framesToSeconds(clip.duration, fps));
      compositor.draw(layer.template.canvas, opacity);
    }
  }
  compositor.end();
  res.collect();
}

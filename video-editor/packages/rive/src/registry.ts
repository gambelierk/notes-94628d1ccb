import type { TemplateDefinition, TemplateManifest } from '@ve/core';
import { inspectTemplate } from './inspect';
import { loadRiveFile, type RiveCanvas, type RiveFile, type RiveImage } from './runtime';
import { TemplateRenderer } from './template-renderer';

export interface TemplateSource {
  id: string;
  bytes: Uint8Array;
  manifest: TemplateManifest;
}

interface Entry {
  def: TemplateDefinition;
  file: RiveFile;
  bytes: Uint8Array;
  manifest: TemplateManifest;
}

/**
 * Loaded templates for one JS realm. The main thread (preview, thumbnails)
 * and the export worker each have their own registry built from the same
 * bytes, so both see identical definitions.
 */
export class TemplateRegistry {
  private entries = new Map<string, Entry>();
  /** Decoded images shared by all renderers in this realm, keyed by asset id. */
  readonly imageCache = new Map<string, RiveImage>();

  constructor(readonly rive: RiveCanvas) {}

  async add(src: TemplateSource): Promise<TemplateDefinition> {
    const existing = this.entries.get(src.id);
    if (existing) return existing.def;
    const file = await loadRiveFile(this.rive, src.bytes);
    const def = inspectTemplate(file, src.manifest, src.id);
    def.id = src.id;
    this.entries.set(src.id, { def, file, bytes: src.bytes, manifest: src.manifest });
    return def;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): Entry | undefined {
    return this.entries.get(id);
  }

  definitions(): TemplateDefinition[] {
    return [...this.entries.values()].map((e) => e.def);
  }

  sources(ids?: Iterable<string>): TemplateSource[] {
    const want = ids ? new Set(ids) : null;
    return [...this.entries.entries()]
      .filter(([id]) => !want || want.has(id))
      .map(([id, e]) => ({ id, bytes: e.bytes, manifest: e.manifest }));
  }

  /**
   * `fill: true` ignores the template's frame layout and fits the artboard to
   * the whole canvas, which is what library thumbnails and hover previews want.
   */
  createRenderer(id: string, canvas: HTMLCanvasElement | OffscreenCanvas, opts: { fill?: boolean } = {}): TemplateRenderer {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Okänd mall: ${id}`);
    const def = opts.fill ? { ...e.def, layout: undefined } : e.def;
    return new TemplateRenderer(this.rive, e.file, def, canvas, this.imageCache);
  }
}

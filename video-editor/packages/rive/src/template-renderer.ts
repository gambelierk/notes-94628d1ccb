import { hexToArgb, resolveTemplateFrame, templatePlacement, type TransformValues, type PropValue, type TemplateDefinition, type TemplateFrameState } from '@ve/core';
import type {
  Artboard,
  LinearAnimationInstance,
  RiveCanvas,
  File as RiveFile,
  StateMachineInstance,
  ViewModelInstance,
  WrappedRenderer,
} from '@rive-app/canvas-advanced';
import { createViewModelInstance, defaultViewModel } from './inspect';
import { decodeRiveImage, type RiveImage } from './runtime';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Supplies image bytes for image fields (by media asset id). */
export type ImageBytesResolver = (assetId: string) => Promise<Uint8Array | null>;

const SM_STEP = 1 / 60;
const SM_MAX_FORWARD = 2; // seconds we will advance incrementally before replaying

/**
 * Renders one template clip. Owns an artboard instance, a view model instance
 * and a Rive renderer bound to its own canvas. Rendering is a pure function of
 * (props, local time, clip duration) so preview and export match.
 */
export class TemplateRenderer {
  readonly canvas: AnyCanvas;
  private renderer: WrappedRenderer;
  private artboard: Artboard;
  private vmi: ViewModelInstance | null;
  private anims = new Map<string, LinearAnimationInstance>();
  private sm: StateMachineInstance | null = null;
  private smTime = -1;
  private appliedProps = new Map<string, string>();
  private images: Map<string, RiveImage>;
  private disposed = false;

  constructor(
    private readonly rive: RiveCanvas,
    private readonly file: RiveFile,
    readonly def: TemplateDefinition,
    canvas: AnyCanvas,
    imageCache: Map<string, RiveImage> = new Map(),
  ) {
    this.canvas = canvas;
    this.images = imageCache;
    this.renderer = rive.makeRenderer(canvas);
    this.artboard = this.createArtboard();
    const vm = defaultViewModel(file, this.artboard);
    this.vmi = vm ? createViewModelInstance(vm) : null;
    if (this.vmi) this.artboard.bindViewModelInstance(this.vmi);
  }

  private createArtboard(): Artboard {
    const ab = this.def.artboard ? this.file.artboardByName(this.def.artboard) : this.file.defaultArtboard();
    if (!ab) throw new Error(`Artboard saknas: ${this.def.artboard}`);
    return ab;
  }

  /** Decode any images the props reference. Call before `applyProps`. */
  async prepareImages(props: Record<string, PropValue>, resolve: ImageBytesResolver): Promise<void> {
    for (const v of Object.values(props)) {
      if (v.type !== 'image' || !v.assetId || this.images.has(v.assetId)) continue;
      const bytes = await resolve(v.assetId);
      if (!bytes) continue;
      try {
        this.images.set(v.assetId, await decodeRiveImage(this.rive, bytes));
      } catch (e) {
        console.warn('Bild kunde inte avkodas', e);
      }
    }
  }

  /** Fresh view model instance with the template's own default values. */
  private resetViewModel(): void {
    const vm = defaultViewModel(this.file, this.artboard);
    const next = vm ? createViewModelInstance(vm) : null;
    if (!next) return;
    this.vmi = next;
    this.artboard.bindViewModelInstance(next);
    this.sm?.bindViewModelInstance(next);
    this.appliedProps.clear();
  }

  /** Push property values into the view model. Only changed values are written. */
  applyProps(props: Record<string, PropValue>): void {
    // An image field going back to "empty" must show the template's own
    // default image again, which only a fresh view model instance has.
    for (const field of this.def.fields) {
      const v = props[field.key] ?? field.default;
      const prev = this.appliedProps.get(field.key);
      if (v.type === 'image' && !v.assetId && prev && prev.includes('"assetId":"')) {
        this.resetViewModel();
        break;
      }
    }
    const vmi = this.vmi;
    if (!vmi) return;
    for (const field of this.def.fields) {
      const v = props[field.key] ?? field.default;
      const sig = JSON.stringify(v);
      if (this.appliedProps.get(field.key) === sig) continue;
      try {
        switch (v.type) {
          case 'string':
            vmi.string(field.key).value = v.value;
            break;
          case 'color':
            vmi.color(field.key).value = hexToArgb(v.value);
            break;
          case 'number':
            vmi.number(field.key).value = v.value;
            break;
          case 'boolean':
            vmi.boolean(field.key).value = v.value;
            break;
          case 'enum':
            vmi.enum(field.key).value = v.value;
            break;
          case 'image': {
            if (!v.assetId) break; // empty → keep the template's default image
            const img = this.images.get(v.assetId);
            if (!img) continue; // not decoded yet; retry next frame
            const native = (img as unknown as { nativeImage?: unknown }).nativeImage ?? img;
            vmi.image(field.key).value(native as never);
            break;
          }
        }
        this.appliedProps.set(field.key, sig);
      } catch (e) {
        console.warn(`Kunde inte sätta ${field.key}`, e);
        this.appliedProps.set(field.key, sig);
      }
    }
  }

  private anim(name: string): LinearAnimationInstance | null {
    let inst = this.anims.get(name);
    if (!inst) {
      const a = this.artboard.animationByName(name);
      if (!a) return null;
      inst = new this.rive.LinearAnimationInstance(a, this.artboard);
      this.anims.set(name, inst);
    }
    return inst;
  }

  private applyAnim(name: string, time: number): void {
    const inst = this.anim(name);
    if (!inst) return;
    inst.time = time;
    inst.apply(1);
  }

  private resetStateMachine(): void {
    this.sm?.delete();
    for (const a of this.anims.values()) a.delete();
    this.anims.clear();
    this.artboard.delete();
    this.artboard = this.createArtboard();
    if (this.vmi) this.artboard.bindViewModelInstance(this.vmi);
    const def = this.def.timing;
    const sm = def.kind === 'stateMachine' ? this.artboard.stateMachineByName(def.name) : null;
    this.sm = sm ? new this.rive.StateMachineInstance(sm, this.artboard) : null;
    if (this.sm && this.vmi) this.sm.bindViewModelInstance(this.vmi);
    this.smTime = 0;
    this.sm?.advanceAndApply(0);
  }

  private pose(state: TemplateFrameState): void {
    const timing = this.def.timing;
    if (state.kind === 'animation') {
      // Layer earlier segments under the current one so the pose does not
      // depend on what was rendered before (seeking backwards is safe).
      if (timing.kind === 'segments') {
        if (timing.in && state.name !== timing.in.name) this.applyAnim(timing.in.name, timing.in.duration);
        if (timing.out && timing.hold && state.name === timing.out.name) this.applyAnim(timing.hold.name, 0);
      }
      this.applyAnim(state.name, state.time);
      this.artboard.advance(0);
    } else if (state.kind === 'stateMachine') {
      if (!this.sm || state.time < this.smTime - 1e-6 || state.time - this.smTime > SM_MAX_FORWARD) {
        this.resetStateMachine();
      }
      let remaining = state.time - this.smTime;
      while (remaining > 1e-6 && this.sm) {
        const dt = Math.min(SM_STEP, remaining);
        this.sm.advanceAndApply(dt);
        remaining -= dt;
      }
      this.smTime = state.time;
      if (!this.sm) this.artboard.advance(0);
    } else {
      this.artboard.advance(0);
    }
  }

  /**
   * Draw the template at `local` seconds into a clip of `clipDuration`
   * seconds. The artboard is fitted (contain) into the canvas.
   */
  render(local: number, clipDuration: number, transform?: TransformValues): void {
    if (this.disposed) return;
    this.pose(resolveTemplateFrame(this.def.timing, local, clipDuration));
    const r = this.renderer;
    const { width, height } = this.canvas;
    r.clear();
    r.save();
    const bounds = this.artboard.bounds;
    const p = templatePlacement(
      this.def.layout,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
      width,
      height,
      transform ?? { x: 0, y: 0, scale: 1, rotation: 0 },
    );
    const box = { minX: p.cx - p.w / 2, minY: p.cy - p.h / 2, maxX: p.cx + p.w / 2, maxY: p.cy + p.h / 2 };
    r.align(this.rive.Fit.contain, this.rive.Alignment.center, box, bounds);
    this.artboard.draw(r);
    r.restore();
    // Canvas2D build queues draw calls; flush so the canvas can be sampled now.
    this.rive.resolveAnimationFrame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sm?.delete();
    for (const a of this.anims.values()) a.delete();
    this.anims.clear();
    this.artboard.delete();
    this.renderer.delete();
  }
}

/** Render a still of a template, e.g. for library thumbnails. */
export async function renderTemplateThumbnail(
  rive: RiveCanvas,
  file: RiveFile,
  def: TemplateDefinition,
  width: number,
  height: number,
  at?: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  // Thumbnails show the graphic itself, filling the tile, not its placement in the frame.
  const r = new TemplateRenderer(rive, file, { ...def, layout: undefined }, canvas);
  try {
    r.applyProps({});
    const t = at ?? thumbnailTime(def);
    r.render(t, def.defaultDuration);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    r.dispose();
  }
}

/** A representative moment: middle of `hold`, or a bit into the animation. */
export function thumbnailTime(def: TemplateDefinition): number {
  const t = def.timing;
  if (t.kind === 'segments') return (t.in?.duration ?? 0) + (t.hold ? t.hold.duration / 2 : 0.01);
  if (t.kind === 'animation') return t.duration / 2;
  if (t.kind === 'stateMachine') return Math.min(1.5, def.defaultDuration / 2);
  return 0;
}

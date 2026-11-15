import type { PropValue, TemplateFieldType } from './types';

/**
 * A motion graphics template: a Rive file plus a description of which
 * properties the user may edit and how its animation maps onto clip time.
 */
export interface TemplateField {
  /** View model property path in the Rive file. */
  key: string;
  label: string;
  type: TemplateFieldType;
  default: PropValue;
  /** Allowed values for `enum` fields. */
  options?: string[];
  group?: string;
  multiline?: boolean;
}

/**
 * How the template's animation is driven by clip time.
 *
 * - `segments` — the recommended contract: linear animations named
 *   in / hold / out. `in` plays at the clip start, `out` ends exactly at the
 *   clip end and `hold` loops in between. Fully seekable.
 * - `animation` — one linear animation, looped or clamped. Seekable.
 * - `stateMachine` — legacy fallback. State machines are stateful, so seeking
 *   replays from the start. Deterministic, but slower for long clips.
 * - `static` — no animation; a still graphic.
 */
export type TemplateTiming =
  | { kind: 'segments'; in: Segment | null; hold: Segment | null; out: Segment | null }
  | { kind: 'animation'; name: string; duration: number; loop: boolean }
  | { kind: 'stateMachine'; name: string }
  | { kind: 'static' };

export interface Segment {
  name: string;
  /** Seconds. */
  duration: number;
}

/**
 * Where the artboard sits in the video frame. Without a layout the artboard
 * is fitted to the whole frame, which is right for templates designed at
 * video resolution (e.g. a 1920×1080 artboard).
 */
export interface TemplateLayout {
  anchor: 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
  /** Width of the graphic as a percentage of the frame width. */
  widthPercent: number;
  /** Distance from the anchored edges as a percentage of the frame height. */
  marginPercent: number;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  category: string;
  artboard: string;
  width: number;
  height: number;
  /** Seconds. */
  defaultDuration: number;
  fields: TemplateField[];
  timing: TemplateTiming;
  layout?: TemplateLayout;
}

/** The manifest shipped next to a `.riv` file. Everything except `file` is optional. */
export interface TemplateManifest {
  id?: string;
  name?: string;
  category?: string;
  file: string;
  artboard?: string;
  defaultDuration?: number;
  /** Optional overrides of auto-detected fields: labels, order, hiding. */
  fields?: Array<Partial<TemplateField> & { key: string; hidden?: boolean }>;
  /** Override the auto-detected animation names. */
  animations?: { in?: string; hold?: string; out?: string };
  stateMachine?: string;
  layout?: TemplateLayout;
}

export type TemplateFrameState =
  | { kind: 'animation'; name: string; time: number }
  | { kind: 'stateMachine'; name: string; time: number }
  | { kind: 'static' };

/**
 * Map a moment inside a template clip (`local` seconds from the clip start)
 * to the animation state that should be shown. Pure and deterministic, which
 * is what makes preview and export identical.
 */
export function resolveTemplateFrame(timing: TemplateTiming, local: number, clipDuration: number): TemplateFrameState {
  const t = Math.max(0, local);
  switch (timing.kind) {
    case 'static':
      return { kind: 'static' };
    case 'stateMachine':
      return { kind: 'stateMachine', name: timing.name, time: t };
    case 'animation': {
      const d = timing.duration;
      if (d <= 0) return { kind: 'animation', name: timing.name, time: 0 };
      return { kind: 'animation', name: timing.name, time: timing.loop ? t % d : Math.min(t, d) };
    }
    case 'segments': {
      const { in: inSeg, hold, out } = timing;
      let inD = inSeg?.duration ?? 0;
      let outD = out?.duration ?? 0;
      // A clip shorter than in+out: shrink both proportionally so the
      // graphic still animates in and out completely.
      if (inD + outD > clipDuration && inD + outD > 0) {
        const k = clipDuration / (inD + outD);
        inD *= k;
        outD *= k;
      }
      if (inSeg && t < inD) {
        return { kind: 'animation', name: inSeg.name, time: inD > 0 ? (t / inD) * inSeg.duration : 0 };
      }
      const outStart = clipDuration - outD;
      if (out && t >= outStart) {
        const u = outD > 0 ? ((t - outStart) / outD) * out.duration : out.duration;
        return { kind: 'animation', name: out.name, time: Math.min(u, out.duration) };
      }
      if (hold) {
        const h = hold.duration;
        return { kind: 'animation', name: hold.name, time: h > 0 ? (t - inD) % h : 0 };
      }
      // No hold: freeze on the last frame of `in` (or first frame of `out`).
      if (inSeg) return { kind: 'animation', name: inSeg.name, time: inSeg.duration };
      if (out) return { kind: 'animation', name: out.name, time: 0 };
      return { kind: 'static' };
    }
  }
}

/** ARGB integer (Rive's colour format) → `#RRGGBBAA`. */
export function argbToHex(argb: number): string {
  const v = argb >>> 0;
  const a = (v >>> 24) & 0xff;
  const r = (v >>> 16) & 0xff;
  const g = (v >>> 8) & 0xff;
  const b = v & 0xff;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${h(a)}`;
}

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA` → ARGB integer. */
export function hexToArgb(hex: string): number {
  let s = hex.replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s += 'ff';
  if (!/^[0-9a-fA-F]{8}$/.test(s)) return 0xff000000;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = parseInt(s.slice(6, 8), 16);
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/** Human readable label from a property name: "titleText" → "Title text". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box (in output pixels) the artboard is fitted into. */
export function layoutBox(
  layout: TemplateLayout | undefined,
  frameW: number,
  frameH: number,
  artboardW: number,
  artboardH: number,
): Box {
  if (!layout || artboardW <= 0 || artboardH <= 0) return { minX: 0, minY: 0, maxX: frameW, maxY: frameH };
  const w = (frameW * layout.widthPercent) / 100;
  const h = (w * artboardH) / artboardW;
  const m = (frameH * layout.marginPercent) / 100;
  const a = layout.anchor;
  const x = a.endsWith('left') ? m : a.endsWith('right') ? frameW - m - w : (frameW - w) / 2;
  const y = a.startsWith('top') ? m : a.startsWith('bottom') ? frameH - m - h : (frameH - h) / 2;
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

import { evaluateParam } from './project';
import { layoutBox, type TemplateLayout } from './template';
import type { Frame } from './time';
import type { Clip, ClipTransform } from './types';

/* ------------------------------------------------------------- formats */

export interface FormatPreset {
  id: string;
  label: string;
  ratio: string;
  width: number;
  height: number;
  /** Typical use, shown as a hint. */
  use: string;
}

/** Standard delivery sizes. All at full HD-class resolution. */
export const FORMAT_PRESETS: FormatPreset[] = [
  { id: '1:1', label: 'Kvadrat', ratio: '1:1', width: 1080, height: 1080, use: 'Instagram- och LinkedIn-flöde' },
  { id: '3:4', label: 'Stående 3:4', ratio: '3:4', width: 1080, height: 1440, use: 'Instagram-flöde, Pinterest' },
  { id: '4:5', label: 'Porträtt 4:5', ratio: '4:5', width: 1080, height: 1350, use: 'Instagram- och Facebook-flöde' },
  { id: '9:16', label: 'Stående 9:16', ratio: '9:16', width: 1080, height: 1920, use: 'Reels, Stories, TikTok, Shorts' },
  { id: '16:9', label: 'Liggande 16:9', ratio: '16:9', width: 1920, height: 1080, use: 'YouTube, webb, presentationer' },
];

export const MIN_SIDE = 128;
export const MAX_SIDE = 4096;
/** H.264 level 5.2 frame-size limit; larger frames cannot be encoded in browsers. */
export const MAX_PIXELS = 4096 * 2304;

export function findPreset(width: number, height: number): FormatPreset | undefined {
  return FORMAT_PRESETS.find((p) => p.width === width && p.height === height);
}

/**
 * Validate a custom size. Returns the size rounded to even numbers (required
 * by H.264 4:2:0) and an error message if it cannot be used.
 */
export function validateCustomSize(width: number, height: number): { width: number; height: number; error: string | null } {
  const w = Math.round(width / 2) * 2;
  const h = Math.round(height / 2) * 2;
  let error: string | null = null;
  if (!Number.isFinite(w) || !Number.isFinite(h)) error = 'Ange bredd och höjd i pixlar';
  else if (w < MIN_SIDE || h < MIN_SIDE) error = `Minst ${MIN_SIDE} px per sida`;
  else if (w > MAX_SIDE || h > MAX_SIDE) error = `Högst ${MAX_SIDE} px per sida`;
  else if (w * h > MAX_PIXELS) error = `För många pixlar (högst ${MAX_SIDE}×2304 eller motsvarande)`;
  return { width: w, height: h, error };
}

/** "1080 × 1920 · 9:16" style label with the reduced aspect ratio. */
export function formatLabel(width: number, height: number): string {
  const g = gcd(width, height);
  return `${width} × ${height} px · ${width / g}:${height / g}`;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a) || 1;
}

/* ------------------------------------------------------------- transforms */

export interface TransformValues {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export const IDENTITY: TransformValues = { x: 0, y: 0, scale: 1, rotation: 0 };

export function transformAt(clip: Clip, frame?: Frame): TransformValues {
  const t = clip.transform;
  if (!t) return IDENTITY;
  return {
    x: evaluateParam(t.x, frame),
    y: evaluateParam(t.y, frame),
    scale: evaluateParam(t.scale, frame),
    rotation: evaluateParam(t.rotation, frame),
  };
}

export function toTransform(v: TransformValues): ClipTransform {
  return { x: { value: v.x }, y: { value: v.y }, scale: { value: v.scale }, rotation: { value: v.rotation } };
}

/** A layer's rectangle in output pixels: centre, size and rotation. */
export interface Placement {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
}

/** Size of a source fitted inside the frame (contain). */
export function containSize(srcW: number, srcH: number, frameW: number, frameH: number): { w: number; h: number } {
  if (srcW <= 0 || srcH <= 0) return { w: frameW, h: frameH };
  const k = Math.min(frameW / srcW, frameH / srcH);
  return { w: srcW * k, h: srcH * k };
}

/** Scale (relative to contain) at which a source covers the whole frame. */
export function coverScale(srcW: number, srcH: number, frameW: number, frameH: number): number {
  const c = containSize(srcW, srcH, frameW, frameH);
  return Math.max(frameW / c.w, frameH / c.h);
}

/** Placement of a video or image clip. */
export function mediaPlacement(srcW: number, srcH: number, frameW: number, frameH: number, t: TransformValues): Placement {
  const c = containSize(srcW, srcH, frameW, frameH);
  return {
    cx: frameW / 2 + t.x * frameW,
    cy: frameH / 2 + t.y * frameH,
    w: c.w * t.scale,
    h: c.h * t.scale,
    rotation: t.rotation,
  };
}

/**
 * Placement of a template clip: its own layout box (from the manifest),
 * scaled around its centre and moved by the clip transform.
 */
export function templatePlacement(
  layout: TemplateLayout | undefined,
  artboardW: number,
  artboardH: number,
  frameW: number,
  frameH: number,
  t: TransformValues,
): Placement {
  // Without a layout the artboard is contained in the frame.
  const box = layout
    ? layoutBox(layout, frameW, frameH, artboardW, artboardH)
    : (() => {
        const c = containSize(artboardW, artboardH, frameW, frameH);
        return { minX: (frameW - c.w) / 2, minY: (frameH - c.h) / 2, maxX: (frameW + c.w) / 2, maxY: (frameH + c.h) / 2 };
      })();
  const w = (box.maxX - box.minX) * t.scale;
  const h = (box.maxY - box.minY) * t.scale;
  return {
    cx: (box.minX + box.maxX) / 2 + t.x * frameW,
    cy: (box.minY + box.maxY) / 2 + t.y * frameH,
    w,
    h,
    rotation: 0,
  };
}

/** Is a point (output pixels) inside a placement, accounting for rotation? */
export function hitTest(p: Placement, px: number, py: number): boolean {
  const r = (-p.rotation * Math.PI) / 180;
  const dx = px - p.cx;
  const dy = py - p.cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2;
}

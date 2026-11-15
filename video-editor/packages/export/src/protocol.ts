import type { Project } from '@ve/core';
import type { TemplateSource } from '@ve/rive';
import type { FontSource } from '@ve/render';

export interface ExportOptions {
  /** Bits per second for H.264. */
  videoBitrate: number;
  audioBitrate: number;
  /** Optional sub-range in frames [start, end). Defaults to the whole timeline. */
  range?: { start: number; end: number };
}

export interface ExportJob {
  project: Project;
  /** Media by asset id (videos and images): a local file, or an absolute URL. */
  media: Record<string, Blob | string>;
  templates: TemplateSource[];
  /** Absolute URL of rive.wasm. */
  riveWasmUrl: string;
  /** Font files for text clips (workers cannot see fonts declared in CSS). */
  fonts?: FontSource[];
  options: ExportOptions;
}

export type ExportRequest = { type: 'start'; job: ExportJob } | { type: 'cancel' };

export type ExportEvent =
  | { type: 'progress'; frame: number; total: number; framesPerSecond: number }
  | { type: 'done'; data: ArrayBuffer; mimeType: string; elapsedMs: number }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

export const QUALITY_PRESETS = {
  standard: { label: 'Standard', bitsPerPixel: 0.1 },
  high: { label: 'Hög', bitsPerPixel: 0.16 },
  max: { label: 'Max', bitsPerPixel: 0.25 },
} as const;

export type QualityPreset = keyof typeof QUALITY_PRESETS;

export function videoBitrateFor(width: number, height: number, fps: number, preset: QualityPreset): number {
  return Math.round(width * height * fps * QUALITY_PRESETS[preset].bitsPerPixel);
}

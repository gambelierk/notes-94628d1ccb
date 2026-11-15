import type { Frame, Micros, Rational } from './time';

export const PROJECT_VERSION = 1 as const;

/**
 * An animatable value. Today it is always static; keyframes can be added later
 * as another variant without touching the renderer, because every read goes
 * through `evaluateParam`.
 */
export type Param<T> = { value: T };

export interface ProjectSettings {
  width: number;
  height: number;
  fps: Rational;
  sampleRate: number;
  /** Background colour behind all layers, `#RRGGBB`. */
  background: string;
  /**
   * When true the first video placed on an empty timeline decides resolution
   * and frame rate ("new sequence from clip"). Turned off once applied, or
   * when the user picked a format explicitly.
   */
  autoFormat?: boolean;
}

export interface VideoAsset {
  kind: 'video';
  id: string;
  name: string;
  durationUs: Micros;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Byte size, for display and integrity checks when relinking. */
  size: number;
}

export interface ImageAsset {
  kind: 'image';
  id: string;
  name: string;
  width: number;
  height: number;
  size: number;
  mime: string;
}

export type MediaAsset = VideoAsset | ImageAsset;

export type TemplateFieldType = 'string' | 'color' | 'number' | 'boolean' | 'enum' | 'image';

export type PropValue =
  | { type: 'string'; value: string }
  | { type: 'color'; value: string } // #RRGGBBAA
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'enum'; value: string }
  | { type: 'image'; assetId: string | null };

interface ClipBase {
  id: string;
  /** Position on the timeline. */
  start: Frame;
  /** Length on the timeline. */
  duration: Frame;
}

export interface VideoClip extends ClipBase {
  kind: 'video';
  assetId: string;
  /** Where in the source the clip begins. */
  sourceStart: Micros;
  volume: Param<number>;
  opacity: Param<number>;
}

export interface TemplateClip extends ClipBase {
  kind: 'template';
  templateId: string;
  props: Record<string, Param<PropValue>>;
  opacity: Param<number>;
}

export type Clip = VideoClip | TemplateClip;

export type TrackKind = 'video' | 'graphics';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: Clip[];
}

export interface Project {
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  settings: ProjectSettings;
  /** Media used by the project. The bytes live outside the project (OPFS / memory). */
  assets: MediaAsset[];
  /** Ordered bottom → top. */
  tracks: Track[];
}

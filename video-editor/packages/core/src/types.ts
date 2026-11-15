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
  /** Pixel size, or for vector graphics the intrinsic size (only the aspect ratio matters). */
  width: number;
  height: number;
  size: number;
  mime: string;
  /**
   * Vector graphics (SVG, or PDF which also covers Illustrator and converted
   * EPS files) are re-rendered at the size they are shown, so edges stay sharp.
   */
  vector?: 'svg' | 'pdf';
}

export interface AudioAsset {
  kind: 'audio';
  id: string;
  name: string;
  durationUs: Micros;
  sampleRate: number;
  channels: number;
  size: number;
}

export type MediaAsset = VideoAsset | ImageAsset | AudioAsset;

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
  /**
   * Fade from black/silence over this many frames at the start, and to
   * black/silence at the end. Pictures fade their opacity, sound its volume
   * (a video clip fades both). Missing = no fade.
   */
  fadeIn?: Frame;
  fadeOut?: Frame;
  /**
   * Cross-dissolve from the clip directly before this one on the same track.
   * Centred on the cut; only active while the two clips touch.
   */
  transitionIn?: {
    kind: 'dissolve';
    duration: Frame;
    /** Id of the clip it dissolves from. The dissolve only applies while that clip touches this one. */
    from?: string;
  };
}

/**
 * Where a visual clip sits in the frame. Optional: a missing transform means
 * "fit to the frame, centred". Positions are fractions of the frame size so
 * a layout survives a change of format; the UI shows them in pixels.
 */
export interface ClipTransform {
  /** Horizontal offset of the clip's centre from the frame centre, as a fraction of frame width. */
  x: Param<number>;
  /** Vertical offset, as a fraction of frame height. */
  y: Param<number>;
  /** 1 = fitted inside the frame (contain). */
  scale: Param<number>;
  /** Degrees, clockwise. */
  rotation: Param<number>;
}

export interface VideoClip extends ClipBase {
  kind: 'video';
  assetId: string;
  /** Where in the source the clip begins. */
  sourceStart: Micros;
  volume: Param<number>;
  opacity: Param<number>;
  transform?: ClipTransform;
}

export interface ImageClip extends ClipBase {
  kind: 'image';
  assetId: string;
  opacity: Param<number>;
  transform?: ClipTransform;
}

export interface TemplateClip extends ClipBase {
  kind: 'template';
  templateId: string;
  props: Record<string, Param<PropValue>>;
  opacity: Param<number>;
  /** Applied on top of the template's own layout. Rotation is not supported for templates. */
  transform?: ClipTransform;
}

/** A sound file on an audio track (music, voice-over, effects). */
export interface AudioClip extends ClipBase {
  kind: 'audio';
  assetId: string;
  sourceStart: Micros;
  volume: Param<number>;
}

export type TextAlign = 'left' | 'center' | 'right';
/** 'brand-heading' / 'brand-body' are the customer's own typefaces (see branding); they fall back to IBM Plex Sans. */
export type TextFont = 'sans' | 'mono' | 'brand-heading' | 'brand-body';

export interface TextStyle {
  font: TextFont;
  /** Font size as a fraction of the frame height, so text scales with the format. */
  size: number;
  weight: 400 | 500 | 600 | 700;
  color: string; // #RRGGBB
  align: TextAlign;
  lineHeight: number;
  /** Wrap width as a fraction of the frame width. */
  maxWidth: number;
  /** Box behind the text (subtitles, labels). */
  background: { color: string; opacity: number } | null;
  shadow: boolean;
}

/** Plain text rendered by the editor itself (titles, subtitles), no Rive needed. */
export interface TextClip extends ClipBase {
  kind: 'text';
  text: string;
  style: TextStyle;
  opacity: Param<number>;
  transform?: ClipTransform;
}

export type Clip = VideoClip | ImageClip | TemplateClip | TextClip | AudioClip;
/** Clips that draw something. */
export type VisualClip = Exclude<Clip, AudioClip>;
/** Clips that make sound. */
export type SoundClip = VideoClip | AudioClip;

export type TrackKind = 'video' | 'graphics' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  /** Track gain applied to every clip's sound on the track (video and audio tracks). */
  volume?: Param<number>;
  /** Marks a track holding subtitles (export as .srt). */
  role?: 'subtitles';
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

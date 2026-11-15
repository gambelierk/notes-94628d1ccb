import { evaluateParam } from './project';
import type { Frame, Rational } from './time';
import type { Clip, Project, Track } from './types';
import { soundOverlap } from './transitions';

/**
 * Fade multiplier (0–1) at `local` frames into a clip. Fractional frames are
 * allowed so audio can be faded per sample. Linear ramps; the fade-in and
 * fade-out never sum to more than the clip.
 */
export function fadeFactor(clip: Pick<Clip, 'duration' | 'fadeIn' | 'fadeOut'>, local: number): number {
  const d = clip.duration;
  if (local < 0 || local > d) return 0;
  let f = 1;
  const fi = Math.min(clip.fadeIn ?? 0, d);
  const fo = Math.min(clip.fadeOut ?? 0, d - fi);
  if (fi > 0 && local < fi) f = Math.min(f, local / fi);
  if (fo > 0 && local > d - fo) f = Math.min(f, (d - local) / fo);
  return Math.max(0, Math.min(1, f));
}

/** Opacity of a visual clip at a timeline frame, including fades. */
export function clipOpacity(clip: Clip, frame: Frame): number {
  const base = 'opacity' in clip ? evaluateParam(clip.opacity, frame) : 1;
  return base * fadeFactor(clip, frame - clip.start);
}

/** Static gain of a sound clip (clip volume × track volume), without fades. */
export function soundGain(clip: Clip, track: Track): number {
  const clipVol = 'volume' in clip ? evaluateParam(clip.volume) : 1;
  const trackVol = track.volume ? evaluateParam(track.volume) : 1;
  return clipVol * trackVol;
}

/** Fades expressed in seconds, for audio engines. */
export function fadeSeconds(clip: Pick<Clip, 'fadeIn' | 'fadeOut'>, fps: Rational): { fadeIn: number; fadeOut: number } {
  const s = (f?: number) => ((f ?? 0) * fps.den) / fps.num;
  return { fadeIn: s(clip.fadeIn), fadeOut: s(clip.fadeOut) };
}

/** Volume as decibels for display (−∞ for silence). */
export function gainToDb(g: number): string {
  if (g <= 0.0001) return '−∞ dB';
  const db = 20 * Math.log10(g);
  return `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
}

export interface SoundSpan {
  assetId: string;
  /** Seconds on the timeline (relative to `fromFrame`). */
  start: number;
  duration: number;
  /** Seconds into the source. */
  sourceStart: number;
  /** Clip volume × track volume. */
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

/**
 * Everything that makes sound, ready for a mixer: the sound of video clips
 * on video tracks and sound files on audio tracks. Muted tracks and silent
 * clips are skipped. Used by both the preview and the exporter.
 */
export function soundSpans(project: Project, fromFrame = 0): SoundSpan[] {
  const fps = project.settings.fps;
  const sec = (f: number) => (f * fps.den) / fps.num;
  const out: SoundSpan[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.hidden) continue;
    for (const c of track.clips) {
      if (c.kind !== 'video' && c.kind !== 'audio') continue;
      const volume = soundGain(c, track);
      if (volume <= 0) continue;
      const f = fadeSeconds(c, fps);
      // Dissolves: the sound starts earlier / ends later and is cross-faded over the dissolve.
      const o = soundOverlap(project, track, c);
      out.push({
        assetId: c.assetId,
        start: sec(c.start - o.before - fromFrame),
        duration: sec(c.duration + o.before + o.after),
        sourceStart: c.sourceStart / 1_000_000 - sec(o.before),
        volume,
        fadeIn: o.inLen ? sec(o.inLen) : f.fadeIn,
        fadeOut: o.outLen ? sec(o.outLen) : f.fadeOut,
      });
    }
  }
  return out;
}

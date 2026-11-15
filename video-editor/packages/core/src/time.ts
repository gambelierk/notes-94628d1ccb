/**
 * Time model.
 *
 * - Timeline positions are integer frames at the project frame rate (`Frame`).
 * - Source media positions are integer microseconds (`Micros`).
 *
 * Keeping both as integers avoids floating point drift over long timelines.
 */

export type Frame = number;
export type Micros = number;

export interface Rational {
  num: number;
  den: number;
}

export const MICROS_PER_SECOND = 1_000_000;

export function fpsValue(fps: Rational): number {
  return fps.num / fps.den;
}

export function framesToSeconds(frames: Frame, fps: Rational): number {
  return (frames * fps.den) / fps.num;
}

export function framesToMicros(frames: Frame, fps: Rational): Micros {
  return Math.round((frames * fps.den * MICROS_PER_SECOND) / fps.num);
}

export function secondsToFrames(seconds: number, fps: Rational): Frame {
  return Math.round((seconds * fps.num) / fps.den);
}

/** Floor variant: the frame that is showing at `seconds`. */
export function secondsToFrameFloor(seconds: number, fps: Rational): Frame {
  return Math.floor((seconds * fps.num) / fps.den + 1e-9);
}

export function microsToFrames(us: Micros, fps: Rational): Frame {
  return Math.round((us * fps.num) / (fps.den * MICROS_PER_SECOND));
}

export function microsToSeconds(us: Micros): number {
  return us / MICROS_PER_SECOND;
}

export function secondsToMicros(seconds: number): Micros {
  return Math.round(seconds * MICROS_PER_SECOND);
}

/** Snap an arbitrary detected frame rate to the closest common broadcast rate. */
export function normalizeFps(rate: number): Rational {
  const common: Rational[] = [
    { num: 24000, den: 1001 },
    { num: 24, den: 1 },
    { num: 25, den: 1 },
    { num: 30000, den: 1001 },
    { num: 30, den: 1 },
    { num: 50, den: 1 },
    { num: 60000, den: 1001 },
    { num: 60, den: 1 },
  ];
  if (!Number.isFinite(rate) || rate <= 0) return { num: 30, den: 1 };
  let best = common[0]!;
  for (const c of common) {
    if (Math.abs(fpsValue(c) - rate) < Math.abs(fpsValue(best) - rate)) best = c;
  }
  return best;
}

/** Format a frame as HH:MM:SS:FF timecode (non drop-frame). */
export function formatTimecode(frame: Frame, fps: Rational): string {
  const nominal = Math.round(fpsValue(fps));
  const f = Math.max(0, Math.round(frame));
  const ff = f % nominal;
  const totalSeconds = Math.floor(f / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

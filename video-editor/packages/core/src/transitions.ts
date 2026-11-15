import { fadeFactor } from './fades';
import { mediaPlacement, transformAt } from './layout';
import { clipEnd, evaluateParam, findClip, updateClip } from './project';
import type { Frame } from './time';
import type { Clip, Project, Track, VisualClip } from './types';

/**
 * Transitions are opt-in and live at clip edges:
 * - between two touching clips on a track: a cross-dissolve, stored on the
 *   right-hand clip as `transitionIn` together with the id of the clip it
 *   dissolves from, centred on the cut. It only applies while those two clips
 *   touch, so moving, deleting or overwriting a neighbour can never attach a
 *   dissolve to a clip nobody chose;
 * - at a clip's start or end: a fade from/to black (or silence), stored as
 *   `fadeIn` / `fadeOut`.
 */

/** Where a transition can be added or already is. `duration` is null when there is none yet. */
export type Joint =
  | { kind: 'cut'; frame: Frame; leftId: string; rightId: string; duration: Frame | null }
  | { kind: 'start'; frame: Frame; clipId: string; duration: Frame | null }
  | { kind: 'end'; frame: Frame; clipId: string; duration: Frame | null };

/** A transition the user selected: the clip it belongs to and which edge. */
export interface TransitionRef {
  clipId: string;
  edge: 'in' | 'out';
}

export const DEFAULT_TRANSITION_SECONDS = 1;

/** Clips touching end-to-start on the same track. */
function prevTouching(track: Track, clip: Clip): Clip | undefined {
  return track.clips.find((c) => c.id !== clip.id && clipEnd(c) === clip.start);
}
function nextTouching(track: Track, clip: Clip): Clip | undefined {
  return track.clips.find((c) => c.id !== clip.id && c.start === clipEnd(clip));
}

/** Does `clip` dissolve from `prev` (its stored partner, or any neighbour for older projects without one)? */
function dissolvesFrom(clip: Clip, prev: Clip | undefined): prev is Clip {
  return !!prev && !!clip.transitionIn && (clip.transitionIn.from === undefined || clip.transitionIn.from === prev.id);
}

/** Effective dissolve length: never longer than either clip. */
function dissolveLength(left: Clip, right: Clip): Frame {
  const d = right.transitionIn?.duration ?? 0;
  return Math.max(0, Math.min(d, left.duration, right.duration));
}

/** Frames before / after the cut that a dissolve covers. */
function split(d: Frame): [Frame, Frame] {
  const before = Math.floor(d / 2);
  return [before, d - before];
}

/**
 * All places on a track where a transition exists or can be added, in one
 * pass over the (sorted, non-overlapping) clips:
 * - every cut between touching clips (dissolve, or a button to add one);
 * - every free clip start/end (fade, or a button to add one);
 * - existing fades at touching edges (a "dip to black" at a cut), so they
 *   stay visible and removable.
 */
export function joints(track: Track): Joint[] {
  const out: Joint[] = [];
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    const prev = i > 0 && clipEnd(clips[i - 1]!) === c.start ? clips[i - 1]! : undefined;
    const next = i + 1 < clips.length && clips[i + 1]!.start === clipEnd(c) ? clips[i + 1]! : undefined;
    if (prev) {
      out.push({ kind: 'cut', frame: c.start, leftId: prev.id, rightId: c.id, duration: dissolvesFrom(c, prev) ? dissolveLength(prev, c) : null });
      if (c.fadeIn) out.push({ kind: 'start', frame: c.start, clipId: c.id, duration: c.fadeIn });
    } else {
      out.push({ kind: 'start', frame: c.start, clipId: c.id, duration: c.fadeIn ?? null });
    }
    if (!next || c.fadeOut) out.push({ kind: 'end', frame: clipEnd(c), clipId: c.id, duration: c.fadeOut ?? null });
  }
  return out;
}

/** The selectable transition for a joint (dissolves belong to the right clip's "in" edge). */
export function jointRef(j: Joint): TransitionRef {
  if (j.kind === 'cut') return { clipId: j.rightId, edge: 'in' };
  return { clipId: j.clipId, edge: j.kind === 'start' ? 'in' : 'out' };
}

export interface TransitionInfo {
  kind: 'dissolve' | 'fadeIn' | 'fadeOut';
  duration: Frame;
  /** Longest allowed length: the shorter clip for a dissolve, the clip minus its other fade for a fade. */
  max: Frame;
  clip: Clip;
  other?: Clip;
}

export function describeTransition(project: Project, ref: TransitionRef): TransitionInfo | null {
  const f = findClip(project, ref.clipId);
  if (!f) return null;
  const { clip, track } = f;
  if (ref.edge === 'in') {
    const prev = prevTouching(track, clip);
    if (dissolvesFrom(clip, prev)) return { kind: 'dissolve', duration: dissolveLength(prev, clip), max: Math.min(prev.duration, clip.duration), clip, other: prev };
    if (clip.fadeIn) return { kind: 'fadeIn', duration: clip.fadeIn, max: Math.max(1, clip.duration - (clip.fadeOut ?? 0)), clip };
    return null;
  }
  return clip.fadeOut ? { kind: 'fadeOut', duration: clip.fadeOut, max: Math.max(1, clip.duration - (clip.fadeIn ?? 0)), clip } : null;
}

/**
 * Add a transition at a joint: a dissolve between touching clips, otherwise a
 * fade from/to black. `frames` is the wanted length, limited by the clips.
 */
export function addTransition(project: Project, j: Joint, frames: Frame): Project {
  if (j.kind === 'cut') {
    const l = findClip(project, j.leftId)?.clip;
    const r = findClip(project, j.rightId)?.clip;
    if (!l || !r) return project;
    const d = Math.max(1, Math.min(frames, l.duration, r.duration));
    // a dissolve replaces any dip to black at this cut
    let p = updateClip(project, r.id, (c) => ({ ...c, transitionIn: { kind: 'dissolve', duration: d, from: l.id }, fadeIn: undefined }));
    p = updateClip(p, l.id, (c) => ({ ...c, fadeOut: undefined }));
    return p;
  }
  const c = findClip(project, j.clipId)?.clip;
  if (!c) return project;
  const other = j.kind === 'start' ? (c.fadeOut ?? 0) : (c.fadeIn ?? 0);
  const d = Math.max(1, Math.min(frames, Math.floor(c.duration / 2) || 1, c.duration - other));
  return updateClip(project, c.id, (x) => (j.kind === 'start' ? { ...x, fadeIn: d } : { ...x, fadeOut: d }));
}

export function setTransitionDuration(project: Project, ref: TransitionRef, frames: Frame): Project {
  const t = describeTransition(project, ref);
  if (!t) return project;
  const d = Math.max(1, Math.min(Math.round(frames), t.max));
  return updateClip(project, ref.clipId, (c) => {
    if (t.kind === 'dissolve') return { ...c, transitionIn: { ...c.transitionIn!, duration: d } };
    if (t.kind === 'fadeIn') return { ...c, fadeIn: d };
    return { ...c, fadeOut: d };
  });
}

export function removeTransition(project: Project, ref: TransitionRef): Project {
  const t = describeTransition(project, ref);
  if (!t) return project;
  return updateClip(project, ref.clipId, (c) =>
    t.kind === 'dissolve' ? { ...c, transitionIn: undefined } : t.kind === 'fadeIn' ? { ...c, fadeIn: undefined } : { ...c, fadeOut: undefined },
  );
}

/* ------------------------------------------------------------- rendering */

export interface Layer {
  track: Track;
  clip: VisualClip;
  /** Transition/fade multiplier (0–1), to be multiplied with the clip's own opacity. */
  mix: number;
}

/**
 * Everything drawn at `frame`, bottom → top, including both clips during a
 * dissolve. The outgoing clip keeps playing past its cut (using the media
 * after its out-point, or its last frame if there is none).
 */
export function visibleLayersAt(project: Project, frame: Frame): Layer[] {
  const out: Layer[] = [];
  for (const track of project.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    const clips = track.clips.filter((c): c is VisualClip => c.kind !== 'audio');
    const main = clips.find((c) => frame >= c.start && frame < clipEnd(c));
    if (!main) continue;
    const prev = prevTouching(track, main) as VisualClip | undefined;
    const next = nextTouching(track, main) as VisualClip | undefined;

    if (dissolvesFrom(main, prev)) {
      const d = dissolveLength(prev, main);
      const [before, after] = split(d);
      if (d > 0 && frame < main.start + after) {
        const p = (frame - (main.start - before) + 0.5) / d;
        out.push({ track, clip: prev as VisualClip, mix: outgoingMix(project, prev as VisualClip, p) });
        out.push({ track, clip: main, mix: p });
        continue;
      }
    }
    if (next && dissolvesFrom(next, main)) {
      const d = dissolveLength(main, next);
      const [before] = split(d);
      if (d > 0 && frame >= next.start - before) {
        const p = (frame - (next.start - before) + 0.5) / d;
        out.push({ track, clip: main, mix: outgoingMix(project, main, p) });
        out.push({ track, clip: next, mix: p });
        continue;
      }
    }
    out.push({ track, clip: main, mix: fadeFactor(main, frame - main.start) });
  }
  return out;
}

/**
 * A full-frame, fully opaque video stays at 100 % underneath while the
 * incoming clip fades in: a true cross-dissolve with no dip in brightness.
 * Anything that doesn't cover the whole frame (scaled/moved/rotated video,
 * reduced opacity, images that may be transparent, text, templates) fades
 * out at the same time, so it never disappears with a jump.
 */
function outgoingMix(project: Project, clip: VisualClip, p: number): number {
  return coversFrame(project, clip) ? 1 : Math.max(0, 1 - p);
}

function coversFrame(project: Project, clip: VisualClip): boolean {
  if (clip.kind !== 'video' || evaluateParam(clip.opacity) < 1) return false;
  const a = project.assets.find((x) => x.id === clip.assetId);
  if (!a || a.kind !== 'video') return false;
  const { width: W, height: H } = project.settings;
  const pl = mediaPlacement(a.width, a.height, W, H, transformAt(clip));
  if (pl.rotation % 360 !== 0) return false;
  const eps = 0.5;
  return pl.cx - pl.w / 2 <= eps && pl.cy - pl.h / 2 <= eps && pl.cx + pl.w / 2 >= W - eps && pl.cy + pl.h / 2 >= H - eps;
}

/* ------------------------------------------------------------- sound */

/** Media available before a clip's in-point / after its out-point (frames). Unlimited for clips without source media. */
function handles(project: Project, clip: Clip): { head: Frame; tail: Frame } {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return { head: Infinity, tail: Infinity };
  const a = project.assets.find((x) => x.id === clip.assetId);
  if (!a || a.kind === 'image') return { head: 0, tail: 0 };
  const fps = project.settings.fps;
  const usPerFrame = (fps.den * 1_000_000) / fps.num;
  const head = Math.floor(clip.sourceStart / usPerFrame + 1e-6);
  const tail = Math.floor((a.durationUs - clip.sourceStart) / usPerFrame + 1e-6) - clip.duration;
  return { head: Math.max(0, head), tail: Math.max(0, tail) };
}

/**
 * How a sound clip is extended and faded by dissolves at its edges.
 *
 * With media to spare on both sides the sounds overlap and cross-fade over
 * the whole dissolve. Without it (the clip already uses the start/end of its
 * file) the outgoing sound fades down to the cut and the incoming one up from
 * it, so nothing is ever cut off abruptly.
 */
export function soundOverlap(project: Project, track: Track, clip: Clip): { before: Frame; after: Frame; inLen: Frame; outLen: Frame } {
  const prev = prevTouching(track, clip);
  const next = nextTouching(track, clip);
  const h = handles(project, clip);
  let before = 0;
  let after = 0;
  let inLen = 0;
  let outLen = 0;
  if (dissolvesFrom(clip, prev)) {
    const [b, a] = split(dissolveLength(prev, clip));
    before = Math.min(b, h.head);
    inLen = before + a;
  }
  if (next && dissolvesFrom(next, clip)) {
    const [b, a] = split(dissolveLength(clip, next));
    after = Math.min(a, h.tail);
    outLen = b + after;
  }
  return { before, after, inLen, outLen };
}

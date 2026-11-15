import { fadeFactor } from './fades';
import { clipEnd, findClip, updateClip } from './project';
import type { Frame } from './time';
import type { Clip, Project, Track, VisualClip } from './types';

/**
 * Transitions are opt-in and live at clip edges:
 * - between two touching clips on a track: a cross-dissolve (stored on the
 *   right-hand clip as `transitionIn`), centred on the cut;
 * - at a free start or end of a clip: a fade from/to black (or silence),
 *   stored as `fadeIn` / `fadeOut`.
 */

/** Where a transition can be added or already is. */
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

/** All places on a track where a transition exists or can be added. */
export function joints(track: Track): Joint[] {
  const out: Joint[] = [];
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  for (const c of clips) {
    const prev = prevTouching(track, c);
    if (prev) out.push({ kind: 'cut', frame: c.start, leftId: prev.id, rightId: c.id, duration: c.transitionIn ? dissolveLength(prev, c) : null });
    else out.push({ kind: 'start', frame: c.start, clipId: c.id, duration: c.fadeIn ?? null });
    if (!nextTouching(track, c)) out.push({ kind: 'end', frame: clipEnd(c), clipId: c.id, duration: c.fadeOut ?? null });
  }
  return out;
}

/** The selectable transition for a joint (dissolves belong to the right clip's "in" edge). */
export function jointRef(j: Joint): TransitionRef {
  if (j.kind === 'cut') return { clipId: j.rightId, edge: 'in' };
  return { clipId: j.clipId, edge: j.kind === 'start' ? 'in' : 'out' };
}

export function describeTransition(project: Project, ref: TransitionRef):
  | { kind: 'dissolve' | 'fadeIn' | 'fadeOut'; duration: Frame; max: Frame; clip: Clip; other?: Clip }
  | null {
  const f = findClip(project, ref.clipId);
  if (!f) return null;
  const { clip, track } = f;
  if (ref.edge === 'in') {
    const prev = prevTouching(track, clip);
    if (prev && clip.transitionIn) return { kind: 'dissolve', duration: dissolveLength(prev, clip), max: Math.min(prev.duration, clip.duration), clip, other: prev };
    if (clip.fadeIn) return { kind: 'fadeIn', duration: clip.fadeIn, max: clip.duration, clip };
    return null;
  }
  return clip.fadeOut ? { kind: 'fadeOut', duration: clip.fadeOut, max: clip.duration, clip } : null;
}

/**
 * Add a transition at a joint: a dissolve between touching clips, otherwise a
 * fade from/to black. Default length 1 s, limited by the clips involved.
 */
export function addTransition(project: Project, j: Joint, frames: Frame): Project {
  if (j.kind === 'cut') {
    const l = findClip(project, j.leftId)?.clip;
    const r = findClip(project, j.rightId)?.clip;
    if (!l || !r) return project;
    const d = Math.max(1, Math.min(frames, l.duration, r.duration));
    let p = updateClip(project, r.id, (c) => ({ ...c, transitionIn: { kind: 'dissolve', duration: d }, fadeIn: undefined }));
    p = updateClip(p, l.id, (c) => ({ ...c, fadeOut: undefined }));
    return p;
  }
  const c = findClip(project, j.clipId)?.clip;
  if (!c) return project;
  const d = Math.max(1, Math.min(frames, Math.floor(c.duration / 2) || 1));
  return updateClip(project, c.id, (x) => (j.kind === 'start' ? { ...x, fadeIn: d } : { ...x, fadeOut: d }));
}

export function setTransitionDuration(project: Project, ref: TransitionRef, frames: Frame): Project {
  const t = describeTransition(project, ref);
  if (!t) return project;
  const d = Math.max(1, Math.min(Math.round(frames), t.max));
  return updateClip(project, ref.clipId, (c) => {
    if (t.kind === 'dissolve') return { ...c, transitionIn: { kind: 'dissolve', duration: d } };
    if (t.kind === 'fadeIn') return { ...c, fadeIn: Math.min(d, c.duration - (c.fadeOut ?? 0)) };
    return { ...c, fadeOut: Math.min(d, c.duration - (c.fadeIn ?? 0)) };
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
    // dissolves need touching neighbours on the same track
    const next = nextTouching(track, main) as VisualClip | undefined;
    const prev = prevTouching(track, main) as VisualClip | undefined;

    if (prev && main.transitionIn) {
      const d = dissolveLength(prev, main);
      const [before, after] = split(d);
      if (d > 0 && frame < main.start + after) {
        const p = (frame - (main.start - before) + 0.5) / d;
        out.push({ track, clip: prev, mix: outgoingMix(prev, p) });
        out.push({ track, clip: main, mix: p });
        continue;
      }
    }
    if (next && next.transitionIn) {
      const d = dissolveLength(main, next);
      const [before] = split(d);
      if (d > 0 && frame >= next.start - before) {
        const p = (frame - (next.start - before) + 0.5) / d;
        out.push({ track, clip: main, mix: outgoingMix(main, p) });
        out.push({ track, clip: next, mix: p });
        continue;
      }
    }
    out.push({ track, clip: main, mix: fadeFactor(main, frame - main.start) });
  }
  return out;
}

/**
 * Opaque pictures (video, images) stay fully visible underneath while the
 * incoming clip fades in — a true cross-dissolve with no dip. Graphics with
 * transparency (text, templates) fade out at the same time.
 */
function outgoingMix(clip: VisualClip, p: number): number {
  return clip.kind === 'video' || clip.kind === 'image' ? 1 : Math.max(0, 1 - p);
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
  if (prev && clip.transitionIn) {
    const d = dissolveLength(prev, clip);
    const [b, a] = split(d);
    before = Math.min(b, h.head);
    inLen = before + a;
  }
  if (next?.transitionIn) {
    const d = dissolveLength(clip, next);
    const [b, a] = split(d);
    after = Math.min(a, h.tail);
    outLen = b + after;
  }
  return { before, after, inLen, outLen };
}

import { framesToMicros, microsToFrames, type Frame, type Micros, type Rational } from './time';
import {
  PROJECT_VERSION,
  type Clip,
  type MediaAsset,
  type Param,
  type Project,
  type ProjectSettings,
  type PropValue,
  type TemplateClip,
  type Track,
  type TrackKind,
  type VideoAsset,
  type VideoClip,
} from './types';

let idCounter = 0;
export function createId(prefix: string): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${rnd}${idCounter.toString(36)}`;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  sampleRate: 48_000,
  background: '#000000',
};

export function createProject(name = 'Nytt projekt', settings: Partial<ProjectSettings> = {}): Project {
  return {
    version: PROJECT_VERSION,
    id: createId('prj'),
    name,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    assets: [],
    tracks: [
      { id: createId('trk'), kind: 'video', name: 'V1', muted: false, hidden: false, clips: [] },
      { id: createId('trk'), kind: 'graphics', name: 'G1', muted: false, hidden: false, clips: [] },
    ],
  };
}

export function evaluateParam<T>(param: Param<T>, _frame?: Frame): T {
  // Static for now. Keyframed params plug in here.
  return param.value;
}

/* ------------------------------------------------------------------ queries */

export function clipEnd(clip: Clip): Frame {
  return clip.start + clip.duration;
}

export function projectDuration(project: Project): Frame {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function findAsset(project: Project, assetId: string): MediaAsset | undefined {
  return project.assets.find((a) => a.id === assetId);
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip; index: number } | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index]!, index };
  }
  return undefined;
}

/** Clips visible at `frame`, ordered bottom → top. */
export function activeClipsAt(project: Project, frame: Frame): { track: Track; clip: Clip }[] {
  const out: { track: Track; clip: Clip }[] = [];
  for (const track of project.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (frame >= clip.start && frame < clipEnd(clip)) {
        out.push({ track, clip });
        break; // clips never overlap within a track
      }
    }
  }
  return out;
}

/** Source time (µs) shown by a video clip at timeline `frame`. */
export function sourceTimeAt(clip: VideoClip, frame: Frame, fps: Rational): Micros {
  return clip.sourceStart + framesToMicros(frame - clip.start, fps);
}

/** Longest a video clip can be given its source start and the asset length. */
export function maxVideoClipDuration(asset: VideoAsset, sourceStart: Micros, fps: Rational): Frame {
  return Math.max(1, Math.floor(((asset.durationUs - sourceStart) * fps.num) / (fps.den * 1_000_000) + 1e-6));
}

export function trackAcceptsClip(track: Track, clip: Pick<Clip, 'kind'>): boolean {
  return trackKindFor(clip.kind) === track.kind;
}

export function trackKindFor(clipKind: Clip['kind']): TrackKind {
  return clipKind === 'video' ? 'video' : 'graphics';
}

/** Frames that the playhead / clip edges should snap to. */
export function snapPoints(project: Project, excludeClipId?: string): Frame[] {
  const pts = new Set<Frame>([0]);
  for (const t of project.tracks)
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      pts.add(c.start);
      pts.add(clipEnd(c));
    }
  return [...pts].sort((a, b) => a - b);
}

export function snap(frame: Frame, points: readonly Frame[], threshold: Frame): Frame {
  let best = frame;
  let bestDist = threshold + 1;
  for (const p of points) {
    const d = Math.abs(p - frame);
    if (d <= threshold && d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/* ------------------------------------------------------------- operations */
/* All operations are pure: they return a new Project and never mutate.     */

function mapTrack(project: Project, trackId: string, fn: (t: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start);
}

/** Shift a clip's start edge by `delta` frames, keeping its end in place. */
function trimStartBy<C extends Clip>(clip: C, delta: Frame, fps: Rational): C {
  const next = { ...clip, start: clip.start + delta, duration: clip.duration - delta };
  if (next.kind === 'video') (next as VideoClip).sourceStart = (clip as VideoClip).sourceStart + framesToMicros(delta, fps);
  return next;
}

/**
 * Overwrite edit: clear [start, end) on a track by trimming, splitting or
 * removing whatever is there.
 */
export function clearRange(clips: Clip[], start: Frame, end: Frame, fps: Rational): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const cs = c.start;
    const ce = clipEnd(c);
    if (ce <= start || cs >= end) {
      out.push(c);
    } else if (cs >= start && ce <= end) {
      // fully covered → removed
    } else if (cs < start && ce > end) {
      out.push({ ...c, duration: start - cs });
      out.push({ ...trimStartBy(c, end - cs, fps), id: createId('clp') });
    } else if (cs < start) {
      out.push({ ...c, duration: start - cs });
    } else {
      out.push(trimStartBy(c, end - cs, fps));
    }
  }
  return out;
}

export function addAsset(project: Project, asset: MediaAsset): Project {
  if (project.assets.some((a) => a.id === asset.id)) return project;
  return { ...project, assets: [...project.assets, asset] };
}

export function updateSettings(project: Project, settings: Partial<ProjectSettings>): Project {
  return { ...project, settings: { ...project.settings, ...settings } };
}

export function addTrack(project: Project, kind: TrackKind): Project {
  const n = project.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = {
    id: createId('trk'),
    kind,
    name: `${kind === 'video' ? 'V' : 'G'}${n}`,
    muted: false,
    hidden: false,
    clips: [],
  };
  return { ...project, tracks: [...project.tracks, track] };
}

export function insertClip(project: Project, trackId: string, clip: Clip): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new Error(`Okänt spår ${trackId}`);
  if (!trackAcceptsClip(track, clip)) throw new Error('Klippet passar inte på det här spåret');
  const start = Math.max(0, Math.round(clip.start));
  const placed = { ...clip, start, duration: Math.max(1, Math.round(clip.duration)) };
  return mapTrack(project, trackId, (t) => ({
    ...t,
    clips: sortClips([...clearRange(t.clips, placed.start, clipEnd(placed), project.settings.fps), placed]),
  }));
}

export function removeClip(project: Project, clipId: string, ripple = false): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { track, clip } = found;
  return mapTrack(project, track.id, (t) => ({
    ...t,
    clips: t.clips
      .filter((c) => c.id !== clipId)
      .map((c) => (ripple && c.start >= clipEnd(clip) ? { ...c, start: c.start - clip.duration } : c)),
  }));
}

export function moveClip(project: Project, clipId: string, toTrackId: string, newStart: Frame): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const target = project.tracks.find((t) => t.id === toTrackId);
  if (!target || !trackAcceptsClip(target, found.clip)) return project;
  const without = removeClip(project, clipId);
  return insertClip(without, toTrackId, { ...found.clip, start: Math.max(0, Math.round(newStart)) });
}

/**
 * Trim one edge of a clip to `edgeFrame`. The edit is clamped so the clip
 * never overlaps its neighbours, never reads outside its source media and is
 * at least one frame long.
 */
export function trimClip(project: Project, clipId: string, edge: 'start' | 'end', edgeFrame: Frame): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { track, clip, index } = found;
  const fps = project.settings.fps;
  const prev = track.clips[index - 1];
  const next = track.clips[index + 1];
  const target = Math.round(edgeFrame);
  let updated: Clip;

  if (edge === 'start') {
    let minStart = prev ? clipEnd(prev) : 0;
    if (clip.kind === 'video') {
      // can't reveal media before the source's first frame
      minStart = Math.max(minStart, clip.start - microsToFrames(clip.sourceStart, fps));
    }
    const s = Math.min(Math.max(target, minStart), clipEnd(clip) - 1);
    updated = trimStartBy(clip, s - clip.start, fps);
  } else {
    let maxEnd = next ? next.start : Number.POSITIVE_INFINITY;
    if (clip.kind === 'video') {
      const asset = findAsset(project, clip.assetId);
      if (asset?.kind === 'video') maxEnd = Math.min(maxEnd, clip.start + maxVideoClipDuration(asset, clip.sourceStart, fps));
    }
    const e = Math.max(Math.min(target, maxEnd), clip.start + 1);
    updated = { ...clip, duration: e - clip.start };
  }
  return mapTrack(project, track.id, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? updated : c)) }));
}

export function splitClip(project: Project, clipId: string, atFrame: Frame): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { track, clip } = found;
  const at = Math.round(atFrame);
  if (at <= clip.start || at >= clipEnd(clip)) return project;
  const left: Clip = { ...clip, duration: at - clip.start };
  const right: Clip = { ...trimStartBy(clip, at - clip.start, project.settings.fps), id: createId('clp') };
  return mapTrack(project, track.id, (t) => ({
    ...t,
    clips: sortClips(t.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c]))),
  }));
}

/** Split every clip under the playhead (optionally only on the given tracks). */
export function splitAtFrame(project: Project, frame: Frame, trackIds?: string[]): Project {
  let p = project;
  for (const t of project.tracks) {
    if (trackIds && !trackIds.includes(t.id)) continue;
    for (const c of t.clips) if (frame > c.start && frame < clipEnd(c)) p = splitClip(p, c.id, frame);
  }
  return p;
}

function updateClip(project: Project, clipId: string, fn: (c: Clip) => Clip): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  return mapTrack(project, found.track.id, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) }));
}

export function setTemplateProp(project: Project, clipId: string, key: string, value: PropValue): Project {
  return updateClip(project, clipId, (c) =>
    c.kind === 'template' ? ({ ...c, props: { ...c.props, [key]: { value } } } satisfies TemplateClip) : c,
  );
}

export function setClipParam(project: Project, clipId: string, param: 'volume' | 'opacity', value: number): Project {
  return updateClip(project, clipId, (c) => {
    if (param === 'volume' && c.kind !== 'video') return c;
    return { ...c, [param]: { value } } as Clip;
  });
}

export function setTrackFlag(project: Project, trackId: string, flag: 'muted' | 'hidden', value: boolean): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, [flag]: value }));
}

/* --------------------------------------------------------------- factories */

export function createVideoClip(asset: VideoAsset, start: Frame, fps: Rational): VideoClip {
  return {
    id: createId('clp'),
    kind: 'video',
    assetId: asset.id,
    start,
    duration: maxVideoClipDuration(asset, 0, fps),
    sourceStart: 0,
    volume: { value: 1 },
    opacity: { value: 1 },
  };
}

export function createTemplateClip(
  templateId: string,
  start: Frame,
  duration: Frame,
  props: Record<string, PropValue>,
): TemplateClip {
  return {
    id: createId('clp'),
    kind: 'template',
    templateId,
    start,
    duration,
    props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { value: v }])),
    opacity: { value: 1 },
  };
}

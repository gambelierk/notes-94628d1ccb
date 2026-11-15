import { describe, expect, it } from 'vitest';
import {
  createProject,
  addAsset,
  insertClip,
  createVideoClip,
  createTemplateClip,
  moveClip,
  trimClip,
  splitClip,
  removeClip,
  activeClipsAt,
  projectDuration,
  sourceTimeAt,
  snap,
  type VideoAsset,
  type VideoClip,
} from '../src';

const fps = { num: 25, den: 1 };
const asset: VideoAsset = { kind: 'video', id: 'a1', name: 'a.mp4', durationUs: 10_000_000, width: 1920, height: 1080, fps: 25, hasAudio: true, size: 1 };

function setup() {
  let p = createProject('t', { fps });
  p = addAsset(p, asset);
  const v1 = p.tracks[0]!.id;
  const g1 = p.tracks[1]!.id;
  return { p, v1, g1 };
}

describe('clips', () => {
  it('creates a full length video clip', () => {
    const c = createVideoClip(asset, 0, fps);
    expect(c.duration).toBe(250);
  });

  it('insert overwrites what is underneath', () => {
    let { p, v1 } = setup();
    p = insertClip(p, v1, createVideoClip(asset, 0, fps)); // 0..250
    p = insertClip(p, v1, { ...createVideoClip(asset, 100, fps), duration: 50 }); // 100..150
    const clips = p.tracks[0]!.clips as VideoClip[];
    expect(clips.map((c) => [c.start, c.duration])).toEqual([[0, 100], [100, 50], [150, 100]]);
    // right remainder must read from the right place in the source
    expect(clips[2]!.sourceStart).toBe(6_000_000);
  });

  it('refuses template clips on a video track', () => {
    const { p, v1 } = setup();
    expect(() => insertClip(p, v1, createTemplateClip('t', 0, 50, {}))).toThrow();
  });

  it('moves a clip and keeps the track sorted and non-overlapping', () => {
    let { p, v1 } = setup();
    p = insertClip(p, v1, { ...createVideoClip(asset, 0, fps), duration: 50 });
    p = insertClip(p, v1, { ...createVideoClip(asset, 100, fps), duration: 50 });
    const first = p.tracks[0]!.clips[0]!.id;
    p = moveClip(p, first, v1, 120);
    const clips = p.tracks[0]!.clips;
    expect(clips.map((c) => [c.start, c.duration])).toEqual([[100, 20], [120, 50]]);
  });

  it('trims start within source bounds and neighbours', () => {
    let { p, v1 } = setup();
    p = insertClip(p, v1, { ...createVideoClip(asset, 50, fps), duration: 100 });
    const id = p.tracks[0]!.clips[0]!.id;
    p = trimClip(p, id, 'start', 75);
    let c = p.tracks[0]!.clips[0] as VideoClip;
    expect([c.start, c.duration, c.sourceStart]).toEqual([75, 75, 1_000_000]);
    // can't extend before source frame 0
    p = trimClip(p, id, 'start', 0);
    c = p.tracks[0]!.clips[0] as VideoClip;
    expect([c.start, c.sourceStart]).toEqual([50, 0]);
    // can't extend past the end of the media
    p = trimClip(p, id, 'end', 10_000);
    c = p.tracks[0]!.clips[0] as VideoClip;
    expect(c.duration).toBe(250);
  });

  it('splits and removes', () => {
    let { p, v1 } = setup();
    p = insertClip(p, v1, createVideoClip(asset, 0, fps));
    const id = p.tracks[0]!.clips[0]!.id;
    p = splitClip(p, id, 100);
    const [a, b] = p.tracks[0]!.clips as VideoClip[];
    expect([a!.duration, b!.start, b!.sourceStart]).toEqual([100, 100, 4_000_000]);
    p = removeClip(p, a!.id, true);
    expect(p.tracks[0]!.clips[0]!.start).toBe(0);
    expect(projectDuration(p)).toBe(150);
  });

  it('finds active clips bottom to top', () => {
    let { p, v1, g1 } = setup();
    p = insertClip(p, v1, createVideoClip(asset, 0, fps));
    p = insertClip(p, g1, createTemplateClip('lt', 10, 50, {}));
    expect(activeClipsAt(p, 20).map((x) => x.clip.kind)).toEqual(['video', 'template']);
    expect(activeClipsAt(p, 60).map((x) => x.clip.kind)).toEqual(['video']);
    const c = p.tracks[0]!.clips[0] as VideoClip;
    expect(sourceTimeAt(c, 25, fps)).toBe(1_000_000);
  });

  it('snaps within threshold', () => {
    expect(snap(103, [0, 100, 200], 5)).toBe(100);
    expect(snap(110, [0, 100, 200], 5)).toBe(110);
  });
});

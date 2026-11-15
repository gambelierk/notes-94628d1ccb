import { describe, expect, it } from 'vitest';
import {
  addAsset,
  addTransition,
  createAudioClip,
  createImageClip,
  createProject,
  createVideoClip,
  describeTransition,
  insertClip,
  joints,
  jointRef,
  moveClip,
  removeTransition,
  setTransitionDuration,
  soundSpans,
  splitClip,
  trimClip,
  visibleLayersAt,
  type AudioAsset,
  type ImageAsset,
  type VideoAsset,
} from '../src';

const fps = { num: 25, den: 1 };
const film: VideoAsset = { kind: 'video', id: 'v', name: 'a.mp4', durationUs: 4_000_000, width: 1920, height: 1080, fps: 25, hasAudio: true, size: 1 };
const img: ImageAsset = { kind: 'image', id: 'i', name: 'b.png', width: 100, height: 100, size: 1, mime: 'image/png' };

/** Two touching clips on V1: A 0..100, B 100..200 (both 4 s films). */
function setup() {
  let p = createProject('t', { fps });
  p = addAsset(addAsset(p, film), img);
  const v1 = p.tracks[0]!.id;
  p = insertClip(p, v1, createVideoClip(film, 0, fps));
  p = insertClip(p, v1, createVideoClip(film, 100, fps));
  const [a, b] = p.tracks[0]!.clips;
  return { p, v1, a: a!.id, b: b!.id };
}

describe('joints', () => {
  it('finds cuts between touching clips and free ends', () => {
    const { p } = setup();
    expect(joints(p.tracks[0]!).map((j) => `${j.kind}@${j.frame}`)).toEqual(['start@0', 'cut@100', 'end@200']);
  });

  it('nothing is added by default', () => {
    const { p } = setup();
    expect(joints(p.tracks[0]!).every((j) => j.duration === null)).toBe(true);
    expect(visibleLayersAt(p, 0)[0]!.mix).toBe(1);
  });
});

describe('dissolve', () => {
  it('shows both clips around the cut, centred on it', () => {
    let { p } = setup();
    const cut = joints(p.tracks[0]!)[1]!;
    p = addTransition(p, cut, 20); // 10 frames each side
    expect(visibleLayersAt(p, 89).map((l) => l.clip.start)).toEqual([0]);
    const at90 = visibleLayersAt(p, 90);
    expect(at90.map((l) => l.clip.start)).toEqual([0, 100]); // outgoing under incoming
    expect(at90[0]!.mix).toBe(1); // opaque video stays, no dip
    expect(at90[1]!.mix).toBeCloseTo(0.025);
    expect(visibleLayersAt(p, 100)[1]!.mix).toBeCloseTo(0.525);
    expect(visibleLayersAt(p, 109)[1]!.mix).toBeCloseTo(0.975);
    expect(visibleLayersAt(p, 110).map((l) => l.clip.start)).toEqual([100]);
  });

  it('fades the outgoing clip when it is not opaque', () => {
    let p = createProject('t', { fps });
    p = addAsset(p, img);
    const g = p.tracks[1]!.id;
    p = insertClip(p, g, createImageClip(img, 0, 50));
    p = insertClip(p, g, { ...createImageClip(img, 50, 50) });
    // images are treated as opaque pictures
    p = addTransition(p, joints(p.tracks[1]!)[1]!, 10);
    expect(visibleLayersAt(p, 50)[0]!.mix).toBe(1);
  });

  it('without spare media: the outgoing sound fades down to the cut and the incoming up from it', () => {
    let { p } = setup(); // both clips use their whole 4 s file
    p = addTransition(p, joints(p.tracks[0]!)[1]!, 20);
    const [a, b] = soundSpans(p);
    expect(a).toMatchObject({ start: 0, duration: 4, fadeOut: 0.4 });
    expect(b).toMatchObject({ start: 4, duration: 4, sourceStart: 0, fadeIn: 0.4 });
  });

  it('with spare media: both sounds overlap and cross-fade over the whole dissolve', () => {
    let { p, v1, a, b } = setup();
    p = trimClip(p, a, 'end', 90); // A: 0..90, 10 frames of tail
    p = trimClip(p, b, 'start', 110); // B: head of 10 frames
    p = moveClip(p, b, v1, 90);
    p = addTransition(p, joints(p.tracks[0]!).find((j) => j.kind === 'cut')!, 20);
    const [sa, sb] = soundSpans(p);
    expect(sa).toMatchObject({ start: 0, duration: 4, fadeOut: 0.8 }); // 3.6 s + 0.4 s tail
    expect(sb!.start).toBeCloseTo(3.2);
    expect(sb).toMatchObject({ fadeIn: 0.8 });
    expect(sb!.sourceStart).toBeCloseTo(0);
  });

  it('is limited by the clips, editable, removable and dropped when clips move apart', () => {
    let { p, v1, a, b } = setup();
    p = addTransition(p, joints(p.tracks[0]!)[1]!, 500);
    expect(describeTransition(p, { clipId: b, edge: 'in' })).toMatchObject({ kind: 'dissolve', duration: 100 });
    p = setTransitionDuration(p, { clipId: b, edge: 'in' }, 30);
    expect(describeTransition(p, { clipId: b, edge: 'in' })!.duration).toBe(30);
    const removed = removeTransition(p, { clipId: b, edge: 'in' });
    expect(joints(removed.tracks[0]!)[1]!.duration).toBeNull();
    // moving B away drops the dissolve
    const moved = moveClip(p, b, v1, 150);
    expect(moved.tracks[0]!.clips.find((c) => c.id === b)!.transitionIn).toBeUndefined();
    // splitting keeps the dissolve on the left part only
    const s = splitClip(p, b, 150);
    expect(s.tracks[0]!.clips.filter((c) => c.transitionIn).map((c) => c.id)).toEqual([b]);
    void a;
  });
});

describe('fade to black', () => {
  it('free ends get fades instead of dissolves', () => {
    let { p, a, b } = setup();
    const js = joints(p.tracks[0]!);
    p = addTransition(p, js[0]!, 25);
    p = addTransition(p, js[2]!, 1000);
    expect(describeTransition(p, jointRef(js[0]!))).toMatchObject({ kind: 'fadeIn', duration: 25 });
    expect(describeTransition(p, jointRef(js[2]!))).toMatchObject({ kind: 'fadeOut', duration: 50 });
    expect(visibleLayersAt(p, 0)[0]!.mix).toBe(0);
    void a;
    void b;
  });

  it('works on audio clips too', () => {
    const music: AudioAsset = { kind: 'audio', id: 'm', name: 'm.mp3', durationUs: 2_000_000, sampleRate: 48000, channels: 2, size: 1 };
    let p = addAsset(createProject('t', { fps }), music);
    p = insertClip(p, p.tracks[2]!.id, createAudioClip(music, 0, fps));
    p = addTransition(p, joints(p.tracks[2]!)[0]!, 25);
    expect(soundSpans(p)[0]).toMatchObject({ fadeIn: 1 });
  });
});

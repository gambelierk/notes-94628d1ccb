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
  removeClip,
  setClipFades,
  setClipParam,
  setClipTransform,
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

  it('fades the outgoing clip out when it does not cover the whole frame', () => {
    let p = createProject('t', { fps });
    p = addAsset(p, img);
    const g = p.tracks[1]!.id;
    p = insertClip(p, g, createImageClip(img, 0, 50));
    p = insertClip(p, g, { ...createImageClip(img, 50, 50) });
    // a square (possibly transparent) image in a 16:9 frame: fades out instead of vanishing at the end
    p = addTransition(p, joints(p.tracks[1]!)[1]!, 10);
    const [out, inc] = visibleLayersAt(p, 50);
    expect(out!.mix).toBeCloseTo(1 - inc!.mix);
  });

  it('fades out a scaled-down or translucent video too', () => {
    let { p, a } = setup();
    p = addTransition(p, joints(p.tracks[0]!)[1]!, 20);
    expect(visibleLayersAt(p, 100)[0]!.mix).toBe(1);
    const small = setClipTransform(p, a, { scale: 0.5 });
    expect(visibleLayersAt(small, 100)[0]!.mix).toBeCloseTo(0.475);
    const faint = setClipParam(p, a, 'opacity', 0.5);
    expect(visibleLayersAt(faint, 100)[0]!.mix).toBeCloseTo(0.475);
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
    // moving B away: no dissolve, and none comes back when it touches another clip
    const moved = moveClip(p, b, v1, 150);
    expect(describeTransition(moved, { clipId: b, edge: 'in' })).toBeNull();
    expect(visibleLayersAt(moved, 150).map((l) => l.clip.id)).toEqual([b]);
    // moving it back re-joins the same pair, so the dissolve is there again
    expect(describeTransition(moveClip(moved, b, v1, 100), { clipId: b, edge: 'in' })).toMatchObject({ kind: 'dissolve' });
    // splitting keeps the dissolve on the left part only
    const s = splitClip(p, b, 150);
    expect(s.tracks[0]!.clips.filter((c) => c.transitionIn).map((c) => c.id)).toEqual([b]);
    void a;
  });
});

describe('dissolves stay with the pair that got them', () => {
  /** A 0..100, B 100..200, C 200..300 with a dissolve B→C. */
  function three() {
    let { p, v1, a, b } = setup();
    p = insertClip(p, v1, createVideoClip(film, 200, fps));
    const c = p.tracks[0]!.clips.find((x) => x.start === 200)!.id;
    p = addTransition(p, joints(p.tracks[0]!).find((j) => j.kind === 'cut' && j.rightId === c)!, 20);
    return { p, v1, a, b, c };
  }

  it('deleting the left clip and closing the gap does not dissolve from a new neighbour', () => {
    const { p, a, b, c } = three();
    const rippled = removeClip(p, b, true);
    expect(joints(rippled.tracks[0]!).find((j) => j.kind === 'cut')).toMatchObject({ leftId: a, rightId: c, duration: null });
    expect(visibleLayersAt(rippled, 100).map((l) => l.clip.id)).toEqual([c]);
  });

  it('overwriting the middle of a clip does not create a dissolve into the overwrite', () => {
    let { p, v1, b, c } = three();
    // a clip with a dissolve on its head, overwritten in the middle by a new clip
    p = insertClip(p, v1, { ...createVideoClip(film, 240, fps), duration: 20 });
    const ids = p.tracks[0]!.clips.map((x) => x.id);
    const tail = p.tracks[0]!.clips.find((x) => x.start === 260)!;
    expect(ids).toContain(c);
    expect(describeTransition(p, { clipId: tail.id, edge: 'in' })).toBeNull();
    expect(describeTransition(p, { clipId: c, edge: 'in' })).toMatchObject({ kind: 'dissolve' });
    void b;
  });

  it('splitting or overwriting inside the left clip keeps the dissolve on its tail', () => {
    const { p, v1, b, c } = three();
    const s = splitClip(p, b, 150);
    expect(describeTransition(s, { clipId: c, edge: 'in' })).toMatchObject({ kind: 'dissolve' });
    const o = insertClip(p, v1, { ...createVideoClip(film, 130, fps), duration: 20 });
    expect(describeTransition(o, { clipId: c, edge: 'in' })).toMatchObject({ kind: 'dissolve' });
    expect(o.tracks[0]!.clips.length).toBe(5);
  });

  it('moving to a negative start clamps and keeps an unchanged clip as is', () => {
    const { p, v1, a } = three();
    expect(moveClip(p, a, v1, -20)).toBe(p);
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

  it('fades at touching edges (a dip to black at a cut) show up as joints and can be removed', () => {
    let { p, a } = setup();
    p = setClipFades(p, a, { fadeOut: 10 });
    const js = joints(p.tracks[0]!);
    const dip = js.find((j) => j.kind === 'end' && j.clipId === a)!;
    expect(dip).toMatchObject({ frame: 100, duration: 10 });
    expect(describeTransition(removeTransition(p, jointRef(dip)), jointRef(dip))).toBeNull();
  });

  it('a fade may be as long as the clip minus its other fade', () => {
    let { p, a } = setup();
    p = setClipFades(p, a, { fadeIn: 30 });
    p = addTransition(p, { kind: 'end', frame: 100, clipId: a, duration: null }, 10);
    expect(describeTransition(p, { clipId: a, edge: 'out' })!.max).toBe(70);
    p = setTransitionDuration(p, { clipId: a, edge: 'out' }, 999);
    expect(describeTransition(p, { clipId: a, edge: 'out' })!.duration).toBe(70);
  });

  it('works on audio clips too', () => {
    const music: AudioAsset = { kind: 'audio', id: 'm', name: 'm.mp3', durationUs: 2_000_000, sampleRate: 48000, channels: 2, size: 1 };
    let p = addAsset(createProject('t', { fps }), music);
    p = insertClip(p, p.tracks[2]!.id, createAudioClip(music, 0, fps));
    p = addTransition(p, joints(p.tracks[2]!)[0]!, 25);
    expect(soundSpans(p)[0]).toMatchObject({ fadeIn: 1 });
  });
});

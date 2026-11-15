import { describe, expect, it } from 'vitest';
import {
  activeClipsAt,
  addAsset,
  clipOpacity,
  createAudioClip,
  createProject,
  createTextClip,
  createVideoClip,
  fadeFactor,
  findClip,
  gainToDb,
  insertClip,
  parseSubtitles,
  setClipFades,
  setTextContent,
  setTrackVolume,
  soundGain,
  splitClip,
  toSrt,
  trimClip,
  TEXT_PRESETS,
  SUBTITLE_STYLE,
  type AudioAsset,
  type VideoAsset,
} from '../src';

const fps = { num: 25, den: 1 };
const music: AudioAsset = { kind: 'audio', id: 'm', name: 'musik.mp3', durationUs: 4_000_000, sampleRate: 44100, channels: 2, size: 1 };
const film: VideoAsset = { kind: 'video', id: 'v', name: 'a.mp4', durationUs: 10_000_000, width: 1920, height: 1080, fps: 25, hasAudio: true, size: 1 };

function setup() {
  let p = createProject('t', { fps });
  p = addAsset(addAsset(p, music), film);
  const [v1, g1, a1] = p.tracks;
  return { p, v1: v1!.id, g1: g1!.id, a1: a1!.id };
}

describe('audio tracks and clips', () => {
  it('new projects have an audio track; audio only goes on audio tracks', () => {
    const { p, v1, a1 } = setup();
    expect(p.tracks.map((t) => t.kind)).toEqual(['video', 'graphics', 'audio']);
    const c = createAudioClip(music, 0, fps);
    expect(c.duration).toBe(100);
    expect(() => insertClip(p, v1, c)).toThrow();
    const q = insertClip(p, a1, c);
    expect(q.tracks[2]!.clips).toHaveLength(1);
    // audio clips are not drawn
    expect(activeClipsAt(q, 10)).toHaveLength(0);
  });

  it('trims audio within the source and keeps source offsets on split', () => {
    let { p, a1 } = setup();
    p = insertClip(p, a1, { ...createAudioClip(music, 0, fps), start: 50 });
    const id = p.tracks[2]!.clips[0]!.id;
    p = trimClip(p, id, 'end', 10_000);
    expect(p.tracks[2]!.clips[0]!.duration).toBe(100); // 4 s of audio
    p = splitClip(p, id, 75);
    const right = p.tracks[2]!.clips[1]!;
    expect(right.kind === 'audio' && right.sourceStart).toBe(1_000_000);
  });

  it('combines clip and track volume', () => {
    let { p, a1 } = setup();
    p = insertClip(p, a1, { ...createAudioClip(music, 0, fps), volume: { value: 0.5 } });
    p = setTrackVolume(p, a1, 0.5);
    const f = findClip(p, p.tracks[2]!.clips[0]!.id)!;
    expect(soundGain(f.clip, f.track)).toBe(0.25);
    expect(gainToDb(0.5)).toBe('−6.0 dB');
    expect(gainToDb(1)).toBe('0.0 dB');
  });
});

describe('fades', () => {
  it('ramps in and out and never overlaps', () => {
    const c = { duration: 100, fadeIn: 20, fadeOut: 40 };
    expect(fadeFactor(c, 0)).toBe(0);
    expect(fadeFactor(c, 10)).toBe(0.5);
    expect(fadeFactor(c, 50)).toBe(1);
    expect(fadeFactor(c, 80)).toBe(0.5);
    expect(fadeFactor(c, 100)).toBe(0);
  });

  it('clamps fades to the clip and splits them sensibly', () => {
    let { p, v1 } = setup();
    p = insertClip(p, v1, createVideoClip(film, 0, fps)); // 250 frames
    const id = p.tracks[0]!.clips[0]!.id;
    p = setClipFades(p, id, { fadeIn: 25, fadeOut: 300 });
    expect(p.tracks[0]!.clips[0]).toMatchObject({ fadeIn: 25, fadeOut: 225 });
    expect(clipOpacity(p.tracks[0]!.clips[0]!, 0)).toBe(0);
    p = setClipFades(p, id, { fadeOut: 50 });
    p = splitClip(p, id, 100);
    const [l, r] = p.tracks[0]!.clips;
    expect([l!.fadeIn, l!.fadeOut, r!.fadeIn, r!.fadeOut]).toEqual([25, undefined, undefined, 50]);
  });
});

describe('text', () => {
  it('creates and edits text clips on graphics tracks', () => {
    let { p, g1, a1 } = setup();
    const preset = TEXT_PRESETS.find((t) => t.id === 'title')!;
    const c = createTextClip('Hej', preset.style, 0, 75);
    expect(() => insertClip(p, a1, c)).toThrow();
    p = insertClip(p, g1, c);
    p = setTextContent(p, c.id, { text: 'Hej då', style: { color: '#ff0000' } });
    const t = p.tracks[1]!.clips[0]!;
    expect(t.kind === 'text' && [t.text, t.style.color, t.style.weight]).toEqual(['Hej då', '#ff0000', 700]);
    expect(activeClipsAt(p, 10).map((x) => x.clip.kind)).toEqual(['text']);
  });
});

describe('subtitles', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHej <i>där</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nRad ett\r\nRad två\r\n';
  const vtt = 'WEBVTT\n\nintro\n00:01.000 --> 00:02.500 align:center\nHej där\n\n00:00:03.000 --> 00:00:04.000\nRad ett\nRad två\n';

  it('parses SRT and VTT the same way', () => {
    const expected = [
      { start: 1, end: 2.5, text: 'Hej där' },
      { start: 3, end: 4, text: 'Rad ett\nRad två' },
    ];
    expect(parseSubtitles(srt)).toEqual(expected);
    expect(parseSubtitles(vtt)).toEqual(expected);
  });

  it('round-trips through SRT', () => {
    const cues = parseSubtitles(srt);
    expect(toSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:02,500\nHej där\n\n2\n00:00:03,000 --> 00:00:04,000\nRad ett\nRad två\n');
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
    expect(SUBTITLE_STYLE.background).not.toBeNull();
  });
});

import { brandTextFont, brandTextStyle, TEXT_FONTS, TEXT_PRESETS as PRESETS } from '../src';

describe("the customer's typefaces in text presets", () => {
  const title = PRESETS.find((p) => p.id === 'title')!;
  const caption = PRESETS.find((p) => p.id === 'caption')!;
  it('headings use the heading typeface, subtitles and body text the text typeface', () => {
    const brand = { heading: true, body: true };
    expect(brandTextStyle(title.style, title.role, brand).font).toBe('brand-heading');
    expect(brandTextStyle(caption.style, caption.role, brand).font).toBe('brand-body');
    expect(brandTextStyle(title.style, title.role, brand).weight).toBe(title.style.weight);
  });
  it('one uploaded typeface is used for everything; none keeps the defaults', () => {
    expect(brandTextFont('body', { heading: true, body: false })).toBe('brand-heading');
    expect(brandTextFont('heading', { heading: false, body: true })).toBe('brand-body');
    expect(brandTextStyle(title.style, title.role, { heading: false, body: false })).toBe(title.style);
    expect(brandTextStyle(title.style, title.role, null)).toBe(title.style);
  });
  it('brand fonts fall back to IBM Plex Sans when the file is missing', () => {
    expect(TEXT_FONTS['brand-heading'].family).toContain('IBM Plex Sans');
  });
});

import { describe, expect, it } from 'vitest';
import {
  FORMAT_PRESETS,
  containSize,
  coverScale,
  createImageClip,
  createProject,
  hitTest,
  insertClip,
  mediaPlacement,
  setClipTransform,
  templatePlacement,
  transformAt,
  validateCustomSize,
  formatLabel,
  type ImageAsset,
} from '../src';

describe('formats', () => {
  it('has the requested presets at full resolution', () => {
    expect(FORMAT_PRESETS.map((f) => `${f.ratio}=${f.width}x${f.height}`)).toEqual([
      '1:1=1080x1080',
      '3:4=1080x1440',
      '4:5=1080x1350',
      '9:16=1080x1920',
      '16:9=1920x1080',
    ]);
  });

  it('validates custom sizes', () => {
    expect(validateCustomSize(1201, 627)).toEqual({ width: 1202, height: 628, error: null }); // rounded to even
    expect(validateCustomSize(64, 1080).error).toMatch(/Minst/);
    expect(validateCustomSize(5000, 1080).error).toMatch(/Högst/);
    expect(validateCustomSize(4096, 4096).error).toMatch(/pixlar/);
    expect(formatLabel(1080, 1920)).toBe('1080 × 1920 px · 9:16');
  });
});

describe('placement', () => {
  it('contains and covers', () => {
    expect(containSize(1920, 1080, 1080, 1920)).toEqual({ w: 1080, h: 607.5 });
    expect(coverScale(1920, 1080, 1080, 1920)).toBeCloseTo(1920 / 607.5);
  });

  it('places media by normalised offset and scale', () => {
    const p = mediaPlacement(1920, 1080, 1080, 1920, { x: 0.25, y: -0.1, scale: 2, rotation: 15 });
    expect(p).toEqual({ cx: 540 + 270, cy: 960 - 192, w: 2160, h: 1215, rotation: 15 });
  });

  it('applies template transforms on top of the layout box', () => {
    const layout = { anchor: 'bottom-left' as const, widthPercent: 50, marginPercent: 10 };
    const p = templatePlacement(layout, 200, 50, 1000, 500, { x: 0.1, y: 0, scale: 2, rotation: 0 });
    // layout box: x 50..550, y 325..450 → centre (300, 387.5), 500×125
    expect(p).toEqual({ cx: 300 + 100, cy: 387.5, w: 1000, h: 250, rotation: 0 });
  });

  it('hit-tests rotated layers', () => {
    const p = { cx: 100, cy: 100, w: 100, h: 20, rotation: 90 };
    expect(hitTest(p, 100, 140)).toBe(true);
    expect(hitTest(p, 140, 100)).toBe(false);
  });
});

describe('clip transforms', () => {
  it('merges partial updates and keeps templates unrotated', () => {
    let p = createProject('t');
    const img: ImageAsset = { kind: 'image', id: 'i', name: 'logo.png', width: 400, height: 200, size: 1, mime: 'image/png' };
    const clip = createImageClip(img, 0, 150);
    p = insertClip(p, p.tracks[1]!.id, clip);
    p = setClipTransform(p, clip.id, { x: 0.3 });
    p = setClipTransform(p, clip.id, { scale: 0.5, rotation: 10 });
    expect(transformAt(p.tracks[1]!.clips[0]!)).toEqual({ x: 0.3, y: 0, scale: 0.5, rotation: 10 });
    // images may also go on the video track
    p = insertClip(p, p.tracks[0]!.id, createImageClip(img, 0, 30));
    expect(p.tracks[0]!.clips[0]!.kind).toBe('image');
  });
});

import { subPlacement, visibleRegion } from '../src';

describe('partial rendering of vector graphics', () => {
  const W = 1920;
  const H = 1080;
  it('a layer inside the frame is fully visible', () => {
    expect(visibleRegion({ cx: 960, cy: 540, w: 400, h: 200, rotation: 0 }, W, H)).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
  });

  it('zoomed in 10×: only the part inside the frame is rendered, and it is drawn exactly where it belongs', () => {
    const p = { cx: 960, cy: 540, w: 19200, h: 10800, rotation: 0 };
    const r = visibleRegion(p, W, H)!;
    expect(r.u0).toBeCloseTo(0.45);
    expect(r.u1).toBeCloseTo(0.55);
    expect(r.v0).toBeCloseTo(0.45);
    const sub = subPlacement(p, r);
    expect(sub.cx).toBeCloseTo(960);
    expect(sub.w).toBeCloseTo(1920);
    expect(sub.h).toBeCloseTo(1080);
  });

  it('a layer half outside the frame renders its visible half', () => {
    const p = { cx: 0, cy: 540, w: 400, h: 400, rotation: 0 };
    const r = visibleRegion(p, W, H)!;
    expect(r).toMatchObject({ u0: 0.5, u1: 1, v0: 0, v1: 1 });
    expect(subPlacement(p, r)).toMatchObject({ cx: 100, cy: 540, w: 200, h: 400 });
  });

  it('nothing to render when the layer is off screen', () => {
    expect(visibleRegion({ cx: -500, cy: 540, w: 400, h: 400, rotation: 0 }, W, H)).toBeNull();
  });

  it('rotated layers: the visible part keeps its place on screen', () => {
    const p = { cx: 960, cy: 540, w: 8000, h: 8000, rotation: 30 };
    const r = visibleRegion(p, W, H)!;
    expect(r.u1 - r.u0).toBeLessThan(0.5);
    const sub = subPlacement(p, r);
    // the centre of the visible part lies on the layer's centre here (symmetric case)
    expect(sub.cx).toBeCloseTo(960);
    expect(sub.cy).toBeCloseTo(540);
    expect(sub.rotation).toBe(30);
    // a corner of the frame maps to a point inside the rendered part
    const rad = (30 * Math.PI) / 180;
    const lx = (0 - 960) * Math.cos(rad) + (0 - 540) * Math.sin(rad);
    expect(lx / 8000 + 0.5).toBeGreaterThanOrEqual(r.u0 - 1e-9);
  });
});

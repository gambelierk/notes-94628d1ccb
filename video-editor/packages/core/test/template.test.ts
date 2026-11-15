import { describe, expect, it } from 'vitest';
import { resolveTemplateFrame, argbToHex, hexToArgb, humanizeKey, type TemplateTiming } from '../src';

const seg: TemplateTiming = {
  kind: 'segments',
  in: { name: 'in', duration: 1 },
  hold: { name: 'hold', duration: 2 },
  out: { name: 'out', duration: 0.5 },
};

describe('template timing', () => {
  it('plays in, loops hold and ends exactly with out', () => {
    expect(resolveTemplateFrame(seg, 0.5, 10)).toEqual({ kind: 'animation', name: 'in', time: 0.5 });
    expect(resolveTemplateFrame(seg, 1.5, 10)).toEqual({ kind: 'animation', name: 'hold', time: 0.5 });
    expect(resolveTemplateFrame(seg, 3.5, 10)).toEqual({ kind: 'animation', name: 'hold', time: 0.5 });
    expect(resolveTemplateFrame(seg, 9.75, 10)).toEqual({ kind: 'animation', name: 'out', time: 0.25 });
  });

  it('compresses in/out on short clips', () => {
    const r = resolveTemplateFrame(seg, 0.25, 0.75); // in+out = 1.5 > 0.75 → k = 0.5
    expect(r).toEqual({ kind: 'animation', name: 'in', time: 0.5 });
  });

  it('converts colours', () => {
    expect(argbToHex(0xffff5a1f)).toBe('#ff5a1fff');
    expect(hexToArgb('#ff5a1f')).toBe(0xffff5a1f);
    expect(hexToArgb(argbToHex(0x80123456))).toBe(0x80123456);
  });

  it('humanizes keys', () => {
    expect(humanizeKey('titleText')).toBe('Title text');
    expect(humanizeKey('Color property')).toBe('Color property');
  });
});

import { layoutBox } from '../src';
describe('layout', () => {
  it('fills the frame without a layout', () => {
    expect(layoutBox(undefined, 1920, 1080, 500, 500)).toEqual({ minX: 0, minY: 0, maxX: 1920, maxY: 1080 });
  });
  it('anchors bottom-left with margin', () => {
    const b = layoutBox({ anchor: 'bottom-left', widthPercent: 50, marginPercent: 10 }, 1000, 500, 200, 50);
    expect(b).toEqual({ minX: 50, minY: 500 - 50 - 125, maxX: 550, maxY: 450 });
  });
});

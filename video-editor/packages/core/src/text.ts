import type { TextStyle } from './types';

/** Starting points for new text clips. Sizes are fractions of the frame height. */
export const TEXT_PRESETS: Array<{ id: string; label: string; sample: string; style: TextStyle; y: number }> = [
  {
    id: 'title',
    label: 'Rubrik',
    sample: 'Rubrik',
    y: 0,
    style: { font: 'sans', size: 0.085, weight: 700, color: '#ffffff', align: 'center', lineHeight: 1.1, maxWidth: 0.86, background: null, shadow: true },
  },
  {
    id: 'subtitle',
    label: 'Underrubrik',
    sample: 'Underrubrik',
    y: 0.08,
    style: { font: 'sans', size: 0.045, weight: 500, color: '#ffffff', align: 'center', lineHeight: 1.2, maxWidth: 0.8, background: null, shadow: true },
  },
  {
    id: 'body',
    label: 'Brödtext',
    sample: 'Skriv din text här',
    y: 0,
    style: { font: 'sans', size: 0.034, weight: 400, color: '#ffffff', align: 'left', lineHeight: 1.35, maxWidth: 0.7, background: null, shadow: true },
  },
  {
    id: 'label',
    label: 'Etikett',
    sample: 'ETIKETT',
    y: -0.38,
    style: {
      font: 'mono',
      size: 0.03,
      weight: 600,
      color: '#000000',
      align: 'center',
      lineHeight: 1.2,
      maxWidth: 0.8,
      background: { color: '#ffffff', opacity: 1 },
      shadow: false,
    },
  },
  {
    id: 'caption',
    label: 'Undertext',
    sample: 'Undertext som läses utan ljud',
    y: 0.36,
    style: SUBTITLE_STYLE_VALUE(),
  },
];

function SUBTITLE_STYLE_VALUE(): TextStyle {
  return {
    font: 'sans',
    size: 0.04,
    weight: 600,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.25,
    maxWidth: 0.84,
    background: { color: '#000000', opacity: 0.72 },
    shadow: false,
  };
}

/** Style used for imported subtitles. */
export const SUBTITLE_STYLE: TextStyle = SUBTITLE_STYLE_VALUE();
/** Vertical position of subtitles (fraction of frame height below centre). */
export const SUBTITLE_Y = 0.36;

export const TEXT_FONTS: Record<TextStyle['font'], { label: string; family: string }> = {
  sans: { label: 'IBM Plex Sans', family: '"IBM Plex Sans Variable", "IBM Plex Sans", sans-serif' },
  mono: { label: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace' },
};

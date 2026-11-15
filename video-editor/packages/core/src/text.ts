import type { TextStyle } from './types';

/** Starting points for new text clips. Sizes are fractions of the frame height. */
export interface TextPreset {
  id: string;
  label: string;
  sample: string;
  style: TextStyle;
  y: number;
  /** Which of the customer's typefaces it uses when the project has its own (see brandTextStyle). */
  role: 'heading' | 'body';
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'title',
    role: 'heading',
    label: 'Rubrik',
    sample: 'Rubrik',
    y: 0,
    style: { font: 'sans', size: 0.085, weight: 700, color: '#ffffff', align: 'center', lineHeight: 1.1, maxWidth: 0.86, background: null, shadow: true },
  },
  {
    id: 'subtitle',
    role: 'heading',
    label: 'Underrubrik',
    sample: 'Underrubrik',
    y: 0.08,
    style: { font: 'sans', size: 0.045, weight: 500, color: '#ffffff', align: 'center', lineHeight: 1.2, maxWidth: 0.8, background: null, shadow: true },
  },
  {
    id: 'body',
    role: 'body',
    label: 'Brödtext',
    sample: 'Skriv din text här',
    y: 0,
    style: { font: 'sans', size: 0.034, weight: 400, color: '#ffffff', align: 'left', lineHeight: 1.35, maxWidth: 0.7, background: null, shadow: true },
  },
  {
    id: 'label',
    role: 'body',
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
    role: 'body',
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

/** Font family names under which a customer's uploaded typefaces are registered (preview and export). */
export const BRAND_TEXT_FAMILY = { heading: 'KlippBrand-page-heading', body: 'KlippBrand-page-body' } as const;

export const TEXT_FONTS: Record<TextStyle['font'], { label: string; family: string }> = {
  sans: { label: 'IBM Plex Sans', family: '"IBM Plex Sans Variable", "IBM Plex Sans", sans-serif' },
  mono: { label: 'IBM Plex Mono', family: '"IBM Plex Mono", monospace' },
  'brand-heading': {
    label: 'Kundens rubriktypsnitt',
    family: `"${BRAND_TEXT_FAMILY.heading}", "IBM Plex Sans Variable", "IBM Plex Sans", sans-serif`,
  },
  'brand-body': {
    label: 'Kundens texttypsnitt',
    family: `"${BRAND_TEXT_FAMILY.body}", "IBM Plex Sans Variable", "IBM Plex Sans", sans-serif`,
  },
};

/** Which of the customer's own typefaces exist (uploaded font files). */
export interface BrandTextFonts {
  heading: boolean;
  body: boolean;
}

/** The customer's typeface for a role; with only one uploaded, it is used for both headings and text. */
export function brandTextFont(role: 'heading' | 'body', brand: BrandTextFonts): TextStyle['font'] | null {
  if (brand[role]) return role === 'heading' ? 'brand-heading' : 'brand-body';
  const other = role === 'heading' ? 'body' : 'heading';
  if (brand[other]) return other === 'heading' ? 'brand-heading' : 'brand-body';
  return null;
}

/** A preset's style in the customer's typeface, when the project has one. */
export function brandTextStyle(style: TextStyle, role: 'heading' | 'body', brand: BrandTextFonts | null): TextStyle {
  const font = brand ? brandTextFont(role, brand) : null;
  return font ? { ...style, font } : style;
}

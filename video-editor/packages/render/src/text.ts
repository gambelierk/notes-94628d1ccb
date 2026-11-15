import { TEXT_FONTS, type TextStyle } from '@ve/core';

type Ctx2D = OffscreenCanvasRenderingContext2D;

export interface TextLayout {
  lines: { text: string; width: number }[];
  sizePx: number;
  lineHeightPx: number;
  pad: number;
  margin: number;
  /** Size of the drawn bitmap (box + shadow margin). */
  width: number;
  height: number;
  boxW: number;
  boxH: number;
}

export interface FontSource {
  family: string;
  url: string;
  weight?: string;
  style?: string;
}

export function fontString(style: TextStyle, sizePx: number): string {
  return `${style.weight} ${Math.max(1, sizePx)}px ${TEXT_FONTS[style.font].family}`;
}

let measureCtx: Ctx2D | null = null;
function ctx(): Ctx2D {
  measureCtx ??= new OffscreenCanvas(4, 4).getContext('2d')!;
  return measureCtx;
}

/** Greedy word wrap; words longer than a line are broken by character. */
function wrap(c: Ctx2D, text: string, maxW: number): { text: string; width: number }[] {
  const out: { text: string; width: number }[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w !== '');
    let line = '';
    const push = (l: string) => out.push({ text: l.trimEnd(), width: c.measureText(l.trimEnd()).width });
    for (const w of words) {
      const cand = line + w;
      if (c.measureText(cand.trimEnd()).width <= maxW || line.trim() === '') {
        if (c.measureText(cand.trimEnd()).width > maxW && line.trim() === '' && !/^\s+$/.test(w)) {
          // a single word wider than the line: break it
          let part = '';
          for (const ch of w) {
            if (c.measureText(part + ch).width > maxW && part) {
              push(part);
              part = '';
            }
            part += ch;
          }
          line = part;
        } else line = cand;
      } else {
        push(line);
        line = /^\s+$/.test(w) ? '' : w;
      }
    }
    push(line);
  }
  return out;
}

/**
 * Lay out text for a frame of W × H pixels. Sizes are relative to the frame,
 * so the same clip looks identical in the (smaller) preview and the export.
 */
export function layoutText(text: string, style: TextStyle, W: number, H: number): TextLayout {
  const c = ctx();
  const sizePx = style.size * H;
  c.font = fontString(style, sizePx);
  const lines = wrap(c, text || ' ', Math.max(sizePx, style.maxWidth * W));
  const lineHeightPx = sizePx * style.lineHeight;
  const pad = style.background ? Math.round(sizePx * 0.35) : Math.round(sizePx * 0.08);
  const margin = style.shadow ? Math.round(sizePx * 0.3) : 0;
  const textW = Math.max(1, ...lines.map((l) => l.width));
  const boxW = Math.ceil(textW + pad * 2);
  const boxH = Math.ceil(lines.length * lineHeightPx + pad * 2);
  return { lines, sizePx, lineHeightPx, pad, margin, boxW, boxH, width: boxW + margin * 2, height: boxH + margin * 2 };
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Draw text into its own canvas (transparent background). */
export function drawText(text: string, style: TextStyle, W: number, H: number): { canvas: OffscreenCanvas; layout: TextLayout } {
  const L = layoutText(text, style, W, H);
  const canvas = new OffscreenCanvas(Math.max(1, L.width), Math.max(1, L.height));
  const c = canvas.getContext('2d')!;
  c.translate(L.margin, L.margin);
  if (style.background && style.background.opacity > 0) {
    c.fillStyle = hexToRgba(style.background.color, style.background.opacity);
    c.beginPath();
    c.roundRect(0, 0, L.boxW, L.boxH, Math.round(L.sizePx * 0.18));
    c.fill();
  }
  c.font = fontString(style, L.sizePx);
  c.textBaseline = 'middle';
  c.fillStyle = style.color;
  if (style.shadow) {
    c.shadowColor = 'rgba(0, 0, 0, 0.65)';
    c.shadowBlur = L.sizePx * 0.14;
    c.shadowOffsetY = L.sizePx * 0.04;
  }
  L.lines.forEach((line, i) => {
    const x = style.align === 'left' ? L.pad : style.align === 'right' ? L.boxW - L.pad - line.width : (L.boxW - line.width) / 2;
    c.fillText(line.text, x, L.pad + L.lineHeightPx * (i + 0.5));
  });
  return { canvas, layout: L };
}

/** Make sure the font for a style is loaded (document.fonts on the main thread, self.fonts in workers). */
export async function ensureFont(style: TextStyle, text: string): Promise<void> {
  const fonts = (globalThis as unknown as { fonts?: FontFaceSet }).fonts ?? (globalThis as unknown as { document?: Document }).document?.fonts;
  if (!fonts) return;
  try {
    await fonts.load(fontString(style, 32), text || 'A');
  } catch {
    /* fall back to whatever is available */
  }
}

/** Register font files in a worker (fonts declared in CSS are not visible there). */
export async function registerFonts(sources: FontSource[]): Promise<void> {
  const fonts = (globalThis as unknown as { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof FontFace === 'undefined') return;
  await Promise.all(
    sources.map(async (s) => {
      try {
        const face = new FontFace(s.family, `url(${s.url})`, { weight: s.weight ?? '400', style: s.style ?? 'normal' });
        await face.load();
        fonts.add(face);
      } catch (e) {
        console.warn('Typsnitt kunde inte laddas', s.family, e);
      }
    }),
  );
}

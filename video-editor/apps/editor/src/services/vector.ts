import type { ImageAsset } from '@ve/core';
import type { VectorRequest } from '@ve/render';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Vector graphics: SVG, and PDF (which also covers Illustrator files saved
 * with PDF content, and EPS files the server has converted to PDF).
 *
 * A graphic is never turned into a fixed-size picture. Every time it is
 * drawn bigger or smaller it is rendered again at exactly the size it is
 * shown at (and only the part that is inside the frame), so edges stay sharp
 * at any scale. Transparent areas stay transparent, so the film shows through.
 *
 * Rendering uses the browser's own SVG renderer and pdf.js, which need the
 * DOM, so it runs on the main thread; the exporter asks for renderings here.
 */

export type VectorFormat = 'svg' | 'pdf' | 'postscript';

export const VECTOR_FILE = /\.(svg|pdf|ai|eps|ps)$/i;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Bigger than this (per side) is never needed: we only render what is inside the frame. */
const MAX_SIDE = 16384;

/** Recognise a vector file from its first bytes. PostScript (EPS, old Illustrator) needs converting on the server. */
export function sniffVector(head: Uint8Array): VectorFormat | null {
  if (head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6) return 'postscript'; // DOS EPS binary header
  let text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 4096));
  text = text.replace(/^﻿/, '').trimStart();
  if (text.startsWith('%PDF-')) return 'pdf';
  if (text.startsWith('%!PS')) return 'postscript';
  if (text.startsWith('<') && /<svg[\s>]/i.test(text)) return 'svg';
  return null;
}

export function vectorFromMime(mime: string | undefined): 'svg' | 'pdf' | undefined {
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'application/pdf') return 'pdf';
  return undefined;
}

interface VectorDoc {
  format: 'svg' | 'pdf';
  /** Intrinsic size (CSS pixels / points); only the aspect ratio matters for placement. */
  width: number;
  height: number;
  render(req: VectorRequest): Promise<ImageBitmap>;
  dispose(): void;
}

/* ------------------------------------------------------------- SVG */

/** CSS length in px (`10cm`, `72pt`, `300`); null for percentages, `auto` or nothing. */
function cssLength(v: string | null): number | null {
  if (!v) return null;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'px').toLowerCase();
  const k = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 }[unit] ?? 1;
  return n * k > 0 ? n * k : null;
}

function openSvg(bytes: Uint8Array): VectorDoc {
  const text = new TextDecoder().decode(bytes);
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = xml.documentElement;
  if (xml.getElementsByTagName('parsererror').length || root.localName !== 'svg') throw new Error('SVG-filen kunde inte läsas');

  // Pictures never run scripts, but strip anything active anyway; <foreignObject> would also block export.
  for (const el of [...root.querySelectorAll('script, foreignObject')]) el.remove();
  for (const el of [root, ...root.querySelectorAll('*')])
    for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);

  const vb = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0;
  let w = cssLength(root.getAttribute('width'));
  let h = cssLength(root.getAttribute('height'));
  if (hasVb) {
    if (w && !h) h = (w * vb[3]!) / vb[2]!;
    else if (h && !w) w = (h * vb[2]!) / vb[3]!;
    w ??= vb[2]!;
    h ??= vb[3]!;
  }
  w ??= 300;
  h ??= 150;
  // without a viewBox the content would not scale with width/height: give it one in its own units
  if (!hasVb) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  root.removeAttribute('x');
  root.removeAttribute('y');
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);
  const width = w;
  const height = h;

  return {
    format: 'svg',
    width,
    height,
    async render(req) {
      // The graphic at full size, seen through a window onto the requested part.
      const inner = root.cloneNode(true) as Element;
      inner.setAttribute('width', String(req.fullWidth));
      inner.setAttribute('height', String(req.fullHeight));
      const doc =
        `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${req.width}" height="${req.height}" ` +
        `viewBox="${req.x} ${req.y} ${req.width} ${req.height}" preserveAspectRatio="none">` +
        new XMLSerializer().serializeToString(inner) +
        '</svg>';
      const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }));
      try {
        const img = new Image(req.width, req.height);
        img.src = url;
        await img.decode();
        const c = new OffscreenCanvas(req.width, req.height);
        c.getContext('2d')!.drawImage(img, 0, 0, req.width, req.height);
        return c.transferToImageBitmap();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    dispose() {},
  };
}

/* ------------------------------------------------------------- PDF / Illustrator */

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js is large: loaded the first time a PDF or Illustrator file is used. */
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return m;
  });
  return pdfjsPromise;
}

const assetBase = () => new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;

async function openPdf(bytes: Uint8Array): Promise<VectorDoc> {
  const lib = await pdfjs();
  const base = assetBase();
  let doc: PDFDocumentProxy;
  try {
    doc = await lib.getDocument({
      data: bytes.slice(), // pdf.js takes ownership of the buffer
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
      enableXfa: false,
    }).promise;
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'PasswordException' ? 'PDF-filen är lösenordsskyddad' : 'PDF-filen kunde inte läsas');
  }
  const page: PDFPageProxy = await doc.getPage(1);
  // Illustrator files saved without "Create PDF Compatible File" only contain a notice page
  const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
  if (/saved without PDF Content/i.test(text)) {
    void doc.loadingTask.destroy();
    throw new Error('Illustrator-filen är sparad utan PDF-innehåll. Spara om den med "Skapa PDF-kompatibel fil" påslaget, eller som PDF eller SVG.');
  }
  const base1 = page.getViewport({ scale: 1 });
  return {
    format: 'pdf',
    width: base1.width,
    height: base1.height,
    async render(req) {
      const viewport = page.getViewport({ scale: req.fullWidth / base1.width, offsetX: -req.x, offsetY: -req.y });
      const canvas = document.createElement('canvas');
      canvas.width = req.width;
      canvas.height = req.height;
      // Transparent background: the film shows through wherever the artwork has nothing.
      // pdf.js would create an opaque context itself, so it gets one with an alpha channel.
      const canvasContext = canvas.getContext('2d', { alpha: true })!;
      await page.render({ canvas, canvasContext, viewport, background: 'rgba(0,0,0,0)', annotationMode: lib.AnnotationMode.ENABLE }).promise;
      const b = await createImageBitmap(canvas);
      canvas.width = canvas.height = 0;
      return b;
    },
    dispose() {
      void doc.loadingTask.destroy();
    },
  };
}

/* ------------------------------------------------------------- library */

async function openDoc(bytes: Uint8Array, format: 'svg' | 'pdf'): Promise<VectorDoc> {
  return format === 'svg' ? openSvg(bytes) : openPdf(bytes);
}

function clampRequest(req: VectorRequest): VectorRequest {
  return {
    fullWidth: Math.max(1, Math.round(req.fullWidth)),
    fullHeight: Math.max(1, Math.round(req.fullHeight)),
    x: Math.round(req.x),
    y: Math.round(req.y),
    width: Math.max(1, Math.min(MAX_SIDE, Math.round(req.width))),
    height: Math.max(1, Math.min(MAX_SIDE, Math.round(req.height))),
  };
}

class VectorLibrary {
  private docs = new Map<string, Promise<VectorDoc>>();
  private bytesFor: ((assetId: string) => Promise<Uint8Array | null>) | null = null;

  /** Where the files' bytes come from (the media library). */
  setSource(bytes: (assetId: string) => Promise<Uint8Array | null>) {
    this.bytesFor = bytes;
  }

  /** Size and format of a file the user picked (throws with a readable message if it can't be used). */
  async probe(blob: Blob, format: 'svg' | 'pdf'): Promise<{ width: number; height: number }> {
    const doc = await openDoc(new Uint8Array(await blob.arrayBuffer()), format);
    doc.dispose();
    return { width: doc.width, height: doc.height };
  }

  private doc(assetId: string, format: 'svg' | 'pdf'): Promise<VectorDoc> {
    let d = this.docs.get(assetId);
    if (!d) {
      d = (async () => {
        const bytes = await this.bytesFor?.(assetId);
        if (!bytes) throw new Error('Filen finns inte');
        return openDoc(bytes, format);
      })();
      d.catch(() => this.docs.delete(assetId)); // retry next time
      this.docs.set(assetId, d);
    }
    return d;
  }

  /** Render part of a graphic (used by the preview and, via a message, by the exporter). */
  rasterize = async (asset: ImageAsset, req: VectorRequest): Promise<ImageBitmap | null> => {
    if (!asset.vector) return null;
    const doc = await this.doc(asset.id, asset.vector);
    return doc.render(clampRequest(req));
  };

  /** A small picture for bins and clips. */
  async thumbnail(assetId: string, format: 'svg' | 'pdf', height = 144): Promise<Blob> {
    const doc = await this.doc(assetId, format);
    let h = height;
    let w = Math.round((h * doc.width) / doc.height);
    if (w > 4 * height) {
      w = 4 * height;
      h = Math.max(1, Math.round((w * doc.height) / doc.width));
    }
    const bmp = await doc.render({ fullWidth: w, fullHeight: h, x: 0, y: 0, width: w, height: h });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return c.convertToBlob({ type: 'image/png' });
  }
}

export const vectors = new VectorLibrary();

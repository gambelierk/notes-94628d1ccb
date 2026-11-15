/**
 * Image loading for the Canvas2D Rive runtime.
 *
 * The runtime decodes embedded and data-bound images with `new Image()`:
 * - In workers `Image` does not exist. We install a stand-in that returns an
 *   OffscreenCanvas (drawable by drawImage/createPattern exactly like an <img>)
 *   and fill it via createImageBitmap when `src` is set.
 * - Loads are asynchronous everywhere, so a frame rendered right after a file
 *   loads could miss its images. We count in-flight loads so callers can wait
 *   with `imagesSettled()` before rendering. That keeps the export deterministic.
 */

let pending = 0;
let waiters: Array<() => void> = [];

function begin() {
  pending++;
}
function end() {
  pending = Math.max(0, pending - 1);
  if (pending === 0) {
    const w = waiters;
    waiters = [];
    for (const fn of w) fn();
  }
}

/** Resolves when no Rive image loads are in flight. */
export function imagesSettled(): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((r) => waiters.push(r));
}

let installed = false;

export function installRiveImageSupport(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as { Image?: typeof Image };

  if (typeof g.Image === 'undefined') {
    g.Image = WorkerImage as unknown as typeof Image;
    installWorkerDocumentShim();
    return;
  }

  // Main thread: wrap the native Image so we can count pending loads.
  const Native = g.Image;
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  class TrackedImage extends Native {
    constructor(width?: number, height?: number) {
      super(width, height);
    }
    override set src(v: string) {
      begin();
      const done = () => {
        this.removeEventListener('load', done);
        this.removeEventListener('error', done);
        end();
      };
      this.addEventListener('load', done);
      this.addEventListener('error', done);
      desc?.set?.call(this, v);
    }
    override get src(): string {
      return (desc?.get?.call(this) as string) ?? '';
    }
  }
  g.Image = TrackedImage;
}

/**
 * The runtime creates a hidden WebGL2 canvas via `document.createElement`
 * for draws Canvas2D cannot make (feathering, some image meshes). In a worker
 * an OffscreenCanvas does the same job. Everything else is a no-op.
 */
function installWorkerDocumentShim() {
  const g = globalThis as unknown as { document?: unknown };
  if (typeof g.document !== 'undefined') return;
  const noop = () => undefined;
  const element = () => ({ style: {}, appendChild: noop, remove: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop });
  g.document = {
    createElement: (tag: string) => (tag.toLowerCase() === 'canvas' ? new OffscreenCanvas(1, 1) : element()),
    addEventListener: noop,
    removeEventListener: noop,
    body: element(),
  };
}

function WorkerImage(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(1, 1) as OffscreenCanvas & {
    onload: (() => void) | null;
    onerror: ((e: unknown) => void) | null;
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
    src: string;
  };
  let src = '';
  canvas.onload = null;
  canvas.onerror = null;
  canvas.complete = false;
  Object.defineProperty(canvas, 'src', {
    get: () => src,
    set: (value: string) => {
      src = value;
      begin();
      void (async () => {
        try {
          const blob = await (await fetch(value)).blob();
          const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          canvas.naturalWidth = bmp.width;
          canvas.naturalHeight = bmp.height;
          canvas.getContext('2d')!.drawImage(bmp, 0, 0);
          bmp.close();
          canvas.complete = true;
          canvas.onload?.();
        } catch (e) {
          canvas.onerror?.(e);
        } finally {
          end();
        }
      })();
    },
  });
  return canvas;
}

import RiveFactory from '@rive-app/canvas-advanced';
import type { RiveCanvas, File as RiveFile, Image as RiveImage } from '@rive-app/canvas-advanced';
import { imagesSettled, installRiveImageSupport } from './worker-polyfill';

export type { RiveCanvas, RiveFile, RiveImage };

let runtime: Promise<RiveCanvas> | null = null;

/**
 * Load the Rive WASM runtime once per JS realm (main thread and each worker
 * get their own instance). `wasmUrl` must point at `rive.wasm` from
 * `@rive-app/canvas-advanced`.
 */
export function loadRiveRuntime(wasmUrl: string): Promise<RiveCanvas> {
  installRiveImageSupport();
  runtime ??= RiveFactory({ locateFile: () => wasmUrl });
  return runtime;
}

export async function loadRiveFile(rive: RiveCanvas, bytes: Uint8Array): Promise<RiveFile> {
  // Copy: the runtime may keep a reference and callers may transfer/reuse buffers.
  const file = await rive.load(new Uint8Array(bytes));
  if (!file) throw new Error('Kunde inte läsa Rive-filen');
  // Embedded images decode asynchronously; wait so the first render is complete.
  await imagesSettled();
  return file;
}

/** Decode image bytes (PNG/JPEG/WebP) into a Rive render image. */
export function decodeRiveImage(rive: RiveCanvas, bytes: Uint8Array): Promise<RiveImage> {
  return new Promise((resolve, reject) => {
    try {
      rive.decodeImage(new Uint8Array(bytes), (img) => {
        if (img) void imagesSettled().then(() => resolve(img));
        else reject(new Error('Kunde inte avkoda bilden'));
      });
    } catch (e) {
      reject(e);
    }
  });
}

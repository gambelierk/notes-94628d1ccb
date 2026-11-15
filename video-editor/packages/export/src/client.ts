import type { ImageAsset } from '@ve/core';
import type { VectorRequest } from '@ve/render';
import type { ExportEvent, ExportJob } from './protocol';

/** Renders part of a vector graphic on the main thread for the exporter. */
export type VectorRasterizer = (asset: ImageAsset, req: VectorRequest) => Promise<ImageBitmap | null>;

export interface ExportProgress {
  frame: number;
  total: number;
  framesPerSecond: number;
}

export interface ExportResult {
  blob: Blob;
  elapsedMs: number;
}

export class ExportCancelledError extends Error {
  constructor() {
    super('Exporten avbröts');
  }
}

/**
 * Run an export in a dedicated worker so the editor stays responsive.
 * Abort with `signal`.
 */
export function exportProject(
  job: ExportJob,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
  rasterizeVector?: VectorRasterizer,
): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module', name: 'export' });
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const onAbort = () => worker.postMessage({ type: 'cancel' });
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = (e: MessageEvent<ExportEvent>) => {
      const ev = e.data;
      switch (ev.type) {
        case 'progress':
          onProgress(ev);
          break;
        case 'rasterize': {
          const answer = (bitmap: ImageBitmap | null) => worker.postMessage({ type: 'raster', id: ev.id, bitmap }, bitmap ? [bitmap] : []);
          if (!rasterizeVector) answer(null);
          else
            rasterizeVector(ev.asset, ev.req).then(answer, (err) => {
              console.warn('Vektorgrafiken kunde inte ritas för exporten', err);
              answer(null);
            });
          break;
        }
        case 'done':
          cleanup();
          resolve({ blob: new Blob([ev.data], { type: ev.mimeType }), elapsedMs: ev.elapsedMs });
          break;
        case 'cancelled':
          cleanup();
          reject(new ExportCancelledError());
          break;
        case 'error':
          cleanup();
          reject(new Error(ev.message));
          break;
      }
    };
    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message || 'Exporten kraschade'));
    };
    worker.postMessage({ type: 'start', job });
  });
}

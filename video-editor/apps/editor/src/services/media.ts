import { CanvasSink } from 'mediabunny';
import { createId, type ImageAsset, type VideoAsset } from '@ve/core';
import { MediaSource, probeVideo } from '@ve/media';

/**
 * Bytes and decoders for imported media. The project only stores metadata
 * and ids; the files live here (later: OPFS for persistence across reloads).
 */
class MediaLibrary {
  private blobs = new Map<string, Blob>();
  private sources = new Map<string, Promise<MediaSource | null>>();

  async importVideo(file: File): Promise<{ asset: VideoAsset; thumbnail: string | null }> {
    const id = createId('vid');
    const { asset, source } = await probeVideo(file, id, file.name);
    this.blobs.set(id, file);
    this.sources.set(id, Promise.resolve(source));
    let thumbnail: string | null = null;
    try {
      thumbnail = await this.posterFrame(source, asset);
    } catch (e) {
      console.warn('Kunde inte skapa miniatyr', e);
    }
    return { asset, thumbnail };
  }

  async importImage(file: File): Promise<ImageAsset> {
    const bmp = await createImageBitmap(file);
    const asset: ImageAsset = {
      kind: 'image',
      id: createId('img'),
      name: file.name,
      width: bmp.width,
      height: bmp.height,
      size: file.size,
      mime: file.type || 'image/png',
    };
    bmp.close();
    this.blobs.set(asset.id, file);
    return asset;
  }

  private async posterFrame(source: MediaSource, asset: VideoAsset): Promise<string | null> {
    if (!source.video) return null;
    const h = 72;
    const w = Math.max(1, Math.round((h * asset.width) / Math.max(1, asset.height)));
    const sink = new CanvasSink(source.video, { width: w * 2, height: h * 2, fit: 'cover' });
    const at = Math.min(1, source.durationSec / 3);
    const wrapped = await sink.getCanvas(at);
    if (!wrapped) return null;
    const c = wrapped.canvas;
    const blob =
      c instanceof OffscreenCanvas
        ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
        : await new Promise<Blob | null>((r) => (c as HTMLCanvasElement).toBlob(r, 'image/jpeg', 0.8));
    return blob ? URL.createObjectURL(blob) : null;
  }

  blob(assetId: string): Blob | undefined {
    return this.blobs.get(assetId);
  }

  openSource = (assetId: string): Promise<MediaSource | null> => {
    let p = this.sources.get(assetId);
    if (!p) {
      const b = this.blobs.get(assetId);
      p = b ? MediaSource.open(b).catch(() => null) : Promise.resolve(null);
      this.sources.set(assetId, p);
    }
    return p;
  };

  imageBytes = async (assetId: string): Promise<Uint8Array | null> => {
    const b = this.blobs.get(assetId);
    return b ? new Uint8Array(await b.arrayBuffer()) : null;
  };
}

export const media = new MediaLibrary();

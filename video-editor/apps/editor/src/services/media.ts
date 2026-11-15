import { CanvasSink } from 'mediabunny';
import { createId, type AudioAsset, type ImageAsset, type VideoAsset } from '@ve/core';
import { computePeaks, MediaSource, probeAudio, probeVideo, type Peaks } from '@ve/media';

type Kind = 'video' | 'image' | 'audio';

interface Entry {
  kind?: Kind;
  /** Local file, when this browser has it (just imported or uploaded). */
  blob?: Blob;
  /** Absolute URL on the server, when the file is stored there. */
  url?: string;
  name?: string;
  size?: number;
}

/**
 * Bytes and decoders for media. The project only stores metadata and ids.
 * A file can be local (demo mode / just imported), remote (saved in a
 * customer project) or both; local is preferred because it avoids the network.
 */
class MediaLibrary {
  private entries = new Map<string, Entry>();
  private sources = new Map<string, Promise<MediaSource | null>>();
  private thumbs = new Map<string, Promise<string | null>>();

  /** Make a server-stored file available under `id`. */
  registerRemote(id: string, url: string, name?: string, size?: number, kind?: Kind) {
    const e = this.entries.get(id) ?? {};
    this.entries.set(id, { ...e, url: new URL(url, location.href).href, name: name ?? e.name, size: size ?? e.size, kind: kind ?? e.kind });
  }

  registerLocal(id: string, blob: Blob) {
    const e = this.entries.get(id) ?? {};
    const guess: Kind = blob.type.startsWith('image/') ? 'image' : blob.type.startsWith('audio/') ? 'audio' : 'video';
    this.entries.set(id, { ...e, blob, size: blob.size, kind: e.kind ?? guess });
  }

  kindOf(id: string): Kind | undefined {
    return this.entries.get(id)?.kind;
  }

  async importAudio(file: File, id: string = createId('aud')): Promise<AudioAsset> {
    const e = this.entries.get(id) ?? {};
    this.entries.set(id, { ...e, kind: 'audio' });
    const { asset, source } = await probeAudio(file, id, file.name, file.size);
    this.registerLocal(id, file);
    this.sources.set(id, Promise.resolve(source));
    return asset;
  }

  /** Metadata for a server-stored sound file so it can be placed on a timeline. */
  async probeRemoteAudio(id: string): Promise<AudioAsset> {
    const e = this.entries.get(id);
    if (!e?.url && !e?.blob) throw new Error('Filen finns inte');
    const { asset, source } = await probeAudio(e.blob ?? e.url!, id, e.name ?? 'ljud', e.size);
    this.sources.set(id, Promise.resolve(source));
    return asset;
  }

  private peakCache = new Map<string, Promise<Peaks | null>>();

  /** Waveform overview for a video's or sound file's audio (computed once, in the background). */
  peaks(id: string): Promise<Peaks | null> {
    let p = this.peakCache.get(id);
    if (!p) {
      p = (async () => {
        // a separate decoder so the waveform doesn't disturb playback
        const e = this.entries.get(id);
        const src = e?.blob ?? e?.url;
        if (!src) return null;
        const source = await MediaSource.open(src);
        try {
          return await computePeaks(source);
        } finally {
          source.dispose();
        }
      })().catch((err) => {
        console.warn('Vågform kunde inte beräknas', err);
        return null;
      });
      this.peakCache.set(id, p);
    }
    return p;
  }

  private isImage(id: string): boolean {
    return this.entries.get(id)?.kind === 'image';
  }

  private async bytesBlob(id: string): Promise<Blob | null> {
    const e = this.entries.get(id);
    if (e?.blob) return e.blob;
    if (e?.url) {
      const r = await fetch(e.url);
      if (r.ok) return r.blob();
    }
    return null;
  }

  /** Metadata for a server-stored image so it can be placed on a timeline. */
  async probeImage(id: string): Promise<ImageAsset> {
    const blob = await this.bytesBlob(id);
    if (!blob) throw new Error('Bilden finns inte');
    const bmp = await createImageBitmap(blob);
    const e = this.entries.get(id);
    const asset: ImageAsset = {
      kind: 'image',
      id,
      name: e?.name ?? 'bild',
      width: bmp.width,
      height: bmp.height,
      size: blob.size,
      mime: blob.type || 'image/png',
    };
    bmp.close();
    return asset;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Probe a local file without registering it (used before uploading). */
  async probeLocal(file: File, id: string = createId('vid')): Promise<VideoAsset> {
    const { asset, source } = await probeVideo(file, id, file.name, file.size);
    source.dispose();
    return asset;
  }

  async importVideo(file: File, id: string = createId('vid')): Promise<{ asset: VideoAsset; thumbnail: string | null }> {
    const { asset, source } = await probeVideo(file, id, file.name, file.size);
    this.registerLocal(id, file);
    this.sources.set(id, Promise.resolve(source));
    return { asset, thumbnail: await this.thumbnail(id) };
  }

  /** Metadata for a remote video so it can be placed on a timeline. */
  async probeRemote(id: string): Promise<VideoAsset> {
    const e = this.entries.get(id);
    if (!e?.url && !e?.blob) throw new Error('Filen finns inte');
    const { asset, source } = await probeVideo(e.blob ?? e.url!, id, e.name ?? 'video', e.size);
    this.sources.set(id, Promise.resolve(source));
    return asset;
  }

  async importImage(file: File, id: string = createId('img')): Promise<ImageAsset> {
    const bmp = await createImageBitmap(file);
    const asset: ImageAsset = {
      kind: 'image',
      id,
      name: file.name,
      width: bmp.width,
      height: bmp.height,
      size: file.size,
      mime: file.type || 'image/png',
    };
    bmp.close();
    const e = this.entries.get(id) ?? {};
    this.entries.set(id, { ...e, kind: 'image' });
    this.registerLocal(id, file);
    return asset;
  }

  /** A small poster frame (object URL) for bins and clips; cached. */
  thumbnail(id: string): Promise<string | null> {
    let p = this.thumbs.get(id);
    if (!p) {
      p = this.posterFrame(id).catch((e) => {
        console.warn('Kunde inte skapa miniatyr', e);
        return null;
      });
      this.thumbs.set(id, p);
    }
    return p;
  }

  private async posterFrame(id: string): Promise<string | null> {
    if (this.entries.get(id)?.kind === 'audio') return null;
    if (this.isImage(id)) {
      const blob = await this.bytesBlob(id);
      if (!blob) return null;
      // small thumbnail so bins and timelines don't hold full-size photos
      const bmp = await createImageBitmap(blob, { resizeHeight: 144, resizeQuality: 'medium' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      return URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
    }
    const source = await this.openSource(id);
    if (!source?.video) return null;
    const h = 72;
    const v = source.video;
    const w = Math.max(1, Math.round((h * v.displayWidth) / Math.max(1, v.displayHeight)));
    const sink = new CanvasSink(v, { width: w * 2, height: h * 2, fit: 'cover' });
    const wrapped = await sink.getCanvas(Math.min(1, source.durationSec / 3));
    if (!wrapped) return null;
    const c = wrapped.canvas;
    const blob =
      c instanceof OffscreenCanvas
        ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
        : await new Promise<Blob | null>((r) => (c as HTMLCanvasElement).toBlob(r, 'image/jpeg', 0.8));
    return blob ? URL.createObjectURL(blob) : null;
  }

  /** Local file if present. */
  blob(id: string): Blob | undefined {
    return this.entries.get(id)?.blob;
  }

  /** What the exporter should read: the local file, else the server URL. */
  exportSource(id: string): Blob | string | undefined {
    const e = this.entries.get(id);
    return e?.blob ?? e?.url;
  }

  openSource = (id: string): Promise<MediaSource | null> => {
    let p = this.sources.get(id);
    if (!p) {
      const e = this.entries.get(id);
      const src = e?.blob ?? e?.url;
      p = src ? MediaSource.open(src).catch(() => null) : Promise.resolve(null);
      this.sources.set(id, p);
    }
    return p;
  };

  imageBytes = async (id: string): Promise<Uint8Array | null> => {
    const e = this.entries.get(id);
    if (e?.blob) return new Uint8Array(await e.blob.arrayBuffer());
    if (e?.url) {
      const r = await fetch(e.url);
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    }
    return null;
  };

  /** URL for showing an image (object URL for local files, else the server URL). */
  displayUrl(id: string): string | null {
    const e = this.entries.get(id);
    return e?.url ?? null;
  }
}

export const media = new MediaLibrary();

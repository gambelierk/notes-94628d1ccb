import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioSampleSink,
  BlobSource,
  CanvasSink,
  Input,
  UrlSource,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import type { VideoAsset } from '@ve/core';

export class UnsupportedMediaError extends Error {}

/**
 * One opened media file. Wraps a mediabunny Input and lazily creates the
 * decoders ("sinks") we need. Works on the main thread and in workers.
 */
export class MediaSource {
  private canvasSinks = new Map<string, CanvasSink>();
  private audioSampleSink: AudioSampleSink | null = null;
  private audioBufferSink: AudioBufferSink | null = null;

  private constructor(
    readonly src: Blob | string,
    readonly input: Input,
    readonly video: InputVideoTrack | null,
    readonly audio: InputAudioTrack | null,
    readonly durationSec: number,
  ) {}

  /** Open a local file (Blob) or a remote file by URL (read with HTTP range requests). */
  static async open(src: Blob | string): Promise<MediaSource> {
    const source = typeof src === 'string' ? new UrlSource(src, { maxCacheSize: 32 * 1024 * 1024 }) : new BlobSource(src);
    const input = new Input({ source, formats: ALL_FORMATS });
    if (!(await input.canRead())) throw new UnsupportedMediaError('Filformatet stöds inte');
    const video = await input.getPrimaryVideoTrack();
    let audio = await input.getPrimaryAudioTrack();
    if (video && !(await video.canDecode())) {
      throw new UnsupportedMediaError(`Videokodeken (${video.codec ?? 'okänd'}) kan inte avkodas i den här webbläsaren`);
    }
    if (audio && !(await audio.canDecode())) audio = null; // keep the video, drop undecodable audio
    const durationSec = await input.computeDuration();
    return new MediaSource(src, input, video, audio, durationSec);
  }

  /** Decoder that renders frames into canvases of the given size (letterboxed). */
  canvasSink(width: number, height: number): CanvasSink {
    if (!this.video) throw new Error('Filen saknar videospår');
    const key = `${width}x${height}`;
    let sink = this.canvasSinks.get(key);
    if (!sink) {
      sink = new CanvasSink(this.video, { width, height, fit: 'contain', alpha: true, poolSize: 4 });
      this.canvasSinks.set(key, sink);
    }
    return sink;
  }

  /**
   * Decoder producing frames at the video's own aspect ratio, downscaled to
   * fit within maxW × maxH (never upscaled). Placement on the output frame is
   * done by the compositor.
   */
  frameSink(maxW: number, maxH: number): CanvasSink {
    const v = this.video;
    if (!v) throw new Error('Filen saknar videospår');
    const dw = v.displayWidth;
    const dh = v.displayHeight;
    const k = Math.min(1, maxW / dw, maxH / dh);
    const w = Math.max(2, Math.round((dw * k) / 2) * 2);
    const h = Math.max(2, Math.round((dh * k) / 2) * 2);
    return this.canvasSink(w, h);
  }

  audioSamples(): AudioSampleSink | null {
    if (!this.audio) return null;
    this.audioSampleSink ??= new AudioSampleSink(this.audio);
    return this.audioSampleSink;
  }

  audioBuffers(): AudioBufferSink | null {
    if (!this.audio) return null;
    this.audioBufferSink ??= new AudioBufferSink(this.audio);
    return this.audioBufferSink;
  }

  dispose(): void {
    this.canvasSinks.clear();
    this.input.dispose();
  }
}

/** Read the metadata we need to place a file on the timeline. */
export async function probeVideo(
  src: Blob | string,
  id: string,
  name: string,
  size?: number,
): Promise<{ asset: VideoAsset; source: MediaSource }> {
  const source = await MediaSource.open(src);
  const v = source.video;
  if (!v) throw new UnsupportedMediaError('Filen innehåller inget videospår');
  let fps = 30;
  try {
    const stats = await v.computePacketStats(120);
    if (stats.averagePacketRate > 0) fps = stats.averagePacketRate;
  } catch {
    /* keep default */
  }
  const asset: VideoAsset = {
    kind: 'video',
    id,
    name,
    durationUs: Math.round(source.durationSec * 1_000_000),
    width: v.displayWidth,
    height: v.displayHeight,
    fps,
    hasAudio: !!source.audio,
    size: size ?? (typeof src === 'string' ? 0 : src.size),
  };
  return { asset, source };
}

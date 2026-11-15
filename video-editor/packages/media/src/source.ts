import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioSampleSink,
  BlobSource,
  CanvasSink,
  Input,
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
    readonly blob: Blob,
    readonly input: Input,
    readonly video: InputVideoTrack | null,
    readonly audio: InputAudioTrack | null,
    readonly durationSec: number,
  ) {}

  static async open(blob: Blob): Promise<MediaSource> {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    if (!(await input.canRead())) throw new UnsupportedMediaError('Filformatet stöds inte');
    const video = await input.getPrimaryVideoTrack();
    let audio = await input.getPrimaryAudioTrack();
    if (video && !(await video.canDecode())) {
      throw new UnsupportedMediaError(`Videokodeken (${video.codec ?? 'okänd'}) kan inte avkodas i den här webbläsaren`);
    }
    if (audio && !(await audio.canDecode())) audio = null; // keep the video, drop undecodable audio
    const durationSec = await input.computeDuration();
    return new MediaSource(blob, input, video, audio, durationSec);
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
export async function probeVideo(blob: Blob, id: string, name: string): Promise<{ asset: VideoAsset; source: MediaSource }> {
  const source = await MediaSource.open(blob);
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
    size: blob.size,
  };
  return { asset, source };
}

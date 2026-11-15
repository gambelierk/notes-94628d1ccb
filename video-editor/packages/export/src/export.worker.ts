/// <reference lib="webworker" />
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { evaluateParam, fpsValue, framesToSeconds, microsToSeconds, projectDuration, type VideoClip } from '@ve/core';
import { AudioMixer, MediaSource, type AudioClipSpec } from '@ve/media';
import { loadRiveRuntime, TemplateRegistry } from '@ve/rive';
import { Compositor, RenderResources, renderFrame } from '@ve/render';
import type { ExportEvent, ExportJob, ExportRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let cancelled = false;
let running = false;

function post(ev: ExportEvent, transfer: Transferable[] = []) {
  self.postMessage(ev, transfer);
}

self.onmessage = (e: MessageEvent<ExportRequest>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'start' && !running) {
    running = true;
    cancelled = false;
    run(msg.job)
      .catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
      .finally(() => (running = false));
  }
};

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

async function run(job: ExportJob) {
  const t0 = performance.now();
  const { project, options } = job;
  const { settings } = project;
  const width = even(settings.width);
  const height = even(settings.height);
  const fps = settings.fps;
  const rate = fpsValue(fps);
  const start = options.range?.start ?? 0;
  const end = options.range?.end ?? projectDuration(project);
  const total = end - start;
  if (total <= 0) throw new Error('Tidslinjen är tom');

  if (!(await canEncodeVideo('avc', { width, height, bitrate: options.videoBitrate }))) {
    throw new Error(`Webbläsaren kan inte koda H.264 i ${width}×${height}`);
  }

  // Media sources (opened lazily, shared by video and audio).
  const sources = new Map<string, Promise<MediaSource | null>>();
  const openSource = (assetId: string) => {
    let p = sources.get(assetId);
    if (!p) {
      const blob = job.media[assetId];
      p = blob ? MediaSource.open(blob).catch(() => null) : Promise.resolve(null);
      sources.set(assetId, p);
    }
    return p;
  };

  // Templates
  const rive = await loadRiveRuntime(job.riveWasmUrl);
  const templates = new TemplateRegistry(rive);
  for (const src of job.templates) await templates.add(src);

  const canvas = new OffscreenCanvas(width, height);
  const compositor = new Compositor(canvas, width, height);
  const resources = new RenderResources(
    {
      openSource,
      templates,
      imageBytes: async (id) => {
        const b = job.media[id];
        return b ? new Uint8Array(await b.arrayBuffer()) : null;
      },
      createCanvas: (w, h) => new OffscreenCanvas(w, h),
    },
    width,
    height,
  );

  // Audio clips: every unmuted video clip whose source has audio.
  const audioClips: AudioClipSpec[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.hidden) continue;
    for (const c of track.clips) {
      if (c.kind !== 'video') continue;
      const clip = c as VideoClip;
      const vol = evaluateParam(clip.volume);
      if (vol <= 0) continue;
      const src = await openSource(clip.assetId);
      const sink = src?.audioSamples();
      if (!sink) continue;
      const clipStart = framesToSeconds(clip.start - start, fps);
      audioClips.push({
        start: clipStart,
        duration: framesToSeconds(clip.duration, fps),
        sourceStart: microsToSeconds(clip.sourceStart),
        volume: vol,
        sink,
      });
    }
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: options.videoBitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(videoSource, { frameRate: rate });

  let audioSource: AudioSampleSource | null = null;
  let mixer: AudioMixer | null = null;
  const sampleRate = settings.sampleRate;
  if (audioClips.length > 0) {
    if (!(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate, bitrate: options.audioBitrate }))) {
      registerAacEncoder(); // WASM fallback (e.g. Chromium on Linux has no native AAC encoder)
    }
    audioSource = new AudioSampleSource({ codec: 'aac', bitrate: options.audioBitrate });
    output.addAudioTrack(audioSource);
    mixer = new AudioMixer(audioClips, sampleRate);
  }

  await output.start();

  const AUDIO_CHUNK = 4096;
  let audioFrame = 0;
  const totalAudioFrames = Math.round(framesToSeconds(total, fps) * sampleRate);
  const pumpAudio = async (untilSec: number) => {
    if (!audioSource || !mixer) return;
    const until = Math.min(totalAudioFrames, Math.round(untilSec * sampleRate));
    while (audioFrame < until) {
      const n = Math.min(AUDIO_CHUNK, totalAudioFrames - audioFrame);
      const [L, R] = await mixer.read(audioFrame, n);
      const data = new Float32Array(n * 2);
      data.set(L, 0);
      data.set(R, n);
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate, timestamp: audioFrame / sampleRate });
      await audioSource.add(sample);
      sample.close();
      audioFrame += n;
    }
  };

  let lastPost = 0;
  try {
    for (let i = 0; i < total; i++) {
      if (cancelled) {
        await output.cancel();
        post({ type: 'cancelled' });
        return;
      }
      await renderFrame(project, start + i, compositor, resources);
      const ts = framesToSeconds(i, fps);
      await videoSource.add(ts, framesToSeconds(1, fps));
      await pumpAudio(framesToSeconds(i + 1, fps) + 0.5);

      const now = performance.now();
      if (now - lastPost > 150 || i === total - 1) {
        lastPost = now;
        post({ type: 'progress', frame: i + 1, total, framesPerSecond: ((i + 1) * 1000) / (now - t0) });
      }
    }
    await pumpAudio(Number.POSITIVE_INFINITY);
    await output.finalize();
  } finally {
    resources.disposeAll();
    compositor.dispose();
    await mixer?.close();
    for (const p of sources.values()) (await p)?.dispose();
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('Exporten gav ingen data');
  post({ type: 'done', data: buffer, mimeType: 'video/mp4', elapsedMs: performance.now() - t0 }, [buffer]);
}

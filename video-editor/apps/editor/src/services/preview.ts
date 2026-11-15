import {
  fpsValue,
  framesToSeconds,
  projectDuration,
  soundSpans,
  secondsToFrameFloor,
  type Frame,
  type Project,
} from '@ve/core';
import { PreviewAudio, type PreviewAudioClip } from '@ve/media';
import { Compositor, RenderResources, renderFrame } from '@ve/render';
import { currentProject, useEditor } from '../state/store';
import { media } from './media';
import { templates } from './templates';

/** Preview renders at most this wide; export always renders full size. */
const MAX_PREVIEW_WIDTH = 1280;

function previewSize(p: Project): [number, number] {
  const k = Math.min(1, MAX_PREVIEW_WIDTH / p.settings.width);
  return [Math.max(2, Math.round(p.settings.width * k)), Math.max(2, Math.round(p.settings.height * k))];
}

/**
 * Drives the viewer. Uses exactly the same `renderFrame` as the exporter.
 * When paused it renders on demand (latest request wins); when playing the
 * AudioContext clock is the master clock and video follows it.
 */
class PreviewEngine {
  private compositor: Compositor | null = null;
  private resources: RenderResources | null = null;
  private audio: PreviewAudio | null = null;
  private pending: Frame | null = null;
  private rendering = false;
  private raf = 0;
  private lastFrame = -1;
  private lastProject: Project | null = null;
  private unsub: (() => void) | null = null;
  /** Bumped whenever the project changes so a frame is redrawn. */
  private version = 0;
  private renderedVersion = -1;
  onRendered: ((frame: Frame) => void) | null = null;

  async attach(canvas: HTMLCanvasElement) {
    const registry = await templates.registry();
    const project = currentProject();
    const [w, h] = previewSize(project);
    this.compositor = new Compositor(canvas, w, h);
    this.resources = new RenderResources(
      {
        openSource: media.openSource,
        templates: registry,
        imageBytes: media.imageBytes,
        createCanvas: (cw, ch) => new OffscreenCanvas(cw, ch),
      },
      w,
      h,
    );
    this.unsub = useEditor.subscribe((s, prev) => {
      const p = s.draft ?? s.history.present.project;
      const pp = prev.draft ?? prev.history.present.project;
      if (p !== pp) {
        this.version++;
        if (s.playing) this.restartAudio();
      }
      if (s.templates !== prev.templates) this.version++; // a template finished loading
      if (!s.playing && (p !== pp || s.playhead !== prev.playhead || s.templates !== prev.templates)) {
        this.request(s.playhead);
      }
    });
    this.request(useEditor.getState().playhead);
  }

  detach() {
    this.pause();
    this.unsub?.();
    this.resources?.disposeAll();
    this.compositor?.dispose();
    this.compositor = null;
    this.resources = null;
  }

  /** Render `frame` as soon as possible; intermediate requests are dropped. */
  request(frame: Frame) {
    this.pending = frame;
    if (!this.rendering) void this.pump();
  }

  private async pump() {
    this.rendering = true;
    try {
      while (this.pending !== null) {
        const frame = this.pending;
        this.pending = null;
        await this.draw(frame);
      }
    } finally {
      this.rendering = false;
    }
  }

  private async draw(frame: Frame) {
    const c = this.compositor;
    const r = this.resources;
    if (!c || !r) return;
    const project = currentProject();
    const [w, h] = previewSize(project);
    if (c.width !== w || c.height !== h) {
      c.resize(w, h);
      r.setSize(w, h);
    }
    if (frame === this.lastFrame && this.renderedVersion === this.version && project === this.lastProject) return;
    try {
      await renderFrame(project, frame, c, r);
      this.lastFrame = frame;
      this.lastProject = project;
      this.renderedVersion = this.version;
      this.onRendered?.(frame);
    } catch (e) {
      console.error('Renderingsfel', e);
    }
  }

  /* ---------------------------------------------------------- playback */

  /** Same sound list as the exporter: video sound and audio files, with volumes and fades. */
  private audioClips(project: Project): Promise<PreviewAudioClip[]> {
    return Promise.all(
      soundSpans(project).map(async (span) => {
        const src = await media.openSource(span.assetId);
        const sink = src?.audioBuffers();
        const clip: PreviewAudioClip | null = sink ? { ...span, sink } : null;
        return clip;
      }),
    ).then((xs) => xs.filter((x): x is PreviewAudioClip => !!x));
  }

  private async restartAudio() {
    if (!this.audio) return;
    const project = currentProject();
    const from = this.audio.time;
    await this.audio.start(await this.audioClips(project), from);
  }

  async play() {
    const store = useEditor.getState();
    const project = currentProject();
    const end = projectDuration(project);
    if (end === 0) return;
    let from = store.playhead;
    if (from >= end - 1) from = 0;
    this.audio ??= new PreviewAudio(new AudioContext({ latencyHint: 'playback' }));
    store.setPlaying(true);
    await this.audio.start(await this.audioClips(project), framesToSeconds(from, project.settings.fps));
    cancelAnimationFrame(this.raf);
    const tick = () => {
      const s = useEditor.getState();
      if (!s.playing || !this.audio) return;
      const p = currentProject();
      const f = secondsToFrameFloor(this.audio.time, p.settings.fps);
      const stop = projectDuration(p);
      if (f >= stop) {
        this.pause();
        useEditor.getState().setPlayhead(Math.max(0, stop - 1));
        return;
      }
      if (f !== s.playhead) s.setPlayhead(f);
      if (!this.rendering) this.request(f);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    this.audio?.stop();
    const s = useEditor.getState();
    if (s.playing) {
      s.setPlaying(false);
      this.request(s.playhead);
    }
  }

  toggle() {
    if (useEditor.getState().playing) this.pause();
    else void this.play();
  }

  get fps(): number {
    return fpsValue(currentProject().settings.fps);
  }
}

export const preview = new PreviewEngine();

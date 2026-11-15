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
import { vectors } from './vector';

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
  /** Bumped by every play/pause/seek; async work from an older session is discarded. */
  private session = 0;
  /** The last playhead the playback loop set itself (anything else is a seek by the user). */
  private clockFrame: Frame | null = null;
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
        // vector graphics: show the nearest rendering at once, redraw when the sharp one is ready
        rasterizeVector: vectors.rasterize,
        vectorMode: 'progressive',
        onAsyncReady: () => {
          this.version++;
          const s = useEditor.getState();
          if (!s.playing) this.request(s.playhead);
        },
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
      // the playhead was moved (button, key, click) during playback: continue playing from there
      if (s.playing && prev.playing && s.playhead !== prev.playhead && s.playhead !== this.clockFrame) {
        // jumped to the very end (End key, "to end" button): stop there instead of starting over
        if (s.playhead >= projectDuration(p) - 1) this.pause();
        else void this.play(s.playhead);
      }
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

  /** The project changed during playback: rebuild the sound from where we are. */
  private async restartAudio() {
    const audio = this.audio;
    if (!audio) return;
    const session = this.session;
    const from = audio.time;
    const clips = await this.audioClips(currentProject());
    if (session !== this.session) return; // paused or seeked meanwhile
    await audio.start(clips, from);
    if (session !== this.session) audio.stop();
  }

  /**
   * Play from `from` (default: the playhead). From the very end it starts
   * over from the beginning. Pausing leaves the playhead where it stopped.
   */
  async play(from: Frame = useEditor.getState().playhead) {
    const store = useEditor.getState();
    const project = currentProject();
    const end = projectDuration(project);
    if (end === 0) return;
    if (from >= end - 1) from = 0;
    const session = ++this.session;
    cancelAnimationFrame(this.raf);
    this.audio ??= new PreviewAudio(new AudioContext({ latencyHint: 'playback' }));
    const audio = this.audio;
    audio.stop();
    this.clockFrame = from;
    if (store.playhead !== from) store.setPlayhead(from);
    store.setPlaying(true);
    const clips = await this.audioClips(project);
    if (session !== this.session) return; // paused (or restarted) while the sound was loading
    await audio.start(clips, framesToSeconds(from, project.settings.fps));
    if (session !== this.session) {
      audio.stop();
      return;
    }
    const tick = () => {
      const s = useEditor.getState();
      if (session !== this.session || !s.playing) return;
      const p = currentProject();
      const f = secondsToFrameFloor(audio.time, p.settings.fps);
      const stop = projectDuration(p);
      if (f >= stop) {
        this.pause();
        useEditor.getState().setPlayhead(Math.max(0, stop - 1));
        return;
      }
      if (f !== s.playhead) {
        this.clockFrame = f;
        s.setPlayhead(f);
      }
      if (!this.rendering) this.request(f);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    this.session++;
    this.clockFrame = null;
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

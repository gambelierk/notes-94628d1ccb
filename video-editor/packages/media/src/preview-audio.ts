import type { AudioBufferSink } from 'mediabunny';

export interface PreviewAudioClip {
  start: number;
  duration: number;
  sourceStart: number;
  volume: number;
  sink: AudioBufferSink;
}

const LOOKAHEAD = 1.0; // seconds of audio scheduled ahead of the clock
const START_LATENCY = 0.06;

/**
 * Real-time audio for preview. The AudioContext clock is the master clock
 * for playback; video frames follow `time`.
 */
export class PreviewAudio {
  private nodes = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private anchorCtx = 0;
  private anchorTimeline = 0;
  private running = false;
  private master: GainNode;

  constructor(readonly ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  get playing(): boolean {
    return this.running;
  }

  /** Current timeline time in seconds. */
  get time(): number {
    if (!this.running) return this.anchorTimeline;
    return this.anchorTimeline + Math.max(0, this.ctx.currentTime - this.anchorCtx);
  }

  async start(clips: PreviewAudioClip[], from: number): Promise<void> {
    this.stop();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const gen = ++this.generation;
    this.running = true;
    this.anchorCtx = this.ctx.currentTime + START_LATENCY;
    this.anchorTimeline = from;
    for (const clip of clips) {
      if (clip.start + clip.duration <= from) continue;
      void this.runClip(clip, from, gen).catch((e) => console.warn('Ljuduppspelning', e));
    }
  }

  stop(): void {
    if (this.running) this.anchorTimeline = this.time;
    this.running = false;
    this.generation++;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes.clear();
  }

  private async runClip(clip: PreviewAudioClip, from: number, gen: number) {
    const gain = this.ctx.createGain();
    gain.gain.value = clip.volume;
    gain.connect(this.master);
    const tlFrom = Math.max(from, clip.start);
    const srcFrom = clip.sourceStart + (tlFrom - clip.start);
    const srcEnd = clip.sourceStart + clip.duration;
    const it = clip.sink.buffers(srcFrom, srcEnd);
    try {
      for await (const wb of it) {
        if (gen !== this.generation) break;
        const tl = clip.start + (wb.timestamp - clip.sourceStart);
        // throttle: don't decode far ahead of the clock
        while (gen === this.generation && tl - this.time > LOOKAHEAD) await sleep(100);
        if (gen !== this.generation) break;

        const when = this.anchorCtx + (tl - this.anchorTimeline);
        let offset = Math.max(0, clip.sourceStart - wb.timestamp); // trim to clip in-point
        let startAt = when + offset;
        const now = this.ctx.currentTime;
        if (startAt < now) {
          offset += now - startAt;
          startAt = now;
        }
        const clipEndCtx = this.anchorCtx + (clip.start + clip.duration - this.anchorTimeline);
        const dur = Math.min(wb.duration - offset, clipEndCtx - startAt);
        if (dur <= 0) continue;
        const node = this.ctx.createBufferSource();
        node.buffer = wb.buffer;
        node.connect(gain);
        node.start(startAt, offset, dur);
        this.nodes.add(node);
        node.onended = () => this.nodes.delete(node);
      }
    } finally {
      await it.return(undefined);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

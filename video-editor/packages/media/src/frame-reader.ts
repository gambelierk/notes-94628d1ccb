import type { CanvasSink, WrappedCanvas } from 'mediabunny';

const EPS = 1e-6;
/** Further than this ahead we seek instead of decoding through. */
const MAX_DECODE_AHEAD = 2.5;

/**
 * Returns the frame displayed at a given source time.
 *
 * Sequential access (playback, export) decodes forward from an iterator,
 * which is fast. Random access (scrubbing, jumping) restarts the iterator at
 * the requested time, which decodes from the nearest preceding keyframe.
 * Calls are serialised internally.
 */
export class VideoFrameReader {
  private iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private current: WrappedCanvas | null = null;
  private pending: WrappedCanvas | null = null;
  private done = false;
  /** Source time the current iterator started at (0 = from the first frame). */
  private startedAt = -1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly sink: CanvasSink) {}

  frameAt(t: number): Promise<WrappedCanvas | null> {
    const run = this.queue.then(() => this.frameAtUnsafe(t));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private covers(f: WrappedCanvas | null, t: number): boolean {
    return !!f && t + EPS >= f.timestamp && (t < f.timestamp + f.duration - EPS || (this.done && this.pending === null));
  }

  private async frameAtUnsafe(t: number): Promise<WrappedCanvas | null> {
    const cur = this.current;
    if (cur && this.covers(cur, t)) return cur;
    // before the first frame (e.g. a dissolve reaching before the media starts): hold the first frame
    if (cur && t < cur.timestamp && this.startedAt === 0) return cur;

    const canDecodeForward = !!this.iter && !!cur && t > cur.timestamp && t - cur.timestamp < MAX_DECODE_AHEAD;
    if (!canDecodeForward) await this.restart(t);

    while (this.pending && this.pending.timestamp <= t + EPS) {
      this.current = this.pending;
      this.pending = await this.pull();
    }
    return this.current;
  }

  private async pull(): Promise<WrappedCanvas | null> {
    if (!this.iter || this.done) return null;
    const r = await this.iter.next();
    if (r.done) {
      this.done = true;
      return null;
    }
    return r.value;
  }

  private async restart(t: number): Promise<void> {
    await this.iter?.return(undefined);
    this.done = false;
    this.startedAt = Math.max(0, t);
    this.iter = this.sink.canvases(this.startedAt);
    this.current = await this.pull();
    this.pending = this.current ? await this.pull() : null;
  }

  async dispose(): Promise<void> {
    await this.queue;
    await this.iter?.return(undefined);
    this.iter = null;
    this.current = this.pending = null;
  }
}

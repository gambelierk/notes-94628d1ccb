import type { AudioSample, AudioSampleSink } from 'mediabunny';

export interface AudioClipSpec {
  /** Timeline position (seconds). */
  start: number;
  duration: number;
  /** Source position (seconds). */
  sourceStart: number;
  volume: number;
  sink: AudioSampleSink;
}

/**
 * Streams one clip's audio as stereo float32 at the output sample rate.
 * Reads must be sequential (each read starts where the previous one ended).
 * Resampling is linear, which is transparent for speech and typical edits.
 */
class ClipAudioStream {
  private iter: AsyncGenerator<AudioSample, void, unknown> | null = null;
  private done = false;
  private srcRate = 0;
  // Decoded source audio, planar stereo. `bufStart` is the source frame index
  // (relative to sourceStart) of buf[0].
  private bufL = new Float32Array(0);
  private bufR = new Float32Array(0);
  private bufLen = 0;
  private bufStart = 0;

  constructor(private readonly spec: AudioClipSpec, private readonly outRate: number) {}

  private ensureCapacity(n: number) {
    if (n <= this.bufL.length) return;
    const cap = Math.max(n, this.bufL.length * 2, 8192);
    const l = new Float32Array(cap);
    const r = new Float32Array(cap);
    l.set(this.bufL.subarray(0, this.bufLen));
    r.set(this.bufR.subarray(0, this.bufLen));
    this.bufL = l;
    this.bufR = r;
  }

  private dropBefore(srcIndex: number) {
    const k = Math.min(this.bufLen, Math.max(0, Math.floor(srcIndex) - this.bufStart - 2));
    if (k <= 0) return;
    this.bufL.copyWithin(0, k, this.bufLen);
    this.bufR.copyWithin(0, k, this.bufLen);
    this.bufLen -= k;
    this.bufStart += k;
  }

  private append(sample: AudioSample) {
    if (!this.srcRate) this.srcRate = sample.sampleRate;
    const n = sample.numberOfFrames;
    const ch = sample.numberOfChannels;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    sample.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
    if (ch > 1) sample.copyTo(r, { planeIndex: 1, format: 'f32-planar' });
    else r.set(l);
    sample.close();

    // Where this packet belongs relative to the clip's source start.
    let at = Math.round((sample.timestamp - this.spec.sourceStart) * this.srcRate);
    let from = 0;
    const end = this.bufStart + this.bufLen;
    if (at < end) {
      from = end - at; // overlap or before the clip start: skip
      at = end;
    }
    if (from >= n) return;
    const gap = at - end; // missing audio → silence
    const add = gap + (n - from);
    this.ensureCapacity(this.bufLen + add);
    this.bufL.fill(0, this.bufLen, this.bufLen + gap);
    this.bufR.fill(0, this.bufLen, this.bufLen + gap);
    this.bufL.set(l.subarray(from), this.bufLen + gap);
    this.bufR.set(r.subarray(from), this.bufLen + gap);
    this.bufLen += add;
  }

  private async fillTo(srcIndex: number) {
    if (!this.iter) {
      const { sourceStart, duration } = this.spec;
      this.iter = this.spec.sink.samples(sourceStart, sourceStart + duration + 0.25);
    }
    while (!this.done && (this.srcRate === 0 || this.bufStart + this.bufLen <= srcIndex + 1)) {
      const r = await this.iter.next();
      if (r.done) {
        this.done = true;
        break;
      }
      this.append(r.value);
    }
  }

  /** Mix `count` output frames starting at clip-relative frame `offset` into dst. */
  async mixInto(dstL: Float32Array, dstR: Float32Array, dstOffset: number, offset: number, count: number, gain: number) {
    if (count <= 0) return;
    const lastOut = offset + count - 1;
    // srcRate is unknown before the first packet; fillTo handles that.
    await this.fillTo(this.srcRate ? (lastOut * this.srcRate) / this.outRate : 0);
    if (!this.srcRate) return; // no audio at all
    await this.fillTo((lastOut * this.srcRate) / this.outRate);
    const ratio = this.srcRate / this.outRate;
    const { bufL, bufR, bufStart, bufLen } = this;
    for (let i = 0; i < count; i++) {
      const p = (offset + i) * ratio - bufStart;
      const i0 = Math.floor(p);
      if (i0 < 0 || i0 >= bufLen) continue;
      const frac = p - i0;
      const i1 = i0 + 1 < bufLen ? i0 + 1 : i0;
      dstL[dstOffset + i] = dstL[dstOffset + i]! + (bufL[i0]! + (bufL[i1]! - bufL[i0]!) * frac) * gain;
      dstR[dstOffset + i] = dstR[dstOffset + i]! + (bufR[i0]! + (bufR[i1]! - bufR[i0]!) * frac) * gain;
    }
    this.dropBefore((offset + count) * ratio);
  }

  async close() {
    await this.iter?.return(undefined);
  }
}

/**
 * Mixes all audio clips of a timeline into consecutive stereo chunks.
 * `read` must be called with increasing, contiguous ranges.
 */
export class AudioMixer {
  private streams = new Map<AudioClipSpec, ClipAudioStream>();

  constructor(private readonly clips: AudioClipSpec[], readonly sampleRate: number) {}

  async read(startFrame: number, count: number): Promise<[Float32Array, Float32Array]> {
    const L = new Float32Array(count);
    const R = new Float32Array(count);
    const rate = this.sampleRate;
    const endFrame = startFrame + count;
    for (const clip of this.clips) {
      const cs = Math.round(clip.start * rate);
      const ce = Math.round((clip.start + clip.duration) * rate);
      const a = Math.max(cs, startFrame);
      const b = Math.min(ce, endFrame);
      if (b <= a) {
        if (ce <= startFrame && this.streams.has(clip)) {
          await this.streams.get(clip)!.close();
          this.streams.delete(clip);
        }
        continue;
      }
      let s = this.streams.get(clip);
      if (!s) {
        s = new ClipAudioStream(clip, rate);
        this.streams.set(clip, s);
      }
      await s.mixInto(L, R, a - startFrame, a - cs, b - a, clip.volume);
    }
    // Soft clip to avoid harsh distortion when sources sum above 0 dBFS.
    for (let i = 0; i < count; i++) {
      L[i] = softClip(L[i]!);
      R[i] = softClip(R[i]!);
    }
    return [L, R];
  }

  async close() {
    for (const s of this.streams.values()) await s.close();
    this.streams.clear();
  }
}

/** Linear below the knee, then a tanh curve that approaches but never exceeds ±1. */
function softClip(x: number): number {
  const KNEE = 0.9;
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  const y = KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
  return x < 0 ? -y : y;
}

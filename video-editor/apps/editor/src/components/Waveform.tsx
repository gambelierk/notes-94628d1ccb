import { useEffect, useRef, useState } from 'react';
import type { Peaks } from '@ve/media';
import { media } from '../services/media';

const MAX_CANVAS = 4096;

/**
 * Waveform for the part of a source that a clip plays: [sourceStart,
 * sourceStart + seconds]. Peaks are computed once per file and cached.
 */
export function Waveform({ assetId, sourceStart, seconds, width, height }: { assetId: string; sourceStart: number; seconds: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  useEffect(() => {
    let alive = true;
    void media.peaks(assetId).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [assetId]);

  const cssW = Math.max(1, Math.min(MAX_CANVAS, Math.round(width)));
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = cssW * dpr;
    c.height = Math.max(1, Math.round(height * dpr));
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(255, 255, 255, 0.6)';
    const mid = c.height / 2;
    const { data, bucketsPerSecond: bps } = peaks;
    const cols = c.width;
    for (let x = 0; x < cols; x++) {
      const t0 = sourceStart + (x / cols) * seconds;
      const t1 = sourceStart + ((x + 1) / cols) * seconds;
      let m = 0;
      for (let b = Math.floor(t0 * bps); b <= Math.floor(t1 * bps) && b < data.length; b++) if (b >= 0 && data[b]! > m) m = data[b]!;
      // perceptual scaling so quiet passages stay visible
      const h = Math.max(0.5, Math.sqrt(m) * mid * 0.95);
      g.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, cssW, height, sourceStart, seconds]);

  if (!peaks) return null;
  return <canvas ref={ref} className="waveform" style={{ width: cssW, height }} aria-hidden="true" />;
}

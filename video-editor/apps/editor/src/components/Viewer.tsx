import { useEffect, useRef } from 'react';
import { formatTimecode } from '@ve/core';
import { preview } from '../services/preview';
import { stepPlayhead } from '../state/actions';
import { useEditor, useProject, useProjectDuration } from '../state/store';
import { Pause, Play, SkipEnd, SkipStart, StepBack, StepFwd } from './Icons';
import { TransformOverlay } from './TransformOverlay';

export function Viewer() {
  const ref = useRef<HTMLCanvasElement>(null);
  const project = useProject();
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const duration = useProjectDuration();
  const { fps, width, height } = project.settings;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    void preview.attach(canvas);
    return () => preview.detach();
  }, []);

  return (
    <section className="panel viewer" aria-label="Förhandsvisning">
      <div className="stage">
        <canvas ref={ref} data-testid="preview-canvas" style={{ aspectRatio: `${width} / ${height}` }} />
        <TransformOverlay canvasRef={ref} />
        {duration === 0 && (
          <div className="stage-empty">
            <div>
              Importera en MP4 och dra in den på tidslinjen.
              <br />
              Lägg sedan på en mall från biblioteket.
            </div>
          </div>
        )}
      </div>
      <div className="transport">
        <span className="timecode" data-testid="timecode">
          {formatTimecode(playhead, fps)}
        </span>
        <div className="spacer" />
        <button className="btn ghost icon-btn" aria-label="Till början" onClick={() => useEditor.getState().setPlayhead(0)}>
          <SkipStart />
        </button>
        <button className="btn ghost icon-btn" aria-label="En bildruta bakåt" onClick={() => stepPlayhead(-1)}>
          <StepBack />
        </button>
        <button
          className="btn icon-btn play-btn"
          aria-label={playing ? 'Pausa' : 'Spela upp'}
          disabled={duration === 0}
          onClick={() => preview.toggle()}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="btn ghost icon-btn" aria-label="En bildruta framåt" onClick={() => stepPlayhead(1)}>
          <StepFwd />
        </button>
        <button
          className="btn ghost icon-btn"
          aria-label="Till slutet"
          onClick={() => useEditor.getState().setPlayhead(Math.max(0, duration - 1))}
        >
          <SkipEnd />
        </button>
        <div className="spacer" />
        <span className="mono dim viewer-format" data-testid="viewer-format">
          {width} × {height}
        </span>
        <span className="timecode dim">{formatTimecode(duration, fps)}</span>
      </div>
    </section>
  );
}


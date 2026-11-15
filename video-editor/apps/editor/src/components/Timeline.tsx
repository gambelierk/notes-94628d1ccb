import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import {
  addTrack,
  findAsset,
  formatTimecode,
  fpsValue,
  microsToFrames,
  moveClip,
  projectDuration,
  secondsToFrames,
  setTrackFlag,
  snap,
  snapPoints,
  evaluateParam,
  framesToSeconds,
  gainToDb,
  trackAcceptsClip,
  joints,
  jointRef,
  type Joint,
  type TransitionRef,
  trimClip,
  type Clip,
  type Frame,
  type Project,
  type Track,
} from '@ve/core';
import { addTransitionAt, deleteSelection, IMAGE_DEFAULT_SECONDS, setTrackGain, splitAtPlayhead, TEXT_DEFAULT_SECONDS } from '../state/actions';
import { Waveform } from './Waveform';
import { clipName } from '../lib/names';
import { committedProject, useEditor, useProject, type LibraryTemplate } from '../state/store';
import { preview } from '../services/preview';
import { Dissolve, Eye, EyeOff, FadeIn, FadeOut, Fit, Plus, Speaker, SpeakerOff, Split, Trash, ZoomIn, ZoomOut } from './Icons';

const ROW_H = 64;
const RULER_H = 28;
const SNAP_PX = 8;
const TICK_STEPS = [1 / 30, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function Timeline() {
  const project = useProject();
  const zoom = useEditor((s) => s.zoom);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const selection = useEditor((s) => s.selection);
  const drag = useEditor((s) => s.drag);
  const dropTarget = useEditor((s) => s.dropTarget);
  const thumbs = useEditor((s) => s.mediaThumbs);
  const templates = useEditor((s) => s.templates);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [snapLine, setSnapLine] = useState<Frame | null>(null);
  const selectedTransition = useEditor((s) => s.transition);
  const [snapping, setSnapping] = useState(true);

  const fps = project.settings.fps;
  const fv = fpsValue(fps);
  const pxPerFrame = zoom / fv;
  const duration = projectDuration(project);
  // Picture tracks top → bottom (topmost layer first), then sound tracks below them.
  const rows = useMemo(
    () => [...project.tracks.filter((t) => t.kind !== 'audio').reverse(), ...project.tracks.filter((t) => t.kind === 'audio')],
    [project.tracks],
  );
  const contentWidth = Math.max(view.width, ((duration / fv) + 20) * zoom);
  const xOf = (f: Frame) => f * pxPerFrame;

  // Keep the viewport size in sync for virtualised ticks.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameAtClientX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.round((clientX - r.left + el.scrollLeft) / pxPerFrame));
    },
    [pxPerFrame],
  );

  const rowAtClientY = useCallback(
    (clientY: number): Track | null => {
      const el = scrollRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const y = clientY - r.top + el.scrollTop - RULER_H;
      const i = Math.floor(y / ROW_H);
      return y >= 0 ? rows[i] ?? null : null;
    },
    [rows],
  );

  const snapFrame = useCallback(
    (f: Frame, points: Frame[]) => (snapping ? snap(f, points, SNAP_PX / pxPerFrame) : f),
    [snapping, pxPerFrame],
  );

  /* ---------------------------------------------- library drag → drop target */
  useEffect(() => {
    const store = useEditor.getState();
    if (!drag) return;
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const inside = drag.x >= r.left && drag.x <= r.right && drag.y >= r.top - 4 && drag.y <= r.bottom;
    if (!inside) {
      if (store.dropTarget) store.setDropTarget(null);
      setSnapLine(null);
      return;
    }
    const type = drag.payload.type;
    const kind = type === 'media' ? 'video' : type === 'audio' ? 'audio' : 'graphics';
    const row = rowAtClientY(drag.y);
    // images go on any picture track; video on video tracks, sound on audio tracks, the rest on graphics tracks
    const fits = !!row && (row.kind === kind || (type === 'image' && row.kind !== 'audio'));
    const track = fits ? row : nearestTrack(rows, kind, row);
    let dur: Frame;
    if (type === 'template') {
      const tpl = templates.find((t) => t.def.id === drag.payload.id);
      dur = secondsToFrames(tpl?.def.defaultDuration ?? 5, fps);
    } else if (type === 'image') {
      dur = secondsToFrames(IMAGE_DEFAULT_SECONDS, fps);
    } else if (type === 'text') {
      dur = secondsToFrames(TEXT_DEFAULT_SECONDS, fps);
    } else {
      const a = findAsset(project, drag.payload.id);
      dur = a && (a.kind === 'video' || a.kind === 'audio') ? microsToFrames(a.durationUs, fps) : secondsToFrames(5, fps);
    }
    const pts = [...snapPoints(committedProject()), useEditor.getState().playhead];
    const raw = frameAtClientX(drag.x);
    const s1 = snapFrame(raw, pts);
    const s2 = snapFrame(raw + dur, pts) - dur;
    const frame = Math.max(0, s1 !== raw ? s1 : s2 !== raw ? s2 : raw);
    setSnapLine(frame !== raw ? (s1 !== raw ? s1 : s2 + dur) : null);
    store.setDropTarget({ trackId: track?.id ?? null, frame, duration: dur });
  }, [drag, rows, templates, project, fps, frameAtClientX, rowAtClientY, snapFrame]);

  /* ---------------------------------------------- ruler scrubbing */
  const onRulerDown = (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (useEditor.getState().playing) preview.pause();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const set = (x: number) => useEditor.getState().setPlayhead(frameAtClientX(x));
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /* ---------------------------------------------- clip move / trim */
  const onClipDown = (e: RPE<HTMLElement>, clip: Clip, mode: 'move' | 'l' | 'r') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = useEditor.getState();
    store.select(clip.id);
    const base = committedProject();
    // Listen on window: the clip element may re-mount in another track row while dragging.
    const target = window;
    const grab = frameAtClientX(e.clientX) - clip.start;
    // for trims: how far from the edge the handle was grabbed, so the edge follows the pointer without jumping
    const edgeGrab = frameAtClientX(e.clientX) - (mode === 'r' ? clip.start + clip.duration : clip.start);
    const pts = [...snapPoints(base, clip.id), store.playhead];
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      moved = true;
      let next: Project = base;
      let line: Frame | null = null;
      if (mode === 'move') {
        const raw = frameAtClientX(ev.clientX) - grab;
        const s1 = snapFrame(raw, pts);
        const s2 = snapFrame(raw + clip.duration, pts) - clip.duration;
        const start = s1 !== raw ? s1 : s2 !== raw ? s2 : raw;
        if (s1 !== raw) line = s1;
        else if (s2 !== raw) line = s2 + clip.duration;
        const row = rowAtClientY(ev.clientY);
        const trackId = row && trackAcceptsClip(row, clip) ? row.id : trackOf(base, clip.id)!;
        next = moveClip(base, clip.id, trackId, start);
      } else {
        const raw = frameAtClientX(ev.clientX) - edgeGrab;
        const f = snapFrame(raw, pts);
        if (f !== raw) line = f;
        next = trimClip(base, clip.id, mode === 'l' ? 'start' : 'end', f);
      }
      setSnapLine(line);
      store.setDraft(next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setSnapLine(null);
      if (moved) useEditor.getState().commitDraft(mode === 'move' ? 'Flytta klipp' : 'Trimma klipp');
      else store.setDraft(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  /* ---------------------------------------------- zoom */
  const zoomTo = useCallback((z: number, anchorClientX?: number) => {
    const el = scrollRef.current;
    const s = useEditor.getState();
    if (!el) return s.setZoom(z);
    const r = el.getBoundingClientRect();
    const ax = anchorClientX !== undefined ? anchorClientX - r.left : el.clientWidth / 2;
    const timeAtAnchor = (el.scrollLeft + ax) / s.zoom;
    s.setZoom(z);
    requestAnimationFrame(() => {
      el.scrollLeft = timeAtAnchor * useEditor.getState().zoom - ax;
    });
  }, []);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el || duration === 0) return;
    useEditor.getState().setZoom(((el.clientWidth - 40) * fv) / duration);
    el.scrollLeft = 0;
  }, [duration, fv]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(useEditor.getState().zoom * Math.exp(-e.deltaY * 0.002), e.clientX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  useEffect(() => {
    const onKey = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      if (d === 0) fit();
      else zoomTo(useEditor.getState().zoom * (d > 0 ? 1.25 : 0.8));
    };
    window.addEventListener('timeline-zoom', onKey);
    return () => window.removeEventListener('timeline-zoom', onKey);
  }, [fit, zoomTo]);

  // Follow the playhead while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = xOf(playhead);
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 40);
  });

  /* ---------------------------------------------- ruler ticks */
  const ticks = useMemo(() => {
    const step = TICK_STEPS.find((s) => s * zoom >= 90) ?? 600;
    const minor = step / (step >= 1 && step % 5 === 0 ? 5 : 4);
    const t0 = Math.floor(view.left / zoom / step) * step;
    const t1 = (view.left + view.width) / zoom + step;
    const out: { x: number; label?: string }[] = [];
    for (let t = t0; t <= t1; t += step) {
      out.push({ x: t * zoom, label: tickLabel(t, step, fps) });
      for (let m = minor; m < step - 1e-9; m += minor) out.push({ x: (t + m) * zoom });
    }
    return out;
  }, [zoom, view, fps]);

  const selClip = selection;
  return (
    <section className="timeline" aria-label="Tidslinje" style={{ ['--row-h' as string]: `${ROW_H}px` }}>
      <div className="tl-toolbar">
        <button className="btn ghost" onClick={splitAtPlayhead} title="Dela vid spelhuvudet (S)">
          <Split /> Dela
        </button>
        <button className="btn ghost" onClick={() => deleteSelection(false)} disabled={!selClip && !selectedTransition} title="Ta bort markerat klipp eller övergång (Delete/Backspace)">
          <Trash /> Ta bort
        </button>
        <span className="sep" />
        <button
          className="btn ghost"
          aria-pressed={snapping}
          onClick={() => setSnapping((v) => !v)}
          title="Fäst mot kanter och spelhuvud"
          style={{ color: snapping ? 'var(--text)' : 'var(--muted)' }}
        >
          Fäst {snapping ? 'på' : 'av'}
        </button>
        <button
          className="btn ghost"
          onClick={() => useEditor.getState().apply((p) => addTrack(p, 'graphics'), 'Nytt grafikspår')}
          title="Lägg till ett grafikspår"
        >
          <Plus /> Grafikspår
        </button>
        <button
          className="btn ghost"
          onClick={() => useEditor.getState().apply((p) => addTrack(p, 'audio'), 'Nytt ljudspår')}
          title="Lägg till ett ljudspår för musik, speakerröst eller effekter"
        >
          <Plus /> Ljudspår
        </button>
        <div className="spacer" />
        <span className="timecode dim" style={{ minWidth: 0, marginRight: 8 }}>
          {formatTimecode(playhead, fps)}
        </span>
        <button className="btn ghost icon-btn" aria-label="Zooma ut" onClick={() => zoomTo(zoom * 0.8)}>
          <ZoomOut />
        </button>
        <button className="btn ghost icon-btn" aria-label="Zooma in" onClick={() => zoomTo(zoom * 1.25)}>
          <ZoomIn />
        </button>
        <button className="btn ghost icon-btn" aria-label="Anpassa till fönstret" onClick={fit}>
          <Fit />
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-headers" ref={headersRef}>
          <div className="tl-header-ruler" />
          {rows.map((t) => (
            <TrackHeader key={t.id} track={t} />
          ))}
        </div>
        <div
          className="tl-scroll"
          ref={scrollRef}
          data-testid="timeline-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            setView({ left: el.scrollLeft, width: el.clientWidth });
            if (headersRef.current) headersRef.current.scrollTop = el.scrollTop;
          }}
        >
          <div className="tl-content" style={{ width: contentWidth }}>
            <div className="tl-ruler" onPointerDown={onRulerDown} data-testid="timeline-ruler">
              {ticks.map((t, i) => (
                <div key={i} className={`tl-tick${t.label ? '' : ' minor'}`} style={{ left: t.x }}>
                  {t.label && <span>{t.label}</span>}
                </div>
              ))}
            </div>
            {rows.map((track) => (
              <div
                key={track.id}
                className={`tl-row ${track.kind}${dropTarget?.trackId === track.id ? ' drop-ok' : ''}`}
                data-track-id={track.id}
                data-track-kind={track.kind}
                onPointerDown={() => useEditor.getState().select(null)}
              >
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    project={project}
                    x={xOf(clip.start)}
                    w={Math.max(2, xOf(clip.duration))}
                    selected={clip.id === selection}
                    thumb={clip.kind === 'video' || clip.kind === 'image' ? thumbs[clip.assetId] : undefined}
                    pxPerFrame={pxPerFrame}
                    templateName={clip.kind === 'template' ? templates.find((t) => t.def.id === clip.templateId)?.def.name : undefined}
                    onDown={onClipDown}
                  />
                ))}
                <TrackJoints
                  track={track}
                  project={project}
                  templates={templates}
                  pxPerFrame={pxPerFrame}
                  selected={selectedTransition}
                />
                {dropTarget?.trackId === track.id && (
                  <div className="drop-ghost" style={{ left: xOf(dropTarget.frame), width: xOf(dropTarget.duration) }} />
                )}
              </div>
            ))}
            {snapLine !== null && <div className="snap-line" style={{ left: xOf(snapLine) }} />}
            <div className="playhead" style={{ left: xOf(playhead) }} />
            {duration === 0 && !drag && <div className="tl-empty">Dra in film, bilder, ljud, text och mallar hit</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Highlight the clip ends a transition button would affect. Done directly on
 * the DOM (a data attribute React doesn't manage) so hovering never
 * re-renders the timeline.
 */
function highlightEdges(button: HTMLElement, j: Joint | null): void {
  const row = button.closest('.tl-row');
  if (!row) return;
  for (const el of row.querySelectorAll<HTMLElement>('.clip[data-hi]')) delete el.dataset.hi;
  if (!j) return;
  const mark = (id: string, side: 'l' | 'r') => {
    const el = row.querySelector<HTMLElement>(`.clip[data-clip-id="${CSS.escape(id)}"]`);
    if (el) el.dataset.hi = el.dataset.hi && el.dataset.hi !== side ? 'lr' : side;
  };
  if (j.kind === 'cut') {
    mark(j.leftId, 'r');
    mark(j.rightId, 'l');
  } else mark(j.clipId, j.kind === 'start' ? 'l' : 'r');
}

/**
 * Transition buttons at every cut and free clip end (shown when hovering the
 * track), and markers for existing transitions (click to select).
 */
function TrackJoints(props: {
  track: Track;
  project: Project;
  templates: LibraryTemplate[];
  pxPerFrame: number;
  selected: TransitionRef | null;
}) {
  const { track, project, templates, pxPerFrame: k, selected } = props;
  const byId = (id: string) => track.clips.find((c) => c.id === id);
  const fps = project.settings.fps;
  const js = useMemo(() => joints(track), [track]);
  return (
    <>
      {js.map((j) => {
        const ref = jointRef(j);
        const key = `${j.kind}-${j.frame}`;
        if (j.duration !== null) {
          // existing transition: a selectable marker over the affected frames
          const d = j.duration;
          const left = j.kind === 'cut' ? j.frame - Math.floor(d / 2) : j.kind === 'start' ? j.frame : j.frame - d;
          const isSel = selected?.clipId === ref.clipId && selected.edge === ref.edge;
          const label = j.kind === 'cut' ? 'Övertoning' : j.kind === 'start' ? 'Tona in från svart' : 'Tona ut till svart';
          return (
            <button
              key={key}
              className={`tl-transition ${j.kind}${isSel ? ' selected' : ''}`}
              style={{ left: left * k, width: Math.max(10, d * k) }}
              data-testid={`transition-${j.kind}`}
              aria-label={`${label}, ${framesToSeconds(d, fps).toFixed(1).replace('.', ',')} s`}
              aria-pressed={isSel}
              title={`${label} · ${framesToSeconds(d, fps).toFixed(2)} s`}
              onPointerDown={(e) => {
                e.stopPropagation();
                useEditor.getState().selectTransition(ref);
              }}
            >
              {j.kind === 'cut' ? <Dissolve /> : j.kind === 'start' ? <FadeIn /> : <FadeOut />}
            </button>
          );
        }
        const label =
          j.kind === 'cut'
            ? `Lägg till övertoning mellan ${clipName(project, byId(j.leftId), templates)} och ${clipName(project, byId(j.rightId), templates)}`
            : j.kind === 'start'
              ? `Tona in ${clipName(project, byId(j.clipId), templates)} från svart`
              : `Tona ut ${clipName(project, byId(j.clipId), templates)} till svart`;
        return (
          <button
            key={key}
            className={`tl-joint ${j.kind}`}
            style={{ left: j.frame * k }}
            data-testid={`joint-${j.kind}`}
            aria-label={label}
            title={label}
            onPointerEnter={(e) => highlightEdges(e.currentTarget, j)}
            onPointerLeave={(e) => highlightEdges(e.currentTarget, null)}
            onFocus={(e) => highlightEdges(e.currentTarget, j)}
            onBlur={(e) => highlightEdges(e.currentTarget, null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              highlightEdges(e.currentTarget, null);
              addTransitionAt(j);
            }}
          >
            {j.kind === 'cut' ? <Dissolve /> : j.kind === 'start' ? <FadeIn /> : <FadeOut />}
          </button>
        );
      })}
    </>
  );
}

function nearestTrack(rows: Track[], kind: Track['kind'], hovered: Track | null): Track | null {
  const candidates = rows.filter((t) => t.kind === kind);
  if (!hovered) return candidates[0] ?? null;
  const hi = rows.indexOf(hovered);
  let best: Track | null = null;
  let bd = Infinity;
  for (const c of candidates) {
    const d = Math.abs(rows.indexOf(c) - hi);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function trackOf(p: Project, clipId: string): string | undefined {
  return p.tracks.find((t) => t.clips.some((c) => c.id === clipId))?.id;
}

function tickLabel(t: number, step: number, fps: Project['settings']['fps']): string {
  if (step < 1) return formatTimecode(secondsToFrames(t, fps), fps).slice(3);
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function TrackHeader({ track }: { track: Track }) {
  const apply = useEditor((s) => s.apply);
  const sound = track.kind === 'video' || track.kind === 'audio';
  const vol = track.volume ? evaluateParam(track.volume) : 1;
  const kindLabel = track.kind === 'video' ? 'Video' : track.kind === 'audio' ? 'Ljud' : track.role === 'subtitles' ? 'Undertext' : 'Grafik';
  return (
    <div className={`tl-track-head ${track.kind}`} data-track-head={track.id}>
      <div className="tl-track-top">
        <span className="tl-track-name">{track.name}</span>
        <span className="tl-track-kind">{kindLabel}</span>
        {sound && (
          <button
            className="tl-toggle"
            aria-pressed={track.muted}
            aria-label={track.muted ? `Slå på ljud för ${track.name}` : `Stäng av ljud för ${track.name}`}
            onClick={() => apply((p) => setTrackFlag(p, track.id, 'muted', !track.muted), 'Ljud av/på')}
          >
            {track.muted ? <SpeakerOff /> : <Speaker />}
          </button>
        )}
        {track.kind !== 'audio' && (
          <button
            className="tl-toggle"
            aria-pressed={track.hidden}
            aria-label={track.hidden ? `Visa ${track.name}` : `Dölj ${track.name}`}
            onClick={() => apply((p) => setTrackFlag(p, track.id, 'hidden', !track.hidden), 'Visa/dölj spår')}
          >
            {track.hidden ? <EyeOff /> : <Eye />}
          </button>
        )}
      </div>
      {sound && (
        <label className="tl-track-vol" title={`Spårvolym ${gainToDb(vol)}`}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={vol}
            aria-label={`Volym för spår ${track.name}`}
            disabled={track.muted}
            onChange={(e) => setTrackGain(track.id, Number(e.target.value))}
            onDoubleClick={() => setTrackGain(track.id, 1)}
          />
          <span className="mono">{Math.round(vol * 100)}%</span>
        </label>
      )}
    </div>
  );
}

function ClipView(props: {
  clip: Clip;
  project: Project;
  x: number;
  w: number;
  selected: boolean;
  thumb?: string;
  templateName?: string;
  pxPerFrame: number;
  onDown: (e: RPE<HTMLElement>, clip: Clip, mode: 'move' | 'l' | 'r') => void;
}) {
  const { clip, project, x, w, selected, thumb, templateName, onDown } = props;
  const fps = project.settings.fps;
  let label: string;
  let sub: string | null = null;
  let missing = false;
  let wave: { assetId: string; sourceStart: number } | null = null;
  if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') {
    const a = findAsset(project, clip.assetId);
    label = a?.name ?? 'Saknad fil';
    missing = !a;
    if (clip.kind === 'audio' || (clip.kind === 'video' && a?.kind === 'video' && a.hasAudio)) {
      wave = { assetId: clip.assetId, sourceStart: clip.sourceStart / 1_000_000 };
    }
  } else if (clip.kind === 'text') {
    label = clip.text.split('\n')[0] || 'Text';
    sub = clip.text.includes('\n') ? clip.text.split('\n').slice(1).join(' ') : null;
  } else {
    label = templateName ?? clip.templateId;
    missing = !templateName;
    const firstText = Object.values(clip.props).find((p) => p.value.type === 'string' && p.value.value.trim());
    sub = firstText && firstText.value.type === 'string' ? firstText.value.value : null;
  }
  return (
    <div
      className={`clip ${clip.kind}${selected ? ' selected' : ''}${missing ? ' missing' : ''}`}
      style={{ left: x, width: w }}
      data-clip-id={clip.id}
      data-testid={`clip-${clip.kind}`}
      title={label}
      onPointerDown={(e) => onDown(e, clip, 'move')}
    >
      {(clip.kind === 'video' || clip.kind === 'image') && thumb && <div className="clip-strip" style={{ backgroundImage: `url(${thumb})` }} />}
      {wave && (
        <div className={`clip-wave${clip.kind === 'video' ? ' under' : ''}`}>
          <Waveform
            assetId={wave.assetId}
            sourceStart={wave.sourceStart}
            seconds={framesToSeconds(clip.duration, fps)}
            width={w}
            height={clip.kind === 'audio' ? 38 : 16}
          />
        </div>
      )}
      <div className="clip-edge-hi l" />
      <div className="clip-edge-hi r" />
      <span className="clip-label">{label}</span>
      {sub && <span className="clip-sub">{sub}</span>}
      <div className="clip-handle l" onPointerDown={(e) => onDown(e, clip, 'l')} />
      <div className="clip-handle r" onPointerDown={(e) => onDown(e, clip, 'r')} />
    </div>
  );
}

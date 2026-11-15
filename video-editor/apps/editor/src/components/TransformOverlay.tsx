import { useEffect, useLayoutEffect, useState, type PointerEvent as RPE, type RefObject } from 'react';
import {
  activeClipsAt,
  coverScale,
  findClip,
  hitTest,
  setClipTransform,
  transformAt,
  type Clip,
  type Placement,
  type TransformValues,
} from '@ve/core';
import { clipPlacement, sourceSize } from '../lib/placement';
import { preview } from '../services/preview';
import { committedProject, useEditor, useProject } from '../state/store';

const SNAP_PX = 8; // screen pixels
const MIN_SCALE = 0.02;
const MAX_SCALE = 20;

interface Guides {
  v: number[]; // x positions in frame px
  h: number[];
}

/**
 * Direct manipulation over the viewer: click a layer to select it, drag to
 * move, drag corners to scale, drag the top handle to rotate. Snaps to the
 * frame centre and edges (hold Shift to disable). Edits go through the
 * draft project so the preview updates live and undo gets one step.
 */
export function TransformOverlay({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const project = useProject();
  const templates = useEditor((s) => s.templates);
  const selection = useEditor((s) => s.selection);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [guides, setGuides] = useState<Guides | null>(null);
  const { width: W, height: H } = project.settings;

  // Track where the canvas is drawn inside the stage.
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const update = () => setRect({ left: c.offsetLeft, top: c.offsetTop, width: c.offsetWidth, height: c.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    ro.observe(c.parentElement!);
    return () => ro.disconnect();
  }, [canvasRef]);
  useEffect(() => {
    const c = canvasRef.current;
    if (c) setRect({ left: c.offsetLeft, top: c.offsetTop, width: c.offsetWidth, height: c.offsetHeight });
  }, [W, H, canvasRef]);

  const k = rect.width / W; // screen px per frame px
  const active = activeClipsAt(project, playhead);
  const selected = selection ? active.find((a) => a.clip.id === selection)?.clip : undefined;
  const placement = selected ? clipPlacement(project, selected, templates) : null;

  const toFrame = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  /** Start a drag gesture; `update` returns the new transform for a pointer position. */
  const gesture = (e: RPE, clip: Clip, label: string, update: (p: { x: number; y: number }, ev: PointerEvent) => Partial<TransformValues>) => {
    e.preventDefault();
    e.stopPropagation();
    if (useEditor.getState().playing) preview.pause();
    const layer = (e.currentTarget as Element).closest('.xf-layer')!;
    const base = committedProject();
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const patch = update(toFrame(ev, layer), ev);
      useEditor.getState().setDraft(setClipTransform(base, clip.id, patch));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setGuides(null);
      if (moved) useEditor.getState().commitDraft(label);
      else useEditor.getState().setDraft(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const startMove = (e: RPE, clip: Clip) => {
    const layer = (e.currentTarget as Element).closest('.xf-layer')!;
    const p0 = toFrame(e, layer);
    const t0 = transformAt(clip);
    const pl0 = clipPlacement(committedProject(), clip, templates);
    if (!pl0) return;
    gesture(e, clip, 'Flytta', (p, ev) => {
      let cx = pl0.cx + (p.x - p0.x);
      let cy = pl0.cy + (p.y - p0.y);
      const g: Guides = { v: [], h: [] };
      if (!ev.shiftKey) {
        const tol = SNAP_PX / k;
        const flat = pl0.rotation % 360 === 0;
        const snapAxis = (c: number, size: number, frame: number, out: number[]) => {
          const cands: Array<[number, number]> = [[frame / 2, frame / 2]]; // centre → centre line
          if (flat) cands.push([size / 2, 0], [frame - size / 2, frame]); // edges → frame edges
          for (const [target, line] of cands)
            if (Math.abs(c - target) < tol) {
              out.push(line);
              return target;
            }
          return c;
        };
        cx = snapAxis(cx, pl0.w, W, g.v);
        cy = snapAxis(cy, pl0.h, H, g.h);
      }
      setGuides(g.v.length || g.h.length ? g : null);
      // translate the change in centre into the normalised offset
      return { x: t0.x + (cx - pl0.cx) / W, y: t0.y + (cy - pl0.cy) / H };
    });
  };

  const startScale = (e: RPE, clip: Clip) => {
    const layer = (e.currentTarget as Element).closest('.xf-layer')!;
    const pl0 = clipPlacement(committedProject(), clip, templates);
    if (!pl0) return;
    const p0 = toFrame(e, layer);
    const d0 = Math.hypot(p0.x - pl0.cx, p0.y - pl0.cy) || 1;
    const t0 = transformAt(clip);
    const src = sourceSize(committedProject(), clip, templates);
    const cover = src && clip.kind !== 'template' ? coverScale(src.w, src.h, W, H) : null;
    gesture(e, clip, 'Skala', (p, ev) => {
      let s = (t0.scale * Math.hypot(p.x - pl0.cx, p.y - pl0.cy)) / d0;
      s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
      if (!ev.shiftKey) {
        for (const target of [1, cover].filter((x): x is number => x !== null)) if (Math.abs(s - target) / target < 0.03) s = target;
      }
      return { scale: s };
    });
  };

  const startRotate = (e: RPE, clip: Clip) => {
    const layer = (e.currentTarget as Element).closest('.xf-layer')!;
    const pl0 = clipPlacement(committedProject(), clip, templates);
    if (!pl0) return;
    gesture(e, clip, 'Rotera', (p, ev) => {
      let deg = (Math.atan2(p.y - pl0.cy, p.x - pl0.cx) * 180) / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      if (!ev.shiftKey) for (const t of [0, 90, 180, 270, 360]) if (Math.abs(deg - t) < 4) deg = t % 360;
      return { rotation: Math.round(deg * 10) / 10 };
    });
  };

  // Click on the picture: select the top-most layer under the pointer and start moving it.
  const onLayerDown = (e: RPE) => {
    if (e.button !== 0) return;
    const p = toFrame(e, e.currentTarget);
    const hit = [...active].reverse().find(({ clip }) => {
      const pl = clipPlacement(project, clip, templates);
      return pl && hitTest(pl, p.x, p.y);
    });
    const s = useEditor.getState();
    if (!hit) {
      s.select(null);
      return;
    }
    s.select(hit.clip.id);
    startMove(e, hit.clip);
  };

  if (rect.width === 0 || playing) return null;
  const sel = selected && placement ? { clip: selected, p: placement } : null;

  return (
    <div
      className="xf-layer"
      data-testid="transform-layer"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={onLayerDown}
    >
      {guides?.v.map((x) => <div key={`v${x}`} className="xf-guide v" style={{ left: x * k }} />)}
      {guides?.h.map((y) => <div key={`h${y}`} className="xf-guide h" style={{ top: y * k }} />)}
      {sel && <Box p={sel.p} k={k} clip={sel.clip} onMove={startMove} onScale={startScale} onRotate={startRotate} />}
    </div>
  );
}

function Box(props: {
  p: Placement;
  k: number;
  clip: Clip;
  onMove: (e: RPE, c: Clip) => void;
  onScale: (e: RPE, c: Clip) => void;
  onRotate: (e: RPE, c: Clip) => void;
}) {
  const { p, k, clip } = props;
  const w = p.w * k;
  const h = p.h * k;
  return (
    <div
      className="xf-box"
      data-testid="transform-box"
      style={{ left: p.cx * k - w / 2, top: p.cy * k - h / 2, width: w, height: h, transform: `rotate(${p.rotation}deg)` }}
      onPointerDown={(e) => props.onMove(e, clip)}
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
        <div key={c} className={`xf-handle ${c}`} data-handle={c} onPointerDown={(e) => props.onScale(e, clip)} />
      ))}
      {clip.kind !== 'template' && (
        <div className="xf-rotate" data-handle="rotate" title="Rotera (Shift: fritt)" onPointerDown={(e) => props.onRotate(e, clip)} />
      )}
    </div>
  );
}

/** Used by tests and keyboard nudging: the selected clip's placement. */
export function selectedPlacement(): Placement | null {
  const s = useEditor.getState();
  const p = s.draft ?? s.history.present.project;
  const f = s.selection ? findClip(p, s.selection) : undefined;
  return f ? clipPlacement(p, f.clip, s.templates) : null;
}

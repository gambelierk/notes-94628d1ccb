import type { PointerEvent as ReactPointerEvent } from 'react';
import { addTemplateToTimeline, addVideoToTimeline } from '../state/actions';
import { useEditor, type DragPayload } from '../state/store';

const DRAG_THRESHOLD = 4;

/**
 * Pointer-based drag from the library onto the timeline. Pointer events
 * (not HTML5 drag-and-drop) give us full control over snapping and a live
 * drop preview. The timeline reports the drop target into the store; on
 * release we insert there.
 */
export function startLibraryDrag(e: ReactPointerEvent, payload: DragPayload) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let active = false;
  const store = useEditor.getState();

  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
    active = true;
    store.setDrag({ payload, x: ev.clientX, y: ev.clientY });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    const { dropTarget } = useEditor.getState();
    store.setDrag(null);
    store.setDropTarget(null);
    if (!active || !dropTarget) return;
    if (payload.type === 'template') addTemplateToTimeline(payload.id, dropTarget.trackId, dropTarget.frame);
    else addVideoToTimeline(payload.id, dropTarget.trackId, dropTarget.frame);
  };
  const cancel = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    store.setDrag(null);
    store.setDropTarget(null);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

import { useEffect, useState } from 'react';
import { canRedo, canUndo } from '@ve/core';
import { ExportDialog } from './components/ExportDialog';
import { Download, Logo, Redo, Undo } from './components/Icons';
import { Inspector } from './components/Inspector';
import { LeftPanel } from './components/LeftPanel';
import { Timeline } from './components/Timeline';
import { Viewer } from './components/Viewer';
import { preview } from './services/preview';
import { templates } from './services/templates';
import { deleteSelection, importFiles, splitAtPlayhead, stepPlayhead } from './state/actions';
import { useEditor, useProjectDuration } from './state/store';

export function App() {
  useEffect(() => {
    void templates.loadBuiltIns();
  }, []);
  useKeyboard();
  const fileDrag = useWindowFileDrop();

  return (
    <div className="app">
      <TopBar />
      <LeftPanel />
      <Viewer />
      <Inspector />
      <Timeline />
      <ExportDialog />
      <DragGhost />
      <Toasts />
      {fileDrag && <div className="file-drop-overlay">Släpp för att importera</div>}
    </div>
  );
}

function TopBar() {
  const history = useEditor((s) => s.history);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const duration = useProjectDuration();
  const name = useEditor((s) => s.history.present.project.name);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Logo width={16} height={16} />
        </span>
        Klipp
      </div>
      <span className="project-name">{name}</span>
      <div className="spacer" />
      <button className="btn ghost icon-btn" aria-label="Ångra" title={`Ångra ${history.present.label}`} disabled={!canUndo(history)} onClick={undo}>
        <Undo />
      </button>
      <button className="btn ghost icon-btn" aria-label="Gör om" disabled={!canRedo(history)} onClick={redo}>
        <Redo />
      </button>
      <button className="btn primary" disabled={duration === 0} onClick={() => useEditor.getState().setExportOpen(true)}>
        <Download /> Exportera
      </button>
    </header>
  );
}

function DragGhost() {
  const drag = useEditor((s) => s.drag);
  if (!drag) return null;
  return (
    <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
      <div className={`thumb${drag.payload.type === 'media' ? ' video' : ''}`}>{drag.payload.thumbnail && <img src={drag.payload.thumbnail} alt="" />}</div>
      <div className="label">{drag.payload.label}</div>
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => useEditor.getState().dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping(e)) return; // let inputs undo their own text
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e) || s.exportOpen) return;
      const fps = s.history.present.project.settings.fps;
      const second = Math.round(fps.num / fps.den);
      switch (e.key) {
        case ' ':
          e.preventDefault();
          preview.toggle();
          break;
        case 's':
        case 'S':
          if (!mod) splitAtPlayhead();
          break;
        case 'k':
          if (mod) {
            e.preventDefault();
            splitAtPlayhead();
          }
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelection(e.shiftKey);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepPlayhead(e.shiftKey ? -second : -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepPlayhead(e.shiftKey ? second : 1);
          break;
        case 'Home':
          s.setPlayhead(0);
          break;
        case 'End':
          stepPlayhead(Number.MAX_SAFE_INTEGER);
          break;
        case 'Escape':
          s.select(null);
          break;
        case '+':
        case '=':
          window.dispatchEvent(new CustomEvent('timeline-zoom', { detail: 1 }));
          break;
        case '-':
          window.dispatchEvent(new CustomEvent('timeline-zoom', { detail: -1 }));
          break;
        case '\\':
          window.dispatchEvent(new CustomEvent('timeline-zoom', { detail: 0 }));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Accept files dropped anywhere in the window. */
function useWindowFileDrop(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      void importFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}

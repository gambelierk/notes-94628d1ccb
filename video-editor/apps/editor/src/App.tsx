import { useEffect, useState } from 'react';
import { canRedo, canUndo, createProject, projectDuration } from '@ve/core';
import { CreateDialog } from './components/FormatPicker';
import { ExportDialog } from './components/ExportDialog';
import { Download, Logo, Plus, Redo, Undo } from './components/Icons';
import { Inspector } from './components/Inspector';
import { LeftPanel } from './components/LeftPanel';
import { Timeline } from './components/Timeline';
import { Viewer } from './components/Viewer';
import { ApiError } from './services/api';
import { composition } from './services/composition';
import { preview } from './services/preview';
import { templates, type LibrarySource } from './services/templates';
import { deleteSelection, importFiles, splitAtPlayhead, stepPlayhead } from './state/actions';
import { useEditor, useProjectDuration } from './state/store';

export function App({ source, compositionId }: { source: LibrarySource; compositionId?: string }) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(!compositionId);
  useEffect(() => {
    void templates.loadLibrary(source);
  }, [source]);
  useEffect(() => {
    if (!compositionId || source.kind !== 'share') return;
    composition
      .open(source.token, compositionId)
      .then(() => setReady(true))
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'Kompositionen finns inte (den kan ha tagits bort).' : String(e?.message ?? e)));
    return () => composition.close();
  }, [source, compositionId]);
  useKeyboard();
  const fileDrag = useWindowFileDrop();
  const library = useEditor((s) => s.library);

  if (library.kind === 'error' || loadError) {
    return (
      <div className="unsupported" role="alert">
        <h1>{library.kind === 'error' ? 'Länken fungerar inte' : 'Kunde inte öppna kompositionen'}</h1>
        <p>{library.kind === 'error' ? library.message : loadError}</p>
        {source.kind === 'share' && library.kind !== 'error' && (
          <a className="btn" href={`/p/${source.token}`}>
            Till kompositionerna
          </a>
        )}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="unsupported">
        <div className="spinner" /> <span className="mono">Öppnar komposition…</span>
      </div>
    );
  }

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
      <ConflictBanner />
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
  const library = useEditor((s) => s.library);
  const comp = useEditor((s) => s.composition);
  return (
    <header className="topbar">
      {comp ? (
        <a
          className="btn ghost back-link"
          href={`/p/${comp.token}`}
          onClick={async (e) => {
            e.preventDefault();
            const href = e.currentTarget.href;
            await composition.flush();
            void composition.uploadThumbnail().finally(() => (location.href = href));
          }}
        >
          ← Kompositioner
        </a>
      ) : (
        <div className="brand">
          <span className="brand-mark">
            <Logo width={16} height={16} />
          </span>
          Klipp
        </div>
      )}
      {library.kind === 'share' && (
        <span className="project-name" data-testid="customer-name">
          {library.name}
        </span>
      )}
      {comp ? <CompositionName key={comp.id} name={comp.name} /> : library.kind !== 'share' && <span className="project-name">{name}</span>}
      {comp && <SaveIndicator />}
      <div className="spacer" />
      {!comp && <CreateButton />}
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

/** Demo editor: start a new (unsaved) film in a chosen format. */
function CreateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <Plus /> Skapa
      </button>
      {open && (
        <CreateDialog
          title="Skapa ny film"
          onClose={() => setOpen(false)}
          onCreate={(name, size) => {
            const s = useEditor.getState();
            if (projectDuration(s.history.present.project) > 0 && !confirm('Börja om med en tom tidslinje? Det nuvarande projektet sparas inte.')) return;
            preview.pause();
            s.loadProject(createProject(name, { width: size.width, height: size.height, autoFormat: false }));
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function CompositionName({ name }: { name: string }) {
  const [v, setV] = useState(name);
  return (
    <input
      className="comp-name"
      aria-label="Kompositionens namn"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() ? void composition.rename(v.trim()) : setV(name))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setV(name);
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

function SaveIndicator() {
  const st = useEditor((s) => s.saveState);
  const uploads = useEditor((s) => s.uploads.length);
  let text: string;
  switch (st.kind) {
    case 'saved':
      text = st.at ? `Sparat ${new Date(st.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : 'Sparat';
      break;
    case 'dirty':
      text = 'Ändrat…';
      break;
    case 'saving':
      text = 'Sparar…';
      break;
    case 'error':
      text = `Kunde inte spara – försöker igen`;
      break;
    case 'conflict':
      text = 'Konflikt';
      break;
  }
  return (
    <span className={`save-state ${st.kind}`} data-testid="save-state" role="status" title={st.kind === 'error' ? st.message : undefined}>
      {uploads > 0 ? `Laddar upp ${uploads} fil${uploads > 1 ? 'er' : ''}… · ` : ''}
      {text}
    </span>
  );
}

function ConflictBanner() {
  const st = useEditor((s) => s.saveState);
  if (st.kind !== 'conflict') return null;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-labelledby="conflict-h">
        <h2 id="conflict-h">Kompositionen har ändrats i ett annat fönster</h2>
        <p className="hint">Dina senaste ändringar här är inte sparade. Välj vilken version som ska gälla.</p>
        <div className="modal-actions">
          <button className="btn" onClick={() => void composition.resolveConflict('reload')}>
            Ladda den andra versionen
          </button>
          <button className="btn primary" onClick={() => void composition.resolveConflict('overwrite')}>
            Behåll min version
          </button>
        </div>
      </div>
    </div>
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { microsToSeconds, type TemplateDefinition, type VideoAsset } from '@ve/core';
import type { TemplateRenderer } from '@ve/rive';
import { startLibraryDrag } from '../lib/drag';
import { addTemplateToTimeline, addVideoToTimeline, importFiles } from '../state/actions';
import { useEditor, useProject, type LibraryTemplate } from '../state/store';
import { templates as templateService } from '../services/templates';
import { Plus, Upload } from './Icons';

export function LeftPanel() {
  const [tab, setTab] = useState<'templates' | 'media'>('templates');
  return (
    <section className="panel left" aria-label="Bibliotek">
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'templates'} onClick={() => setTab('templates')}>
          Mallar
        </button>
        <button className="tab" role="tab" aria-selected={tab === 'media'} onClick={() => setTab('media')}>
          Media
        </button>
      </div>
      {tab === 'templates' ? <TemplateLibrary /> : <MediaBin />}
    </section>
  );
}

function FilePicker({ accept, label, multiple = true }: { accept: string; label: string; multiple?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn" onClick={() => ref.current?.click()}>
        <Upload /> {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void importFiles(files);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------- templates */

function TemplateLibrary() {
  const items = useEditor((s) => s.templates);
  const loading = useEditor((s) => s.templatesLoading);
  const library = useEditor((s) => s.library);
  const grouped = useMemo(() => {
    const m = new Map<string, LibraryTemplate[]>();
    for (const t of items) {
      const k = t.def.category;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [items]);

  return (
    <>
      <div className="panel-head">
        <span className="panel-title">{library.kind === 'share' ? `Mallar · ${library.name}` : 'Rive-mallar'}</span>
        {library.kind !== 'share' && <FilePicker accept=".riv" label="Importera .riv" />}
      </div>
      <div className="scroll" data-testid="template-library">
        {loading && items.length === 0 && (
          <div className="empty">
            <div className="spinner" style={{ margin: '0 auto 10px' }} />
            Laddar mallar…
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="empty">
            <strong>Inga mallar än</strong>
            <br />
            {library.kind === 'share' ? 'Mallarna för det här projektet har inte lagts upp ännu.' : 'Importera en .riv-fil.'}
          </div>
        )}
        <div className="lib-grid">
          {grouped.map(([cat, list]) => (
            <Group key={cat} cat={cat} list={list} />
          ))}
        </div>
        <p className="hint" style={{ padding: '0 12px 16px' }}>
          Dra en mall till tidslinjen, eller klicka på <strong>+</strong> för att lägga den vid spelhuvudet.
        </p>
      </div>
    </>
  );
}

function Group({ cat, list }: { cat: string; list: LibraryTemplate[] }) {
  return (
    <>
      <div className="lib-cat">{cat}</div>
      {list.map((t) => (
        <TemplateTile key={t.def.id} item={t} />
      ))}
    </>
  );
}

function TemplateTile({ item }: { item: LibraryTemplate }) {
  const { def, thumbnail } = item;
  const [hover, setHover] = useState(false);
  return (
    <div
      className="lib-item"
      role="button"
      tabIndex={0}
      aria-label={`Mall: ${def.name}`}
      data-template-id={def.id}
      onPointerDown={(e) => startLibraryDrag(e, { type: 'template', id: def.id, label: def.name, thumbnail })}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') addTemplateToTimeline(def.id, null, null);
      }}
    >
      <div className="thumb">
        {thumbnail && <img src={thumbnail} alt="" draggable={false} />}
        {hover && <HoverPreview def={def} />}
        <span className="badge">{def.defaultDuration.toFixed(0)} s</span>
      </div>
      <button
        className="lib-add"
        aria-label={`Lägg till ${def.name} vid spelhuvudet`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => addTemplateToTimeline(def.id, null, null)}
      >
        <Plus width={14} height={14} />
      </button>
      <span className="lib-name">{def.name}</span>
    </div>
  );
}

/** Plays the template live while hovering over its tile. */
function HoverPreview({ def }: { def: TemplateDefinition }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let renderer: TemplateRenderer | null = null;
    let cancelled = false;
    void templateService.registry().then((reg) => {
      if (cancelled || !ref.current) return;
      const canvas = ref.current;
      canvas.width = 320;
      canvas.height = 180;
      renderer = reg.createRenderer(def.id, canvas, { fill: true });
      renderer.applyProps({});
      const t0 = performance.now();
      const loop = () => {
        const t = ((performance.now() - t0) / 1000) % def.defaultDuration;
        renderer?.render(t, def.defaultDuration);
        raf = requestAnimationFrame(loop);
      };
      loop();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
  }, [def]);
  return <canvas ref={ref} />;
}

/* ------------------------------------------------------------- media */

function MediaBin() {
  const project = useProject();
  const thumbs = useEditor((s) => s.mediaThumbs);
  const videos = project.assets.filter((a): a is VideoAsset => a.kind === 'video');
  const [over, setOver] = useState(false);
  return (
    <>
      <div className="panel-head">
        <span className="panel-title">Projektets media</span>
        <FilePicker accept="video/mp4,.mp4,.m4v,.mov" label="Importera MP4" />
      </div>
      <div className="scroll">
        {videos.length === 0 && (
          <div className="empty">
            <strong>Inga klipp än</strong>
            <br />
            Importera en MP4 eller släpp filer var som helst i fönstret.
          </div>
        )}
        <div className="lib-grid">
          {videos.map((a) => (
            <div
              key={a.id}
              className="lib-item"
              role="button"
              tabIndex={0}
              aria-label={`Video: ${a.name}`}
              data-asset-id={a.id}
              onPointerDown={(e) => startLibraryDrag(e, { type: 'media', id: a.id, label: a.name, thumbnail: thumbs[a.id] ?? null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addVideoToTimeline(a.id, null, null);
              }}
            >
              <div className="thumb video">
                {thumbs[a.id] && <img src={thumbs[a.id]} alt="" draggable={false} />}
                <span className="badge">{formatDuration(microsToSeconds(a.durationUs))}</span>
              </div>
              <button
                className="lib-add"
                aria-label={`Lägg ${a.name} sist på tidslinjen`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => addVideoToTimeline(a.id, null, null)}
              >
                <Plus width={14} height={14} />
              </button>
              <span className="lib-name" title={a.name}>
                {a.name}
              </span>
              <span className="lib-meta">
                {a.width}×{a.height} · {Math.round(a.fps)} fps{a.hasAudio ? '' : ' · utan ljud'}
              </span>
            </div>
          ))}
        </div>
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            void importFiles([...e.dataTransfer.files]);
          }}
        >
          Släpp MP4-filer här
        </div>
      </div>
    </>
  );
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

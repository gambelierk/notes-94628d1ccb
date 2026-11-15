import { useEffect, useMemo, useRef, useState } from 'react';
import { microsToSeconds, type ImageAsset, type TemplateDefinition, type VideoAsset } from '@ve/core';
import type { TemplateRenderer } from '@ve/rive';
import { startLibraryDrag } from '../lib/drag';
import { addImageToTimeline, addTemplateToTimeline, addVideoToTimeline, importFiles } from '../state/actions';
import { useEditor, useProject, type LibraryTemplate } from '../state/store';
import { media } from '../services/media';
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
        {library.kind === 'share' && library.allowUploads && <FilePicker accept=".riv" label="Ladda upp .riv" />}
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

interface BinItem {
  id: string;
  kind: 'video' | 'image';
  name: string;
  asset: VideoAsset | ImageAsset | null;
  size: number | null;
}

function MediaBin() {
  const project = useProject();
  const thumbs = useEditor((s) => s.mediaThumbs);
  const serverMedia = useEditor((s) => s.serverMedia);
  const uploads = useEditor((s) => s.uploads);
  const saved = useEditor((s) => !!s.composition);
  const [over, setOver] = useState(false);

  // In a saved composition the bin shows all videos in the customer project,
  // so footage can be reused across compositions.
  const items = useMemo<BinItem[]>(() => {
    const out = new Map<string, BinItem>();
    for (const a of project.assets) out.set(a.id, { id: a.id, kind: a.kind, name: a.name, asset: a, size: a.size });
    for (const m of serverMedia) if (!out.has(m.id)) out.set(m.id, { id: m.id, kind: m.kind, name: m.name, asset: null, size: m.size });
    return [...out.values()];
  }, [project.assets, serverMedia]);

  useEffect(() => {
    for (const it of items) {
      if (thumbs[it.id] || !media.has(it.id)) continue;
      void media.thumbnail(it.id).then((u) => u && useEditor.getState().setMediaThumb(it.id, u));
    }
  }, [items, thumbs]);

  return (
    <>
      <div className="panel-head">
        <span className="panel-title">{saved ? 'Projektets media' : 'Media'}</span>
        <FilePicker accept="video/mp4,video/quicktime,.mp4,.m4v,.mov,image/png,image/jpeg,image/webp" label="Importera" />
      </div>
      <div className="scroll" data-testid="media-bin">
        {uploads.length > 0 && (
          <div className="uploads">
            {uploads.map((u) => (
              <div key={u.id} className="upload-row">
                <span className="mono ellipsis">{u.name}</span>
                <span className="mono">{Math.round(u.progress * 100)} %</span>
                <div className="progress">
                  <div style={{ width: `${u.progress * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {items.length === 0 && uploads.length === 0 && (
          <div className="empty">
            <strong>Inga filer än</strong>
            <br />
            Importera filmer (MP4, MOV) och bilder (PNG, JPEG, WebP) eller släpp dem var som helst i fönstret.
            {saved && (
              <>
                <br />
                Filerna sparas i projektet och kan användas i alla kompositioner.
              </>
            )}
          </div>
        )}
        {(['video', 'image'] as const).map((kind) => {
          const list = items.filter((it) => it.kind === kind);
          if (!list.length) return null;
          return (
            <div className="lib-grid" key={kind}>
              <div className="lib-cat">{kind === 'video' ? 'Filmer' : 'Bilder'}</div>
              {list.map((it) => (
                <BinTile key={it.id} it={it} thumb={thumbs[it.id] ?? null} />
              ))}
            </div>
          );
        })}
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
          Släpp filmer och bilder här
        </div>
      </div>
    </>
  );
}

function BinTile({ it, thumb }: { it: BinItem; thumb: string | null }) {
  const add = () => void (it.kind === 'image' ? addImageToTimeline(it.id, null, null) : addVideoToTimeline(it.id, null, null));
  const a = it.asset;
  const meta = a
    ? a.kind === 'video'
      ? `${a.width}×${a.height} · ${Math.round(a.fps)} fps${a.hasAudio ? '' : ' · utan ljud'}`
      : `${a.width}×${a.height} · ${a.mime.replace('image/', '').toUpperCase()}`
    : it.size
      ? formatBytes(it.size)
      : '';
  return (
    <div
      className="lib-item"
      role="button"
      tabIndex={0}
      aria-label={`${it.kind === 'image' ? 'Bild' : 'Video'}: ${it.name}`}
      data-asset-id={it.id}
      data-asset-kind={it.kind}
      onPointerDown={(e) => startLibraryDrag(e, { type: it.kind === 'image' ? 'image' : 'media', id: it.id, label: it.name, thumbnail: thumb })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') add();
      }}
    >
      <div className={`thumb${it.kind === 'video' ? ' video' : ''}`}>
        {thumb && <img src={thumb} alt="" draggable={false} />}
        {a?.kind === 'video' && <span className="badge">{formatDuration(microsToSeconds(a.durationUs))}</span>}
      </div>
      <button
        className="lib-add"
        aria-label={it.kind === 'image' ? `Lägg ${it.name} vid spelhuvudet` : `Lägg ${it.name} sist på tidslinjen`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={add}
      >
        <Plus width={14} height={14} />
      </button>
      <span className="lib-name" title={it.name}>
        {it.name}
      </span>
      <span className="lib-meta">{meta}</span>
    </div>
  );
}

export function formatBytes(n: number): string {
  if (n <= 0) return '0 kB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

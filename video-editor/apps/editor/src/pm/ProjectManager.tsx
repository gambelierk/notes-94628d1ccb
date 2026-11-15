import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { createProject, type CompositionSummaryDTO, type MediaDTO } from '@ve/core';
import { ApiError, compositionUrl, customerApi } from '../services/api';
import { templates } from '../services/templates';
import { importTemplateFile } from '../state/actions';
import { useEditor } from '../state/store';
import { formatBytes } from '../components/LeftPanel';
import { CreateDialog } from '../components/FormatPicker';
import { Plus, Trash, Upload } from '../components/Icons';
import '../admin/admin.css';
import './pm.css';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function formatTime(sec: number): string {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `idag ${time}`;
  return `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

/**
 * The customer's project manager: their saved compositions, plus the
 * project's templates and media. Reached through the share link.
 */
export function ProjectManager({ token }: { token: string }) {
  const library = useEditor((s) => s.library);
  const tpls = useEditor((s) => s.templates);
  const uploads = useEditor((s) => s.uploads);
  const toasts = useEditor((s) => s.toasts);
  const [comps, setComps] = useState<CompositionSummaryDTO[] | null>(null);
  const [mediaList, setMediaList] = useState<MediaDTO[]>([]);
  const [creating, setCreating] = useState(false);
  const toast = useEditor((s) => s.toast);

  const refresh = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([customerApi.compositions(token), customerApi.media(token)]);
      setComps(c);
      setMediaList(m);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) toast(errText(e), 'error');
    }
  }, [token, toast]);

  useEffect(() => {
    void templates.loadLibrary({ kind: 'share', token });
    void refresh();
  }, [token, refresh]);

  if (library.kind === 'error') {
    return (
      <div className="unsupported" role="alert">
        <h1>Länken fungerar inte</h1>
        <p>{library.message}</p>
      </div>
    );
  }

  const ownTemplates = tpls.filter((t) => t.uploadedBy === 'customer');
  const projectTemplates = tpls.filter((t) => t.uploadedBy !== 'customer');
  const usedBytes = mediaList.reduce((a, m) => a + m.size, 0);

  return (
    <div className="admin pm-shell" data-testid="project-manager">
      <header className="topbar">
        <BrandMark />
        <span className="project-name" data-testid="customer-name">
          {library.kind === 'share' ? library.name : ' '}
        </span>
        <div className="spacer" />
      </header>

      <main className="pm-main">
        <section className="pm-section">
          <div className="pm-head">
            <h1>Kompositioner</h1>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus /> Skapa
            </button>
          </div>
          {comps === null && <div className="empty">Laddar…</div>}
          {comps?.length === 0 && (
            <button className="pm-empty" onClick={() => setCreating(true)}>
              <strong>Skapa din första komposition</strong>
              <span>En komposition är en film: dina klipp, projektets mallar och din text. Den sparas automatiskt.</span>
            </button>
          )}
          <div className="comp-grid">
            {comps?.map((c) => (
              <CompositionCard key={c.id} c={c} token={token} onChanged={refresh} />
            ))}
          </div>
        </section>

        <div className="pm-columns">
          <section className="pm-section card">
            <div className="card-head">
              <h2>
                Mallar <span className="count mono">{tpls.length}</span>
              </h2>
              {library.kind === 'share' && library.allowUploads && <RivUpload />}
            </div>
            {uploads.length > 0 && <p className="hint mono">Laddar upp {uploads.map((u) => u.name).join(', ')}…</p>}
            <TemplateList list={projectTemplates} />
            {ownTemplates.length > 0 && (
              <>
                <div className="lib-cat">Egna mallar</div>
                <TemplateList list={ownTemplates} token={token} deletable />
              </>
            )}
            {tpls.length === 0 && !useEditor.getState().templatesLoading && <p className="hint">Inga mallar i projektet än.</p>}
          </section>

          <section className="pm-section card">
            <div className="card-head">
              <h2>
                Media <span className="count mono">{mediaList.length}</span>
              </h2>
              <span className="hint mono">{formatBytes(usedBytes)}</span>
            </div>
            {mediaList.length === 0 && <p className="hint">Filmer du importerar i en komposition sparas här och kan återanvändas.</p>}
            <ul className="media-list">
              {mediaList.map((m) => (
                <li key={m.id}>
                  <span className="kind mono">{m.kind === 'video' ? 'VID' : 'IMG'}</span>
                  <span className="ellipsis" title={m.name}>
                    {m.name}
                  </span>
                  <span className="mono dim">{formatBytes(m.size)}</span>
                  <button
                    className="btn ghost icon-btn"
                    aria-label={`Ta bort ${m.name}`}
                    onClick={async () => {
                      if (!confirm(`Ta bort ${m.name}? Klipp som använder filen visas som saknade.`)) return;
                      try {
                        await customerApi.deleteMedia(token, m.id);
                        setMediaList((l) => l.filter((x) => x.id !== m.id));
                      } catch (e) {
                        toast(errText(e), 'error');
                      }
                    }}
                  >
                    <Trash />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      {creating && (
        <CreateDialog
          title="Skapa ny film"
          confirmLabel="Skapa och öppna"
          onClose={() => setCreating(false)}
          onCreate={async (name, size) => {
            try {
              const project = createProject(name, { width: size.width, height: size.height, autoFormat: false });
              const c = await customerApi.createComposition(token, name, project);
              location.href = compositionUrl(token, c.id);
            } catch (err) {
              toast(errText(err), 'error');
            }
          }}
        />
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function RivUpload() {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn" onClick={() => ref.current?.click()}>
        <Upload /> Ladda upp mall
      </button>
      <input
        ref={ref}
        type="file"
        accept=".riv"
        multiple
        hidden
        data-testid="customer-riv-upload"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          for (const f of files) {
            try {
              await importTemplateFile(f);
            } catch (err) {
              useEditor.getState().toast(`${f.name}: ${errText(err)}`, 'error');
            }
          }
        }}
      />
    </>
  );
}

function TemplateList({ list, token, deletable }: { list: ReturnType<typeof useEditor.getState>['templates']; token?: string; deletable?: boolean }) {
  return (
    <div className="pm-tpl-grid">
      {list.map((t) => (
        <div key={t.def.id} className="pm-tpl" data-template-id={t.def.id}>
          <div className="thumb">{t.thumbnail && <img src={t.thumbnail} alt="" />}</div>
          <div className="pm-tpl-text">
            <span className="ellipsis">{t.def.name}</span>
            <span className="mono dim">{t.def.category}</span>
          </div>
          {deletable && token && (
            <button
              className="btn ghost icon-btn"
              aria-label={`Ta bort ${t.def.name}`}
              onClick={async () => {
                if (!confirm(`Ta bort mallen ${t.def.name}? Klipp som använder den visas som saknade.`)) return;
                try {
                  await customerApi.deleteTemplate(token, t.def.id);
                  const s = useEditor.getState();
                  s.setTemplates(s.templates.filter((x) => x.def.id !== t.def.id));
                } catch (e) {
                  useEditor.getState().toast(errText(e), 'error');
                }
              }}
            >
              <Trash />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function CompositionCard({ c, token, onChanged }: { c: CompositionSummaryDTO; token: string; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.name);
  const toast = useEditor((s) => s.toast);
  const href = compositionUrl(token, c.id);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
  return (
    <article className="comp-card" data-testid="composition-card">
      <a className="comp-thumb" href={href} aria-label={`Öppna ${c.name}`}>
        {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" /> : <span className="mono dim">Ingen förhandsbild</span>}
        <span className="badge">{formatTime(c.durationSeconds)}</span>
      </a>
      <div className="comp-body">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              if (name.trim() && name.trim() !== c.name) void act(() => customerApi.renameComposition(token, c.id, name.trim()));
            }}
          >
            <input className="input" autoFocus aria-label="Nytt namn" value={name} onChange={(e) => setName(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : (
          <a className="comp-name-link" href={href}>
            {c.name}
          </a>
        )}
        <span className="mono dim comp-meta">
          {c.width}×{c.height} · ändrad {formatWhen(c.updatedAt)}
        </span>
        <div className="comp-actions">
          <button className="link-btn" onClick={() => setRenaming(true)}>
            Byt namn
          </button>
          <button className="link-btn" onClick={() => void act(() => customerApi.duplicateComposition(token, c.id))}>
            Duplicera
          </button>
          <button
            className="link-btn"
            onClick={() => {
              if (confirm(`Ta bort "${c.name}"? Det går inte att ångra. Filmerna finns kvar i projektets media.`))
                void act(() => customerApi.deleteComposition(token, c.id));
            }}
          >
            Ta bort
          </button>
        </div>
      </div>
    </article>
  );
}

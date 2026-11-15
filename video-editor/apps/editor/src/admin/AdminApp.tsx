import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CompositionSummaryDTO, FieldOverride, TemplateDTO, TemplateField, TemplateLayout, TemplateSettings, WorkspaceDTO } from '@ve/core';
import { formatBytes } from '../components/LeftPanel';
import { ApiError, api, shareUrl } from '../services/api';
import { Logo, Plus, Trash, Upload } from '../components/Icons';
import { inspectForAdmin, type AdminInspection } from './rive-inspect';
import './admin.css';

type Toast = { id: number; kind: 'info' | 'error'; text: string };
let toastSeq = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2500);
  }, []);
  return { toasts, push };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function AdminApp() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  useEffect(() => {
    api
      .me()
      .then((r) => setAuth(r.authenticated ? 'in' : 'out'))
      .catch(() => setAuth('out'));
  }, []);
  if (auth === 'checking') return <div className="admin" />;
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;
  return <Dashboard onLogout={() => setAuth('out')} />;
}

/* ------------------------------------------------------------- login */

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin admin-login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark">
            <Logo width={16} height={16} />
          </span>
          Klipp · Admin
        </div>
        <div className="field">
          <label htmlFor="pw">Lösenord</label>
          <input id="pw" className="input" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy || !password}>
          Logga in
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- dashboard */

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { toasts, push } = useToasts();
  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() => location.hash.slice(1) || null);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    try {
      setWorkspaces(await api.workspaces());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else push(errText(e), 'error');
    }
  }, [onLogout, push]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    history.replaceState(null, '', selected ? `#${selected}` : location.pathname);
  }, [selected]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const w = await api.createWorkspace(name);
      setNewName('');
      await refresh();
      setSelected(w.id);
    } catch (err) {
      push(errText(err), 'error');
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    onLogout();
  };

  return (
    <div className="admin admin-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Logo width={16} height={16} />
          </span>
          Klipp
        </div>
        <span className="project-name">Admin</span>
        <div className="spacer" />
        <a className="btn ghost" href="/">
          Demo-editorn
        </a>
        <button className="btn ghost" onClick={logout}>
          Logga ut
        </button>
      </header>
      <aside className="admin-side">
        <div className="panel-head">
          <span className="panel-title">Kundprojekt</span>
        </div>
        <form className="new-ws" onSubmit={create}>
          <input className="input" placeholder="Nytt kundprojekt, t.ex. kundens namn" aria-label="Namn på nytt kundprojekt" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn icon-btn" aria-label="Skapa kundprojekt" disabled={!newName.trim()}>
            <Plus />
          </button>
        </form>
        <nav className="ws-list" aria-label="Kundprojekt">
          {workspaces?.length === 0 && <p className="hint" style={{ padding: '8px 12px' }}>Inga kundprojekt än.</p>}
          {workspaces?.map((w) => (
            <button key={w.id} className="ws-item" aria-current={w.id === selected} onClick={() => setSelected(w.id)}>
              <span className="ws-name">{w.name}</span>
              <span className="ws-meta mono">
                {w.templateCount} {w.templateCount === 1 ? 'mall' : 'mallar'} · {w.compositionCount} komp.
                {!w.sharingEnabled && ' · delning av'}
              </span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="admin-main">
        {selected ? (
          <WorkspaceView
            key={selected}
            id={selected}
            toast={push}
            onChanged={refresh}
            onDeleted={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <div className="empty admin-empty">
            <strong>Välj eller skapa ett kundprojekt</strong>
            <br />
            Ladda sedan upp kundens Rive-mallar och skicka delningslänken till kunden.
          </div>
        )}
      </main>
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

/* ------------------------------------------------------------- workspace */

function WorkspaceView(props: { id: string; toast: (t: string, k?: 'info' | 'error') => void; onChanged: () => void; onDeleted: () => void }) {
  const { id, toast, onChanged, onDeleted } = props;
  const [ws, setWs] = useState<WorkspaceDTO | null>(null);
  const [items, setItems] = useState<TemplateDTO[]>([]);
  const [comps, setComps] = useState<CompositionSummaryDTO[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.workspace(id);
      setWs(r.workspace);
      setItems(r.templates);
      setComps(r.compositions);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else toast(errText(e), 'error');
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchWs = async (patch: { name?: string; sharingEnabled?: boolean; allowCustomerUploads?: boolean }) => {
    const before = ws;
    if (before) setWs({ ...before, ...patch }); // optimistic
    try {
      setWs(await api.updateWorkspace(id, patch));
      onChanged();
    } catch (e) {
      setWs(before);
      toast(errText(e), 'error');
    }
  };

  const upload = async (files: File[]) => {
    const rivs = files.filter((f) => /\.riv$/i.test(f.name));
    if (rivs.length < files.length) toast('Endast .riv-filer kan laddas upp', 'error');
    for (const f of rivs) {
      setUploading((u) => [...u, f.name]);
      try {
        const t = await api.uploadTemplate(id, f);
        setItems((xs) => [...xs, t]);
        toast(`${f.name} uppladdad`);
      } catch (e) {
        toast(`${f.name}: ${errText(e)}`, 'error');
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name));
      }
    }
    onChanged();
  };

  const categories = useMemo(() => [...new Set(items.map((t) => t.category))], [items]);

  if (notFound) return <div className="empty admin-empty">Kundprojektet finns inte längre.</div>;
  if (!ws) return <div className="empty admin-empty">Laddar…</div>;

  const link = shareUrl(ws.shareToken);

  return (
    <div className="ws-view" data-testid="workspace-view">
      <div className="ws-title-row">
        <EditableTitle value={ws.name} onSave={(name) => patchWs({ name })} />
        <span className="mono dim ws-stats" data-testid="ws-stats">
          {ws.compositionCount} {ws.compositionCount === 1 ? 'komposition' : 'kompositioner'} · {ws.mediaCount} mediefiler ·{' '}
          {formatBytes(ws.mediaBytes)}
        </span>
      </div>

      <section className="card share-card" aria-labelledby="share-h">
        <div className="card-head">
          <h2 id="share-h">Delningslänk</h2>
          <label className="switch">
            <input type="checkbox" checked={ws.sharingEnabled} onChange={(e) => patchWs({ sharingEnabled: e.target.checked })} />
            <span>{ws.sharingEnabled ? 'Delning på' : 'Delning av'}</span>
          </label>
        </div>
        <div className="share-row">
          <input className="input mono" readOnly value={link} aria-label="Delningslänk" data-testid="share-link" onFocus={(e) => e.currentTarget.select()} disabled={!ws.sharingEnabled} />
          <button
            className="btn"
            disabled={!ws.sharingEnabled}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                toast('Länken är kopierad');
              } catch {
                toast('Kunde inte kopiera – markera och kopiera manuellt', 'error');
              }
            }}
          >
            Kopiera
          </button>
          <a className={`btn${ws.sharingEnabled ? '' : ' disabled'}`} href={link} target="_blank" rel="noopener noreferrer">
            Öppna som kund
          </a>
        </div>
        <p className="hint">
          Alla med länken kan använda mallarna i editorn. De kan inte se andra kunders mallar eller ändra något här.{' '}
          <button
            className="link-btn"
            onClick={async () => {
              if (!confirm('Skapa en ny länk? Den nuvarande länken slutar fungera direkt.')) return;
              try {
                setWs(await api.rotateLink(id));
                toast('Ny länk skapad – den gamla fungerar inte längre');
              } catch (e) {
                toast(errText(e), 'error');
              }
            }}
          >
            Skapa ny länk
          </button>
        </p>
      </section>

      <section className="card" aria-labelledby="perm-h">
        <div className="card-head">
          <h2 id="perm-h">Kundens behörigheter</h2>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={ws.allowCustomerUploads}
            onChange={(e) => patchWs({ allowCustomerUploads: e.target.checked })}
            aria-describedby="perm-hint"
          />
          <span>Kunden får ladda upp egna Rive-mallar</span>
        </label>
        <p className="hint" id="perm-hint">
          Egna mallar sparas i projektet och syns under ”Egna mallar” hos kunden. De visas också nedan, markerade som kunduppladdade.
          Kunden kan alltid skapa kompositioner och ladda upp egna filmer.
        </p>
      </section>

      <section className="card" aria-labelledby="tpl-h">
        <div className="card-head">
          <h2 id="tpl-h">
            Mallar <span className="count">{items.length}</span>
          </h2>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload /> Ladda upp .riv
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".riv"
            multiple
            hidden
            data-testid="riv-upload"
            onChange={(e) => {
              const fs = [...(e.target.files ?? [])];
              e.target.value = '';
              void upload(fs);
            }}
          />
        </div>
        <div
          className={`dropzone admin-drop${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void upload([...e.dataTransfer.files]);
          }}
        >
          {uploading.length ? `Laddar upp ${uploading.join(', ')}…` : 'Släpp .riv-filer här'}
        </div>
        <datalist id="categories">
          {[...new Set([...categories, 'Lower thirds', 'Titlar', 'Grafik', 'Helbild', 'Sociala medier'])].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="tpl-grid">
          {items.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              toast={toast}
              onUpdated={(n) => setItems((xs) => xs.map((x) => (x.id === n.id ? n : x)))}
              onDeleted={() => {
                setItems((xs) => xs.filter((x) => x.id !== t.id));
                onChanged();
              }}
            />
          ))}
        </div>
        {items.length === 0 && !uploading.length && <p className="hint">Inga mallar än. Ladda upp kundens .riv-filer ovan.</p>}
      </section>

      <section className="card" aria-labelledby="comp-h">
        <div className="card-head">
          <h2 id="comp-h">
            Kundens kompositioner <span className="count">{comps.length}</span>
          </h2>
        </div>
        {comps.length === 0 ? (
          <p className="hint">Kunden har inte skapat några kompositioner än.</p>
        ) : (
          <ul className="media-list">
            {comps.map((c) => (
              <li key={c.id} className="comp-row">
                <span className="ellipsis">{c.name}</span>
                <span className="mono dim">
                  {c.width}×{c.height}
                </span>
                <span className="mono dim">{Math.round(c.durationSeconds)} s</span>
                <span className="mono dim">{new Date(c.updatedAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card danger">
        <div className="card-head">
          <h2>Ta bort kundprojekt</h2>
          <button
            className="btn danger-btn"
            onClick={async () => {
              if (!confirm(`Ta bort "${ws.name}" och alla dess mallar? Det går inte att ångra, och länken slutar fungera.`)) return;
              try {
                await api.deleteWorkspace(id);
                toast('Kundprojektet är borttaget');
                onDeleted();
              } catch (e) {
                toast(errText(e), 'error');
              }
            }}
          >
            <Trash /> Ta bort
          </button>
        </div>
      </section>
    </div>
  );
}

function EditableTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onSave(t);
    else setV(value);
  };
  return (
    <input
      className="title-input"
      aria-label="Kundprojektets namn"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setV(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/* ------------------------------------------------------------- template card */

const PLACEMENTS: Array<{ id: string; label: string; anchor: TemplateLayout['anchor'] | null }> = [
  { id: 'full', label: 'Hela bildrutan', anchor: null },
  { id: 'bottom-left', label: 'Nere till vänster', anchor: 'bottom-left' },
  { id: 'bottom', label: 'Nere i mitten', anchor: 'bottom' },
  { id: 'bottom-right', label: 'Nere till höger', anchor: 'bottom-right' },
  { id: 'top-left', label: 'Uppe till vänster', anchor: 'top-left' },
  { id: 'top', label: 'Uppe i mitten', anchor: 'top' },
  { id: 'top-right', label: 'Uppe till höger', anchor: 'top-right' },
  { id: 'left', label: 'Mitten till vänster', anchor: 'left' },
  { id: 'center', label: 'Centrerad', anchor: 'center' },
  { id: 'right', label: 'Mitten till höger', anchor: 'right' },
];

const FIELD_TYPE: Record<string, string> = { string: 'text', color: 'färg', image: 'bild', number: 'tal', boolean: 'av/på', enum: 'val' };

function TemplateCard(props: { t: TemplateDTO; toast: (t: string, k?: 'info' | 'error') => void; onUpdated: (t: TemplateDTO) => void; onDeleted: () => void }) {
  const { t, toast, onUpdated, onDeleted } = props;
  const [info, setInfo] = useState<AdminInspection | null>(null);
  const [name, setName] = useState(t.name);
  const [category, setCategory] = useState(t.category);
  const [width, setWidth] = useState(String(t.layout?.widthPercent ?? 35));

  // Re-inspect when the artboard changes (fields and thumbnail depend on it).
  useEffect(() => {
    let alive = true;
    setInfo(null);
    void inspectForAdmin(t).then((r) => alive && setInfo(r));
    return () => {
      alive = false;
    };
  }, [t.id, t.sha256, t.artboard]);
  useEffect(() => () => void (info?.thumbnail && URL.revokeObjectURL(info.thumbnail)), [info]);

  const save = async (patch: Partial<TemplateSettings>) => {
    try {
      onUpdated(await api.updateTemplate(t.id, patch));
    } catch (e) {
      toast(errText(e), 'error');
      setName(t.name);
      setCategory(t.category);
    }
  };

  const placement = t.layout ? t.layout.anchor : 'full';
  const def = info?.def;

  return (
    <article className="tpl-card" data-testid="admin-template" data-template-id={t.id}>
      <div className="thumb">
        {info?.thumbnail && <img src={info.thumbnail} alt="" />}
        {!info && <div className="spinner thumb-spinner" />}
      </div>
      {info?.error && (
        <p className="form-error" role="alert">
          Filen kunde inte läsas av Rive: {info.error}
        </p>
      )}
      <div className="tpl-fields">
        <div className="field">
          <label htmlFor={`n-${t.id}`}>Namn</label>
          <input id={`n-${t.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== t.name && save({ name: name.trim() })} />
        </div>
        <div className="field">
          <label htmlFor={`c-${t.id}`}>Kategori</label>
          <input
            id={`c-${t.id}`}
            className="input"
            list="categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onBlur={() => category.trim() && category !== t.category && save({ category: category.trim() })}
          />
        </div>
        {info && info.artboards.length > 1 && (
          <div className="field">
            <label htmlFor={`a-${t.id}`}>Artboard</label>
            <select id={`a-${t.id}`} className="select" value={t.artboard ?? ''} onChange={(e) => save({ artboard: e.target.value || null })}>
              <option value="">Standard ({info.artboards[0]})</option>
              {info.artboards.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field-row">
          <div className="field">
            <label htmlFor={`p-${t.id}`}>Placering</label>
            <select
              id={`p-${t.id}`}
              className="select"
              value={placement}
              onChange={(e) => {
                const p = PLACEMENTS.find((x) => x.id === e.target.value)!;
                void save({ layout: p.anchor ? { anchor: p.anchor, widthPercent: Number(width) || 35, marginPercent: 6 } : null });
              }}
            >
              {PLACEMENTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          {t.layout && (
            <div className="field narrow">
              <label htmlFor={`w-${t.id}`}>Bredd %</label>
              <input
                id={`w-${t.id}`}
                className="input"
                type="number"
                min={5}
                max={100}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                onBlur={() => {
                  const w = Math.min(100, Math.max(5, Number(width) || 35));
                  setWidth(String(w));
                  if (t.layout && w !== t.layout.widthPercent) void save({ layout: { ...t.layout, widthPercent: w } });
                }}
              />
            </div>
          )}
          <div className="field narrow">
            <label htmlFor={`d-${t.id}`}>Längd (s)</label>
            <input
              id={`d-${t.id}`}
              className="input"
              type="number"
              min={0.5}
              step={0.5}
              placeholder={def ? String(def.defaultDuration) : ''}
              defaultValue={t.defaultDuration ?? ''}
              onBlur={(e) => {
                const v = e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
                if (v !== t.defaultDuration) void save({ defaultDuration: v });
              }}
            />
          </div>
        </div>
        {(def || t.uploadedBy === 'customer') && (
          <div className="tpl-meta">
            {t.uploadedBy === 'customer' && <span className="pill strong">Kunduppladdad</span>}
            {def && (
              <span className={`pill ${def.timing.kind === 'segments' ? 'ok' : 'warn'}`} title={timingHelp(def.timing.kind)}>
                {def.timing.kind === 'segments' ? 'in / hold / out' : def.timing.kind === 'stateMachine' ? 'state machine' : def.timing.kind === 'animation' ? 'animation' : 'stillbild'}
              </span>
            )}
          </div>
        )}
        {def && def.fields.length > 0 && <FieldEditor key={t.artboard ?? ""} fields={def.fields} overrides={t.fields ?? []} onSave={(fields) => save({ fields })} />}
        {def && def.fields.length === 0 && <span className="pill warn">Inga redigerbara fält (ingen View Model med data binding)</span>}
        <div className="tpl-foot">
          <span className="hint mono">
            {t.fileName} · {(t.size / 1024).toFixed(0)} kB
          </span>
          <button
            className="btn ghost icon-btn"
            aria-label={`Ta bort ${t.name}`}
            onClick={async () => {
              if (!confirm(`Ta bort mallen "${t.name}"? Klipp som kunden redan använt den i kan inte längre renderas.`)) return;
              try {
                await api.deleteTemplate(t.id);
                onDeleted();
              } catch (e) {
                toast(errText(e), 'error');
              }
            }}
          >
            <Trash />
          </button>
        </div>
      </div>
    </article>
  );
}

/** Rename fields to customer-friendly labels and choose which ones the customer may edit. */
function FieldEditor({ fields, overrides, onSave }: { fields: TemplateField[]; overrides: FieldOverride[]; onSave: (f: FieldOverride[] | null) => void }) {
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, byKey.get(f.key)?.label ?? ''])));
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => Object.fromEntries(fields.map((f) => [f.key, !!byKey.get(f.key)?.hidden])));
  const commit = (lab: Record<string, string>, hid: Record<string, boolean>) => {
    const out: FieldOverride[] = fields
      .map((f) => ({ key: f.key, ...(lab[f.key]?.trim() ? { label: lab[f.key]!.trim() } : {}), ...(hid[f.key] ? { hidden: true } : {}) }))
      .filter((o) => o.label || o.hidden);
    onSave(out.length ? out : null);
  };
  return (
    <div className="field-editor">
      <span className="field-label">Fält för kunden</span>
      {fields.map((f) => (
        <div key={f.key} className={`fe-row${hidden[f.key] ? ' off' : ''}`}>
          <input
            type="checkbox"
            checked={!hidden[f.key]}
            aria-label={`Visa ${f.key} för kunden`}
            title="Visa för kunden"
            onChange={(e) => {
              const next = { ...hidden, [f.key]: !e.target.checked };
              setHidden(next);
              commit(labels, next);
            }}
          />
          <input
            className="input"
            aria-label={`Etikett för ${f.key}`}
            placeholder={f.label}
            value={labels[f.key] ?? ''}
            onChange={(e) => setLabels((l) => ({ ...l, [f.key]: e.target.value }))}
            onBlur={() => {
              if ((labels[f.key] ?? '').trim() !== (byKey.get(f.key)?.label ?? '')) commit(labels, hidden);
            }}
          />
          <span className="fe-type" title={`Rive-egenskap: ${f.key}`}>
            {FIELD_TYPE[f.type] ?? f.type}
          </span>
        </div>
      ))}
    </div>
  );
}

function timingHelp(kind: string): string {
  return kind === 'segments'
    ? 'Animationerna in/hold/out finns – mallen anpassar sig efter klippets längd.'
    : 'Mallen saknar animationerna in/hold/out och anpassar sig inte efter klippets längd.';
}

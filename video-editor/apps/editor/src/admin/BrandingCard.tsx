import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BRAND_FONT_PRESETS,
  BRAND_LOGO_PLATES,
  contrastRatio,
  type BrandFontPresetId,
  type BrandFontSlot,
  type BrandingDTO,
  type BrandLogoPlate,
  type WorkspaceDTO,
} from '@ve/core';
import { api } from '../services/api';
import { brandVariables, loadBrandFonts, MIN_ACCENT_CONTRAST } from '../services/branding';
import { Logo, Plus, Trash, Upload } from '../components/Icons';

const HEX = /^#[0-9a-f]{6}$/i;
const SAVE_DELAY_MS = 400;

/**
 * Admin: the look of one customer's pages – accent colour, heading and body
 * typefaces (a preset or their own font file) and logo – with a live preview.
 */
export function BrandingCard(props: { ws: WorkspaceDTO; onChange: (w: WorkspaceDTO) => void; toast: (t: string, k?: 'info' | 'error') => void }) {
  const { ws, onChange, toast } = props;
  const b = ws.branding;
  // the colour is edited locally (the picker fires continuously) and saved shortly after
  const [accent, setAccent] = useState<string | null>(b.accent);
  const [hexDraft, setHexDraft] = useState(b.accent ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef(0);
  /** A colour waiting to be saved (sent right away if the card closes first). */
  const pendingAccent = useRef<{ id: string; accent: string | null } | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  // only when switching customer: a save landing mid-drag must not pull the picker back
  useEffect(() => {
    setAccent(ws.branding.accent);
    setHexDraft(ws.branding.accent ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const p = pendingAccent.current;
      if (p) void api.setBranding(p.id, { accent: p.accent }).catch(() => undefined);
    },
    [],
  );

  const run = async (label: string, f: () => Promise<WorkspaceDTO>) => {
    setBusy(label);
    try {
      onChange(await f());
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeAccent = (v: string | null) => {
    setAccent(v);
    setHexDraft(v ?? '');
    clearTimeout(timer.current);
    pendingAccent.current = { id: ws.id, accent: v };
    timer.current = window.setTimeout(() => {
      pendingAccent.current = null;
      void run('accent', () => api.setBranding(ws.id, { accent: v }));
    }, SAVE_DELAY_MS);
  };

  const preview: BrandingDTO = { ...b, accent };
  const scope = `admin-${ws.id}`;
  useEffect(() => {
    void loadBrandFonts(b, scope);
  }, [b, scope]);
  const weak = accent && contrastRatio(accent, '#151515') < MIN_ACCENT_CONTRAST;

  return (
    <section className="card" aria-labelledby="brand-h" data-testid="branding-card">
      <div className="card-head">
        <h2 id="brand-h">Utseende för kunden</h2>
        {busy && <span className="mono dim">Sparar…</span>}
      </div>
      <p className="hint">Gäller kundens projekthanterare och editor via delningslänken. Adminsidorna påverkas inte.</p>

      <div className="brand-grid">
        <div className="brand-fields">
          {/* colour */}
          <div className="brand-field">
            <span className="field-label">Accentfärg</span>
            <div className="brand-row">
              <input
                type="color"
                className="brand-color"
                value={accent ?? '#ececec'}
                aria-label="Välj accentfärg"
                onChange={(e) => changeAccent(e.target.value.toLowerCase())}
              />
              <input
                className="input mono brand-hex"
                value={hexDraft}
                placeholder="#rrggbb"
                aria-label="Accentfärg som hexkod"
                data-testid="brand-hex"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setHexDraft(v);
                  if (HEX.test(v)) changeAccent(v.toLowerCase());
                }}
              />
              <button className="btn" disabled={accent === null} onClick={() => changeAccent(null)}>
                Standard (grå)
              </button>
            </div>
            {weak && (
              <p className="hint" role="status">
                Färgen är mörk mot den mörka bakgrunden. Knappar får färgen, men markeringar och fokusramar visas ljusa så att de syns.
              </p>
            )}
          </div>

          {/* fonts */}
          {(['heading', 'body'] as const).map((slot) => (
            <FontField key={slot} slot={slot} ws={ws} busy={busy === slot} run={run} />
          ))}

          {/* logo */}
          <div className="brand-field">
            <span className="field-label">Logotyp</span>
            <div className="brand-row">
              <div className={`brand-logo-box plate-${b.logo ? b.logoPlate : 'none'}`} style={b.logoPlate === 'accent' && accent ? { background: accent } : undefined}>
                {b.logo ? <img src={b.logo.url} alt="Kundens logotyp" /> : <span className="dim">Ingen logotyp</span>}
              </div>
              <button className="btn" onClick={() => logoRef.current?.click()} disabled={busy === 'logo'}>
                <Upload /> {b.logo ? 'Byt' : 'Ladda upp'}
              </button>
              {b.logo && (
                <button className="btn ghost icon-btn" aria-label="Ta bort logotypen" onClick={() => void run('logo', () => api.deleteBrandLogo(ws.id))}>
                  <Trash />
                </button>
              )}
              <input
                ref={logoRef}
                type="file"
                hidden
                accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                data-testid="brand-logo-upload"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void run('logo', () => api.uploadBrandLogo(ws.id, f));
                }}
              />
            </div>
            <p className="hint">SVG (helst) eller PNG med genomskinlig bakgrund. Visas uppe till vänster och som ikon i webbläsarfliken.</p>
            {b.logo && (
              <label className="brand-row">
                <span>Platta bakom logotypen</span>
                <select
                  className="input"
                  value={b.logoPlate}
                  data-testid="brand-logo-plate"
                  onChange={(e) => void run('logo', () => api.setBranding(ws.id, { logoPlate: e.target.value as BrandLogoPlate }))}
                >
                  {BRAND_LOGO_PLATES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <BrandPreview branding={preview} scope={scope} name={ws.name} />
      </div>
    </section>
  );
}

function FontField(props: { slot: BrandFontSlot; ws: WorkspaceDTO; busy: boolean; run: (label: string, f: () => Promise<WorkspaceDTO>) => Promise<void> }) {
  const { slot, ws, busy, run } = props;
  const f = ws.branding[slot];
  const ref = useRef<HTMLInputElement>(null);
  const label = slot === 'heading' ? 'Typsnitt för rubriker' : 'Typsnitt för text';
  return (
    <div className="brand-field">
      <span className="field-label">{label}</span>
      <div className="brand-row">
        {f.custom ? (
          <span className="brand-font-name" data-testid={`brand-font-${slot}`}>
            {f.custom.name} <span className="mono dim">{f.custom.format.toUpperCase()}</span>
          </span>
        ) : (
          <select
            className="input"
            aria-label={label}
            value={f.preset}
            onChange={(e) => void run(slot, () => api.setBranding(ws.id, { [`${slot}Preset`]: e.target.value as BrandFontPresetId }))}
          >
            {BRAND_FONT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {f.custom ? (
          <button className="btn ghost icon-btn" aria-label={`Ta bort eget ${label.toLowerCase()}`} onClick={() => void run(slot, () => api.deleteBrandFont(ws.id, slot))}>
            <Trash />
          </button>
        ) : (
          <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>
            <Plus /> Eget typsnitt
          </button>
        )}
        <input
          ref={ref}
          type="file"
          hidden
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          data-testid={`brand-font-upload-${slot}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(slot, () => api.uploadBrandFont(ws.id, slot, file));
          }}
        />
      </div>
      {slot === 'body' && (
        <p className="hint">
          Egna typsnitt: WOFF2 (bäst), WOFF, TTF eller OTF. Kontrollera att kundens licens tillåter användning på webben.
        </p>
      )}
    </div>
  );
}

/** A small mock of the customer's project manager in their branding. */
function BrandPreview({ branding, scope, name }: { branding: BrandingDTO; scope: string; name: string }) {
  const style = brandVariables(branding, scope) as CSSProperties;
  return (
    <div className="brand-preview" style={style} aria-label="Förhandsvisning av kundens sida" data-testid="brand-preview">
      <div className="bp-top">
        {branding.logo ? (
          <span className={`brand brand-custom plate-${branding.logoPlate}`}>
            <img className="brand-logo" src={branding.logo.url} alt="" />
          </span>
        ) : (
          <span className="bp-klipp">
            <span className="brand-mark">
              <Logo width={14} height={14} />
            </span>
            Klipp
          </span>
        )}
        <span className="bp-name">{name}</span>
      </div>
      <div className="bp-body">
        <div className="bp-head">
          <h3>Kompositioner</h3>
          <button className="btn primary" tabIndex={-1}>
            <Plus /> Skapa
          </button>
        </div>
        <p>Brödtext i kundens typsnitt. Här skapar kunden filmer med mallarna.</p>
        <div className="bp-tiles">
          <div className="bp-tile selected" />
          <div className="bp-tile" />
          <div className="bp-tile" />
        </div>
      </div>
    </div>
  );
}

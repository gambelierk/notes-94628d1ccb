import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BRAND_FONT_PRESETS,
  BRAND_LOGO_PLATES,
  contrastRatio,
  type BrandFontPresetId,
  type BrandFontSlot,
  type BrandingDTO,
  type BrandLogoPlate,
  type BrandTopbarDTO,
  type BrandTopbarKey,
  textOn,
  type WorkspaceDTO,
} from '@ve/core';
import { api } from '../services/api';
import { brandVariables, loadBrandFonts, MIN_ACCENT_CONTRAST, topbarVariables } from '../services/branding';
import { Logo, Plus, Trash, Upload } from '../components/Icons';

const HEX = /^#[0-9a-f]{6}$/i;
const SAVE_DELAY_MS = 400;

const TOPBAR_FIELDS: { key: BrandTopbarKey; label: string; auto: string }[] = [
  { key: 'background', label: 'Bakgrund', auto: 'Automatiskt: mörk' },
  { key: 'text', label: 'Text', auto: 'Automatiskt: svart eller vit' },
  { key: 'button', label: 'Knappar', auto: 'Automatiskt: accentfärgen' },
  { key: 'buttonText', label: 'Text i knappar', auto: 'Automatiskt: svart eller vit' },
];

type Run = (label: string, f: () => Promise<WorkspaceDTO>) => Promise<void>;

/**
 * A colour with a picker, a hex field and a reset to "automatic" (null).
 * The value follows the picker at once (`onLive`, for the preview) and is
 * saved a moment after the last change – also if the card closes first.
 */
function ColorField(props: {
  label: string;
  hint?: string;
  value: string | null;
  /** Shown in the picker while the value is automatic. */
  swatch: string;
  resetLabel: string;
  testid: string;
  compact?: boolean;
  onLive: (v: string | null) => void;
  save: (v: string | null) => Promise<WorkspaceDTO>;
  run: Run;
}) {
  const { label, hint, swatch, resetLabel, testid, compact, onLive, run } = props;
  const [value, setValue] = useState<string | null>(props.value);
  const [draft, setDraft] = useState(props.value ?? '');
  const timer = useRef(0);
  const pending = useRef<(() => Promise<WorkspaceDTO>) | null>(null);
  const save = useRef(props.save);
  save.current = props.save;

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void pending.current?.().catch(() => undefined); // leaving within the delay still saves
    },
    [],
  );

  const change = (v: string | null) => {
    setValue(v);
    setDraft(v ?? '');
    onLive(v);
    clearTimeout(timer.current);
    const send = () => save.current(v);
    pending.current = send;
    timer.current = window.setTimeout(() => {
      pending.current = null;
      void run(testid, send);
    }, SAVE_DELAY_MS);
  };

  return (
    <div className={`brand-color-field${compact ? ' compact' : ''}`}>
      <span className={compact ? 'brand-color-label' : 'field-label'}>{label}</span>
      <div className="brand-row">
        <input type="color" className="brand-color" value={value ?? swatch} aria-label={`Välj färg: ${label}`} onChange={(e) => change(e.target.value.toLowerCase())} />
        <input
          className="input mono brand-hex"
          value={draft}
          placeholder={value === null ? 'auto' : '#rrggbb'}
          aria-label={`${label} som hexkod`}
          data-testid={testid}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            if (HEX.test(v)) change(v.toLowerCase());
          }}
        />
        <button className="btn" disabled={value === null} onClick={() => change(null)}>
          {resetLabel}
        </button>
        {hint && value === null && <span className="dim brand-color-hint">{hint}</span>}
      </div>
    </div>
  );
}

/**
 * Admin: the look of one customer's pages – accent colour, heading and body
 * typefaces (a preset or their own font file) and logo – with a live preview.
 */
export function BrandingCard(props: { ws: WorkspaceDTO; onChange: (w: WorkspaceDTO) => void; toast: (t: string, k?: 'info' | 'error') => void }) {
  const { ws, onChange, toast } = props;
  const b = ws.branding;
  // colours follow the pickers live in the preview; each field saves itself shortly after a change
  const [accent, setAccent] = useState<string | null>(b.accent);
  const [topbar, setTopbar] = useState<BrandTopbarDTO>(b.topbar);
  const [busy, setBusy] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

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

  const preview: BrandingDTO = { ...b, accent, topbar };
  const scope = `admin-${ws.id}`;
  useEffect(() => {
    void loadBrandFonts(b, scope);
  }, [b, scope]);
  const weak = accent && contrastRatio(accent, '#151515') < MIN_ACCENT_CONTRAST;
  // what "automatic" currently resolves to (shown in the swatches), and a warning for unreadable choices
  const tbVars = topbarVariables(preview);
  const topbarAuto: Record<BrandTopbarKey, string> = {
    background: tbVars['--panel'] ?? '#151515',
    text: tbVars['--text'] ?? '#ececec',
    button: tbVars['--accent'] ?? accent ?? '#ececec',
    buttonText: tbVars['--on-accent'] ?? textOn(tbVars['--accent'] ?? accent ?? '#ececec'),
  };
  const lowContrast =
    contrastRatio(topbarAuto.text, topbarAuto.background) < 3
      ? 'Texten syns dåligt mot bakgrunden i övre sektionen. Välj en ljusare eller mörkare textfärg.'
      : contrastRatio(topbarAuto.buttonText, topbarAuto.button) < 3
        ? 'Texten i knapparna syns dåligt mot knappfärgen.'
        : contrastRatio(topbarAuto.button, topbarAuto.background) < 1.3
          ? 'Knapparna har nästan samma färg som bakgrunden i övre sektionen.'
          : null;

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
            <ColorField
              label="Accentfärg"
              hint="Knappar, markeringar och fokus"
              value={b.accent}
              swatch="#ececec"
              resetLabel="Standard (grå)"
              testid="brand-hex"
              onLive={setAccent}
              save={(v) => api.setBranding(ws.id, { accent: v })}
              run={run}
            />
            {weak && (
              <p className="hint" role="status">
                Färgen är mörk mot den mörka bakgrunden. Knappar får färgen, men markeringar och fokusramar visas ljusa så att de syns.
              </p>
            )}
          </div>

          {/* top section */}
          <div className="brand-field" data-testid="brand-topbar">
            <span className="field-label">Övre sektionen</span>
            <p className="hint">Raden högst upp med logotypen och exportknappen. Det som lämnas på Automatiskt väljs så att det syns mot bakgrunden.</p>
            {TOPBAR_FIELDS.map((f) => (
              <ColorField
                key={f.key}
                label={f.label}
                hint={f.auto}
                value={b.topbar[f.key]}
                swatch={topbarAuto[f.key]}
                resetLabel="Automatiskt"
                testid={`brand-topbar-${f.key}`}
                compact
                onLive={(v) => setTopbar((t) => ({ ...t, [f.key]: v }))}
                save={(v) => api.setBranding(ws.id, { topbar: { [f.key]: v } })}
                run={run}
              />
            ))}
            {lowContrast && (
              <p className="hint" role="status" data-testid="brand-topbar-warning">
                {lowContrast}
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
              <div className={`brand-logo-box plate-${b.logo ? b.logoPlate : 'none'}`} style={
                  // shown as on the customer's page: on its plate, or straight on the top section
                  b.logoPlate === 'accent' ? { background: accent ?? '#ececec' } : b.logoPlate === 'none' ? { background: topbarAuto.background } : undefined
                }
              >
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
      <div className="bp-top topbar" style={topbarVariables(branding) as CSSProperties}>
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
        <span className="spacer" />
        <button className="btn primary" tabIndex={-1} data-testid="brand-preview-export">
          Exportera
        </button>
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

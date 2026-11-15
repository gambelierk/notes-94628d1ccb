import { useEffect, useState, type FormEvent } from 'react';
import { findPreset, FORMAT_PRESETS, MAX_SIDE, MIN_SIDE, validateCustomSize } from '@ve/core';

export interface Size {
  width: number;
  height: number;
}

/**
 * Format chooser: the standard social/web sizes at full resolution, plus a
 * custom size in pixels. Used by "Skapa" and by the project settings.
 */
export function FormatPicker({ value, onChange, compact = false }: { value: Size; onChange: (s: Size) => void; compact?: boolean }) {
  const preset = findPreset(value.width, value.height);
  const [custom, setCustom] = useState(!preset);
  const [w, setW] = useState(String(value.width));
  const [h, setH] = useState(String(value.height));
  useEffect(() => {
    setW(String(value.width));
    setH(String(value.height));
  }, [value.width, value.height]);

  const check = validateCustomSize(Number(w), Number(h));
  const applyCustom = (nw = w, nh = h) => {
    const v = validateCustomSize(Number(nw), Number(nh));
    if (!v.error) {
      setW(String(v.width));
      setH(String(v.height));
      onChange({ width: v.width, height: v.height });
    }
  };

  return (
    <div className={`format-picker${compact ? ' compact' : ''}`}>
      <div className="fp-grid" role="radiogroup" aria-label="Format">
        {FORMAT_PRESETS.map((p) => {
          const on = !custom && preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${p.label} ${p.ratio}, ${p.width} × ${p.height} pixlar`}
              className={`fp-opt${on ? ' on' : ''}`}
              onClick={() => {
                setCustom(false);
                onChange({ width: p.width, height: p.height });
              }}
            >
              <span className="fp-shape-box">
                <span className="fp-shape" style={shapeStyle(p.width, p.height)} />
              </span>
              {!compact && <span className="fp-ratio mono">{p.ratio}</span>}
              <span className="fp-label">{compact ? p.ratio : p.label}</span>
              <span className="fp-dims mono">
                {p.width} × {p.height}
              </span>
              {!compact && <span className="fp-use">{p.use}</span>}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={`fp-opt${custom ? ' on' : ''}`}
          onClick={() => {
            setCustom(true);
            applyCustom();
          }}
        >
          <span className="fp-shape-box">
            <span className="fp-shape custom" style={check.error ? shapeStyle(1, 1) : shapeStyle(check.width, check.height)} />
          </span>
          {!compact && <span className="fp-ratio mono">px</span>}
          <span className="fp-label">{compact ? 'Anpassad' : 'Anpassad storlek'}</span>
          <span className="fp-dims mono">egna mått</span>
          {!compact && <span className="fp-use">Bredd och höjd i pixlar</span>}
        </button>
      </div>
      {custom && (
        <div className="fp-custom">
          <label className="fp-num">
            <span>Bredd</span>
            <input
              className="input mono"
              type="number"
              inputMode="numeric"
              min={MIN_SIDE}
              max={MAX_SIDE}
              step={2}
              value={w}
              aria-label="Bredd i pixlar"
              onChange={(e) => setW(e.target.value)}
              onBlur={() => applyCustom()}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), applyCustom())}
            />
            <span className="mono dim">px</span>
          </label>
          <button
            type="button"
            className="btn ghost icon-btn"
            aria-label="Byt bredd och höjd"
            title="Byt bredd och höjd"
            onClick={() => {
              setW(h);
              setH(w);
              applyCustom(h, w);
            }}
          >
            ⇄
          </button>
          <label className="fp-num">
            <span>Höjd</span>
            <input
              className="input mono"
              type="number"
              inputMode="numeric"
              min={MIN_SIDE}
              max={MAX_SIDE}
              step={2}
              value={h}
              aria-label="Höjd i pixlar"
              onChange={(e) => setH(e.target.value)}
              onBlur={() => applyCustom()}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), applyCustom())}
            />
            <span className="mono dim">px</span>
          </label>
          <span className={`fp-msg mono${check.error ? ' err' : ''}`} role={check.error ? 'alert' : undefined}>
            {check.error ?? `${check.width} × ${check.height} px`}
          </span>
        </div>
      )}
    </div>
  );
}

/** A box with the format's aspect ratio that fits its 1:1 slot. */
function shapeStyle(w: number, h: number): React.CSSProperties {
  return h > w ? { aspectRatio: `${w} / ${h}`, height: '100%', width: 'auto' } : { aspectRatio: `${w} / ${h}`, width: '100%', height: 'auto' };
}

/** "Skapa": name + format. Used by the project manager and the demo editor. */
export function CreateDialog({
  title = 'Skapa',
  confirmLabel = 'Skapa',
  defaultName = '',
  onCreate,
  onClose,
}: {
  title?: string;
  confirmLabel?: string;
  defaultName?: string;
  onCreate: (name: string, size: Size) => Promise<void> | void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [size, setSize] = useState<Size>({ width: 1080, height: 1920 });
  const [busy, setBusy] = useState(false);
  const valid = !validateCustomSize(size.width, size.height).error;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await onCreate(name.trim() || 'Namnlös film', size);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal create-modal" role="dialog" aria-modal="true" aria-labelledby="create-h" onSubmit={submit} data-testid="create-dialog">
        <h2 id="create-h">{title}</h2>
        <div className="field">
          <label htmlFor="create-name">Namn</label>
          <input id="create-name" className="input" autoFocus placeholder="t.ex. Reklamfilm vår" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Format</span>
          <FormatPicker value={size} onChange={setSize} />
        </div>
        <div className="modal-actions">
          <span className="mono dim create-summary">
            {size.width} × {size.height} px
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={busy || !valid}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluateParam,
  findAsset,
  findClip,
  formatTimecode,
  framesToSeconds,
  microsToSeconds,
  updateSettings,
  type Project,
  type PropValue,
  type TemplateClip,
  type TemplateField,
  type VideoClip,
} from '@ve/core';
import { media } from '../services/media';
import { setParam, setTemplateField, setTemplateImage } from '../state/actions';
import { useEditor, useProject } from '../state/store';
import { Image as ImageIcon, Trash } from './Icons';

const BASE_PALETTE = ['#ffffff', '#111111', '#ff6a3d', '#ffd84d', '#2ec27e', '#3b82f6', '#a855f7', '#ef4444'];

export function Inspector() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const found = selection ? findClip(project, selection) : undefined;

  return (
    <section className="panel right" aria-label="Egenskaper">
      <div className="panel-head">
        <span className="panel-title">Egenskaper</span>
      </div>
      <div className="scroll">
        {!found && <ProjectSettings project={project} />}
        {found?.clip.kind === 'template' && <TemplateInspector key={found.clip.id} clip={found.clip} project={project} />}
        {found?.clip.kind === 'video' && <VideoInspector key={found.clip.id} clip={found.clip} project={project} />}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- template */

function TemplateInspector({ clip, project }: { clip: TemplateClip; project: Project }) {
  const tpl = useEditor((s) => s.templates.find((t) => t.def.id === clip.templateId));
  const palette = useMemo(() => projectPalette(project), [project]);
  const fps = project.settings.fps;
  if (!tpl) {
    return (
      <div className="inspector">
        <div className="empty">Mallen "{clip.templateId}" är inte laddad.</div>
      </div>
    );
  }
  const { def } = tpl;
  return (
    <div className="inspector" data-testid="template-inspector">
      <div className="insp-head">
        <div className="thumb">{tpl.thumbnail && <img src={tpl.thumbnail} alt="" />}</div>
        <div>
          <div className="insp-title">{def.name}</div>
          <div className="insp-sub">
            {framesToSeconds(clip.duration, fps).toFixed(2)} s · {timingLabel(def.timing.kind)}
          </div>
        </div>
      </div>
      {def.fields.length === 0 && <p className="hint">Mallen har inga redigerbara fält (ingen View Model med data binding).</p>}
      {def.fields.map((f) => (
        <FieldEditor key={f.key} clip={clip} field={f} value={clip.props[f.key]?.value ?? f.default} palette={palette} />
      ))}
      <div className="divider" />
      <RangeField
        label="Opacitet"
        value={evaluateParam(clip.opacity)}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(v) => setParam(clip.id, 'opacity', v)}
      />
      <p className="hint">
        Dra i klippets kanter på tidslinjen för att ändra längden.
        {def.timing.kind === 'segments'
          ? ' In- och utanimationen anpassas automatiskt.'
          : ' Mallen saknar animationerna in/hold/out och spelas därför upp från början utan att anpassas till längden.'}
      </p>
    </div>
  );
}

function timingLabel(kind: string): string {
  switch (kind) {
    case 'segments':
      return 'in / hold / out';
    case 'stateMachine':
      return 'state machine';
    case 'animation':
      return 'animation';
    default:
      return 'stillbild';
  }
}

function FieldEditor({ clip, field, value, palette }: { clip: TemplateClip; field: TemplateField; value: PropValue; palette: string[] }) {
  const id = `f-${clip.id}-${field.key}`;
  const set = (v: PropValue) => setTemplateField(clip.id, field.key, v);
  switch (value.type) {
    case 'string':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          {field.multiline || value.value.length > 40 ? (
            <textarea id={id} className="textarea" value={value.value} onChange={(e) => set({ type: 'string', value: e.target.value })} />
          ) : (
            <input id={id} className="input" value={value.value} onChange={(e) => set({ type: 'string', value: e.target.value })} />
          )}
        </div>
      );
    case 'color':
      return <ColorField id={id} label={field.label} value={value.value} palette={palette} onChange={(v) => set({ type: 'color', value: v })} />;
    case 'number':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            className="input"
            type="number"
            step="any"
            value={Number.isFinite(value.value) ? value.value : 0}
            onChange={(e) => set({ type: 'number', value: e.target.valueAsNumber || 0 })}
          />
        </div>
      );
    case 'boolean':
      return (
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={value.value} onChange={(e) => set({ type: 'boolean', value: e.target.checked })} />
          <span className="field-label">{field.label}</span>
        </label>
      );
    case 'enum':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <select id={id} className="select" value={value.value} onChange={(e) => set({ type: 'enum', value: e.target.value })}>
            {(field.options ?? [value.value]).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    case 'image':
      return <ImageField clip={clip} field={field} assetId={value.assetId} />;
  }
}

function ColorField({
  id,
  label,
  value,
  palette,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  palette: string[];
  onChange: (v: string) => void;
}) {
  const rgb = value.slice(0, 7);
  // Keep an existing alpha, but never let a picked colour become invisible.
  const alpha = value.length === 9 && value.slice(7).toLowerCase() !== '00' ? value.slice(7) : 'ff';
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commitText = () => {
    const t = text.trim().startsWith('#') ? text.trim() : `#${text.trim()}`;
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(t)) onChange(t.length === 7 ? t + alpha : t);
    else setText(value);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="color-row">
        <span className="swatch" style={{ background: rgb }}>
          <input aria-label={`${label} – färgväljare`} type="color" value={rgb} onChange={(e) => onChange(e.target.value + alpha)} />
        </span>
        <input
          id={id}
          className="input"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && commitText()}
          style={{ fontFamily: 'var(--mono)' }}
        />
      </div>
      <div className="palette" aria-label="Projektets färger">
        {palette.map((c) => (
          <button key={c} title={c} aria-label={`Använd ${c}`} style={{ background: c }} onClick={() => onChange(c.length === 7 ? c + alpha : c)} />
        ))}
      </div>
    </div>
  );
}

function ImageField({ clip, field, assetId }: { clip: TemplateClip; field: TemplateField; assetId: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const url = useObjectUrl(assetId ? media.blob(assetId) : undefined);
  return (
    <div className="field">
      <span className="field-label">{field.label}</span>
      <div className="image-field">
        <div className="thumb">{url && <img src={url} alt="" />}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="btn" onClick={() => ref.current?.click()}>
            <ImageIcon /> {assetId ? 'Byt bild' : 'Välj bild'}
          </button>
          {assetId && (
            <button className="btn ghost" onClick={() => setTemplateField(clip.id, field.key, { type: 'image', assetId: null })}>
              <Trash /> Ta bort
            </button>
          )}
        </div>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void setTemplateImage(clip.id, field.key, f);
        }}
      />
    </div>
  );
}

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function projectPalette(project: Project): string[] {
  const used = new Set<string>();
  for (const t of project.tracks)
    for (const c of t.clips)
      if (c.kind === 'template')
        for (const p of Object.values(c.props)) if (p.value.type === 'color') used.add(p.value.value.slice(0, 7).toLowerCase());
  return [...new Set([...used, ...BASE_PALETTE])].slice(0, 16);
}

/* ------------------------------------------------------------- video */

function VideoInspector({ clip, project }: { clip: VideoClip; project: Project }) {
  const asset = findAsset(project, clip.assetId);
  const thumb = useEditor((s) => s.mediaThumbs[clip.assetId]);
  const fps = project.settings.fps;
  return (
    <div className="inspector" data-testid="video-inspector">
      <div className="insp-head">
        <div className="thumb video">{thumb && <img src={thumb} alt="" />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="insp-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {asset?.name ?? 'Saknad fil'}
          </div>
          <div className="insp-sub">Videoklipp</div>
        </div>
      </div>
      <dl className="kv">
        <dt>Start</dt>
        <dd>{formatTimecode(clip.start, fps)}</dd>
        <dt>Längd</dt>
        <dd>{formatTimecode(clip.duration, fps)}</dd>
        <dt>Källans in</dt>
        <dd>{microsToSeconds(clip.sourceStart).toFixed(2)} s</dd>
        {asset?.kind === 'video' && (
          <>
            <dt>Upplösning</dt>
            <dd>
              {asset.width}×{asset.height}
            </dd>
          </>
        )}
      </dl>
      <div className="divider" />
      <RangeField
        label="Volym"
        value={evaluateParam(clip.volume)}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(v) => setParam(clip.id, 'volume', v)}
      />
      <RangeField
        label="Opacitet"
        value={evaluateParam(clip.opacity)}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(v) => setParam(clip.id, 'opacity', v)}
      />
    </div>
  );
}

function RangeField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="range-row">
        <input
          type="range"
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value))}
        />
        <span className="val">{props.format(props.value)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- project */

const RESOLUTIONS: Array<[string, number, number]> = [
  ['1080p liggande', 1920, 1080],
  ['1080p stående', 1080, 1920],
  ['Kvadrat', 1080, 1080],
  ['720p liggande', 1280, 720],
  ['4K liggande', 3840, 2160],
];

function ProjectSettings({ project }: { project: Project }) {
  const { width, height, fps, background } = project.settings;
  const apply = useEditor((s) => s.apply);
  const current = RESOLUTIONS.findIndex(([, w, h]) => w === width && h === height);
  return (
    <div className="inspector">
      <p className="hint">Markera ett klipp på tidslinjen för att redigera det.</p>
      <div className="field">
        <label htmlFor="res">Upplösning</label>
        <select
          id="res"
          className="select"
          value={current}
          onChange={(e) => {
            const r = RESOLUTIONS[Number(e.target.value)];
            if (r) apply((p) => updateSettings(p, { width: r[1], height: r[2] }), 'Ändra upplösning');
          }}
        >
          {current < 0 && (
            <option value={-1}>
              Egen ({width}×{height})
            </option>
          )}
          {RESOLUTIONS.map(([label, w, h], i) => (
            <option key={label} value={i}>
              {label} ({w}×{h})
            </option>
          ))}
        </select>
      </div>
      <dl className="kv">
        <dt>Bildfrekvens</dt>
        <dd>{(fps.num / fps.den).toFixed(fps.den === 1 ? 0 : 3)} fps</dd>
        <dt>Ljud</dt>
        <dd>{project.settings.sampleRate / 1000} kHz stereo</dd>
      </dl>
      <ColorField
        id="bg"
        label="Bakgrund"
        value={background.length === 7 ? `${background}ff` : background}
        palette={['#000000', '#ffffff', '#16171a']}
        onChange={(v) => apply((p) => updateSettings(p, { background: v.slice(0, 7) }), 'Bakgrundsfärg', 'bg')}
      />
      <div className="divider" />
      <div className="hint">
        <strong style={{ color: 'var(--text-2)' }}>Kortkommandon</strong>
        <br />
        <kbd>Mellanslag</kbd> spela/pausa · <kbd>S</kbd> dela · <kbd>Delete</kbd> ta bort · <kbd>Shift</kbd>+<kbd>Delete</kbd> ta bort och
        stäng luckan · <kbd>←</kbd>/<kbd>→</kbd> bildruta · <kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> ångra · <kbd>+</kbd>/<kbd>−</kbd> zooma
      </div>
    </div>
  );
}

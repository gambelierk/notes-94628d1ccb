import { useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluateParam,
  findAsset,
  findClip,
  formatTimecode,
  framesToSeconds,
  microsToSeconds,
  coverScale,
  describeTransition,
  gainToDb,
  secondsToFrames,
  TEXT_FONTS,
  transformAt,
  updateSettings,
  type AudioClip,
  type Clip,
  type ImageClip,
  type TextClip,
  type TextStyle,
  type TransitionRef,
  type Project,
  type PropValue,
  type TemplateClip,
  type TemplateField,
  type VideoClip,
} from '@ve/core';
import { media } from '../services/media';
import { FormatPicker } from './FormatPicker';
import { clipPlacement, sourceSize } from '../lib/placement';
import {
  deleteTransition,
  resetTransform,
  setParam,
  setTemplateField,
  setTemplateImage,
  setText,
  setTransform,
  setTransitionLength,
} from '../state/actions';
import { Waveform } from './Waveform';
import { useEditor, useProject } from '../state/store';
import { clipName } from '../lib/names';
import { brandTextFonts } from '../services/branding';
import { Dissolve, FadeIn, FadeOut, Image as ImageIcon, Trash } from './Icons';

const BASE_PALETTE = ['#ffffff', '#111111', '#ff6a3d', '#ffd84d', '#2ec27e', '#3b82f6', '#a855f7', '#ef4444'];

export function Inspector() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const transition = useEditor((s) => s.transition);
  const found = selection ? findClip(project, selection) : undefined;
  const trans = transition ? describeTransition(project, transition) : null;

  return (
    <section className="panel right" aria-label="Egenskaper">
      <div className="panel-head">
        <span className="panel-title">Egenskaper</span>
      </div>
      <div className="scroll">
        {trans && transition && <TransitionInspector key={`${transition.clipId}-${transition.edge}`} refTo={transition} t={trans} project={project} />}
        {!found && !trans && <ProjectSettings project={project} />}
        {found?.clip.kind === 'template' && <TemplateInspector key={found.clip.id} clip={found.clip} project={project} />}
        {found?.clip.kind === 'video' && <VideoInspector key={found.clip.id} clip={found.clip} project={project} />}
        {found?.clip.kind === 'image' && <ImageInspector key={found.clip.id} clip={found.clip} project={project} />}
        {found?.clip.kind === 'audio' && <AudioInspector key={found.clip.id} clip={found.clip} project={project} trackName={found.track.name} />}
        {found?.clip.kind === 'text' && <TextInspector key={found.clip.id} clip={found.clip} project={project} />}
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
      <TransformFields clip={clip} project={project} />
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
  const localUrl = useObjectUrl(assetId ? media.blob(assetId) : undefined);
  const url = localUrl ?? (assetId ? media.displayUrl(assetId) : null);
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
      <VolumeField clip={clip} label={asset?.kind === 'video' && !asset.hasAudio ? 'Volym (filmen saknar ljud)' : 'Volym för klippets ljud'} />
      <TransformFields clip={clip} project={project} />
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
        Filmens ljud följer klippet: det flyttas, trimmas och delas tillsammans med bilden. Övergångar läggs till med knapparna vid klippets
        kanter på tidslinjen.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- image */

function ImageInspector({ clip, project }: { clip: ImageClip; project: Project }) {
  const asset = findAsset(project, clip.assetId);
  const thumb = useEditor((s) => s.mediaThumbs[clip.assetId]);
  const fps = project.settings.fps;
  return (
    <div className="inspector" data-testid="image-inspector">
      <div className="insp-head">
        <div className="thumb">{thumb && <img src={thumb} alt="" />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="insp-title ellipsis">{asset?.name ?? 'Saknad fil'}</div>
          <div className="insp-sub">
            Bild{asset?.kind === 'image' ? ` · ${asset.width}×${asset.height}` : ''}
          </div>
        </div>
      </div>
      <dl className="kv">
        <dt>Start</dt>
        <dd>{formatTimecode(clip.start, fps)}</dd>
        <dt>Längd</dt>
        <dd>{formatTimecode(clip.duration, fps)}</dd>
      </dl>
      <div className="divider" />
      <TransformFields clip={clip} project={project} />
      <RangeField
        label="Opacitet"
        value={evaluateParam(clip.opacity)}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)} %`}
        onChange={(v) => setParam(clip.id, 'opacity', v)}
      />
      <p className="hint">Dra bilden i förhandsvisningen för att flytta den och i hörnen för att skala. Ändra längden genom att dra i klippets kanter.</p>
    </div>
  );
}

/* ------------------------------------------------------------- placement */

/**
 * Position (centre, in output pixels from the top-left), scale and rotation.
 * Stored normalised in the project; shown in pixels here.
 */
function TransformFields({ clip, project }: { clip: Clip; project: Project }) {
  const templates = useEditor((s) => s.templates);
  const { width: W, height: H } = project.settings;
  const t = transformAt(clip);
  const pl = clipPlacement(project, clip, templates);
  const src = sourceSize(project, clip, templates);
  const isTemplate = clip.kind === 'template';
  const asset = clip.kind === 'image' ? findAsset(project, clip.assetId) : undefined;
  const isVector = asset?.kind === 'image' && !!asset.vector;
  const cover = src && !isTemplate && clip.kind !== 'text' ? coverScale(src.w, src.h, W, H) : null;
  const num = (label: string, value: number, unit: string, onChange: (v: number) => void, step = 1, testid?: string) => (
    <label className="xf-field">
      <span>{label}</span>
      <input
        className="input mono"
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : 0}
        data-testid={testid}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      <span className="mono dim">{unit}</span>
    </label>
  );
  return (
    <div className="field" data-testid="transform-fields">
      <span className="field-label">Placering</span>
      <div className="xf-grid">
        {pl && num('X', pl.cx, 'px', (v) => setTransform(clip.id, { x: t.x + (v - pl.cx) / W }), 1, 'xf-x')}
        {pl && num('Y', pl.cy, 'px', (v) => setTransform(clip.id, { y: t.y + (v - pl.cy) / H }), 1, 'xf-y')}
        {num('Skala', t.scale * 100, '%', (v) => setTransform(clip.id, { scale: Math.max(2, v) / 100 }), 1, 'xf-scale')}
        {!isTemplate && num('Rotation', t.rotation, '°', (v) => setTransform(clip.id, { rotation: v }), 1, 'xf-rot')}
      </div>
      {pl && (
        <span className="mono dim xf-size">
          {Math.round(pl.w)} × {Math.round(pl.h)} px i en bild på {W} × {H}
        </span>
      )}
      {isVector && (
        <span className="mono dim xf-size" data-testid="vector-note">
          Vektorgrafik · ritas om skarpt i varje storlek
        </span>
      )}
      <div className="xf-actions">
        <button className="btn" onClick={() => resetTransform(clip.id)} title={clip.kind === 'text' ? 'Ursprunglig storlek, centrerat' : 'Hela innehållet syns, centrerat'}>
          {clip.kind === 'text' ? 'Återställ' : 'Anpassa'}
        </button>
        {cover !== null && (
          <button className="btn" onClick={() => setTransform(clip.id, { x: 0, y: 0, scale: cover }, 'Fyll bilden')} title="Täcker hela bilden">
            Fyll
          </button>
        )}
        <button className="btn" onClick={() => setTransform(clip.id, { x: 0, y: 0 }, 'Centrera')}>
          Centrera
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sound */

function VolumeField({ clip, label = 'Volym' }: { clip: VideoClip | AudioClip; label?: string }) {
  const v = evaluateParam(clip.volume);
  return (
    <div className="field" data-testid="clip-volume">
      <span className="field-label">{label}</span>
      <div className="range-row">
        <input
          type="range"
          aria-label="Klippets volym"
          min={0}
          max={2}
          step={0.01}
          value={v}
          onChange={(e) => setParam(clip.id, 'volume', Number(e.target.value))}
          onDoubleClick={() => setParam(clip.id, 'volume', 1)}
        />
        <span className="val">{Math.round(v * 100)} %</span>
      </div>
      <span className="mono dim vol-db">{gainToDb(v)} · dubbelklicka för 100 %</span>
    </div>
  );
}

function AudioInspector({ clip, project, trackName }: { clip: AudioClip; project: Project; trackName: string }) {
  const asset = findAsset(project, clip.assetId);
  const fps = project.settings.fps;
  return (
    <div className="inspector" data-testid="audio-inspector">
      <div className="insp-head">
        <div className="thumb audio">
          {asset?.kind === 'audio' && <Waveform assetId={asset.id} sourceStart={0} seconds={microsToSeconds(asset.durationUs)} width={72} height={40} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="insp-title ellipsis">{asset?.name ?? 'Saknad fil'}</div>
          <div className="insp-sub">Ljud · spår {trackName}</div>
        </div>
      </div>
      <dl className="kv">
        <dt>Start</dt>
        <dd>{formatTimecode(clip.start, fps)}</dd>
        <dt>Längd</dt>
        <dd>{formatTimecode(clip.duration, fps)}</dd>
        <dt>Källans in</dt>
        <dd>{microsToSeconds(clip.sourceStart).toFixed(2)} s</dd>
        {asset?.kind === 'audio' && (
          <>
            <dt>Format</dt>
            <dd>
              {(asset.sampleRate / 1000).toFixed(1)} kHz · {asset.channels === 1 ? 'mono' : 'stereo'}
            </dd>
          </>
        )}
      </dl>
      <div className="divider" />
      <VolumeField clip={clip} />
      <p className="hint">Spårets volym (reglaget i spårhuvudet) påverkar alla klipp på spåret och multipliceras med klippets volym.</p>
    </div>
  );
}

/* ------------------------------------------------------------- transitions */

function TransitionInspector({ refTo, t, project }: { refTo: TransitionRef; t: NonNullable<ReturnType<typeof describeTransition>>; project: Project }) {
  const fps = project.settings.fps;
  const templates = useEditor((s) => s.templates);
  const name = (c: Clip | undefined) => clipName(project, c, templates);
  const title = t.kind === 'dissolve' ? 'Övertoning' : t.kind === 'fadeIn' ? 'Tona in från svart' : 'Tona ut till svart';
  const what =
    t.kind === 'dissolve'
      ? `${name(t.other)} → ${name(t.clip)}`
      : `${t.kind === 'fadeIn' ? 'Början' : 'Slutet'} av ${name(t.clip)}`;
  const secs = framesToSeconds(t.duration, fps);
  const max = framesToSeconds(t.max, fps);
  return (
    <div className="inspector" data-testid="transition-inspector">
      <div className="insp-head">
        <div className="trans-icon">{t.kind === 'dissolve' ? <Dissolve /> : t.kind === 'fadeIn' ? <FadeIn /> : <FadeOut />}</div>
        <div style={{ minWidth: 0 }}>
          <div className="insp-title">{title}</div>
          <div className="insp-sub ellipsis">{what}</div>
        </div>
      </div>
      <p className="hint">
        {t.kind === 'dissolve'
          ? 'Klippen tonas över i varandra, centrerat på skarven. Ljudet tonas över på samma sätt.'
          : t.kind === 'fadeIn'
            ? 'Bilden tonas upp från svart och ljudet från tystnad.'
            : 'Bilden tonas ner till svart och ljudet till tystnad.'}
      </p>
      <div className="field">
        <span className="field-label">Längd</span>
        <label className="xf-field">
          <span>Sekunder</span>
          <input
            className="input mono"
            type="number"
            min={0.05}
            max={max}
            step={0.1}
            value={Math.round(secs * 100) / 100}
            data-testid="transition-duration"
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v > 0) setTransitionLength(refTo, secondsToFrames(v, fps));
            }}
          />
          <span className="mono dim">s</span>
        </label>
        <div className="xf-actions">
          {[0.5, 1, 2]
            .filter((v) => v <= max + 1e-6)
            .map((v) => (
              <button key={v} className="btn" aria-pressed={Math.abs(secs - v) < 0.02} onClick={() => setTransitionLength(refTo, secondsToFrames(v, fps))}>
                {String(v).replace('.', ',')} s
              </button>
            ))}
        </div>
        <span className="mono dim xf-size">högst {max.toFixed(2).replace('.', ',')} s ({t.kind === 'dissolve' ? 'det kortaste klippet' : t.clip.fadeIn && t.clip.fadeOut ? 'klippets längd minus den andra toningen' : 'klippets längd'})</span>
      </div>
      <button className="btn" onClick={() => deleteTransition(refTo)}>
        <Trash /> Ta bort övergång
      </button>
      <p className="hint">
        Tips: markera övergången och tryck <kbd>Delete</kbd> eller <kbd>Backspace</kbd> för att ta bort den.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- text */

function TextInspector({ clip, project }: { clip: TextClip; project: Project }) {
  const st = clip.style;
  const H = project.settings.height;
  const setStyle = (patch: Partial<TextStyle>) => setText(clip.id, { style: patch });
  const library = useEditor((s) => s.library);
  const brand = brandTextFonts(library.kind === 'share' ? library.branding : null);
  // the customer's own typefaces are offered when uploaded (and stay listed if a clip already uses one)
  const fonts = (Object.keys(TEXT_FONTS) as TextStyle['font'][]).flatMap((k): { id: TextStyle['font']; label: string }[] => {
    if (k === 'brand-heading' || k === 'brand-body') {
      const slot = k === 'brand-heading' ? 'heading' : 'body';
      if (!brand[slot]) return st.font === k ? [{ id: k, label: `${TEXT_FONTS[k].label} (saknas)` }] : [];
      return [{ id: k, label: `${brand.names[slot]} · ${slot === 'heading' ? 'rubriker' : 'text'}` }];
    }
    return [{ id: k, label: TEXT_FONTS[k].label }];
  });
  return (
    <div className="inspector" data-testid="text-inspector">
      <div className="field">
        <label htmlFor={`t-${clip.id}`}>Text</label>
        <textarea id={`t-${clip.id}`} className="textarea" value={clip.text} onChange={(e) => setText(clip.id, { text: e.target.value })} rows={3} />
      </div>
      <div className="two-col">
        <div className="field">
          <label htmlFor={`tf-${clip.id}`}>Typsnitt</label>
          <select id={`tf-${clip.id}`} className="select" value={st.font} onChange={(e) => setStyle({ font: e.target.value as TextStyle['font'] })}>
            {fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`tw-${clip.id}`}>Vikt</label>
          <select
            id={`tw-${clip.id}`}
            className="select"
            value={st.weight}
            onChange={(e) => setStyle({ weight: Number(e.target.value) as TextStyle['weight'] })}
          >
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={600}>Semibold</option>
            <option value={700}>Bold</option>
          </select>
        </div>
      </div>
      <div className="xf-grid">
        <label className="xf-field">
          <span>Storlek</span>
          <input
            className="input mono"
            type="number"
            min={6}
            step={1}
            value={Math.round(st.size * H)}
            data-testid="text-size"
            onChange={(e) => e.target.valueAsNumber > 0 && setStyle({ size: e.target.valueAsNumber / H })}
          />
          <span className="mono dim">px</span>
        </label>
        <label className="xf-field">
          <span>Radbredd</span>
          <input
            className="input mono"
            type="number"
            min={10}
            max={100}
            step={1}
            value={Math.round(st.maxWidth * 100)}
            onChange={(e) => e.target.valueAsNumber > 0 && setStyle({ maxWidth: Math.min(100, e.target.valueAsNumber) / 100 })}
          />
          <span className="mono dim">%</span>
        </label>
      </div>
      <div className="seg" role="group" aria-label="Justering">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} aria-pressed={st.align === a} onClick={() => setStyle({ align: a })}>
            {a === 'left' ? 'Vänster' : a === 'center' ? 'Centrerad' : 'Höger'}
          </button>
        ))}
      </div>
      <ColorField id={`tc-${clip.id}`} label="Textfärg" value={`${st.color}ff`} palette={projectPalette(project)} onChange={(v) => setStyle({ color: v.slice(0, 7) })} />
      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={!!st.background}
          onChange={(e) => setStyle({ background: e.target.checked ? { color: '#000000', opacity: 0.72 } : null })}
        />
        <span className="field-label">Platta bakom texten</span>
      </label>
      {st.background && (
        <>
          <ColorField
            id={`tb-${clip.id}`}
            label="Plattans färg"
            value={`${st.background.color}ff`}
            palette={['#000000', '#ffffff', ...projectPalette(project)]}
            onChange={(v) => setStyle({ background: { ...st.background!, color: v.slice(0, 7) } })}
          />
          <RangeField
            label="Plattans opacitet"
            value={st.background.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(v) => setStyle({ background: { ...st.background!, opacity: v } })}
          />
        </>
      )}
      <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={st.shadow} onChange={(e) => setStyle({ shadow: e.target.checked })} />
        <span className="field-label">Skugga</span>
      </label>
      <div className="divider" />
      <TransformFields clip={clip} project={project} />
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

function ProjectSettings({ project }: { project: Project }) {
  const { width, height, fps, background } = project.settings;
  const apply = useEditor((s) => s.apply);
  return (
    <div className="inspector">
      <p className="hint">Markera ett klipp på tidslinjen eller i bilden för att redigera det.</p>
      <div className="field">
        <span className="field-label">Format</span>
        <FormatPicker
          compact
          value={{ width, height }}
          onChange={(sz) => apply((p) => updateSettings(p, { width: sz.width, height: sz.height, autoFormat: false }), 'Ändra format')}
        />
        <span className="mono dim fp-note">Placeringar följer med när formatet ändras.</span>
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

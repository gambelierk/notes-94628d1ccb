import { useEffect, useRef, useState } from 'react';
import { fpsValue, framesToSeconds, projectDuration, type Project } from '@ve/core';
import {
  ExportCancelledError,
  exportProject,
  QUALITY_PRESETS,
  videoBitrateFor,
  type ExportJob,
  type ExportProgress,
  type QualityPreset,
} from '@ve/export';
import { media } from '../services/media';
import { RIVE_WASM_URL, templates } from '../services/templates';
import { committedProject, useEditor } from '../state/store';
import { Download } from './Icons';

type Phase = { kind: 'setup' } | { kind: 'running'; progress: ExportProgress | null } | { kind: 'done'; url: string; size: number; elapsedMs: number; name: string } | { kind: 'error'; message: string };

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  if (!open) return null;
  return <Dialog />;
}

async function buildJob(project: Project, preset: QualityPreset): Promise<ExportJob> {
  const registry = await templates.registry();
  const usedTemplates = new Set<string>();
  const mediaIds = new Set<string>();
  for (const t of project.tracks)
    for (const c of t.clips) {
      if (c.kind === 'video' || c.kind === 'image') mediaIds.add(c.assetId);
      else {
        usedTemplates.add(c.templateId);
        for (const p of Object.values(c.props)) if (p.value.type === 'image' && p.value.assetId) mediaIds.add(p.value.assetId);
      }
    }
  const mediaBlobs: Record<string, Blob | string> = {};
  for (const id of mediaIds) {
    const src = media.exportSource(id);
    if (src) mediaBlobs[id] = src;
  }
  const { width, height, fps } = project.settings;
  return {
    project,
    media: mediaBlobs,
    templates: registry.sources(usedTemplates),
    riveWasmUrl: RIVE_WASM_URL,
    options: { videoBitrate: videoBitrateFor(width, height, fpsValue(fps), preset), audioBitrate: 192_000 },
  };
}

function Dialog() {
  const close = () => useEditor.getState().setExportOpen(false);
  const project = committedProject();
  const [preset, setPreset] = useState<QualityPreset>('high');
  const compName = useEditor((s) => s.composition?.name);
  const [name, setName] = useState(compName || project.name || 'export');
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);
  const { width, height, fps } = project.settings;
  const dur = framesToSeconds(projectDuration(project), fps);
  const bitrate = videoBitrateFor(width, height, fpsValue(fps), preset);
  const estMB = ((bitrate + 192_000) * dur) / 8 / 1e6;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase.kind !== 'running') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase.kind]);

  const start = async () => {
    setPhase({ kind: 'running', progress: null });
    abort.current = new AbortController();
    try {
      const job = await buildJob(project, preset);
      const res = await exportProject(job, (p) => setPhase({ kind: 'running', progress: p }), abort.current.signal);
      const url = URL.createObjectURL(res.blob);
      const file = `${(name.trim() || 'export').replace(/[\\/:*?"<>|]+/g, '-')}.mp4`;
      setPhase({ kind: 'done', url, size: res.blob.size, elapsedMs: res.elapsedMs, name: file });
      triggerDownload(url, file);
    } catch (e) {
      if (e instanceof ExportCancelledError) setPhase({ kind: 'setup' });
      else setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && phase.kind !== 'running' && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" data-testid="export-dialog">
        <h2 id="export-title">Exportera MP4</h2>

        {phase.kind === 'setup' && (
          <>
            <div className="field">
              <label htmlFor="exp-name">Filnamn</label>
              <input id="exp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <span className="field-label">Kvalitet</span>
              <div className="seg" role="group" aria-label="Kvalitet">
                {(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((k) => (
                  <button key={k} aria-pressed={preset === k} onClick={() => setPreset(k)}>
                    {QUALITY_PRESETS[k].label}
                  </button>
                ))}
              </div>
            </div>
            <dl className="kv">
              <dt>Format</dt>
              <dd>MP4 · H.264 · AAC</dd>
              <dt>Upplösning</dt>
              <dd>
                {width}×{height} · {fpsValue(fps).toFixed(fps.den === 1 ? 0 : 2)} fps
              </dd>
              <dt>Längd</dt>
              <dd>{dur.toFixed(1)} s</dd>
              <dt>Bithastighet</dt>
              <dd>{(bitrate / 1e6).toFixed(1)} Mbit/s</dd>
              <dt>Uppskattad storlek</dt>
              <dd>~{estMB.toFixed(estMB < 10 ? 1 : 0)} MB</dd>
            </dl>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Avbryt
              </button>
              <button className="btn primary" onClick={start} disabled={dur === 0}>
                Exportera
              </button>
            </div>
          </>
        )}

        {phase.kind === 'running' && (
          <>
            <Progress p={phase.progress} />
            <p className="hint">Exporten körs i bakgrunden och använder samma rendering som förhandsvisningen.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => abort.current?.abort()}>
                Avbryt export
              </button>
            </div>
          </>
        )}

        {phase.kind === 'done' && (
          <>
            <p data-testid="export-done">
              Klar på {(phase.elapsedMs / 1000).toFixed(1)} s · {(phase.size / 1e6).toFixed(1)} MB
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Stäng
              </button>
              <a className="btn primary" href={phase.url} download={phase.name} data-testid="export-download">
                <Download /> Ladda ner igen
              </a>
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <p style={{ color: 'var(--danger)' }} data-testid="export-error">
              {phase.message}
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Stäng
              </button>
              <button className="btn primary" onClick={() => setPhase({ kind: 'setup' })}>
                Försök igen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Progress({ p }: { p: ExportProgress | null }) {
  const pct = p ? (p.frame / p.total) * 100 : 0;
  const eta = p && p.framesPerSecond > 0 ? (p.total - p.frame) / p.framesPerSecond : null;
  return (
    <div className="field">
      <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span>{p ? `${p.frame} / ${p.total} bildrutor` : 'Förbereder…'}</span>
        <span>{p ? `${p.framesPerSecond.toFixed(0)} fps${eta !== null ? ` · ${Math.ceil(eta)} s kvar` : ''}` : ''}</span>
      </div>
    </div>
  );
}

function triggerDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

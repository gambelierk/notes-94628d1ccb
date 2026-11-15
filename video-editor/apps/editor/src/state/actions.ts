import {
  addAsset,
  addTrack,
  clipEnd,
  createTemplateClip,
  createVideoClip,
  findAsset,
  findClip,
  insertClip,
  normalizeFps,
  projectDuration,
  removeClip,
  secondsToFrames,
  setClipParam,
  setTemplateProp,
  splitAtFrame,
  splitClip,
  updateSettings,
  type Frame,
  type Project,
  type PropValue,
  type TrackKind,
  type VideoAsset,
} from '@ve/core';
import { UnsupportedMediaError } from '@ve/media';
import { media } from '../services/media';
import { templates } from '../services/templates';
import { committedProject, useEditor } from './store';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function ensureTrack(p: Project, kind: TrackKind, preferred: string | null): [Project, string] {
  const pref = preferred ? p.tracks.find((t) => t.id === preferred && t.kind === kind) : undefined;
  if (pref) return [p, pref.id];
  const existing = p.tracks.find((t) => t.kind === kind);
  if (existing) return [p, existing.id];
  const next = addTrack(p, kind);
  return [next, next.tracks[next.tracks.length - 1]!.id];
}

/** Import files picked or dropped by the user: MP4 video, images and .riv templates. */
export async function importFiles(files: Iterable<File>): Promise<void> {
  const store = useEditor.getState();
  for (const file of files) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.riv')) {
        const def = await templates.importFile(file);
        store.toast(`Mallen "${def.name}" har lagts till`);
      } else if (file.type.startsWith('image/')) {
        const asset = await media.importImage(file);
        store.apply((p) => addAsset(p, asset), 'Importera bild');
      } else if (file.type.startsWith('video/') || /\.(mp4|m4v|mov)$/.test(name)) {
        const { asset, thumbnail } = await media.importVideo(file);
        if (thumbnail) store.setMediaThumb(asset.id, thumbnail);
        store.apply((p) => addAsset(p, asset), 'Importera video');
      } else {
        store.toast(`${file.name}: filtypen stöds inte än (MP4, bilder och .riv)`, 'error');
      }
    } catch (e) {
      const msg = e instanceof UnsupportedMediaError || e instanceof Error ? e.message : String(e);
      store.toast(`${file.name}: ${msg}`, 'error');
      console.error(e);
    }
  }
}

/** First video in an empty sequence decides resolution and frame rate (like "new sequence from clip"). */
function adoptSettings(p: Project, asset: VideoAsset): Project {
  if (projectDuration(p) > 0) return p;
  return updateSettings(p, { width: even(asset.width), height: even(asset.height), fps: normalizeFps(asset.fps) });
}

export function addVideoToTimeline(assetId: string, trackId: string | null, frame: Frame | null) {
  const store = useEditor.getState();
  let newClipId: string | null = null;
  store.apply((p0) => {
    const asset = findAsset(p0, assetId);
    if (!asset || asset.kind !== 'video') throw new Error('Mediet finns inte');
    let p = adoptSettings(p0, asset);
    const [p1, tid] = ensureTrack(p, 'video', trackId);
    p = p1;
    const track = p.tracks.find((t) => t.id === tid)!;
    const start = frame ?? track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const clip = createVideoClip(asset, start, p.settings.fps);
    newClipId = clip.id;
    return insertClip(p, tid, clip);
  }, 'Lägg till klipp');
  if (newClipId) store.select(newClipId);
}

export function addTemplateToTimeline(templateId: string, trackId: string | null, frame: Frame | null) {
  const store = useEditor.getState();
  const tpl = store.templates.find((t) => t.def.id === templateId);
  if (!tpl) return;
  let newClipId: string | null = null;
  store.apply((p0) => {
    const [p, tid] = ensureTrack(p0, 'graphics', trackId);
    const fps = p.settings.fps;
    const duration = secondsToFrames(tpl.def.defaultDuration, fps);
    const defaults = Object.fromEntries(tpl.def.fields.map((f) => [f.key, f.default]));
    const clip = createTemplateClip(templateId, frame ?? store.playhead, duration, defaults);
    newClipId = clip.id;
    return insertClip(p, tid, clip);
  }, `Lägg till ${tpl.def.name}`);
  if (newClipId) store.select(newClipId);
}

export function splitAtPlayhead() {
  const s = useEditor.getState();
  const p = committedProject();
  const sel = s.selection ? findClip(p, s.selection) : undefined;
  if (sel && s.playhead > sel.clip.start && s.playhead < clipEnd(sel.clip)) {
    s.apply((x) => splitClip(x, sel.clip.id, s.playhead), 'Dela klipp');
  } else {
    s.apply((x) => splitAtFrame(x, s.playhead), 'Dela vid spelhuvudet');
  }
}

export function deleteSelection(ripple: boolean) {
  const s = useEditor.getState();
  if (!s.selection) return;
  const id = s.selection;
  s.apply((p) => removeClip(p, id, ripple), ripple ? 'Ta bort och stäng luckan' : 'Ta bort klipp');
  s.select(null);
}

export function setTemplateField(clipId: string, key: string, value: PropValue) {
  useEditor.getState().apply((p) => setTemplateProp(p, clipId, key, value), 'Ändra mallfält', `prop:${clipId}:${key}`);
}

export async function setTemplateImage(clipId: string, key: string, file: File) {
  const store = useEditor.getState();
  try {
    const asset = await media.importImage(file);
    store.apply(
      (p) => setTemplateProp(addAsset(p, asset), clipId, key, { type: 'image', assetId: asset.id }),
      'Byt bild',
    );
  } catch (e) {
    store.toast(`Bilden kunde inte läsas: ${e instanceof Error ? e.message : e}`, 'error');
  }
}

export function setParam(clipId: string, param: 'volume' | 'opacity', value: number) {
  useEditor.getState().apply((p) => setClipParam(p, clipId, param, value), param === 'volume' ? 'Volym' : 'Opacitet', `${param}:${clipId}`);
}

export function stepPlayhead(delta: Frame) {
  const s = useEditor.getState();
  const end = projectDuration(committedProject());
  s.setPlayhead(Math.min(Math.max(0, s.playhead + delta), Math.max(0, end)));
}

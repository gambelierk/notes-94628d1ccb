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
import { createId, type ImageAsset, type MediaDTO } from '@ve/core';
import { UnsupportedMediaError } from '@ve/media';
import { customerApi } from '../services/api';
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

/**
 * Upload a file to the customer project with progress shown in the media bin.
 * The local file is kept, so playback does not have to fetch it back.
 */
async function uploadToProject(file: File): Promise<MediaDTO> {
  const store = useEditor.getState();
  const token = store.composition!.token;
  const uploadId = createId('up');
  store.setUpload({ id: uploadId, name: file.name, progress: 0 });
  try {
    const m = await customerApi.uploadMedia(token, file, (f) => useEditor.getState().setUpload({ id: uploadId, name: file.name, progress: f }));
    media.registerRemote(m.id, m.url, m.name, m.size);
    media.registerLocal(m.id, file);
    useEditor.getState().setServerMedia([...useEditor.getState().serverMedia.filter((x) => x.id !== m.id), m]);
    return m;
  } finally {
    useEditor.getState().endUpload(uploadId);
  }
}

/** Import files picked or dropped by the user: MP4 video, images and .riv templates. */
export async function importFiles(files: Iterable<File>): Promise<void> {
  const store = useEditor.getState();
  const saved = !!store.composition; // customer composition: files go to the server
  for (const file of files) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.riv')) {
        await importTemplateFile(file);
      } else if (file.type.startsWith('image/')) {
        const id = saved ? (await uploadToProject(file)).id : createId('img');
        const asset = await media.importImage(file, id);
        store.apply((p) => addAsset(p, asset), 'Importera bild');
      } else if (file.type.startsWith('video/') || /\.(mp4|m4v|mov)$/.test(name)) {
        // Probe locally first: fail fast on unsupported codecs before uploading.
        await media.probeLocal(file);
        const id = saved ? (await uploadToProject(file)).id : createId('vid');
        const { asset, thumbnail } = await media.importVideo(file, id);
        if (thumbnail) store.setMediaThumb(asset.id, thumbnail);
        store.apply((p) => addAsset(p, asset), 'Importera video');
      } else {
        store.toast(`${file.name}: filtypen stöds inte än (MP4, MOV, bilder och .riv)`, 'error');
      }
    } catch (e) {
      const msg = e instanceof UnsupportedMediaError || e instanceof Error ? e.message : String(e);
      store.toast(`${file.name}: ${msg}`, 'error');
      console.error(e);
    }
  }
}

/** A .riv file from the user: local in demo mode, uploaded to the project for customers (if allowed). */
export async function importTemplateFile(file: File): Promise<void> {
  const store = useEditor.getState();
  const lib = store.library;
  if (lib.kind === 'share') {
    if (!lib.allowUploads) {
      store.toast('Mallar läggs till av administratören för det här projektet', 'error');
      return;
    }
    const uploadId = createId('up');
    store.setUpload({ id: uploadId, name: file.name, progress: 0 });
    try {
      const t = await customerApi.uploadTemplate(lib.token, file, (f) => useEditor.getState().setUpload({ id: uploadId, name: file.name, progress: f }));
      const def = await templates.addShared(t);
      store.toast(`Mallen "${def.name}" har lagts till i projektet`);
    } finally {
      useEditor.getState().endUpload(uploadId);
    }
    return;
  }
  const def = await templates.importFile(file);
  store.toast(`Mallen "${def.name}" har lagts till`);
}

/** First video in an empty sequence decides resolution and frame rate (like "new sequence from clip"). */
function adoptSettings(p: Project, asset: VideoAsset): Project {
  if (projectDuration(p) > 0 || p.settings.autoFormat === false) return p;
  return updateSettings(p, { width: even(asset.width), height: even(asset.height), fps: normalizeFps(asset.fps), autoFormat: false });
}

export async function addVideoToTimeline(assetId: string, trackId: string | null, frame: Frame | null): Promise<void> {
  const store = useEditor.getState();
  // Media from the project bin that this composition has not used yet.
  if (!findAsset(committedProject(), assetId)) {
    try {
      const asset = await media.probeRemote(assetId);
      store.apply((p) => addAsset(p, asset), 'Lägg till media');
      void media.thumbnail(assetId).then((u) => u && useEditor.getState().setMediaThumb(assetId, u));
    } catch (e) {
      store.toast(`Filmen kunde inte öppnas: ${e instanceof Error ? e.message : e}`, 'error');
      return;
    }
  }
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
    const id = store.composition ? (await uploadToProject(file)).id : createId('img');
    const asset: ImageAsset = await media.importImage(file, id);
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

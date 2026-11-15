import {
  addAsset,
  addTrack,
  clipEnd,
  createImageClip,
  createTemplateClip,
  resetClipTransform,
  setClipTransform,
  type TransformValues,
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
import {
  createAudioClip,
  createId,
  createTextClip,
  parseSubtitles,
  setClipFades,
  setTextContent,
  setTrackVolume,
  SUBTITLE_STYLE,
  brandTextStyle,
  SUBTITLE_Y,
  TEXT_PRESETS,
  toSrt,
  addTransition,
  DEFAULT_TRANSITION_SECONDS,
  jointRef,
  removeTransition,
  setTransitionDuration,
  type Joint,
  type TransitionRef,
  type Cue,
  type ImageAsset,
  type MediaDTO,
  type TextStyle,
} from '@ve/core';
import { UnsupportedMediaError } from '@ve/media';
import { customerApi } from '../services/api';
import { media } from '../services/media';
import { templates } from '../services/templates';
import { sniffVector, VECTOR_FILE, vectors } from '../services/vector';
import { brandTextFonts } from '../services/branding';
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
async function uploadToProject(file: File, keepLocal = true): Promise<MediaDTO> {
  const store = useEditor.getState();
  const token = store.composition!.token;
  const uploadId = createId('up');
  store.setUpload({ id: uploadId, name: file.name, progress: 0 });
  try {
    const m = await customerApi.uploadMedia(token, file, (f) => useEditor.getState().setUpload({ id: uploadId, name: file.name, progress: f }));
    media.registerRemote(m.id, m.url, m.name, m.size, m.kind, m.mime);
    if (keepLocal) media.registerLocal(m.id, file);
    useEditor.getState().setServerMedia([...useEditor.getState().serverMedia.filter((x) => x.id !== m.id), m]);
    return m;
  } finally {
    useEditor.getState().endUpload(uploadId);
  }
}

const AUDIO_FILE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/;
const VECTOR_MIME = new Set(['image/svg+xml', 'application/pdf', 'application/postscript', 'application/illustrator', 'image/x-eps', 'application/eps']);

/**
 * Vector graphics: SVG and PDF/Illustrator are read here; EPS (PostScript)
 * is converted to PDF by the server when it is uploaded to a customer project.
 */
async function importVectorFile(file: File, saved: boolean): Promise<void> {
  const store = useEditor.getState();
  const format = sniffVector(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  if (!format) throw new Error('filen innehåller ingen vektorgrafik som kan läsas (SVG, PDF, Illustrator eller EPS)');
  let asset: ImageAsset;
  if (format === 'postscript') {
    if (!saved) throw new Error('EPS-filer konverteras när de laddas upp till ett projekt. Öppna en komposition i ett kundprojekt, eller spara filen som PDF eller SVG.');
    const m = await uploadToProject(file, false); // the server stores it converted to PDF
    asset = await media.probeImage(m.id);
  } else {
    // check locally first, so a broken file never gets uploaded
    await vectors.probe(file, format);
    const id = saved ? (await uploadToProject(file)).id : createId('img');
    asset = await media.importVector(file, file.name, format, id);
  }
  store.apply((p) => addAsset(p, asset), 'Importera grafik');
  void media.thumbnail(asset.id).then((u) => u && useEditor.getState().setMediaThumb(asset.id, u));
}

/** Import files picked or dropped by the user: video, images, sound files, subtitles and .riv templates. */
export async function importFiles(files: Iterable<File>): Promise<void> {
  const store = useEditor.getState();
  const saved = !!store.composition; // customer composition: files go to the server
  for (const file of files) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.riv')) {
        await importTemplateFile(file);
      } else if (/\.(srt|vtt)$/.test(name)) {
        await importSubtitles(file);
      } else if (file.type.startsWith('audio/') || AUDIO_FILE.test(name)) {
        // Probe locally first: fail fast on unsupported formats before uploading.
        await media.importAudio(file, createId('probe'));
        const id = saved ? (await uploadToProject(file)).id : createId('aud');
        const asset = await media.importAudio(file, id);
        store.apply((p) => addAsset(p, asset), 'Importera ljud');
        void media.peaks(asset.id);
      } else if (VECTOR_FILE.test(name) || VECTOR_MIME.has(file.type)) {
        await importVectorFile(file, saved);
      } else if (file.type.startsWith('image/')) {
        const id = saved ? (await uploadToProject(file)).id : createId('img');
        const asset = await media.importImage(file, id);
        store.apply((p) => addAsset(p, asset), 'Importera bild');
        void media.thumbnail(asset.id).then((u) => u && useEditor.getState().setMediaThumb(asset.id, u));
      } else if (file.type.startsWith('video/') || /\.(mp4|m4v|mov)$/.test(name)) {
        // Probe locally first: fail fast on unsupported codecs before uploading.
        await media.probeLocal(file);
        const id = saved ? (await uploadToProject(file)).id : createId('vid');
        const { asset, thumbnail } = await media.importVideo(file, id);
        if (thumbnail) store.setMediaThumb(asset.id, thumbnail);
        store.apply((p) => addAsset(p, asset), 'Importera video');
      } else {
        store.toast(`${file.name}: filtypen stöds inte (film: MP4/MOV, bild: PNG/JPEG/WebP, grafik: SVG/PDF/AI/EPS, ljud: MP3/WAV/M4A/Ogg/FLAC, text: SRT/VTT)`, 'error');
      }
    } catch (e) {
      const msg = e instanceof UnsupportedMediaError || e instanceof Error ? e.message : String(e);
      store.toast(`${file.name}: ${msg}`, 'error');
      console.error(e);
    }
  }
}

/** What the user sees for a template file: its name, never the file format. */
function templateLabel(fileName: string): string {
  return fileName.replace(/\.riv$/i, '').replace(/[_-]+/g, ' ').trim() || 'Mall';
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
    const label = templateLabel(file.name);
    store.setUpload({ id: uploadId, name: label, progress: 0 });
    try {
      const t = await customerApi.uploadTemplate(lib.token, file, (f) => useEditor.getState().setUpload({ id: uploadId, name: label, progress: f }));
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

/** Put a sound file on an audio track (default: the first audio track, at the playhead). */
export async function addAudioToTimeline(assetId: string, trackId: string | null, frame: Frame | null): Promise<void> {
  const store = useEditor.getState();
  if (!findAsset(committedProject(), assetId)) {
    try {
      const asset = await media.probeRemoteAudio(assetId);
      store.apply((p) => addAsset(p, asset), 'Lägg till ljud');
    } catch (e) {
      store.toast(`Ljudfilen kunde inte öppnas: ${e instanceof Error ? e.message : e}`, 'error');
      return;
    }
  }
  let newClipId: string | null = null;
  store.apply((p0) => {
    const asset = findAsset(p0, assetId);
    if (!asset || asset.kind !== 'audio') throw new Error('Ljudfilen finns inte');
    const [p, tid] = ensureTrack(p0, 'audio', trackId);
    const clip = createAudioClip(asset, frame ?? useEditor.getState().playhead, p.settings.fps);
    newClipId = clip.id;
    return insertClip(p, tid, clip);
  }, 'Lägg till ljud');
  if (newClipId) store.select(newClipId);
}

export const TEXT_DEFAULT_SECONDS = 4;

/** The customer's own typefaces on this page, if any (text presets and subtitles use them). */
export function currentBrandFonts() {
  const lib = useEditor.getState().library;
  return brandTextFonts(lib.kind === 'share' ? lib.branding : null);
}

/** Add a text clip from a preset on a graphics track at the playhead. */
export function addTextToTimeline(presetId: string, trackId: string | null, frame: Frame | null) {
  const store = useEditor.getState();
  const preset = TEXT_PRESETS.find((p) => p.id === presetId) ?? TEXT_PRESETS[0]!;
  let newClipId: string | null = null;
  store.apply((p0) => {
    const [p, tid] = ensureTrack(p0, 'graphics', trackId);
    const style = brandTextStyle(preset.style, preset.role, currentBrandFonts());
    const clip = createTextClip(preset.sample, style, frame ?? store.playhead, secondsToFrames(TEXT_DEFAULT_SECONDS, p.settings.fps), preset.y);
    newClipId = clip.id;
    return insertClip(p, tid, clip);
  }, `Lägg till ${preset.label.toLowerCase()}`);
  if (newClipId) store.select(newClipId);
}

export function setText(clipId: string, patch: { text?: string; style?: Partial<TextStyle> }) {
  const key = patch.text !== undefined ? 'text' : Object.keys(patch.style ?? {}).join();
  useEditor.getState().apply((p) => setTextContent(p, clipId, patch), 'Ändra text', `text:${clipId}:${key}`);
}

export function setFades(clipId: string, fades: { fadeIn?: Frame; fadeOut?: Frame }) {
  useEditor.getState().apply((p) => setClipFades(p, clipId, fades), 'Tona in/ut', `fade:${clipId}:${Object.keys(fades).join()}`);
}

export function setTrackGain(trackId: string, volume: number) {
  useEditor.getState().apply((p) => setTrackVolume(p, trackId, volume), 'Spårvolym', `trackvol:${trackId}`);
}

/** Import .srt/.vtt: every cue becomes a text clip on a new subtitle track. */
export async function importSubtitles(file: File): Promise<void> {
  const store = useEditor.getState();
  const cues = parseSubtitles(await file.text());
  if (cues.length === 0) {
    store.toast(`${file.name}: hittade inga undertexter`, 'error');
    return;
  }
  const subtitleStyle = brandTextStyle(SUBTITLE_STYLE, 'body', currentBrandFonts());
  store.apply((p0) => {
    let p = addTrack(p0, 'graphics');
    const tid = p.tracks[p.tracks.length - 1]!.id;
    const n = p.tracks.filter((t) => t.role === 'subtitles').length + 1;
    p = { ...p, tracks: p.tracks.map((t) => (t.id === tid ? { ...t, name: `T${n}`, role: 'subtitles' as const } : t)) };
    const fps = p.settings.fps;
    for (const cue of cues) {
      const start = secondsToFrames(cue.start, fps);
      const end = Math.max(start + 1, secondsToFrames(cue.end, fps));
      p = insertClip(p, tid, createTextClip(cue.text, subtitleStyle, start, end - start, SUBTITLE_Y));
    }
    return p;
  }, 'Importera undertexter');
  store.toast(`${cues.length} undertexter importerade från ${file.name}`);
}

/** Text clips on subtitle tracks (or all text clips if there are none) as SRT. */
export function subtitlesAsSrt(project: Project): { srt: string; count: number } {
  const fps = project.settings.fps;
  const subTracks = project.tracks.filter((t) => t.role === 'subtitles');
  const tracks = subTracks.length ? subTracks : project.tracks.filter((t) => t.kind === 'graphics');
  const cues: Cue[] = tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'text')
    .map((c) => ({ start: (c.start * fps.den) / fps.num, end: ((c.start + c.duration) * fps.den) / fps.num, text: c.kind === 'text' ? c.text : '' }))
    .sort((a, b) => a.start - b.start);
  return { srt: toSrt(cues), count: cues.length };
}

export const IMAGE_DEFAULT_SECONDS = 5;

/** Put an image on the timeline (default: the first graphics track, at the playhead). */
export async function addImageToTimeline(assetId: string, trackId: string | null, frame: Frame | null): Promise<void> {
  const store = useEditor.getState();
  if (!findAsset(committedProject(), assetId)) {
    try {
      const asset = await media.probeImage(assetId);
      store.apply((p) => addAsset(p, asset), 'Lägg till bild');
    } catch (e) {
      store.toast(`Bilden kunde inte öppnas: ${e instanceof Error ? e.message : e}`, 'error');
      return;
    }
  }
  let newClipId: string | null = null;
  store.apply((p0) => {
    const asset = findAsset(p0, assetId);
    if (!asset || asset.kind !== 'image') throw new Error('Bilden finns inte');
    const preferred = trackId ? p0.tracks.find((t) => t.id === trackId) : undefined;
    const [p, tid] = preferred ? [p0, preferred.id] : ensureTrack(p0, 'graphics', null);
    const clip = createImageClip(asset, frame ?? useEditor.getState().playhead, secondsToFrames(IMAGE_DEFAULT_SECONDS, p.settings.fps));
    newClipId = clip.id;
    return insertClip(p, tid, clip);
  }, 'Lägg till bild');
  if (newClipId) store.select(newClipId);
}

/** Move/scale/rotate a visual clip. `mergeKey` groups rapid edits (typing, slider drags). */
export function setTransform(clipId: string, patch: Partial<TransformValues>, label = 'Placering') {
  useEditor.getState().apply((p) => setClipTransform(p, clipId, patch), label, `transform:${clipId}:${Object.keys(patch).join()}`);
}

export function resetTransform(clipId: string) {
  useEditor.getState().apply((p) => resetClipTransform(p, clipId), 'Återställ placering');
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

/** Add a dissolve (between touching clips) or a fade to/from black (free clip end) at a joint. */
export function addTransitionAt(j: Joint) {
  const s = useEditor.getState();
  const frames = secondsToFrames(DEFAULT_TRANSITION_SECONDS, s.history.present.project.settings.fps);
  s.apply((p) => addTransition(p, j, frames), j.kind === 'cut' ? 'Lägg till övertoning' : j.kind === 'start' ? 'Tona in från svart' : 'Tona ut till svart');
  s.selectTransition(jointRef(j));
}

export function setTransitionLength(ref: TransitionRef, frames: Frame) {
  useEditor.getState().apply((p) => setTransitionDuration(p, ref, frames), 'Övergångens längd', `trans:${ref.clipId}:${ref.edge}`);
}

export function deleteTransition(ref: TransitionRef) {
  const s = useEditor.getState();
  s.apply((p) => removeTransition(p, ref), 'Ta bort övergång');
  s.selectTransition(null);
}

/** Delete/Backspace: removes the selected transition, or the selected clip (Shift: close the gap). */
export function deleteSelection(ripple: boolean) {
  const s = useEditor.getState();
  if (s.transition) {
    deleteTransition(s.transition);
    return;
  }
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

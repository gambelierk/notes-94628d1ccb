import {
  argbToHex,
  humanizeKey,
  type PropValue,
  type Segment,
  type TemplateDefinition,
  type TemplateField,
  type TemplateManifest,
  type TemplateTiming,
} from '@ve/core';
import type { Artboard, File as RiveFile, LinearAnimation, ViewModel, ViewModelInstance } from '@rive-app/canvas-advanced';

const NO_WORK_AREA = 4294967295;

const IN_NAMES = ['in', 'intro', 'animate in', 'animatein', 'enter'];
const HOLD_NAMES = ['hold', 'loop', 'idle', 'main'];
const OUT_NAMES = ['out', 'outro', 'animate out', 'animateout', 'exit'];

interface AnimInfo {
  name: string;
  duration: number;
  loop: boolean;
}

function animInfo(anim: LinearAnimation): AnimInfo {
  // The typings lag behind the runtime: LinearAnimation exposes duration (frames),
  // fps, workStart and workEnd.
  const a = anim as unknown as { name: string; duration: number; fps: number; workStart: number; workEnd: number; loopValue: number };
  const fps = a.fps || 60;
  const useWork = a.workStart !== NO_WORK_AREA && a.workEnd !== NO_WORK_AREA && a.workEnd > a.workStart;
  const frames = useWork ? a.workEnd - a.workStart : a.duration;
  return { name: a.name, duration: frames / fps, loop: a.loopValue !== 0 };
}

export function listAnimations(artboard: Artboard): AnimInfo[] {
  const out: AnimInfo[] = [];
  for (let i = 0; i < artboard.animationCount(); i++) out.push(animInfo(artboard.animationByIndex(i)));
  return out;
}

function pick(anims: AnimInfo[], preferred: string | undefined, candidates: string[]): AnimInfo | null {
  if (preferred) return anims.find((a) => a.name === preferred) ?? null;
  return anims.find((a) => candidates.includes(a.name.trim().toLowerCase())) ?? null;
}

function detectTiming(artboard: Artboard, manifest?: TemplateManifest): TemplateTiming {
  const anims = listAnimations(artboard);
  const seg = (a: AnimInfo | null): Segment | null => (a ? { name: a.name, duration: a.duration } : null);
  const inA = pick(anims, manifest?.animations?.in, IN_NAMES);
  const outA = pick(anims, manifest?.animations?.out, OUT_NAMES);
  const holdA = pick(anims, manifest?.animations?.hold, HOLD_NAMES);
  if ((inA || outA) && !manifest?.stateMachine) {
    return { kind: 'segments', in: seg(inA), hold: seg(holdA), out: seg(outA) };
  }
  const smCount = artboard.stateMachineCount();
  if (smCount > 0) {
    const name = manifest?.stateMachine ?? artboard.stateMachineByIndex(0).name;
    return { kind: 'stateMachine', name };
  }
  const first = anims[0];
  if (first) return { kind: 'animation', name: first.name, duration: first.duration, loop: first.loop };
  return { kind: 'static' };
}

export function defaultViewModel(file: RiveFile, artboard: Artboard): ViewModel | null {
  try {
    return file.defaultArtboardViewModel(artboard) ?? null;
  } catch {
    return null;
  }
}

export function createViewModelInstance(vm: ViewModel): ViewModelInstance | null {
  try {
    return vm.defaultInstance() ?? vm.instance() ?? null;
  } catch {
    try {
      return vm.instance() ?? null;
    } catch {
      return null;
    }
  }
}

function readDefault(vmi: ViewModelInstance | null, key: string, type: TemplateField['type']): PropValue {
  try {
    switch (type) {
      case 'string':
        return { type, value: vmi?.string(key)?.value ?? '' };
      case 'color':
      {
        // A fully transparent default is almost always "colour not set": show it opaque.
        let argb = (vmi?.color(key)?.value ?? 0xffffffff) >>> 0;
        if (argb >>> 24 === 0) argb = (argb | 0xff000000) >>> 0;
        return { type, value: argbToHex(argb) };
      }
      case 'number':
        return { type, value: vmi?.number(key)?.value ?? 0 };
      case 'boolean':
        return { type, value: vmi?.boolean(key)?.value ?? false };
      case 'enum':
        return { type, value: vmi?.enum(key)?.value ?? '' };
      case 'image':
        return { type, assetId: null };
    }
  } catch {
    // fall through to empty defaults
  }
  return type === 'image' ? { type, assetId: null } : ({ type, value: '' } as PropValue);
}

const TYPE_MAP: Record<string, TemplateField['type'] | undefined> = {
  string: 'string',
  color: 'color',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  enumType: 'enum',
  image: 'image',
  assetImage: 'image',
};

/**
 * Inspect a Rive file and produce a template definition. Editable fields come
 * from the artboard's default view model (data binding); the manifest can
 * rename, reorder or hide them.
 */
export function inspectTemplate(file: RiveFile, manifest: TemplateManifest, fallbackId: string): TemplateDefinition {
  const artboard = manifest.artboard ? file.artboardByName(manifest.artboard) : file.defaultArtboard();
  if (!artboard) throw new Error(`Mallen saknar sin bildyta (${manifest.artboard ?? 'standard'})`);
  try {
    const vm = defaultViewModel(file, artboard);
    const vmi = vm ? createViewModelInstance(vm) : null;
    const detected: TemplateField[] = [];
    for (const prop of vm?.getProperties() ?? []) {
      const type = TYPE_MAP[String(prop.type)];
      if (!type) continue;
      const field: TemplateField = { key: prop.name, label: humanizeKey(prop.name), type, default: readDefault(vmi, prop.name, type) };
      if (type === 'enum') {
        try {
          field.options = vmi?.enum(prop.name)?.values ?? [];
        } catch {
          field.options = [];
        }
      }
      if (type === 'string' && field.default.type === 'string' && field.default.value.includes('\n')) field.multiline = true;
      detected.push(field);
    }

    let fields = detected;
    if (manifest.fields?.length) {
      const byKey = new Map(detected.map((f) => [f.key, f]));
      const ordered: TemplateField[] = [];
      for (const o of manifest.fields) {
        const base = byKey.get(o.key);
        byKey.delete(o.key);
        if (!base || o.hidden) continue;
        const { hidden: _h, ...rest } = o;
        ordered.push({ ...base, ...rest, default: rest.default ?? base.default } as TemplateField);
      }
      fields = [...ordered, ...byKey.values()];
    }

    const timing = detectTiming(artboard, manifest);
    let defaultDuration = manifest.defaultDuration ?? 5;
    if (!manifest.defaultDuration && timing.kind === 'segments') {
      const io = (timing.in?.duration ?? 0) + (timing.out?.duration ?? 0);
      defaultDuration = Math.max(5, io + (timing.hold?.duration ?? 0));
    }

    return {
      id: manifest.id ?? fallbackId,
      name: manifest.name ?? artboard.name ?? fallbackId,
      category: manifest.category ?? 'Övrigt',
      artboard: artboard.name,
      width: artboard.width,
      height: artboard.height,
      defaultDuration,
      fields,
      timing,
      ...(manifest.layout ? { layout: manifest.layout } : {}),
    };
  } finally {
    artboard.delete();
  }
}

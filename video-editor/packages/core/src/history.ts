import type { Project } from './types';

/**
 * Undo/redo by immutable snapshots. Operations never mutate, so successive
 * projects share almost all of their structure and snapshots are cheap.
 *
 * `mergeKey` lets rapid edits of the same thing (typing in a text field,
 * dragging a slider) collapse into a single undo step.
 */
export interface HistoryEntry {
  project: Project;
  label: string;
  mergeKey?: string;
  at: number;
}

export interface History {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 200;
export const MERGE_WINDOW_MS = 1500;

export function createHistory(project: Project): History {
  return { past: [], present: { project, label: 'Start', at: 0 }, future: [] };
}

export function commit(
  history: History,
  project: Project,
  label: string,
  mergeKey?: string,
  now: number = Date.now(),
): History {
  if (project === history.present.project) return history;
  const entry: HistoryEntry = { project, label, at: now, ...(mergeKey ? { mergeKey } : {}) };
  const canMerge =
    mergeKey !== undefined &&
    history.present.mergeKey === mergeKey &&
    now - history.present.at < MERGE_WINDOW_MS &&
    history.past.length > 0;
  if (canMerge) return { past: history.past, present: entry, future: [] };
  const past = [...history.past, history.present];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: entry, future: [] };
}

export function undo(history: History): History {
  const prev = history.past[history.past.length - 1];
  if (!prev) return history;
  return {
    past: history.past.slice(0, -1),
    present: { ...prev, mergeKey: undefined },
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const next = history.future[0];
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}
export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

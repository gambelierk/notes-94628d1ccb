import { describe, expect, it } from 'vitest';
import { createHistory, commit, undo, redo, createProject } from '../src';

describe('history', () => {
  it('undoes and redoes', () => {
    const p0 = createProject('a');
    const p1 = { ...p0, name: 'b' };
    const p2 = { ...p1, name: 'c' };
    let h = createHistory(p0);
    h = commit(h, p1, 'b');
    h = commit(h, p2, 'c');
    h = undo(h);
    expect(h.present.project.name).toBe('b');
    h = redo(h);
    expect(h.present.project.name).toBe('c');
  });

  it('merges rapid edits with the same key', () => {
    const p0 = createProject('a');
    let h = createHistory(p0);
    h = commit(h, { ...p0, name: 'H' }, 'text', 'k', 1000);
    h = commit(h, { ...p0, name: 'He' }, 'text', 'k', 1200);
    h = commit(h, { ...p0, name: 'Hej' }, 'text', 'k', 1400);
    expect(h.past.length).toBe(1);
    h = undo(h);
    expect(h.present.project.name).toBe('a');
  });
});

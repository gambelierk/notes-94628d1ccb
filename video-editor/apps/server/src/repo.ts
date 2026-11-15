import { randomBytes, randomUUID } from 'node:crypto';
import type { FieldOverride, TemplateDTO, TemplateLayout, TemplateSettings, WorkspaceDTO } from '@ve/core';
import type { DB } from './db.ts';

const now = () => new Date().toISOString();
export const newShareToken = () => randomBytes(18).toString('base64url'); // 144 bits
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

interface WorkspaceRow {
  id: string;
  name: string;
  share_token: string;
  sharing_enabled: number;
  created_at: string;
  updated_at: string;
  template_count?: number;
}

interface TemplateRow {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  artboard: string | null;
  default_duration: number | null;
  layout_json: string | null;
  fields_json: string | null;
  file_name: string;
  blob_key: string;
  sha256: string;
  size: number;
  sort: number;
  created_at: string;
  updated_at: string;
}

function toWorkspace(r: WorkspaceRow): WorkspaceDTO {
  return {
    id: r.id,
    name: r.name,
    shareToken: r.share_token,
    sharingEnabled: r.sharing_enabled === 1,
    templateCount: r.template_count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toTemplate(r: TemplateRow): TemplateDTO {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    category: r.category,
    artboard: r.artboard,
    defaultDuration: r.default_duration,
    layout: r.layout_json ? (JSON.parse(r.layout_json) as TemplateLayout) : null,
    fields: r.fields_json ? (JSON.parse(r.fields_json) as FieldOverride[]) : null,
    fileName: r.file_name,
    size: r.size,
    sha256: r.sha256,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class Repo {
  private readonly db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  /* ------------------------------------------------------------ workspaces */

  listWorkspaces(): WorkspaceDTO[] {
    const rows = this.db
      .prepare(
        `SELECT w.*, (SELECT COUNT(*) FROM templates t WHERE t.workspace_id = w.id) AS template_count
         FROM workspaces w ORDER BY w.name COLLATE NOCASE`,
      )
      .all() as unknown as WorkspaceRow[];
    return rows.map(toWorkspace);
  }

  getWorkspace(id: string): WorkspaceDTO | null {
    const r = this.db
      .prepare(
        `SELECT w.*, (SELECT COUNT(*) FROM templates t WHERE t.workspace_id = w.id) AS template_count
         FROM workspaces w WHERE w.id = ?`,
      )
      .get(id) as WorkspaceRow | undefined;
    return r ? toWorkspace(r) : null;
  }

  /** Only returns workspaces whose sharing is enabled. */
  getSharedWorkspace(token: string): WorkspaceDTO | null {
    const r = this.db.prepare('SELECT * FROM workspaces WHERE share_token = ? AND sharing_enabled = 1').get(token) as
      | WorkspaceRow
      | undefined;
    return r ? toWorkspace(r) : null;
  }

  createWorkspace(name: string): WorkspaceDTO {
    const id = newId('ws');
    const t = now();
    this.db
      .prepare('INSERT INTO workspaces (id, name, share_token, sharing_enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(id, name, newShareToken(), t, t);
    return this.getWorkspace(id)!;
  }

  updateWorkspace(id: string, patch: { name?: string; sharingEnabled?: boolean }): WorkspaceDTO | null {
    const w = this.getWorkspace(id);
    if (!w) return null;
    this.db
      .prepare('UPDATE workspaces SET name = ?, sharing_enabled = ?, updated_at = ? WHERE id = ?')
      .run(patch.name ?? w.name, (patch.sharingEnabled ?? w.sharingEnabled) ? 1 : 0, now(), id);
    return this.getWorkspace(id);
  }

  rotateShareToken(id: string): WorkspaceDTO | null {
    const r = this.db.prepare('UPDATE workspaces SET share_token = ?, updated_at = ? WHERE id = ?').run(newShareToken(), now(), id);
    return r.changes ? this.getWorkspace(id) : null;
  }

  /** Deletes the workspace and its templates; returns blob keys that may now be orphaned. */
  deleteWorkspace(id: string): string[] | null {
    const keys = (this.db.prepare('SELECT blob_key FROM templates WHERE workspace_id = ?').all(id) as { blob_key: string }[]).map(
      (r) => r.blob_key,
    );
    const r = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    return r.changes ? keys : null;
  }

  /* ------------------------------------------------------------ templates */

  listTemplates(workspaceId: string): TemplateDTO[] {
    const rows = this.db
      .prepare('SELECT * FROM templates WHERE workspace_id = ? ORDER BY sort, created_at')
      .all(workspaceId) as unknown as TemplateRow[];
    return rows.map(toTemplate);
  }

  getTemplate(id: string): (TemplateDTO & { blobKey: string }) | null {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
    return r ? { ...toTemplate(r), blobKey: r.blob_key } : null;
  }

  createTemplate(input: {
    workspaceId: string;
    name: string;
    category: string;
    fileName: string;
    blobKey: string;
    sha256: string;
    size: number;
  }): TemplateDTO {
    const id = newId('tpl');
    const t = now();
    const max = this.db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM templates WHERE workspace_id = ?').get(input.workspaceId) as {
      m: number;
    };
    this.db
      .prepare(
        `INSERT INTO templates (id, workspace_id, name, category, file_name, blob_key, sha256, size, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.workspaceId, input.name, input.category, input.fileName, input.blobKey, input.sha256, input.size, max.m + 1, t, t);
    this.touchWorkspace(input.workspaceId);
    return this.getTemplate(id)!;
  }

  updateTemplate(id: string, patch: Partial<TemplateSettings>): TemplateDTO | null {
    const cur = this.getTemplate(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db
      .prepare(
        `UPDATE templates SET name = ?, category = ?, artboard = ?, default_duration = ?, layout_json = ?, fields_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.category,
        next.artboard,
        next.defaultDuration,
        next.layout ? JSON.stringify(next.layout) : null,
        next.fields?.length ? JSON.stringify(next.fields) : null,
        now(),
        id,
      );
    this.touchWorkspace(cur.workspaceId);
    return this.getTemplate(id);
  }

  /** Returns the blob key if no other template references it any more. */
  deleteTemplate(id: string): { orphanedKey: string | null } | null {
    const cur = this.getTemplate(id);
    if (!cur) return null;
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    this.touchWorkspace(cur.workspaceId);
    return { orphanedKey: this.blobInUse(cur.blobKey) ? null : cur.blobKey };
  }

  blobInUse(key: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM templates WHERE blob_key = ? LIMIT 1').get(key);
  }

  private touchWorkspace(id: string) {
    this.db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), id);
  }

  /* ------------------------------------------------------------ sessions */

  createSession(tokenHash: string, days: number) {
    const created = new Date();
    const expires = new Date(created.getTime() + days * 86_400_000);
    this.db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
      tokenHash,
      created.toISOString(),
      expires.toISOString(),
    );
  }

  sessionValid(tokenHash: string): boolean {
    const r = this.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as { expires_at: string } | undefined;
    return !!r && new Date(r.expires_at).getTime() > Date.now();
  }

  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  purgeExpiredSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  }
}

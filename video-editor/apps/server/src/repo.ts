import { randomBytes, randomUUID } from 'node:crypto';
import type {
  CompositionDTO,
  CompositionSummaryDTO,
  FieldOverride,
  MediaDTO,
  TemplateDTO,
  TemplateLayout,
  TemplateSettings,
  UploadedBy,
  WorkspaceDTO,
} from '@ve/core';
import type { DB } from './db.ts';

const now = () => new Date().toISOString();
export const newShareToken = () => randomBytes(18).toString('base64url'); // 144 bits
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export class RevisionConflict extends Error {
  readonly current: number;
  constructor(current: number) {
    super('Kompositionen har ändrats någon annanstans');
    this.current = current;
  }
}

interface WorkspaceRow {
  id: string;
  name: string;
  share_token: string;
  sharing_enabled: number;
  allow_customer_uploads: number;
  created_at: string;
  updated_at: string;
  template_count: number;
  composition_count: number;
  media_count: number;
  media_bytes: number;
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
  uploaded_by: UploadedBy;
  created_at: string;
  updated_at: string;
}

interface MediaRow {
  id: string;
  workspace_id: string;
  kind: 'video' | 'image' | 'audio';
  name: string;
  mime: string;
  size: number;
  blob_key: string;
  created_at: string;
}

interface CompositionRow {
  id: string;
  workspace_id: string;
  name: string;
  project_json: string;
  revision: number;
  width: number;
  height: number;
  duration_seconds: number;
  thumb_key: string | null;
  created_at: string;
  updated_at: string;
}

const WORKSPACE_SELECT = `
  SELECT w.*,
    (SELECT COUNT(*) FROM templates t WHERE t.workspace_id = w.id) AS template_count,
    (SELECT COUNT(*) FROM compositions c WHERE c.workspace_id = w.id) AS composition_count,
    (SELECT COUNT(*) FROM media m WHERE m.workspace_id = w.id) AS media_count,
    (SELECT COALESCE(SUM(m.size), 0) FROM media m WHERE m.workspace_id = w.id) AS media_bytes
  FROM workspaces w`;

function toWorkspace(r: WorkspaceRow): WorkspaceDTO {
  return {
    id: r.id,
    name: r.name,
    shareToken: r.share_token,
    sharingEnabled: r.sharing_enabled === 1,
    allowCustomerUploads: r.allow_customer_uploads === 1,
    templateCount: r.template_count ?? 0,
    compositionCount: r.composition_count ?? 0,
    mediaCount: r.media_count ?? 0,
    mediaBytes: r.media_bytes ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toTemplate(r: TemplateRow): TemplateDTO {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    uploadedBy: r.uploaded_by,
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

export interface MediaRecord extends Omit<MediaDTO, 'url'> {
  workspaceId: string;
  blobKey: string;
}

function toMedia(r: MediaRow): MediaRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    kind: r.kind,
    name: r.name,
    mime: r.mime,
    size: r.size,
    blobKey: r.blob_key,
    createdAt: r.created_at,
  };
}

export interface CompositionRecord extends Omit<CompositionDTO, 'thumbnailUrl'> {
  workspaceId: string;
  thumbKey: string | null;
}

function toComposition(r: CompositionRow, withProject: boolean): CompositionRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    revision: r.revision,
    width: r.width,
    height: r.height,
    durationSeconds: r.duration_seconds,
    thumbKey: r.thumb_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    project: withProject ? JSON.parse(r.project_json) : undefined,
  };
}

export type { CompositionSummaryDTO };

export interface ProjectMeta {
  width: number;
  height: number;
  durationSeconds: number;
}

export class Repo {
  private readonly db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /* ------------------------------------------------------------ workspaces */

  listWorkspaces(): WorkspaceDTO[] {
    const rows = this.db.prepare(`${WORKSPACE_SELECT} ORDER BY w.name COLLATE NOCASE`).all() as unknown as WorkspaceRow[];
    return rows.map(toWorkspace);
  }

  getWorkspace(id: string): WorkspaceDTO | null {
    const r = this.db.prepare(`${WORKSPACE_SELECT} WHERE w.id = ?`).get(id) as WorkspaceRow | undefined;
    return r ? toWorkspace(r) : null;
  }

  /** Only returns workspaces whose sharing is enabled. */
  getSharedWorkspace(token: string): WorkspaceDTO | null {
    const r = this.db.prepare(`${WORKSPACE_SELECT} WHERE w.share_token = ? AND w.sharing_enabled = 1`).get(token) as
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

  updateWorkspace(id: string, patch: { name?: string; sharingEnabled?: boolean; allowCustomerUploads?: boolean }): WorkspaceDTO | null {
    const w = this.getWorkspace(id);
    if (!w) return null;
    this.db
      .prepare('UPDATE workspaces SET name = ?, sharing_enabled = ?, allow_customer_uploads = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? w.name,
        (patch.sharingEnabled ?? w.sharingEnabled) ? 1 : 0,
        (patch.allowCustomerUploads ?? w.allowCustomerUploads) ? 1 : 0,
        now(),
        id,
      );
    return this.getWorkspace(id);
  }

  rotateShareToken(id: string): WorkspaceDTO | null {
    const r = this.db.prepare('UPDATE workspaces SET share_token = ?, updated_at = ? WHERE id = ?').run(newShareToken(), now(), id);
    return r.changes ? this.getWorkspace(id) : null;
  }

  /** Deletes the workspace and everything in it; returns blob keys that may now be orphaned. */
  deleteWorkspace(id: string): string[] | null {
    const keys = [
      ...(this.db.prepare('SELECT blob_key AS k FROM templates WHERE workspace_id = ?').all(id) as { k: string }[]),
      ...(this.db.prepare('SELECT blob_key AS k FROM media WHERE workspace_id = ?').all(id) as { k: string }[]),
      ...(this.db.prepare('SELECT thumb_key AS k FROM compositions WHERE workspace_id = ? AND thumb_key IS NOT NULL').all(id) as {
        k: string;
      }[]),
    ].map((r) => r.k);
    const r = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    return r.changes ? keys : null;
  }

  /** Is a stored file still referenced by anything? */
  blobInUse(key: string): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM templates WHERE blob_key = ?1
         UNION ALL SELECT 1 FROM media WHERE blob_key = ?1
         UNION ALL SELECT 1 FROM compositions WHERE thumb_key = ?1 LIMIT 1`,
      )
      .get(key);
  }

  private touchWorkspace(id: string) {
    this.db.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now(), id);
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
    uploadedBy: UploadedBy;
  }): TemplateDTO {
    const id = newId('tpl');
    const t = now();
    const max = this.db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM templates WHERE workspace_id = ?').get(input.workspaceId) as {
      m: number;
    };
    this.db
      .prepare(
        `INSERT INTO templates (id, workspace_id, name, category, file_name, blob_key, sha256, size, sort, uploaded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.name,
        input.category,
        input.fileName,
        input.blobKey,
        input.sha256,
        input.size,
        max.m + 1,
        input.uploadedBy,
        t,
        t,
      );
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

  /** Returns the blob key if nothing references it any more. */
  deleteTemplate(id: string): { orphanedKey: string | null } | null {
    const cur = this.getTemplate(id);
    if (!cur) return null;
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    this.touchWorkspace(cur.workspaceId);
    return { orphanedKey: this.blobInUse(cur.blobKey) ? null : cur.blobKey };
  }

  /* ------------------------------------------------------------ media */

  listMedia(workspaceId: string): MediaRecord[] {
    const rows = this.db.prepare('SELECT * FROM media WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as unknown as MediaRow[];
    return rows.map(toMedia);
  }

  getMedia(id: string): MediaRecord | null {
    const r = this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
    return r ? toMedia(r) : null;
  }

  mediaBytes(workspaceId: string): number {
    return (this.db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM media WHERE workspace_id = ?').get(workspaceId) as { s: number }).s;
  }

  createMedia(input: Omit<MediaRecord, 'id' | 'createdAt'>): MediaRecord {
    const id = newId('med');
    this.db
      .prepare('INSERT INTO media (id, workspace_id, kind, name, mime, size, blob_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.workspaceId, input.kind, input.name, input.mime, input.size, input.blobKey, now());
    this.touchWorkspace(input.workspaceId);
    return this.getMedia(id)!;
  }

  deleteMedia(id: string): { orphanedKey: string | null } | null {
    const cur = this.getMedia(id);
    if (!cur) return null;
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id);
    return { orphanedKey: this.blobInUse(cur.blobKey) ? null : cur.blobKey };
  }

  /* ------------------------------------------------------------ compositions */

  listCompositions(workspaceId: string): CompositionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, name, '' AS project_json, revision, width, height, duration_seconds, thumb_key, created_at, updated_at
         FROM compositions WHERE workspace_id = ? ORDER BY updated_at DESC`,
      )
      .all(workspaceId) as unknown as CompositionRow[];
    return rows.map((r) => toComposition(r, false));
  }

  getComposition(id: string): CompositionRecord | null {
    const r = this.db.prepare('SELECT * FROM compositions WHERE id = ?').get(id) as CompositionRow | undefined;
    return r ? toComposition(r, true) : null;
  }

  createComposition(workspaceId: string, name: string, projectJson: string, meta: ProjectMeta): CompositionRecord {
    const id = newId('cmp');
    const t = now();
    this.db
      .prepare(
        `INSERT INTO compositions (id, workspace_id, name, project_json, revision, width, height, duration_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(id, workspaceId, name, projectJson, meta.width, meta.height, meta.durationSeconds, t, t);
    this.touchWorkspace(workspaceId);
    return this.getComposition(id)!;
  }

  /**
   * Save a new version. `baseRevision` must match the stored revision
   * (optimistic concurrency), otherwise RevisionConflict is thrown.
   */
  saveComposition(id: string, baseRevision: number, projectJson: string, meta: ProjectMeta, name?: string): CompositionRecord | null {
    return this.tx(() => {
      const cur = this.db.prepare('SELECT revision, name FROM compositions WHERE id = ?').get(id) as
        | { revision: number; name: string }
        | undefined;
      if (!cur) return null;
      if (cur.revision !== baseRevision) throw new RevisionConflict(cur.revision);
      this.db
        .prepare(
          `UPDATE compositions SET project_json = ?, revision = revision + 1, width = ?, height = ?, duration_seconds = ?, name = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(projectJson, meta.width, meta.height, meta.durationSeconds, name ?? cur.name, now(), id);
      return this.getComposition(id);
    });
  }

  renameComposition(id: string, name: string): CompositionRecord | null {
    const r = this.db.prepare('UPDATE compositions SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
    return r.changes ? this.getComposition(id) : null;
  }

  setCompositionThumb(id: string, key: string): string | null {
    const cur = this.getComposition(id);
    if (!cur) return null;
    this.db.prepare('UPDATE compositions SET thumb_key = ? WHERE id = ?').run(key, id);
    return cur.thumbKey;
  }

  deleteComposition(id: string): { orphanedKey: string | null } | null {
    const cur = this.getComposition(id);
    if (!cur) return null;
    this.db.prepare('DELETE FROM compositions WHERE id = ?').run(id);
    this.touchWorkspace(cur.workspaceId);
    return { orphanedKey: cur.thumbKey && !this.blobInUse(cur.thumbKey) ? cur.thumbKey : null };
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

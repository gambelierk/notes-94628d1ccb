import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  /** Built editor (apps/editor/dist). Served when present. */
  staticDir: string | null;
  adminPassword: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  maxUploadBytes: number;
  /** Largest single video/image a customer may upload. */
  maxMediaBytes: number;
  /** Total media storage per customer project. */
  workspaceQuotaBytes: number;
  sessionDays: number;
  /** Ghostscript executable for converting EPS to PDF (null: EPS not accepted). */
  ghostscript: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const root = path.resolve(import.meta.dirname, '../../..');
  const production = env.NODE_ENV === 'production';
  let adminPassword = env.ADMIN_PASSWORD ?? '';
  if (!adminPassword) {
    if (production) throw new Error('ADMIN_PASSWORD måste vara satt i produktion');
    adminPassword = 'admin';
    console.warn('⚠ ADMIN_PASSWORD saknas – använder "admin" (endast för utveckling)');
  }
  if (production && adminPassword.length < 12) throw new Error('ADMIN_PASSWORD måste vara minst 12 tecken i produktion');
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: path.resolve(env.DATA_DIR ?? path.join(root, '.data')),
    staticDir: env.STATIC_DIR === '' ? null : path.resolve(env.STATIC_DIR ?? path.join(root, 'apps/editor/dist')),
    adminPassword,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    trustProxy: env.TRUST_PROXY === 'true',
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
    maxMediaBytes: Number(env.MAX_MEDIA_MB ?? 2048) * 1024 * 1024,
    workspaceQuotaBytes: Number(env.WORKSPACE_QUOTA_MB ?? 20480) * 1024 * 1024,
    sessionDays: Number(env.SESSION_DAYS ?? 7),
    ghostscript: env.GHOSTSCRIPT === '' ? null : (env.GHOSTSCRIPT ?? 'gs'),
  };
}

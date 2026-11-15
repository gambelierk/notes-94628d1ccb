import type { SharedLibraryDTO, TemplateDTO, TemplateSettings, WorkspaceDTO } from '@ve/core';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { ...headers } };
  if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = `Fel ${r.status}`;
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}

export const api = {
  /* public */
  shared: (token: string) => call<SharedLibraryDTO>('GET', `/api/share/${encodeURIComponent(token)}`),

  /* admin */
  me: () => call<{ authenticated: boolean }>('GET', '/api/admin/me'),
  login: (password: string) => call<{ ok: true }>('POST', '/api/admin/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/admin/logout'),
  workspaces: () => call<WorkspaceDTO[]>('GET', '/api/admin/workspaces'),
  workspace: (id: string) => call<{ workspace: WorkspaceDTO; templates: TemplateDTO[] }>('GET', `/api/admin/workspaces/${id}`),
  createWorkspace: (name: string) => call<WorkspaceDTO>('POST', '/api/admin/workspaces', { name }),
  updateWorkspace: (id: string, patch: { name?: string; sharingEnabled?: boolean }) =>
    call<WorkspaceDTO>('PATCH', `/api/admin/workspaces/${id}`, patch),
  rotateLink: (id: string) => call<WorkspaceDTO>('POST', `/api/admin/workspaces/${id}/rotate-link`),
  deleteWorkspace: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/workspaces/${id}`),
  uploadTemplate: (workspaceId: string, file: File) =>
    call<TemplateDTO>('POST', `/api/admin/workspaces/${workspaceId}/templates`, file, {
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    }),
  updateTemplate: (id: string, patch: Partial<TemplateSettings>) => call<TemplateDTO>('PATCH', `/api/admin/templates/${id}`, patch),
  deleteTemplate: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/templates/${id}`),
  templateFileUrl: (id: string) => `/api/admin/templates/${id}/file`,
};

export function shareUrl(token: string): string {
  return new URL(`/p/${token}`, location.origin).href;
}

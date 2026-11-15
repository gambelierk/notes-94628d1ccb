import type {
  CompositionDTO,
  CompositionSummaryDTO,
  MediaDTO,
  SharedLibraryDTO,
  SharedTemplateDTO,
  TemplateDTO,
  TemplateSettings,
  WorkspaceDTO,
} from '@ve/core';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class ConflictError extends ApiError {
  readonly revision: number;
  constructor(message: string, revision: number) {
    super(409, message);
    this.revision = revision;
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
    let revision: number | undefined;
    try {
      const j = (await r.json()) as { error?: string; revision?: number };
      msg = j.error ?? msg;
      revision = j.revision;
    } catch {
      /* not json */
    }
    if (r.status === 409 && revision !== undefined) throw new ConflictError(msg, revision);
    throw new ApiError(r.status, msg);
  }
  return (await r.json()) as T;
}

/**
 * Upload with progress (fetch cannot report upload progress yet).
 * Resolves with the parsed JSON response.
 */
export function uploadWithProgress<T>(url: string, file: Blob, name: string, onProgress?: (fraction: number) => void, method = 'POST'): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not json */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(xhr.status, (body as { error?: string } | null)?.error ?? `Fel ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Nätverksfel vid uppladdning'));
    xhr.send(file);
  });
}

const share = (token: string) => `/api/share/${encodeURIComponent(token)}`;

/** Customer API: everything is scoped by the share token. */
export const customerApi = {
  library: (token: string) => call<SharedLibraryDTO>('GET', share(token)),
  uploadTemplate: (token: string, file: File, onProgress?: (f: number) => void) =>
    uploadWithProgress<SharedTemplateDTO>(`${share(token)}/templates`, file, file.name, onProgress),
  deleteTemplate: (token: string, id: string) => call<{ ok: true }>('DELETE', `${share(token)}/templates/${id}`),

  media: (token: string) => call<MediaDTO[]>('GET', `${share(token)}/media`),
  uploadMedia: (token: string, file: File, onProgress?: (f: number) => void) =>
    uploadWithProgress<MediaDTO>(`${share(token)}/media`, file, file.name, onProgress),
  deleteMedia: (token: string, id: string) => call<{ ok: true }>('DELETE', `${share(token)}/media/${id}`),

  compositions: (token: string) => call<CompositionSummaryDTO[]>('GET', `${share(token)}/compositions`),
  composition: (token: string, id: string) => call<CompositionDTO>('GET', `${share(token)}/compositions/${id}`),
  createComposition: (token: string, name: string, project: unknown) =>
    call<CompositionDTO>('POST', `${share(token)}/compositions`, { name, project }),
  saveComposition: (token: string, id: string, baseRevision: number, project: unknown, name?: string) =>
    call<CompositionSummaryDTO>('PUT', `${share(token)}/compositions/${id}`, { baseRevision, project, ...(name ? { name } : {}) }),
  renameComposition: (token: string, id: string, name: string) =>
    call<CompositionSummaryDTO>('PATCH', `${share(token)}/compositions/${id}`, { name }),
  duplicateComposition: (token: string, id: string) => call<CompositionSummaryDTO>('POST', `${share(token)}/compositions/${id}/duplicate`),
  deleteComposition: (token: string, id: string) => call<{ ok: true }>('DELETE', `${share(token)}/compositions/${id}`),
  uploadThumbnail: (token: string, id: string, blob: Blob) =>
    uploadWithProgress<CompositionSummaryDTO>(`${share(token)}/compositions/${id}/thumbnail`, blob, 'thumb.jpg', undefined, 'PUT'),
};

export const api = {
  /* public */
  shared: (token: string) => customerApi.library(token),

  /* admin */
  me: () => call<{ authenticated: boolean }>('GET', '/api/admin/me'),
  login: (password: string) => call<{ ok: true }>('POST', '/api/admin/login', { password }),
  logout: () => call<{ ok: true }>('POST', '/api/admin/logout'),
  workspaces: () => call<WorkspaceDTO[]>('GET', '/api/admin/workspaces'),
  workspace: (id: string) =>
    call<{ workspace: WorkspaceDTO; templates: TemplateDTO[]; compositions: CompositionSummaryDTO[] }>('GET', `/api/admin/workspaces/${id}`),
  createWorkspace: (name: string) => call<WorkspaceDTO>('POST', '/api/admin/workspaces', { name }),
  updateWorkspace: (id: string, patch: { name?: string; sharingEnabled?: boolean; allowCustomerUploads?: boolean }) =>
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

export function compositionUrl(token: string, id: string): string {
  return `/p/${token}/c/${id}`;
}

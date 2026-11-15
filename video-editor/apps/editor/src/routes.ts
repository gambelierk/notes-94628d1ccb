export type Route =
  | { kind: 'demo' }
  | { kind: 'admin' }
  | { kind: 'projects'; token: string }
  | { kind: 'composition'; token: string; id: string };

/**
 * `/admin` → admin, `/p/<token>` → the customer's project manager,
 * `/p/<token>/c/<id>` → editor for one composition, anything else → demo editor.
 */
export function currentRoute(pathname = location.pathname): Route {
  if (/^\/admin\/?$/.test(pathname)) return { kind: 'admin' };
  const c = /^\/p\/([A-Za-z0-9_-]{16,64})\/c\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  if (c) return { kind: 'composition', token: c[1]!, id: c[2]! };
  const m = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
  if (m) return { kind: 'projects', token: m[1]! };
  return { kind: 'demo' };
}

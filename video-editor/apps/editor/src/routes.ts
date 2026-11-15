export type Route = { kind: 'demo' } | { kind: 'admin' } | { kind: 'share'; token: string };

/** `/admin` → admin, `/p/<token>` → customer editor, anything else → demo editor. */
export function currentRoute(pathname = location.pathname): Route {
  if (/^\/admin\/?$/.test(pathname)) return { kind: 'admin' };
  const m = /^\/p\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
  if (m) return { kind: 'share', token: m[1]! };
  return { kind: 'demo' };
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useMemo } from 'react';
import { App } from './App';
import { currentRoute } from './routes';
import './styles.css';

const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));

function Root() {
  const route = useMemo(() => currentRoute(), []);
  if (route.kind === 'admin') {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }
  const source = route.kind === 'share' ? ({ kind: 'share', token: route.token } as const) : ({ kind: 'demo' } as const);
  return <App source={source} />;
}

function supported(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return 'WebCodecs saknas';
  if (typeof OffscreenCanvas === 'undefined') return 'OffscreenCanvas saknas';
  if (!document.createElement('canvas').getContext('webgl2')) return 'WebGL2 saknas';
  return null;
}

const root = createRoot(document.getElementById('root')!);
const missing = supported();
if (missing) {
  root.render(
    <div className="unsupported">
      <h1>Webbläsaren stöds inte</h1>
      <p>
        Klipp behöver WebCodecs, OffscreenCanvas och WebGL2 ({missing}). Använd en aktuell version av Chrome eller Edge.
      </p>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

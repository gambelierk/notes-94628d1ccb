import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

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
      <App />
    </StrictMode>,
  );
}

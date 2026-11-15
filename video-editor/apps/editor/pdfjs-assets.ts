import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

/** pdf.js data it loads on demand: CJK character maps, the 14 standard fonts, colour profiles and wasm decoders. */
const DIRS = ['cmaps', 'standard_fonts', 'iccs', 'wasm'];
const PREFIX = 'pdfjs/';

/**
 * Serves (dev) and emits (build) pdf.js's data folders under `/pdfjs/…`,
 * so PDFs and Illustrator files render with the right fonts and images.
 */
export function pdfjsAssets(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const files = () =>
    DIRS.flatMap((d) => {
      const dir = path.join(root, d);
      try {
        return readdirSync(dir)
          .filter((f) => statSync(path.join(dir, f)).isFile() && !f.startsWith('LICENSE'))
          .map((f) => `${d}/${f}`);
      } catch {
        return [];
      }
    });
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
        if (!url.startsWith(`/${PREFIX}`)) return next();
        const rel = url.slice(PREFIX.length + 1);
        if (!files().includes(rel)) return next();
        if (rel.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
        else if (rel.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
        createReadStream(path.join(root, rel)).pipe(res);
      });
    },
    generateBundle() {
      for (const rel of files()) this.emitFile({ type: 'asset', fileName: `${PREFIX}${rel}`, source: readFileSync(path.join(root, rel)) });
    },
  };
}

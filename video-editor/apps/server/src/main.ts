import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from './app.ts';
import { DiskBlobStore } from './blobs.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { Repo } from './repo.ts';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'klipp.sqlite'));
const repo = new Repo(db);
const blobs = new DiskBlobStore(path.join(config.dataDir, 'blobs'));
const app = createApp({ repo, blobs, config });

// Serve the built editor when present: one process for app + API.
if (config.staticDir && existsSync(path.join(config.staticDir, 'index.html'))) {
  const root = path.relative(process.cwd(), config.staticDir) || '.';
  const indexHtml = readFileSync(path.join(config.staticDir, 'index.html'), 'utf8');
  app.use(
    '/assets/*',
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.use('*', serveStatic({ root }));
  // SPA routes: /, /admin, /p/<token>
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
} else {
  console.log('Ingen byggd editor hittades – kör `pnpm dev` för gränssnittet (Vite proxar /api hit).');
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Klipp-servern lyssnar på http://localhost:${info.port}  (data: ${config.dataDir})`);
});

const shutdown = () => {
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

let requestCount = 0;
let destroyErrors = 0;
const baselineHeap = process.memoryUsage().heapUsed;

// Catch the ngOnDestroy error that escapes cleanUpView.
// The error bubbles out of the async platform teardown (setTimeout in
// asyncDestroyPlatform) and becomes an uncaughtException. Angular's
// ErrorHandler never sees it — this is part of the bug.
process.on('uncaughtException', (err) => {
  if (err instanceof TypeError && err.message.includes('disconnect')) {
    destroyErrors++;
    return; // Suppress known error — we're counting it
  }
  // Re-throw unexpected errors
  console.error('Unexpected uncaughtException:', err);
  process.exit(1);
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  const n = ++requestCount;

  angularApp
    .handle(req)
    .then((response) => {
      if (response) {
        // Small delay to let asyncDestroyPlatform (setTimeout-based) run
        // before we measure the heap.
        setTimeout(() => {
          // __angularLViewLeakCount is a net counter: +1 on registerLView, -1 on
          // unregisterLView. LViews that were never unregistered (the bug) keep it
          // permanently elevated. No GC needed; works across per-request module instances.
          const lviewCount = (globalThis as any).__angularLViewLeakCount ?? 'unavailable (run npm install to apply patch)';

          if (global.gc) global.gc();
          const mem = process.memoryUsage();
          const heapGrowthKB = ((mem.heapUsed - baselineHeap) / 1024).toFixed(0);
          console.log(
            `[req #${n}] lviewLeaks=${lviewCount} ` +
            `destroyErrors=${destroyErrors} ` +
            `heap=+${heapGrowthKB}KB`
          );
        }, 200);

        writeResponseToNodeResponse(response, res);
      } else {
        next();
      }
    })
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
    console.log('NOTE: metrics only work here (ng serve does not use server.ts)');
    console.log('');
    console.log('Send requests:');
    console.log('  for i in $(seq 1 100); do curl -s http://localhost:4000/ > /dev/null; done');
    console.log('');
    console.log('What to watch for:');
    console.log('  - lviewLeaks grows by ~4 per request (leaked LViews: net registerLView minus unregisterLView calls)');
    console.log('  - destroyErrors increments (ngOnDestroy error escapes as uncaughtException)');
    console.log('');
  });
}

export const reqHandler = createNodeRequestHandler(app);

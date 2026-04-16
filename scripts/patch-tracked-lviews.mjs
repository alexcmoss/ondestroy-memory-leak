/**
 * Patches @angular/core's debug_node.mjs to instrument registerLView /
 * unregisterLView with a global net counter (globalThis.__angularLViewLeakCount).
 *
 * Each SSR request runs in its own module instance with its own TRACKED_LVIEWS Map,
 * so reading the Map directly would always show 0. The counter on globalThis persists
 * across all instances: +1 on register, -1 on unregister. LViews that were never
 * unregistered (the bug) keep it permanently elevated.
 *
 * Run via the "postinstall" and "prebuild" npm scripts.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = resolve(__dirname, '../node_modules/@angular/core/fesm2022/debug_node.mjs');

let src;
try {
  src = readFileSync(file, 'utf8');
} catch {
  console.error(`patch-tracked-lviews: could not read ${file}`);
  process.exit(1);
}

const PATCH_MARKER = '/** patch: expose TRACKED_LVIEWS */';
if (src.includes(PATCH_MARKER)) {
  console.log('patch-tracked-lviews: already applied, skipping.');
  process.exit(0);
}

// Each SSR request gets its own module instance with its own TRACKED_LVIEWS Map.
// Assigning the Map reference to globalThis is useless — by the time we read it the
// request's Map is already cleaned up.  Instead, patch registerLView / unregisterLView
// to maintain a global *net* counter.  Leaked LViews (those whose unregisterLView was
// skipped) keep the counter permanently positive.
const TARGET_MAP  = 'const TRACKED_LVIEWS = new Map();';
const TARGET_REG  = '    TRACKED_LVIEWS.set(lView[ID], lView);';
const TARGET_UREG = '    TRACKED_LVIEWS.delete(lView[ID]);';

for (const [label, t] of [['TRACKED_LVIEWS declaration', TARGET_MAP], ['registerLView body', TARGET_REG], ['unregisterLView body', TARGET_UREG]]) {
  if (!src.includes(t)) {
    console.error(
      `patch-tracked-lviews: anchor "${label}" not found in debug_node.mjs — ` +
      'Angular version may have changed. Update the target strings in scripts/patch-tracked-lviews.mjs.'
    );
    process.exit(1);
  }
}

let patched = src
  // Initialise the global counter once (idempotent across request module instances).
  .replace(
    TARGET_MAP,
    `${TARGET_MAP}\n${PATCH_MARKER}\nglobalThis.__angularLViewLeakCount ??= 0;`
  )
  // Increment on register.
  .replace(
    TARGET_REG,
    `${TARGET_REG}\n    globalThis.__angularLViewLeakCount++;`
  )
  // Decrement on unregister (successful cleanup — not a leak).
  .replace(
    TARGET_UREG,
    `${TARGET_UREG}\n    globalThis.__angularLViewLeakCount--;`
  );

writeFileSync(file, patched, 'utf8');
console.log('patch-tracked-lviews: global LView net counter installed on globalThis.__angularLViewLeakCount');

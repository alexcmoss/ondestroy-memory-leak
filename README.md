# Angular SSR ngOnDestroy / TRACKED_LVIEWS Memory Leak

Minimal reproduction of an SSR memory leak caused by `ngOnDestroy` errors during
Angular's view cleanup.

## Bug

There are two related issues in Angular's `cleanUpView()` function:

### 1. TRACKED_LVIEWS leak (per-view)

`cleanUpView()` calls `unregisterLView(lView)` as the **last statement in its `try`
block**. If `executeOnDestroys()` (which runs `ngOnDestroy` hooks) throws, the
`unregisterLView()` call is skipped and the LView stays permanently in the module-level
`TRACKED_LVIEWS` Map.

```javascript
// @angular/core — cleanUpView() (simplified)
try {
  destroyLView(tView, lView);           // calls ngOnDestroy hooks — may throw
  lView[FLAGS] |= 256;                  // Destroyed
  unregisterLView(lView);               // SKIPPED if destroyLView throws
} finally {
  setActiveConsumer(prevConsumer);       // only resets reactive context
}
```

**Fix**: Move `unregisterLView(lView)` into the `finally` block.

### 2. Error escapes as uncaughtException

The `ngOnDestroy` error thrown inside `cleanUpView` is not caught by Angular's
`ErrorHandler`. It propagates through `ApplicationRef.ngOnDestroy()` → `forEach` →
`asyncDestroyPlatform` (which uses `setTimeout`) → and becomes a Node.js
`uncaughtException`. In production, this would crash the SSR server.

The `Array.forEach` in `ApplicationRef.ngOnDestroy()` also means one throwing view
prevents cleanup of all subsequent views in the same request.

**Affected versions**: Tested on v20.3.19.

## Reproducing

```bash
npm install
npm run repro
```

`npm run repro` patches `@angular/core`, builds the SSR bundle, and starts the Express
server on port 4000. (`ng serve` uses Angular's own dev server and does not run
`server.ts`, so metrics are not available there.)

In another terminal:

```bash
for i in $(seq 1 100); do curl -s http://localhost:4000/ > /dev/null; done
```

### What to look for in the server logs

The output will be noisy — Angular's built-in `uncaughtException` handler prints a full
stack trace for each error. Between the stack traces, look for the `[req #N]` lines:

```
[req #1] lviewLeaks=4  destroyErrors=1  heap=+8349KB
[req #2] lviewLeaks=8  destroyErrors=2  heap=+9208KB
```

- **lviewLeaks grows by ~4 per request** — net count of `registerLView` minus
  `unregisterLView` calls. LViews whose `unregisterLView` was skipped (the bug) keep it
  permanently elevated. No GC needed.
- **destroyErrors increments** — each request's `ngOnDestroy` error escapes as an
  `uncaughtException` (Angular's `ErrorHandler` never sees it)
- **`Array.forEach` in the stack trace** — confirms the forEach cascade bug in
  `ApplicationRef.ngOnDestroy()`

## Expected behaviour

1. `unregisterLView()` should be in a `finally` block so LViews are always cleaned up
2. `ApplicationRef.ngOnDestroy()` should use a for-loop with per-view try/catch instead
   of `forEach`
3. Errors during view cleanup should be routed through Angular's `ErrorHandler`, not
   escape as `uncaughtException`

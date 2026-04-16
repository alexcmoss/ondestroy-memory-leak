import {
  mergeApplicationConfig,
  ApplicationConfig,
  ApplicationRef,
  DestroyRef,
  ErrorHandler,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

/**
 * Silent error handler — suppresses the ngOnDestroy error so the server
 * doesn't crash, making the silent leak visible instead.
 */
class SilentErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    // Intentionally silent — the leak happens whether or not we log.
  }
}

/**
 * Logs view state at teardown to expose the forEach cascade.
 *
 * ApplicationRef.ngOnDestroy() calls:
 *   _views.slice().forEach(view => view.destroy())
 *
 * If any view's destroy() throws, forEach aborts. All subsequent views in
 * the array are never destroyed and their LViews stay in the global
 * TRACKED_LVIEWS Map permanently.
 *
 * Additionally, cleanUpView() calls unregisterLView() as the *last*
 * statement in its try block. If executeOnDestroys() (which runs
 * ngOnDestroy hooks) throws, unregisterLView() is skipped and the LView
 * stays in TRACKED_LVIEWS (~57 KB per request).
 */
const lviewLeakDetector = provideEnvironmentInitializer(() => {
  const appRef = inject(ApplicationRef);
  const destroyRef = inject(DestroyRef);

  destroyRef.onDestroy(() => {
    const views = (appRef as any)._views as { destroyed: boolean }[] | undefined;
    const total = views?.length ?? 0;
    const undestroyed = views?.filter((v) => !v.destroyed).length ?? 0;

    console.log(
      `[lview-leak] onDestroy: total views=${total}, still undestroyed=${undestroyed}`
    );

    const mem = process.memoryUsage();
    console.log(
      `[lview-leak] heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`
    );
  });
});

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: ErrorHandler, useClass: SilentErrorHandler },
    lviewLeakDetector,
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

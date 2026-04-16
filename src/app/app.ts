import { Component, OnDestroy } from '@angular/core';

/**
 * Component whose ngOnDestroy throws on the server.
 *
 * Simulates any component that accesses a browser-only API during cleanup
 * (e.g. window, localStorage, IntersectionObserver.disconnect()).
 *
 * When ngOnDestroy throws inside cleanUpView(), the subsequent call to
 * unregisterLView() is skipped because it is the last statement in the try
 * block — there is no finally. The LView permanently leaks into the
 * module-level TRACKED_LVIEWS Map, keeping this component instance alive.
 */
@Component({
  selector: 'app-throwing',
  template: `<p>Throwing component (leaks into TRACKED_LVIEWS)</p>`,
})
export class ThrowingComponent implements OnDestroy {
  ngOnDestroy(): void {
    // Simulate accessing a browser API that does not exist on the server.
    (globalThis as any).nonExistentBrowserApi.disconnect();
  }
}

@Component({
  selector: 'app-root',
  imports: [ThrowingComponent],
  template: `<app-throwing />`,
})
export class App {}

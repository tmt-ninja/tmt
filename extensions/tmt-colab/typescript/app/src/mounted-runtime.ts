import { mountUrl } from './bootstrap.js';
import { buildWatch } from './app-build.js';
import { createAppRouter } from './router.js';
import { mountedTransport, sharedMountedTransport, type SharedSession } from './mounted.js';
import { SessionLimitError } from './session-limit-error.js';

export type MountedSnapshot =
  | { state: 'loading' }
  | { state: 'failed'; limit?: SessionLimitError }
  | { state: 'ready'; router: ReturnType<typeof createAppRouter> };

/**
 * A tab's paired Colab: its Remote session, registration, discovery and page bindings, from
 * `start` until `close`. It lives outside React, so the shell can keep it while Colab's route is
 * left and show its last page again on return without opening anything (#5954).
 */
export function startMounted(options: { session?: SharedSession } = {}) {
  const controller = new AbortController();
  const listeners = new Set<() => void>();
  let snapshot: MountedSnapshot = { state: 'loading' };
  let mounted: Awaited<ReturnType<typeof mountedTransport>> | null = null;
  let closed = false;
  const publish = (next: MountedSnapshot) => {
    if (closed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    mounted?.close();
    window.removeEventListener('pagehide', close);
    window.removeEventListener('pageshow', restore);
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) location.reload();
  };
  window.addEventListener('pagehide', close);
  window.addEventListener('pageshow', restore);
  void (async () => {
    try {
      mountUrl();
    } catch {
      return publish({ state: 'failed' });
    }
    try {
      const next = options.session
        ? await sharedMountedTransport(controller.signal, { session: options.session })
        : await mountedTransport(controller.signal);
      if (closed) return next.close();
      mounted = next;
      publish({
        state: 'ready',
        router: createAppRouter(next.transport, next.space, next.pageIds),
      });
    } catch (error) {
      // A device at its Remote session limit is refused with a reason a reload can clear.
      publish({ state: 'failed', limit: error instanceof SessionLimitError ? error : undefined });
      void buildWatch.check();
    }
  })();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => snapshot,
    close,
  };
}
export type MountedRuntime = ReturnType<typeof startMounted>;

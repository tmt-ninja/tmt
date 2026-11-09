import type { Page } from '@playwright/test';

/** What the serve answered to one block batch of the browser (a `blocksresult` frame). */
export type BlocksOutcome = { state: string; code?: string };

/**
 * Every `blocksresult` the serve sends to `page`, in order. A batch that is not `committed` is an
 * edit of the person that did not land (#6220), so a scenario that types while an agent writes can
 * count them. Attach it before the page opens its connection.
 */
export function recordBlocksResults(page: Page): BlocksOutcome[] {
  const seen: BlocksOutcome[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return;
      let frame: unknown;
      try {
        frame = JSON.parse(payload);
      } catch {
        return;
      }
      if (typeof frame !== 'object' || frame === null) return;
      const { type, state, code } = frame as Record<string, unknown>;
      if (type !== 'blocksresult' || typeof state !== 'string') return;
      const outcome = typeof code === 'string' ? { state, code } : { state };
      seen.push(outcome);
      // Logged as it arrives, so a scenario that fails later still shows what the serve refused.
      if (state !== 'committed')
        console.log(`blocksresult-not-committed ${JSON.stringify(outcome)}`);
    });
  });
  return seen;
}

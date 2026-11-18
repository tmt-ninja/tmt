import { useEffect, useRef } from 'react';
import type { PageTransport } from './transport.js';
import { activityOwners, type WorkItem } from './work-home-model.js';

/**
 * The owners' activity (decision on #6474, option a): one bounded batch on events that already
 * happen (opening, the tab becoming visible, a list re-read), never a timer. The list answer
 * never waits for it: when what it observed changed, the list is read again and its rows show it.
 */
export function useOwnerActivity(
  transport: PageTransport,
  items: readonly WorkItem[],
  listed: unknown,
  reread: () => void,
) {
  const owners = activityOwners(items).join('\n');
  const seen = useRef<string>(undefined);
  // The list re-read this hook asks for must not ask again: only opening, the tab becoming visible
  // and a list re-read from elsewhere read activity (#6578 review).
  const own = useRef(false);
  useEffect(() => {
    const read = transport.workActivity;
    if (!read || !owners) return;
    const controller = new AbortController();
    const run = () =>
      void read(owners.split('\n'), controller.signal).then(
        (answer) => {
          if (controller.signal.aborted) return;
          // Only a changed state can change a list status; a working agent's newer activity time
          // alone is no reason to read the list again.
          const observed = JSON.stringify(
            Object.entries(answer)
              .map(([owner, row]) => [owner, row.state])
              .sort(),
          );
          if (observed === seen.current) return;
          seen.current = observed;
          own.current = true;
          reread();
        },
        () => undefined,
      );
    if (own.current) own.current = false;
    else run();
    document.addEventListener(
      'visibilitychange',
      () => document.visibilityState === 'visible' && run(),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [transport, owners, listed, reread]);
}

import { useCallback, useSyncExternalStore } from 'react';
import { railCollapsed, subscribeRail } from '@tmt/browser-ui/shell';

/** Whether the wide screen's side menu is collapsed on this device (#6833), as the shell keeps it:
 * the page's outline becomes a strip and the bar leads with the way back. */
export function useRailCollapsed(shell?: Element): boolean {
  // The mounted Colab module and the host have separate copies of the shell module.
  // Read the host's applied state so a same-tab change is visible without a storage event.
  const read = useCallback(
    () => (shell ? shell.getAttribute('data-rail') === 'collapsed' : railCollapsed()),
    [shell],
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!shell) return subscribeRail(notify);
      const observer = new MutationObserver(notify);
      observer.observe(shell, { attributes: true, attributeFilter: ['data-rail'] });
      return () => observer.disconnect();
    },
    [shell],
  );
  return useSyncExternalStore(subscribe, read, () => false);
}

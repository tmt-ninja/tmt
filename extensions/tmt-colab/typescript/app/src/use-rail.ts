import { useSyncExternalStore } from 'react';
import { railCollapsed, subscribeRail } from '@tmt/browser-ui/shell';

/** Whether the wide screen's side menu is collapsed on this device (#6833), as the shell keeps it:
 * the page's outline becomes a strip and the bar leads with the way back. */
export function useRailCollapsed(): boolean {
  return useSyncExternalStore(subscribeRail, railCollapsed, () => false);
}

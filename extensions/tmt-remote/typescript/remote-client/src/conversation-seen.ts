/** Browser-local positions only. Opening a visible newest page counts as seeing a DM. */
import { coreId } from './operations.js';
import {
  conversationPosition,
  type ConversationChanges,
  type ConversationPage,
} from './conversations.js';
export interface ConversationScope {
  machineId: string;
  viewerId: string;
  memberId: string;
}
export interface SeenBaseline {
  available: boolean;
  position: string | null;
}
export type ConversationUnread =
  | { state: 'unknown' }
  | { state: 'known'; count: number; more: boolean };
type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>;
function key(scope: ConversationScope): string {
  if (![scope.machineId, scope.viewerId, scope.memberId].every(coreId))
    throw new TypeError('Invalid conversation scope.');
  return JSON.stringify(['tmt.dm.seen.v1', scope.machineId, scope.viewerId, scope.memberId]);
}
export function conversationSeen(storage: SeenStorage | undefined) {
  return {
    read(scope: ConversationScope): SeenBaseline {
      try {
        if (!storage) return { available: false, position: null };
        const value = storage.getItem(key(scope));
        return { available: true, position: conversationPosition(value) ? value : null };
      } catch {
        return { available: false, position: null };
      }
    },
    markVisibleNewest(
      scope: ConversationScope,
      page: ConversationPage,
      view: { newest: boolean; documentVisible: boolean; panelVisible: boolean },
    ): boolean {
      if (
        !view.newest ||
        !view.documentVisible ||
        !view.panelVisible ||
        page.viewerId !== scope.viewerId ||
        !conversationPosition(page.changePosition)
      )
        return false;
      try {
        if (!storage) return false;
        storage.setItem(key(scope), page.changePosition);
        return true;
      } catch {
        return false;
      }
    },
  };
}
/** No baseline or failed storage is unknown; only Core can prove a count, including zero. */
export function conversationUnread(
  baseline: SeenBaseline,
  changes: ConversationChanges | undefined,
): ConversationUnread {
  if (!baseline.available || baseline.position === null || !changes || changes === 'unknown')
    return { state: 'unknown' };
  return { state: 'known', count: changes.count, more: changes.more };
}

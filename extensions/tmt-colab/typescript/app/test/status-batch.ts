import type { DiscussionRef } from '../src/thread-records.js';
import type { ThreadRecipient } from '../src/thread-status.js';
import type {
  StatusChange,
  StatusOutcome,
  StatusRequest,
  ThreadBinding,
} from '../src/thread-store.js';

/** The `setStatuses` contract over a per-thread write: one outcome per request, in order, and a
 * recipient belongs to the first committed status. `ThreadStore` tests cover the real batch. */
export function statusBatch(
  write: (
    ref: DiscussionRef,
    previous: DiscussionRef | null,
    resolved: boolean,
    recipients: readonly ThreadRecipient[] | Promise<readonly ThreadRecipient[]>,
  ) => Promise<StatusChange>,
  calls: StatusRequest[][] = [],
): ThreadBinding['setStatuses'] {
  return async (requests) => {
    calls.push([...requests]);
    const assigned = new Set<string>();
    const outcomes: StatusOutcome[] = [];
    for (const request of requests) {
      try {
        const recipients = ((await request.recipients) ?? []).filter(
          (value) => !assigned.has(`${value.machine}:${value.agent}`),
        );
        const outcome = await write(request.thread, request.previous, request.resolved, recipients);
        if (outcome.changed)
          for (const value of outcome.status.recipients)
            assigned.add(`${value.machine}:${value.agent}`);
        outcomes.push(outcome);
      } catch (error) {
        outcomes.push({ error });
      }
    }
    return outcomes;
  };
}

import { requireValue } from '@tmt/colab-client';
import type { PageAsk } from './ask-panel.js';
import type { AgentDestination } from './live-ask.js';
import type { DiscussionRef, ThreadView } from './thread-records.js';
import {
  asksAbout,
  type ThreadBinding,
  type StatusChange,
  type StatusOutcome,
} from './thread-store.js';
import {
  discussionRefKey,
  type ThreadRecipient,
  type ThreadStatusView,
  type ThreadNotificationRecord,
} from './thread-status.js';
import { isStatusThread } from './thread-status-view.js';

const recipientKey = (value: { machine: string; agent: string }) =>
  `${value.machine}:${value.agent}`;
export interface MentionWarning {
  name: string;
  reason: 'unknown' | 'ambiguous';
}

/** Authenticated discussion/Ask projections and the current agents list. A signed
 * prior Ask pins a mentioned name to its recipient UUID after a rename. A name
 * alone must uniquely match; replies are not required. */
export function freezeThreadRecipients(
  thread: ThreadView,
  asks: readonly PageAsk[],
  destinations: readonly AgentDestination[],
  onlyAgentName?: string,
) {
  const current = new Map<
    string,
    Map<string, { machine: string; agent: string; agentName: string }>
  >();
  const put = (
    map: typeof current,
    name: string,
    recipient: { machine: string; agent: string; agentName: string },
  ) => {
    const matches = map.get(name) ?? new Map();
    matches.set(recipientKey(recipient), recipient);
    map.set(name, matches);
  };
  for (const destination of destinations) put(current, destination.agentName, destination);
  // Reading actions resolve their authored name from the current directory only. The
  // passage's other mentions and prior Asks must not expand this explicit recipient.
  if (onlyAgentName !== undefined) {
    const matches = current.get(onlyAgentName);
    if (matches?.size !== 1)
      return {
        recipients: [] as ThreadRecipient[],
        warnings: [
          {
            name: onlyAgentName,
            reason: matches?.size ? ('ambiguous' as const) : ('unknown' as const),
          },
        ],
      };
    const value = [...matches.values()][0];
    return {
      recipients: [
        {
          machine: value.machine,
          agent: value.agent,
          agentName: onlyAgentName,
          operationId: crypto.randomUUID(),
        },
      ],
      warnings: [] as MentionWarning[],
    };
  }
  const recipients = new Map<string, ThreadRecipient>();
  const warnings = new Map<string, MentionWarning>();
  for (const comment of thread.comments.filter((value) => !value.deleted)) {
    const pinned: typeof current = new Map();
    for (const ask of asks) {
      if (asksAbout(ask, thread, comment)) put(pinned, ask.agentName, ask);
    }
    const names = [...new Set([...current.keys(), ...pinned.keys()])]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
    const pattern = /@/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(comment.body))) {
      const index = match.index;
      if (index > 0 && /[\p{L}\p{N}_]/u.test(comment.body[index - 1])) continue;
      const remainder = comment.body.slice(index + 1);
      const name = names.find(
        (value) =>
          remainder.startsWith(value) &&
          /^(?:$|[\s,.!?;:()[\]{}])/u.test(remainder.slice(value.length)),
      );
      if (!name) {
        const unknown = /^([^\s,.!?;:()[\]{}]+)/u.exec(remainder)?.[1];
        if (unknown) warnings.set(unknown, { name: unknown, reason: 'unknown' });
        continue;
      }
      const candidates = pinned.get(name) ?? current.get(name)!;
      if (candidates.size !== 1) {
        warnings.set(name, { name, reason: 'ambiguous' });
        continue;
      }
      const value = [...candidates.values()][0];
      const key = recipientKey(value);
      if (!recipients.has(key))
        recipients.set(key, {
          machine: value.machine,
          agent: value.agent,
          agentName: name,
          operationId: crypto.randomUUID(),
        });
      pattern.lastIndex = index + 1 + name.length;
    }
  }
  requireValue(recipients.size <= 1000);
  return {
    recipients: [...recipients.values()].sort((a, b) =>
      recipientKey(a) < recipientKey(b) ? -1 : 1,
    ),
    warnings: [...warnings.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

export type NotificationAdoption =
  | { adopted: true }
  | { adopted: false; reason: ThreadNotificationRecord['reason'] };
export interface ThreadStatusCoordinatorOptions {
  binding: Pick<ThreadBinding, 'setStatus' | 'setStatuses' | 'notificationFailed'>;
  asks(): readonly PageAsk[];
  destinations(): Promise<readonly AgentDestination[]>;
  notify(
    status: ThreadStatusView,
    recipient: ThreadRecipient,
    captured: ThreadView,
    destinations: readonly AgentDestination[],
  ): Promise<NotificationAdoption>;
}
type ThreadStatusChange = StatusChange & { warnings?: MentionWarning[] };
export interface ResolveAllResult {
  /** The publication report is available first; this settles every original notification attempt. */
  settled: Promise<void>;
  results: (
    | { thread: DiscussionRef; result: ThreadStatusChange }
    | { thread: DiscussionRef; error: unknown }
  )[];
}
/** Explicit parent action only. The status and recipient operation IDs are
 * durable before sequential notification attempts. No open/reload/retry path. */
export class ThreadStatusCoordinator {
  #changing = new Map<
    string,
    {
      resolved: boolean;
      generation: symbol;
      task: Promise<ThreadStatusChange>;
    }
  >();
  #batch: Promise<ResolveAllResult> | undefined;
  constructor(private options: ThreadStatusCoordinatorOptions) {}
  /** The confirmed filter snapshot only, published by one `setStatuses` under one admission.
   * A refused thread or update leaves the others intact; a recipient belongs to its first
   * committed status. Each committed thread then notifies on its own, as `change` does. */
  resolveAll(threads: readonly ThreadView[]): Promise<ResolveAllResult> {
    if (this.#batch) return this.#batch;
    const captured = [
      ...new Map(
        threads.map((thread) => [discussionRefKey(thread.ref), structuredClone(thread)]),
      ).values(),
    ];
    const asks = structuredClone([...this.options.asks()]);
    const notifications: Promise<void>[] = [];
    const publications = Promise.resolve().then(() =>
      this.#resolveAll(captured, asks, notifications),
    );
    const settled = publications
      .then(() => Promise.allSettled(notifications))
      .then(() => undefined);
    const task = publications.then((results) => ({ results, settled }));
    // Repeated clicks share the publication report until all original attempts settle.
    const clear = () => {
      if (this.#batch === task) this.#batch = undefined;
    };
    void settled.then(clear, clear);
    this.#batch = task;
    return task;
  }
  async #resolveAll(
    captured: readonly ThreadView[],
    asks: readonly PageAsk[],
    notifications: Promise<void>[],
  ): Promise<ResolveAllResult['results']> {
    const results: ResolveAllResult['results'] = captured.map((thread) => ({
      thread: thread.ref,
      result: { changed: false },
    }));
    const writes: {
      index: number;
      key: string;
      generation: symbol;
      settle(outcome: StatusOutcome): void;
    }[] = [];
    for (const [index, thread] of captured.entries()) {
      const key = discussionRefKey(thread.ref);
      // A batch never joins or supersedes another explicit action on the same thread.
      if (this.#changing.has(key)) continue;
      if (!isStatusThread(thread)) {
        results[index] = { thread: thread.ref, error: new Error('Not a status thread') };
        continue;
      }
      if (thread.resolved) continue;
      const generation = Symbol();
      let settle!: (outcome: StatusOutcome) => void;
      const task = new Promise<StatusOutcome>((resolve) => (settle = resolve)).then((outcome) => {
        if ('error' in outcome) throw outcome.error;
        return outcome;
      });
      task.catch(() => {});
      this.#changing.set(key, { resolved: true, generation, task });
      writes.push({ index, key, generation, settle });
    }
    if (!writes.length) return results;
    // Start directory I/O before the binding acquires its lock and admits the writer.
    // Prior signed IDs still identify recipients if the directory is unavailable.
    const destinations = (async () => this.options.destinations())()
      .catch(() => [])
      .then((values) => structuredClone([...values]));
    const frozen = destinations.then((values) =>
      writes.map(({ index }) => freezeThreadRecipients(captured[index], asks, values)),
    );
    const outcomes = await this.options.binding
      .setStatuses(
        writes.map(({ index }, i) => ({
          thread: captured[index].ref,
          previous: captured[index].status?.ref ?? null,
          resolved: true,
          recipients: frozen.then((values) => values[i].recipients),
        })),
      )
      .catch((error: unknown) => writes.map(() => ({ error })));
    const directory = await destinations;
    for (const [i, { index, key, generation, settle }] of writes.entries()) {
      const outcome = outcomes[i] ?? { error: new Error('Missing status outcome') };
      const thread = captured[index];
      const done = () => {
        if (this.#changing.get(key)?.generation === generation) this.#changing.delete(key);
      };
      if ('error' in outcome) results[index] = { thread: thread.ref, error: outcome.error };
      else if (outcome.changed) {
        const result = { ...outcome, warnings: (await frozen)[i].warnings };
        results[index] = { thread: thread.ref, result };
        notifications.push(
          this.#notify(key, generation, outcome.status, thread, directory).finally(done),
        );
        settle(result);
        continue;
      }
      done();
      settle(outcome);
    }
    return results;
  }
  change(thread: ThreadView, resolved: boolean, options?: { onlyAgentName: string }) {
    return this.#start(thread, resolved, options?.onlyAgentName);
  }
  #start(thread: ThreadView, resolved: boolean, onlyAgentName?: string) {
    const key = discussionRefKey(thread.ref);
    const pending = this.#changing.get(key);
    if (pending?.resolved === resolved) return pending.task;
    const generation = Symbol();
    const captured = structuredClone(thread);
    const asks = structuredClone([...this.options.asks()]);
    const task = Promise.resolve().then(() =>
      this.#change(key, generation, captured, asks, resolved, onlyAgentName),
    );
    this.#changing.set(key, { resolved, generation, task });
    return task;
  }
  async #change(
    key: string,
    generation: symbol,
    thread: ThreadView,
    asks: readonly PageAsk[],
    resolved: boolean,
    onlyAgentName?: string,
  ) {
    let notifying = false;
    try {
      requireValue(isStatusThread(thread));
      if (thread.resolved === resolved) return { changed: false } as const;
      // Start directory I/O before the binding acquires its lock and admits the writer.
      // Prior signed IDs still identify recipients if the directory is unavailable.
      const destinations = resolved
        ? this.options.destinations().catch(() => [])
        : Promise.resolve([]);
      const frozen = destinations.then((values) =>
        resolved
          ? freezeThreadRecipients(thread, asks, values, onlyAgentName)
          : { recipients: [], warnings: [] },
      );
      const result = await this.options.binding.setStatus(
        thread.ref,
        thread.status?.ref ?? null,
        resolved,
        frozen.then((value) => value.recipients),
      );
      if (!result.changed) return result;
      notifying = true;
      const notification = this.#notify(
        key,
        generation,
        result.status,
        thread,
        await destinations,
      ).finally(() => {
        if (this.#changing.get(key)?.generation === generation) this.#changing.delete(key);
      });
      void notification;
      return { ...result, warnings: (await frozen).warnings };
    } finally {
      if (!notifying && this.#changing.get(key)?.generation === generation)
        this.#changing.delete(key);
    }
  }
  async #notify(
    key: string,
    generation: symbol,
    status: ThreadStatusView,
    thread: ThreadView,
    destinations: readonly AgentDestination[],
  ) {
    for (const recipient of status.recipients) {
      // A newer explicit action supersedes this task, never the person's status write.
      if (this.#changing.get(key)?.generation !== generation) return;
      try {
        const outcome = await this.options.notify(status, recipient, thread, destinations);
        if (!outcome.adopted)
          await this.options.binding.notificationFailed(
            status,
            recipient.operationId,
            outcome.reason,
          );
      } catch {
        // Unknown adoption never permits a resend; independent recipients get one attempt each.
      }
    }
  }
}

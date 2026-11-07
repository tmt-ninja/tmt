import { generatedId } from '@tmt/colab-client';
import { LIST_TOKEN, type PageListChange } from './bootstrap.js';

/** After a refused or failed held read, how long the reading tab waits before it reads the whole
 * list once and tries a held read again (contract: Live page list). */
export const PAGE_LIST_BACKOFF_MS = 30_000;
/** Pages a broadcast may name: the owner list's own bound. */
const BROADCAST_PAGES = 1000;
const PAGE_REVISION = /^v1:[0-9a-f]{64}$/;

export interface PageListReads {
  /** The whole list now. */
  list(signal: AbortSignal): Promise<PageListChange>;
  /** The list once it no longer has `after` as its token, or unchanged after the serve's hold. */
  held(after: string, signal: AbortSignal): Promise<PageListChange>;
}

/** The browser's tab coordination for one mount: a Web Lock and a BroadcastChannel of `name`. */
export interface PageListCoordination {
  readonly name: string;
  readonly locks: Pick<LockManager, 'request'>;
  channel(): Pick<BroadcastChannel, 'postMessage' | 'close' | 'addEventListener'>;
  /** Whether this tab is visible now, and a way to hear when it becomes visible. */
  visible(): boolean;
  onVisible(listener: () => void): () => void;
}

type Message =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'revisions'; listToken: string; revisions: [string, string][] };

/** A broadcast from another tab, or nothing when it is not exactly one of the two messages. It is
 * only a hint that pages moved: a listener compiles from its own verified reads. */
export function broadcastMessage(data: unknown): Message | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const value = data as Record<string, unknown>;
  const keys = Object.keys(value).sort().join();
  if (value.v !== 1) return undefined;
  if (value.type === 'hello') return keys === 'type,v' ? { v: 1, type: 'hello' } : undefined;
  if (value.type !== 'revisions' || keys !== 'listToken,revisions,type,v') return undefined;
  if (typeof value.listToken !== 'string' || !LIST_TOKEN.test(value.listToken)) return undefined;
  const list = value.revisions;
  if (!Array.isArray(list) || list.length > BROADCAST_PAGES) return undefined;
  const revisions: [string, string][] = [];
  for (const entry of list as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return undefined;
    const [id, revision] = entry as unknown[];
    if (typeof id !== 'string' || typeof revision !== 'string' || !PAGE_REVISION.test(revision))
      return undefined;
    try {
      generatedId(id);
    } catch {
      return undefined;
    }
    revisions.push([id, revision]);
  }
  return { v: 1, type: 'revisions', listToken: value.listToken, revisions };
}

/**
 * The browser's live page list: at most one held read per browser, however many tabs and
 * followers listen (contract: Live page list). Browsers allow six HTTP/1.1 connections per host
 * across all tabs, so a held read in every tab would starve the origin. The tab holding the Web
 * Lock reads and broadcasts each list's revisions; the others only listen. A tab that becomes
 * visible takes the lock, so a hidden or frozen holder never stalls the rest. Without the lock or
 * channel API each tab holds its own read, bounded by the serve's cap (CAPACITY, then
 * `PAGE_LIST_BACKOFF_MS`).
 */
export class PageListFeed {
  readonly #listeners = new Set<(revisions: ReadonlyMap<string, string>) => void>();
  #latest?: ReadonlyMap<string, string>;
  /** The token of the list `#latest` came from. */
  #token?: string;
  #run?: AbortController;
  #closed = false;
  constructor(
    private readonly reads: PageListReads,
    private readonly coordination?: PageListCoordination,
    private readonly backoffMs = PAGE_LIST_BACKOFF_MS,
  ) {}
  watch(listener: (revisions: ReadonlyMap<string, string>) => void): () => void {
    if (this.#closed) return () => {};
    this.#listeners.add(listener);
    const latest = this.#latest;
    if (latest) queueMicrotask(() => this.#listeners.has(listener) && listener(latest));
    if (!this.#run) {
      const run = (this.#run = new AbortController());
      if (this.coordination) this.#coordinate(this.coordination, run.signal);
      else void this.#loop(run.signal);
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size) return;
      this.#run?.abort();
      this.#run = undefined;
      this.#latest = undefined;
      this.#token = undefined;
    };
  }
  /** The page's revision in the latest list this tab heard; absent while no list is known. */
  revision(page: string): string | undefined {
    return this.#latest?.get(page);
  }
  /** End the feed for good: its read, its lock and its channel, whoever still listens. */
  close() {
    this.#closed = true;
    this.#listeners.clear();
    this.#run?.abort();
    this.#run = undefined;
    this.#latest = undefined;
    this.#token = undefined;
  }
  #publish(revisions: ReadonlyMap<string, string>, token: string) {
    this.#latest = revisions;
    this.#token = token;
    for (const listener of this.#listeners) listener(revisions);
  }
  #coordinate(coordination: PageListCoordination, signal: AbortSignal) {
    const channel = coordination.channel();
    let holding = false;
    const broadcast = (revisions: ReadonlyMap<string, string>, listToken: string) =>
      channel.postMessage({
        v: 1,
        type: 'revisions',
        listToken,
        revisions: [...revisions],
      } satisfies Message);
    channel.addEventListener('message', (event) => {
      const message = broadcastMessage((event as MessageEvent).data);
      if (!message || signal.aborted) return;
      if (message.type === 'hello') {
        if (holding && this.#latest && this.#token) broadcast(this.#latest, this.#token);
      } else if (!holding) this.#publish(new Map(message.revisions), message.listToken);
    });
    // One lock request at a time: queued behind the holder, or stealing when this tab is visible.
    let current: AbortController | undefined;
    const acquire = (steal: boolean) => {
      current?.abort();
      const owned = new AbortController();
      current = owned;
      coordination.locks
        .request(coordination.name, steal ? { steal: true } : { signal: owned.signal }, () => {
          if (owned.signal.aborted) return;
          holding = true;
          // The list the last holder told of: this tab resumes with a held read, not a full one.
          void this.#loop(owned.signal, broadcast, this.#token);
          return new Promise<void>((resolve) =>
            owned.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        })
        // Stolen by a visible tab, replaced by this tab's own request, or the feed ended.
        .catch(() => {})
        .finally(() => {
          owned.abort();
          if (current !== owned) return;
          holding = false;
          current = undefined;
          if (!signal.aborted) acquire(false);
        });
    };
    acquire(coordination.visible());
    const quiet = coordination.onVisible(() => {
      if (!holding && !signal.aborted) acquire(true);
    });
    channel.postMessage({ v: 1, type: 'hello' } satisfies Message);
    signal.addEventListener(
      'abort',
      () => {
        quiet();
        const last = current;
        current = undefined;
        last?.abort();
        channel.close();
      },
      { once: true },
    );
  }
  async #loop(
    signal: AbortSignal,
    broadcast?: (revisions: ReadonlyMap<string, string>, listToken: string) => void,
    start?: string,
  ) {
    let token = start;
    while (!signal.aborted) {
      try {
        const change = token ? await this.reads.held(token, signal) : await this.reads.list(signal);
        if (signal.aborted) return;
        token = change.listToken;
        if (!change.unchanged) {
          this.#publish(change.revisions, change.listToken);
          broadcast?.(change.revisions, change.listToken);
        }
      } catch {
        if (signal.aborted) return;
        token = undefined;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.backoffMs);
          signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
            once: true,
          });
        });
      }
    }
  }
}

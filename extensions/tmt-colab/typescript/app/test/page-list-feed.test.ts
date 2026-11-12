import { describe, expect, it, vi } from 'vite-plus/test';
import type { PageListChange } from '../src/bootstrap.js';
import {
  broadcastMessage,
  PAGE_LIST_BACKOFF_MS,
  PageListFeed,
  type PageListCoordination,
} from '../src/page-list-feed.js';
import { AdmissionRefusedError } from '../src/registration.js';

const PAGE_A = '10000000-0000-4000-8000-00000000000a';
const token = (n: number) => n.toString(16).padStart(64, '0');
/** A moved list: the page's revision follows the list, and listeners hear its content revision. */
const changed = (n: number, content: string): PageListChange => ({
  unchanged: false,
  listToken: token(n),
  revisions: new Map([[PAGE_A, `v1:${token(n)}`]]),
  contents: new Map([[PAGE_A, content]]),
});

describe('the live page list (#6162)', () => {
  it('holds one read per tab however many listen, and re-arms on each answer', async () => {
    const held: ((value: PageListChange) => void)[] = [];
    const reads = {
      list: vi.fn(async () => changed(1, 'v1:a')),
      held: vi.fn(
        (_after: string, _signal: AbortSignal) =>
          new Promise<PageListChange>((resolve) => held.push(resolve)),
      ),
    };
    const feed = new PageListFeed(reads);
    const heard: string[] = [];
    const first = feed.watch((latest) => heard.push(`1:${latest.get(PAGE_A)}`));
    const second = feed.watch((latest) => heard.push(`2:${latest.get(PAGE_A)}`));
    await vi.waitFor(() => expect(reads.held).toHaveBeenCalledTimes(1));
    expect(reads.list).toHaveBeenCalledTimes(1);
    expect(reads.held).toHaveBeenLastCalledWith(token(1), expect.any(AbortSignal));
    expect(heard).toEqual(['1:v1:a', '2:v1:a']);
    // Unchanged: nobody hears anything, and the same token is held again.
    held.shift()!({ unchanged: true, listToken: token(1) });
    await vi.waitFor(() => expect(reads.held).toHaveBeenCalledTimes(2));
    expect(reads.held).toHaveBeenLastCalledWith(token(1), expect.any(AbortSignal));
    expect(heard).toHaveLength(2);
    held.shift()!(changed(2, 'v1:b'));
    await vi.waitFor(() => expect(reads.held).toHaveBeenCalledTimes(3));
    expect(reads.held).toHaveBeenLastCalledWith(token(2), expect.any(AbortSignal));
    expect(heard).toEqual(['1:v1:a', '2:v1:a', '1:v1:b', '2:v1:b']);
    // A late listener hears the latest list at once.
    const late: string[] = [];
    const third = feed.watch((latest) => late.push(latest.get(PAGE_A)!));
    await vi.waitFor(() => expect(late).toEqual(['v1:b']));
    first();
    second();
    third();
    // The last listener leaving ends the held read.
    const signal = reads.held.mock.calls.at(-1)![1];
    expect(signal.aborted).toBe(true);
  });

  it('a refused held read (CAPACITY) is never an error: one list read on the backoff, then held again', async () => {
    vi.useFakeTimers();
    try {
      let refuse = true;
      const reads = {
        list: vi.fn(async () => changed(reads.list.mock.calls.length, 'v1:a')),
        held: vi.fn(async (_after: string, _signal: AbortSignal) => {
          if (refuse) throw new AdmissionRefusedError(503, '{"code":"CAPACITY"}', 'CAPACITY');
          return new Promise<PageListChange>(() => {});
        }),
      };
      const feed = new PageListFeed(reads);
      const heard: string[] = [];
      const stop = feed.watch((latest) => heard.push(latest.get(PAGE_A)!));
      await vi.advanceTimersByTimeAsync(0);
      expect(reads.list).toHaveBeenCalledTimes(1);
      expect(reads.held).toHaveBeenCalledTimes(1);
      // Refused: nothing more until the backoff passes.
      await vi.advanceTimersByTimeAsync(PAGE_LIST_BACKOFF_MS - 1);
      expect(reads.list).toHaveBeenCalledTimes(1);
      expect(reads.held).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads.list).toHaveBeenCalledTimes(2);
      expect(reads.held).toHaveBeenCalledTimes(2);
      // A slot frees: the next round holds and stays held.
      refuse = false;
      await vi.advanceTimersByTimeAsync(PAGE_LIST_BACKOFF_MS);
      expect(reads.list).toHaveBeenCalledTimes(3);
      expect(reads.held).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(PAGE_LIST_BACKOFF_MS * 3);
      expect(reads.held).toHaveBeenCalledTimes(3);
      expect(heard).toEqual(['v1:a', 'v1:a', 'v1:a']);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the page-list vector (#6162)', async () => {
  const vector = (await import('../../../contracts/vectors/page-list-v1.json')).default as {
    replies: { name: string; reply: unknown; result: unknown }[];
    listToken: { valid: string[]; invalid: string[] };
  };
  const { heldPageList, listRevisions } = await import('../src/bootstrap.js');
  for (const { name, reply, result } of vector.replies)
    it(name, () => {
      if (result === 'refused') expect(() => listRevisions(reply)).toThrow();
      else {
        const read = listRevisions(reply);
        expect(
          read.unchanged
            ? read
            : {
                ...read,
                revisions: Object.fromEntries(read.revisions),
                contents: Object.fromEntries(read.contents),
              },
        ).toEqual(result);
      }
    });
  it('holds only on a token the serve admits', async () => {
    for (const token of vector.listToken.invalid)
      await expect(
        heldPageList(new URL('http://127.0.0.1:1/'), token, new AbortController().signal),
      ).rejects.toThrow();
  });
});

/** One browser's tabs: a Web Lock manager with queueing, signals and steal, and a channel hub. */
function browser() {
  type Held = { tab: number; release: () => void; reject: (error: Error) => void };
  let held: Held | undefined;
  const queue: { tab: number; grant: () => void }[] = [];
  const channels = new Set<{ tab: number; listeners: Set<(event: { data: unknown }) => void> }>();
  const grantNext = () => {
    if (held) return;
    queue.shift()?.grant();
  };
  const tab = (index: number, visible = false): PageListCoordination & { show(): void } => {
    const shown = new Set<() => void>();
    let isVisible = visible;
    return {
      name: 'colab-page-list:test',
      locks: {
        request: ((_name: string, options: LockOptions, callback: () => unknown) =>
          new Promise((resolve, reject) => {
            const grant = () => {
              let release!: () => void;
              const done = new Promise<void>((r) => (release = r));
              held = { tab: index, release, reject };
              Promise.resolve(callback())
                .then(() => release())
                .catch(() => release());
              void done.then(() => {
                if (held?.tab === index && held.release === release) held = undefined;
                resolve(undefined);
                grantNext();
              });
            };
            if (options.steal) {
              const previous = held;
              held = undefined;
              previous?.reject(new DOMException('stolen', 'AbortError'));
              grant();
              return;
            }
            const entry = { tab: index, grant };
            options.signal?.addEventListener('abort', () => {
              const at = queue.indexOf(entry);
              if (at >= 0) queue.splice(at, 1);
              reject(new DOMException('aborted', 'AbortError'));
            });
            queue.push(entry);
            grantNext();
          })) as unknown as LockManager['request'],
      },
      channel: () => {
        const own = { tab: index, listeners: new Set<(event: { data: unknown }) => void>() };
        channels.add(own);
        return {
          postMessage: (data: unknown) => {
            for (const other of channels)
              if (other !== own)
                for (const listener of other.listeners)
                  queueMicrotask(() => listener({ data: structuredClone(data) }));
          },
          addEventListener: ((_type: string, listener: (event: { data: unknown }) => void) =>
            own.listeners.add(listener)) as unknown as BroadcastChannel['addEventListener'],
          close: () => channels.delete(own),
        };
      },
      visible: () => isVisible,
      onVisible: (listener) => {
        shown.add(listener);
        return () => shown.delete(listener);
      },
      show() {
        isVisible = true;
        for (const listener of shown) listener();
      },
    };
  };
  return {
    tab,
    holder: () => held?.tab,
    post: (data: unknown) => channels.forEach((c) => c.listeners.forEach((l) => l({ data }))),
  };
}

/** A serve whose held reads wait until `move()` changes the list. */
function serve() {
  let n = 1;
  const waiting = new Set<() => void>();
  const inFlight = { held: 0, max: 0 };
  const current = (): PageListChange => changed(n, n.toString(16).padStart(64, '0'));
  return {
    inFlight,
    reads: () => ({
      list: vi.fn(async () => current()),
      held: vi.fn(
        (after: string, signal: AbortSignal) =>
          new Promise<PageListChange>((resolve, reject) => {
            if (after !== token(n)) return resolve(current());
            inFlight.held++;
            inFlight.max = Math.max(inFlight.max, inFlight.held);
            const done = () => {
              inFlight.held--;
              waiting.delete(done);
              resolve(current());
            };
            waiting.add(done);
            signal.addEventListener('abort', () => {
              if (!waiting.delete(done)) return;
              inFlight.held--;
              reject(signal.reason);
            });
          }),
      ),
    }),
    move() {
      n++;
      for (const done of waiting) done();
    },
  };
}

describe('one held read per browser (#6162)', () => {
  it('five tabs share one held read, every tab hears a change, and the lock passes on when the holder leaves', async () => {
    const tabs = browser();
    const server = serve();
    const heard = new Map<number, string[]>();
    const stops = Array.from({ length: 5 }, (_, index) => {
      const feed = new PageListFeed(server.reads(), tabs.tab(index));
      heard.set(index, []);
      return feed.watch((latest) => heard.get(index)!.push(latest.get(PAGE_A)!));
    });
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    expect(tabs.holder()).toBe(0);
    server.move();
    await vi.waitFor(() =>
      expect([...heard.values()].every((list) => list.at(-1) === '2'.padStart(64, '0'))).toBe(true),
    );
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    // The holder leaves: another tab takes the lock and holds.
    stops[0]!();
    await vi.waitFor(() => expect(tabs.holder()).toBe(1));
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    server.move();
    await vi.waitFor(() => expect(heard.get(4)!.at(-1)).toBe('3'.padStart(64, '0')));
    expect(server.inFlight.max).toBe(1);
    for (const stop of stops.slice(1)) stop();
    await vi.waitFor(() => expect(server.inFlight.held).toBe(0));
  });

  it('a membership move changes every revision but no content revision, in the holder and the listening tabs (#6179)', async () => {
    const tabs = browser();
    let n = 1;
    let membership = 0;
    const waiting = new Set<() => void>();
    const current = (): PageListChange => ({
      unchanged: false,
      listToken: token(n),
      revisions: new Map([[PAGE_A, `v1:${token(1000 + membership)}`]]),
      contents: new Map([[PAGE_A, 'c'.repeat(64)]]),
    });
    const reads = () => ({
      list: async () => current(),
      held: (after: string, signal: AbortSignal) =>
        new Promise<PageListChange>((resolve, reject) => {
          if (after !== token(n)) return resolve(current());
          const done = () => resolve(current());
          waiting.add(done);
          signal.addEventListener('abort', () => waiting.delete(done) && reject(signal.reason));
        }),
    });
    const feeds = [0, 1].map((index) => new PageListFeed(reads(), tabs.tab(index)));
    const heard: string[][] = [[], []];
    const stops = feeds.map((feed, index) =>
      feed.watch((latest) => heard[index]!.push(latest.get(PAGE_A)!)),
    );
    await vi.waitFor(() => expect(feeds[1]!.revision(PAGE_A)).toBe(`v1:${token(1000)}`));
    // Another page is shared: the list and every page's revision move, the page's content does not.
    membership++;
    n++;
    const answers = [...waiting];
    waiting.clear();
    for (const done of answers) done();
    for (const feed of feeds)
      await vi.waitFor(() => expect(feed.revision(PAGE_A)).toBe(`v1:${token(1001)}`));
    for (const list of heard) expect(new Set(list)).toEqual(new Set(['c'.repeat(64)]));
    for (const stop of stops) stop();
  });

  it('a closed feed lets the lock go even while a follower still listens', async () => {
    const tabs = browser();
    const server = serve();
    const first = new PageListFeed(server.reads(), tabs.tab(0));
    const second = new PageListFeed(server.reads(), tabs.tab(1));
    first.watch(() => {});
    second.watch(() => {});
    await vi.waitFor(() => expect(tabs.holder()).toBe(0));
    first.close();
    await vi.waitFor(() => expect(tabs.holder()).toBe(1));
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    second.close();
    await vi.waitFor(() => expect(server.inFlight.held).toBe(0));
  });

  it('a tab that becomes visible takes the lock from a hidden holder and resumes its held read', async () => {
    const tabs = browser();
    const server = serve();
    const hidden = new PageListFeed(server.reads(), tabs.tab(0));
    const second = tabs.tab(1);
    const reads = server.reads();
    const visible = new PageListFeed(reads, second);
    const stopHidden = hidden.watch(() => {});
    const heard: string[] = [];
    const stopVisible = visible.watch((latest) => heard.push(latest.get(PAGE_A)!));
    await vi.waitFor(() => expect(tabs.holder()).toBe(0));
    await vi.waitFor(() => expect(heard.length).toBeGreaterThan(0));
    second.show();
    await vi.waitFor(() => expect(tabs.holder()).toBe(1));
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    server.move();
    await vi.waitFor(() => expect(heard.at(-1)).toBe('2'.padStart(64, '0')));
    // The stolen holder cancels its read as the new holder starts one: they overlap at most once.
    expect(server.inFlight.max).toBeLessThanOrEqual(2);
    // The broadcast named the list's token: the new holder held on it, with no whole-list read.
    expect(reads.list).not.toHaveBeenCalled();
    expect(reads.held).toHaveBeenCalled();
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    stopHidden();
    stopVisible();
  });

  it('tabs that open one by one, each taking the lock as it shows, all hear the next change', async () => {
    // The acceptance's five tabs: each new tab is visible, so it steals the lock from the last.
    const tabs = browser();
    const server = serve();
    const heard = new Map<number, string[]>();
    const stops: (() => void)[] = [];
    for (let index = 0; index < 5; index++) {
      const tab = tabs.tab(index, true);
      const feed = new PageListFeed(server.reads(), tab);
      heard.set(index, []);
      stops.push(feed.watch((latest) => heard.get(index)!.push(latest.get(PAGE_A)!)));
      await vi.waitFor(() => expect(tabs.holder()).toBe(index));
      await vi.waitFor(() => expect(heard.get(index)!.length).toBeGreaterThan(0));
    }
    await vi.waitFor(() => expect(server.inFlight.held).toBe(1));
    server.move();
    const moved = '2'.padStart(64, '0');
    await vi.waitFor(() =>
      expect([...heard.entries()].filter(([, list]) => list.at(-1) !== moved)).toEqual([]),
    );
    for (const stop of stops) stop();
  });

  it('a listening tab ignores a malformed broadcast', async () => {
    const tabs = browser();
    const server = serve();
    const holder = new PageListFeed(server.reads(), tabs.tab(0));
    const listener = new PageListFeed(server.reads(), tabs.tab(1));
    const stopHolder = holder.watch(() => {});
    const heard: unknown[] = [];
    const stop = listener.watch((latest) => heard.push(latest));
    await vi.waitFor(() => expect(heard.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const before = heard.length;
    for (const data of [
      null,
      'revisions',
      {
        v: 1,
        type: 'revisions',
        listToken: '0'.repeat(64),
        revisions: [['page-a', 'v1:' + '0'.repeat(64), '0'.repeat(64)]],
      },
      // A list without its token, or with one the serve never makes.
      {
        v: 1,
        type: 'revisions',
        revisions: [
          ['10000000-0000-4000-8000-000000000001', 'v1:' + '0'.repeat(64), '0'.repeat(64)],
        ],
      },
      {
        v: 1,
        type: 'revisions',
        listToken: 'A'.repeat(64),
        revisions: [
          ['10000000-0000-4000-8000-000000000001', 'v1:' + '0'.repeat(64), '0'.repeat(64)],
        ],
      },
      {
        v: 1,
        type: 'revisions',
        listToken: '0'.repeat(64),
        revisions: [
          ['10000000-0000-4000-8000-000000000001', 'v1:' + '0'.repeat(64), '0'.repeat(64)],
        ],
        extra: 1,
      },
      { v: 2, type: 'revisions', listToken: '0'.repeat(64), revisions: [] },
      // A page without its content revision (the shape before #6179), or with a malformed one.
      {
        v: 1,
        type: 'revisions',
        listToken: '0'.repeat(64),
        revisions: [['10000000-0000-4000-8000-000000000001', 'v1:' + '0'.repeat(64)]],
      },
      {
        v: 1,
        type: 'revisions',
        listToken: '0'.repeat(64),
        revisions: [
          ['10000000-0000-4000-8000-000000000001', 'v1:' + '0'.repeat(64), 'v1:' + '0'.repeat(64)],
        ],
      },
    ])
      tabs.post(data);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(heard).toHaveLength(before);
    expect(broadcastMessage({ v: 1, type: 'hello' })).toEqual({ v: 1, type: 'hello' });
    expect(broadcastMessage({ v: 1, type: 'hello', page: 'x' })).toBeUndefined();
    stopHolder();
    stop();
  });

  it('without coordination, five tabs against a serve capped at four: the fifth backs off and never errors', async () => {
    vi.useFakeTimers();
    try {
      let holding = 0;
      const refused: number[] = [];
      const lists: number[] = [];
      const feeds = Array.from(
        { length: 5 },
        (_, index) =>
          new PageListFeed({
            list: async () => (lists.push(index), changed(1, 'v1:a')),
            held: async (_after, signal) => {
              if (holding >= 4) {
                refused.push(index);
                throw new AdmissionRefusedError(503, '{"code":"CAPACITY"}', 'CAPACITY');
              }
              holding++;
              return new Promise<PageListChange>((_resolve, reject) =>
                signal.addEventListener('abort', () => (holding--, reject(signal.reason))),
              );
            },
          }),
      );
      const stops = feeds.map((feed) => feed.watch(() => {}));
      await vi.advanceTimersByTimeAsync(0);
      expect(holding).toBe(4);
      expect(refused).toEqual([4]);
      await vi.advanceTimersByTimeAsync(PAGE_LIST_BACKOFF_MS);
      expect(lists.filter((tab) => tab === 4)).toHaveLength(2);
      // A slot frees: the fifth tab holds on its next round.
      stops[0]!();
      await vi.advanceTimersByTimeAsync(PAGE_LIST_BACKOFF_MS);
      expect(holding).toBe(4);
      expect(refused).toEqual([4, 4]);
      for (const stop of stops.slice(1)) stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

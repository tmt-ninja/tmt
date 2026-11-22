import { afterEach, expect, it, vi } from 'vite-plus/test';
import { RETRY_CAP_MS, RETRY_FIRST_MS, retryWhileVisible } from '../src/shell-app.js';

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
  show(visible: boolean) {
    this.visibilityState = visible ? 'visible' : 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('a waiting card tries after 2 s, doubles the wait to a 30 s cap and stops once it loads (#6810)', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', new FakeDocument());
  const route = new AbortController();
  const at: number[] = [];
  let loads = 7;
  retryWhileVisible(async () => {
    at.push(Date.now());
    return --loads === 0;
  }, route.signal);
  const start = Date.now();
  await vi.advanceTimersByTimeAsync(0);
  expect(at).toEqual([]);
  await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000 + 30_000 + 30_000 + 30_000);
  expect(at.map((time) => time - start)).toEqual([
    2_000, 6_000, 14_000, 30_000, 60_000, 90_000, 120_000,
  ]);
  expect([RETRY_FIRST_MS, RETRY_CAP_MS]).toEqual([2_000, 30_000]);
  // Loaded: nothing more is tried.
  await vi.advanceTimersByTimeAsync(120_000);
  expect(at).toHaveLength(7);
});

it('a hidden page tries nothing, showing it tries at once, one attempt at a time, and leaving stops it', async () => {
  vi.useFakeTimers();
  const page = new FakeDocument();
  vi.stubGlobal('document', page);
  const route = new AbortController();
  const at: number[] = [];
  let finish: ((loaded: boolean) => void) | undefined;
  // A card first shown in a hidden tab tries nothing until the tab shows.
  page.visibilityState = 'hidden';
  retryWhileVisible(() => {
    at.push(Date.now());
    return new Promise<boolean>((resolve) => (finish = resolve));
  }, route.signal);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(at).toHaveLength(0);
  page.show(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(at).toHaveLength(1);
  // Still in flight: showing the page again or the clock passing starts no second attempt.
  page.show(false);
  page.show(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(at).toHaveLength(1);
  finish!(false);
  await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS * 2);
  expect(at).toHaveLength(2);
  // The route is left mid-attempt: that attempt ends, and nothing follows it.
  route.abort();
  finish!(false);
  page.show(false);
  page.show(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(at).toHaveLength(2);
});

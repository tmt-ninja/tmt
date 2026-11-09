import { describe, expect, it } from 'vite-plus/test';
import { mentionPages } from '../src/mention-pages.js';
import type { ParentPageViewSource } from '../src/parent-page-view.js';
import type { PageViewRecord } from '../src/page-view-source.js';

const row = (id: string, name: string) => ({ id, name }) as unknown as PageViewRecord;
const never = () => Promise.reject(new Error('not opened'));

/** A page-list source that counts its stops and settles when `settle` says. */
function source(settle: 'now' | 'later' | 'never') {
  const counts = { stops: 0 };
  let publish: ((rows: PageViewRecord[]) => void) | undefined;
  const pages: ParentPageViewSource = (onRows) => {
    if (settle === 'now') onRows([row('p1', 'One')]);
    else publish = onRows;
    return () => {
      counts.stops += 1;
    };
  };
  return { pages, counts, publish: () => publish?.([row('p1', 'One')]) };
}

describe('mention pages list', () => {
  it('stops the source once when it settles before returning its stop', async () => {
    const { pages, counts } = source('now');
    const list = await mentionPages(pages, never, () => true).list(new AbortController().signal);
    await Promise.resolve();
    expect(list).toEqual([{ id: 'p1', title: 'One' }]);
    expect(counts.stops).toBe(1);
  });

  it('stops the source once when the menu closes after the list arrived', async () => {
    const { pages, counts, publish } = source('later');
    const menu = new AbortController();
    const reading = mentionPages(pages, never, () => true).list(menu.signal);
    publish();
    await reading;
    await Promise.resolve();
    menu.abort();
    expect(counts.stops).toBe(1);
  });

  it('stops the source once when the menu closes before the list arrives', async () => {
    const { pages, counts } = source('never');
    const menu = new AbortController();
    const reading = mentionPages(pages, never, () => true).list(menu.signal);
    menu.abort();
    await expect(reading).rejects.toBeDefined();
    expect(counts.stops).toBe(1);
  });
});

import { describe, expect, it, vi } from 'vite-plus/test';
import { pageViewRecords, watchPageView } from '../src/page-view-source.js';
import type { PageSummary, PageTransport } from '../src/transport.js';
import { rememberPages } from '../src/quick-switcher-source.js';

const page = (id: string): PageSummary => ({ id, title: `Page ${id}`, sharing: 'private' });

describe('page view source', () => {
  it('limits and strips the records sent to the frame', () => {
    const records = pageViewRecords(
      Array.from({ length: 205 }, (_, index) => ({
        ...page(String(index)),
        source: 'not for the frame',
        title: 'x'.repeat(400),
      })),
    );
    expect(records.length).toBeLessThanOrEqual(200);
    expect(new TextEncoder().encode(JSON.stringify(records)).byteLength).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect(records[0]?.name).toHaveLength(256);
    expect(records[0]).not.toHaveProperty('source');
    expect(
      pageViewRecords([
        { ...page('archived'), archived: true },
        { ...page('design'), projects: ['tmt:design-system'] },
        page('visible'),
      ]).map((item) => item.id),
    ).toEqual(['visible']);
  });
  it('aborts and does not publish a late result after close', async () => {
    let finish!: (home: { title: string; pages: PageSummary[] }) => void;
    const source = {
      page: async () => {
        throw new Error('unexpected page read');
      },
      spaceHome: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    } as PageTransport;
    const publish = vi.fn();
    const stop = watchPageView(source, 'private-test', publish, vi.fn());
    stop();
    finish({ title: 'Test', pages: [page('one')] });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });
  it('publishes a refreshed admitted list and stops watching after close', async () => {
    const source = {
      page: async () => {
        throw new Error('unexpected page read');
      },
      spaceHome: async () => ({ title: 'Test', pages: [page('one')] }),
    } as PageTransport;
    const publish = vi.fn();
    const stop = watchPageView(source, 'private-test', publish, vi.fn());
    await Promise.resolve();
    expect(publish.mock.lastCall?.[0].map((row: { id: string }) => row.id)).toEqual(['one']);
    rememberPages(source, 'private-test', [page('two')]);
    expect(publish.mock.lastCall?.[0].map((row: { id: string }) => row.id)).toEqual(['two']);
    stop();
    rememberPages(source, 'private-test', [page('three')]);
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it('reports a failed initial read without publishing fabricated data', async () => {
    const source: PageTransport = {
      page: async () => {
        throw new Error('unexpected page read');
      },
      spaceHome: async () => {
        throw new Error('unavailable');
      },
    };
    const publish = vi.fn();
    const failed = vi.fn();
    const stop = watchPageView(source, 'another-private-test', publish, failed);
    await Promise.resolve();
    expect(failed).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    stop();
  });
});

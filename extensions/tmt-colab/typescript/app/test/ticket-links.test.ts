import { describe, expect, test } from 'vite-plus/test';
import { githubTicket, ticketLinks, validTicketRepository } from '../src/ticket-links.js';
import { ticketPageByPrefix } from '../src/use-ticket-links.js';

describe('block ticket links', () => {
  const lookup = ({ text }: { text: string }) => text;
  test('matches positive standalone numbers and reports scalar spans', () => {
    expect(ticketLinks('💡 (#6745), W-182 and COLAB-140.', undefined, lookup)).toEqual([
      { from: 3, to: 8, href: '#6745' },
      { from: 11, to: 16, href: 'W-182' },
      { from: 21, to: 30, href: 'COLAB-140' },
    ]);
    expect(
      ticketLinks('x#1 #0 #012 αW-4 W-4extra W-0002 https://a.test/(#57) /#12', undefined, lookup),
    ).toEqual([]);
  });

  test('never crosses a formatting boundary or overlaps existing semantic marks', () => {
    const input = '#123 #456 #789';
    expect(
      ticketLinks(
        input,
        [
          { from: 0, to: 2, mark: 'bold' },
          { from: 5, to: 9, mark: 'code' },
          { from: 10, to: 14, mark: 'italic' },
        ],
        lookup,
      ),
    ).toEqual([{ from: 10, to: 14, href: '#789' }]);
    for (const mark of ['link', 'agent', 'block']) {
      expect(ticketLinks('#6745', [{ from: 1, to: 4, mark }], lookup)).toEqual([]);
    }
  });

  test('validates the configured GitHub repository', () => {
    expect(validTicketRepository('tmt-ninja/tmt')).toBe(true);
    expect(githubTicket('tmt-ninja/tmt', '6745')).toBe(
      'https://github.com/tmt-ninja/tmt/issues/6745',
    );
    for (const repository of ['a/b/c', '..', 'a/..', '-a/b', 'a/b?preview', 'a/@b']) {
      expect(validTicketRepository(repository)).toBe(false);
    }
  });

  test('a deleted page still makes a short prefix ambiguous', () => {
    const first = { pageId: '123456780000', deleted: false as const };
    const deleted = { pageId: '123456780001', deleted: true as const };
    expect(
      ticketPageByPrefix({ title: '', pages: [], pageIds: [first, deleted] }, '12345678'),
    ).toBeUndefined();
    expect(
      ticketPageByPrefix({ title: '', pages: [], pageIds: [first, deleted] }, '123456780000'),
    ).toBe(first.pageId);
    expect(ticketPageByPrefix({ title: '', pages: [] }, '12345678')).toBeUndefined();
  });
});

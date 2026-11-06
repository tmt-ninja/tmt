import { expect, it } from 'vite-plus/test';
import type { PageSummary } from '../src/transport.js';
import type { LegacyWork, Work } from '../src/work.js';
import { moveBetweenParents, pageLocation, parentRefusal, subpageTree } from '../src/work-tree.js';
import { SaveNotApplied, SaveRefused } from '../src/save.js';

const row = (
  id: string,
  state: PageSummary['state'],
  parent?: { page: string; index: number },
): PageSummary => ({
  id,
  title: id.toUpperCase(),
  state,
  sharing: 'private',
  ...(parent ? { summary: { comments: 0, waiting: false, needsYou: 0, parent } } : {}),
});
const work: Work = { version: 2, order: ['b', 'c'] };
const pages = [
  row('top', 'todo'),
  row('a', 'in-progress', { page: 'top', index: 0 }),
  row('b', 'done', { page: 'a', index: 0 }),
  row('c', 'in-progress', { page: 'a', index: 1 }),
  row('c2', 'done', { page: 'c', index: 10 }),
  row('c1', 'todo', { page: 'c', index: 2 }),
  row('free', 'todo'),
  row('elsewhere', 'todo', { page: 'top', index: 1 }),
];

it('offers only valid new parents and presents their location as a path', () => {
  expect(parentRefusal('a', 'a', pages)).toEqual({ kind: 'self' });
  expect(parentRefusal('a', 'top', pages)).toEqual({ kind: 'attached' });
  expect(parentRefusal('a', 'c1', pages)).toEqual({ kind: 'loop' });
  expect(parentRefusal('a', 'elsewhere', pages)).toBeUndefined();
  expect(
    pageLocation(
      pages.find((page) => page.id === 'c1')!,
      pages,
    ),
  ).toBe('TOP / A / C');
  expect(pageLocation({ ...pages[0], projects: ['Product'] }, pages)).toBe('Product');
  expect(pageLocation(pages[1], [{ ...pages[0], projects: ['Product'] }, ...pages.slice(1)])).toBe(
    'Product / TOP',
  );
});

it('moves in order and distinguishes a confirmed failed attach from an unknown outcome', async () => {
  const calls: string[] = [];
  const success = async (parent: string, action: 'subpage.attach' | 'subpage.detach') => {
    calls.push(`${parent}:${action}`);
  };
  expect(await moveBetweenParents('old', 'new', success)).toBe('attached');
  expect(calls).toEqual(['old:subpage.detach', 'new:subpage.attach']);
  calls.length = 0;
  expect(
    await moveBetweenParents('old', 'new', async (parent, action) => {
      await success(parent, action);
      if (action === 'subpage.attach') throw new SaveRefused('refused', 'Refused');
    }),
  ).toBe('detached');
  expect(calls).toEqual(['old:subpage.detach', 'new:subpage.attach']);
  expect(
    await moveBetweenParents('old', 'new', async (_parent, action) => {
      if (action === 'subpage.attach') throw new Error('Connection lost');
    }),
  ).toBe('unknown');
  calls.length = 0;
  expect(
    await moveBetweenParents('old', 'new', async (parent, action) => {
      await success(parent, action);
      if (action === 'subpage.detach') throw new SaveNotApplied('detach');
    }),
  ).toBe('unknown');
  expect(calls).toEqual(['old:subpage.detach']);
});

it("lists direct sub-pages in page order and deeper levels in each parent's order", () => {
  const tree = subpageTree('a', work, pages);
  expect(tree.top.map(({ id, parent }) => [id, parent])).toEqual([
    ['b', 'a'],
    ['c', 'a'],
  ]);
  // Index 2 before index 10, numerically.
  expect(tree.childrenOf('c').map(({ id }) => id)).toEqual(['c1', 'c2']);
  expect(tree.childrenOf('a')).toBe(tree.top);
  expect(tree.childrenOf('free')).toEqual([]);
});

it('reads a task-era value as its linked pages, once each, and never its plain tasks', () => {
  const legacy: LegacyWork = {
    version: 1,
    next: 5,
    order: ['T-1', 'T-2', 'T-3', 'T-4'],
    tasks: {
      'T-1': { title: 'b', state: 'todo', child: 'b' },
      'T-2': { title: 'plain', state: 'done' },
      'T-3': { title: 'c', state: 'todo', child: 'c' },
      // Two tasks following one page (a writers' race) still draw one row.
      'T-4': { title: 'b again', state: 'todo', child: 'b' },
    },
  };
  expect(subpageTree('a', legacy, pages).top.map(({ id }) => id)).toEqual(['b', 'c']);
});

it('counts only direct sub-pages by their own state, unknown when the list has none', () => {
  const tree = subpageTree('a', work, pages);
  expect(tree.counts(tree.top)).toEqual({ done: 1, inProgress: 1, todo: 0, unknown: 0, total: 2 });
  const unlisted = subpageTree('a', work, undefined);
  expect(unlisted.top.map((page) => page.title)).toEqual([undefined, undefined]);
  expect(unlisted.counts(unlisted.top)).toMatchObject({ unknown: 2, total: 2 });
});

it('names why a page cannot be attached: itself, above it, or under another page', () => {
  const tree = subpageTree('a', work, pages);
  expect(tree.refusal('a')).toEqual({ kind: 'self' });
  expect(tree.refusal('top')).toEqual({ kind: 'loop' });
  expect(tree.refusal('b')).toEqual({ kind: 'attached', parentTitle: 'A' });
  expect(tree.refusal('elsewhere')).toEqual({ kind: 'attached', parentTitle: 'TOP' });
  expect(tree.refusal('free')).toBeUndefined();
});

it('ends the ancestor walk on a stored loop', () => {
  const looped = [
    row('x', 'todo', { page: 'y', index: 0 }),
    row('y', 'todo', { page: 'x', index: 0 }),
  ];
  expect(subpageTree('x', undefined, looped).refusal('y')).toEqual({ kind: 'loop' });
});

it('leaves archived sub-pages out of every level and every count, keeping the others in order', () => {
  const archive = (ids: string[]) =>
    pages.map((page) => (ids.includes(page.id) ? { ...page, archived: true } : page));
  // A mix: the archived sub-page leaves its row and the count; its sibling keeps its place.
  const mixed = subpageTree('a', work, archive(['b']));
  expect(mixed.top.map(({ id }) => id)).toEqual(['c']);
  expect(mixed.counts(mixed.top)).toEqual({
    done: 0,
    inProgress: 1,
    todo: 0,
    unknown: 0,
    total: 1,
  });
  // Nested: an archived page below a sub-page leaves that level too.
  expect(mixed.childrenOf('c').map(({ id }) => id)).toEqual(['c1', 'c2']);
  expect(
    subpageTree('a', work, archive(['c1']))
      .childrenOf('c')
      .map(({ id }) => id),
  ).toEqual(['c2']);
  // All archived: nothing to list or count.
  const all = subpageTree('a', work, archive(['b', 'c']));
  expect(all.top).toEqual([]);
  expect(all.counts(all.top).total).toBe(0);
  // Unarchiving brings the row back in its old position: the link was never removed.
  expect(subpageTree('a', work, pages).top.map(({ id }) => id)).toEqual(['b', 'c']);
});

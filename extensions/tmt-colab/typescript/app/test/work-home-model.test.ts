import { expect, it } from 'vite-plus/test';
import type { PageSummary } from '../src/transport.js';
import {
  activityOwners,
  doneChart,
  overview,
  projectSections,
  recentlyDone,
  workItems,
} from '../src/work-home-model.js';
import {
  htmlOutlineSections,
  sectionMark,
  sectionTotals,
  segmentState,
  stuckSection,
} from '../src/section-view.js';

const DAY = 86_400_000;
const now = new Date(2026, 10, 17, 15, 0).getTime();
let n = 0;
function page(
  status: string,
  extra: Omit<Partial<PageSummary>, 'summary'> & { summary?: Record<string, unknown> } = {},
) {
  n += 1;
  return {
    id: `p${n}`,
    title: `Page ${n}`,
    sharing: 'private',
    lastUpdateAtMs: now - n * 60_000,
    projects: [],
    ...extra,
    summary: { comments: 0, waiting: false, needsYou: 0, status, ...extra.summary },
  } as PageSummary;
}

it('counts pages and assigned numbered to-dos, never an unassigned or plain checklist line', () => {
  const items = workItems([
    page('working', {
      summary: {
        todos: [
          { id: 'a', text: 'Reply', checked: false, number: 'C-2', assignee: 'gui-2' },
          { id: 'b', text: 'Line', checked: true },
          {
            id: 'c',
            text: 'Ship',
            checked: true,
            number: 'C-3',
            doneAtMs: now - 1,
            assignee: 'gui-3',
          },
          { id: 'd', text: 'Someday', checked: false, number: 'C-4' },
          // To-dos an Ask made read the Ask's state.
          { id: 'e', text: 'Asked', checked: false, number: 'C-5', assignee: 'gui-4', ask: 'sent' },
          {
            id: 'f',
            text: 'Replied',
            checked: false,
            number: 'C-6',
            assignee: 'gui-4',
            ask: 'needs-you',
          },
          {
            id: 'g',
            text: 'Handled',
            checked: false,
            number: 'C-7',
            assignee: 'gui-4',
            ask: 'answered',
          },
        ],
      },
    }),
    page('done', { archived: true }),
    { id: 'x', title: 'No summary', sharing: 'private' } as PageSummary,
  ]);
  expect(items.map((item) => [item.key.split(':')[1] ?? 'page', item.status])).toEqual([
    ['page', 'working'],
    ['a', 'discussing'],
    ['c', 'done'],
    ['e', 'working'],
    ['f', 'needs-you'],
    ['g', 'working'],
  ]);
  expect(items.find((item) => item.key.endsWith(':g'))?.next).toBe('Answered');
  expect(items.find((item) => item.key.endsWith(':e'))?.next).toBe('Page 1');
});

it('carries the counted sections of a page as its one number, bar and stuck section (#6619)', () => {
  const sections = [
    { id: 'a', title: 'Plan', level: 2, done: 3, total: 3, state: 'done' },
    { id: 'b', title: 'Build', level: 3, done: 1, total: 2, state: 'waiting-ci' },
    { id: 'c', title: 'Ask', level: 2, done: 0, total: 3, state: 'needs-you' },
    { id: 'd', title: 'Hand', level: 2, done: 1, total: 4, state: 'done', manual: 'done' },
    { id: 'e', title: 'Later', level: 2, done: 0, total: 2, state: 'not-started' },
  ] as const;
  const [item] = workItems([page('working', { summary: { sections } })]);
  expect(item.sections).toEqual(sections);
  expect(sectionTotals(item.sections!)).toEqual({ done: 2, total: 5 });
  expect(item.sections!.map((section) => segmentState(section.state))).toEqual([
    'done',
    'working',
    'waiting',
    'done',
    'todo',
  ]);
  expect(
    item.sections!.map((section) => [sectionMark(section).shape, sectionMark(section).count]),
  ).toEqual([
    ['dot', '3/3'],
    ['half', '1/2 · Waiting on a PR'],
    ['target', '0/3 · Needs you'],
    // A manual done keeps the real count.
    ['dot', '1/4'],
    ['ring', '0/2'],
  ]);
  expect(stuckSection(item.sections!)?.title).toBe('Ask');
  // An HTML page's sections take the frame's visible headings in order; one it hides is left out.
  expect(
    htmlOutlineSections(
      [
        { id: 'h1', title: 'Plan', level: 2, done: 0, total: 0, state: 'needs-you' },
        { id: 'h2', title: 'Hidden', level: 2, done: 0, total: 0, state: 'working' },
        { id: 'h3', title: 'Plan', level: 3, done: 0, total: 0, state: 'working' },
      ],
      [
        { id: '0', title: 'Plan', level: 2 },
        { id: '1', title: 'Intro', level: 3 },
        { id: '2', title: 'Plan', level: 3 },
      ],
    ).map((section) => section.id),
  ).toEqual(['0', '2']);
  // A page without counted sections carries none.
  expect(workItems([page('working')])[0].sections).toBeUndefined();
});

it('counts the overview in five statuses and only shows discussing or unchecked work it has', () => {
  const items = workItems([
    page('working', { summary: { fields: { owner: { id: 'g2', name: 'gui-2' } } } }),
    page('waiting-ci'),
    page('waiting-release'),
    page('blocked', { summary: { blockedSinceMs: now - 2 * DAY } }),
    page('blocked', { summary: { blockedSinceMs: now - DAY } }),
    page('done'),
  ]);
  const seen = overview(items);
  expect(seen.open).toBe(5);
  expect(seen.counts).toMatchObject({ working: 1, waiting: 2, blocked: 2, discussing: 0 });
  expect(seen.moving).toEqual([{ id: 'g2', name: 'gui-2' }]);
  expect(seen.stuckLongest?.blockedSinceMs).toBe(now - 2 * DAY);
  expect(activityOwners(items)).toEqual(['g2']);
});

it('orders a project by attention and hides one with nothing open or recently done', () => {
  const items = workItems([
    page('working', { projects: ['Colab'], workNumber: 'COLAB-1' }),
    page('needs-you', { projects: ['Colab'], workNumber: 'COLAB-2' }),
    page('working', {
      projects: ['Colab'],
      workNumber: 'COLAB-3',
      summary: { fields: { priority: 'high' } },
    }),
    page('blocked', { projects: ['Colab'], workNumber: 'COLAB-4' }),
    page('done', { projects: ['Old'], summary: { doneAtMs: now - 9 * DAY } }),
    page('discussing'),
  ]);
  const sections = projectSections(items, ['Old', 'Colab'], now);
  expect(sections.map((section) => section.name ?? 'none')).toEqual(['Colab', 'none']);
  expect(sections[0].prefix).toBe('COLAB');
  expect(sections[0].open.map((item) => item.number)).toEqual([
    'COLAB-4',
    'COLAB-2',
    'COLAB-3',
    'COLAB-1',
  ]);
});

it('counts done work per day against the period before, and lists the newest first', () => {
  const items = workItems([
    page('done', { summary: { doneAtMs: now - 60_000 } }),
    page('done', { summary: { doneAtMs: now - 2 * DAY } }),
    page('done', { summary: { doneAtMs: now - 8 * DAY } }),
    page('working'),
  ]);
  const week = doneChart(items, 'week', now);
  expect(week.cells).toHaveLength(7);
  expect(week.cells.at(-1)).toMatchObject({ count: 1, current: true });
  expect([week.total, week.previous]).toEqual([2, 1]);
  expect(doneChart(items, 'today', now).cells).toHaveLength(16);
  expect(recentlyDone(items, 10).map((item) => item.doneAtMs)).toEqual([
    now - 60_000,
    now - 2 * DAY,
    now - 8 * DAY,
  ]);
  const today = week.cells.at(-1)!;
  expect(recentlyDone(items, 10, today)).toHaveLength(1);
});

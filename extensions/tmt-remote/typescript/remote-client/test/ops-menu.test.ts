import { expect, it, vi } from 'vite-plus/test';
import {
  opsMenu,
  opsSection,
  opsPlace,
  opsHref,
  opsPlaceLabel,
  resolveOpsPlace,
} from '../src/ops-menu.js';
import { visibleCurrent } from '@tmt/browser-ui/shell';
import type { OpsAgent, OpsBoard } from '../src/ops-source.js';

vi.stubGlobal('document', {
  createElement: () => ({ className: '', dataset: {}, style: {}, setAttribute() {} }),
});

const agent = (id: string, name: string): OpsAgent => ({
  tokens1d: null,
  checklistCount: null,
  id,
  name,
  squad: 'sample',
  role: 'member',
  state: 'working',
  waitingOnYou: 0,
});
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const board = (): OpsBoard => ({
  defaultIdleAlertMs: null,
  agents: [agent(first, 'first'), agent(second, 'second')],
  squads: [{ name: 'sample', room: null, idleAlertMs: 1_800_000 }],
  schedules: [
    { id: 'timer', squad: 'sample', when: 'hourly', what: '', nextMs: null, state: null },
  ],
  truncated: false,
});

it('shows local squad channels with observed timer counts, then the Orchestration row', () => {
  const source = board();
  const menu = opsMenu('home', source, '/ops/');
  expect(menu.groups).toHaveLength(2);
  expect(menu.groups[0]!.label).toBe('THIS MACHINE');
  expect(menu.groups[0]!.items.map((item) => item.label)).toEqual(['sample']);
  expect(menu.groups[0]!.items[0]!.leading?.label).toBe('Channel');
  expect(menu.groups[0]!.items[0]!.badges).toEqual(['⏱ 1']);
  expect(menu.groups[0]!.items[0]!.children!.map((item) => item.label)).toEqual([
    'first',
    'second',
  ]);
  expect(menu.settings).toBeUndefined();
  expect(
    opsMenu('home', { ...source, schedules: null }, '/ops/').groups[0]!.items[0]!.badges,
  ).toBeUndefined();
  expect(
    opsMenu('home', { ...source, truncated: true }, '/ops/').groups[0]!.items[0]!.badges,
  ).toBeUndefined();
  // Orchestration reads Core, not the board: its row follows the machine groups in every state.
  const orchestration = (value: ReturnType<typeof opsMenu>) => value.groups.at(-1)!.items;
  expect(orchestration(menu)).toEqual([
    {
      id: 'orchestration',
      label: 'Orchestration',
      icon: 'clock',
      href: '/ops/#orchestration',
      current: false,
    },
  ]);
  expect(orchestration(opsMenu('orchestration', source, '/ops/'))[0]!.current).toBe(true);
  const unavailable = opsMenu('home', { ...source, unavailable: 'unavailable' }, '/ops/');
  expect(unavailable.groups.map((group) => group.items.map((item) => item.label))).toEqual([
    ['Orchestration'],
  ]);
});

it('shows an idle override only when both intervals are known and differ', () => {
  const source = { ...board(), squads: [{ name: 'sample', room: null, idleAlertMs: 1_800_000 }] };
  const badges = (value: OpsBoard) => opsMenu('home', value, '/ops/').groups[0]!.items[0]!.badges;
  expect(badges(source)).toEqual(['⏱ 1']);
  expect(badges({ ...source, defaultIdleAlertMs: null })).toEqual(['⏱ 1']);
  expect(badges({ ...source, defaultIdleAlertMs: 1_800_000 })).toEqual(['⏱ 1']);
  expect(badges({ ...source, defaultIdleAlertMs: 900_000 })).toEqual(['⏱ 1', 'Idle 30m']);
});

it('routes channels and DMs by scoped UUID and sends removed routes to the channel home', () => {
  const place = { squad: 'a/b # team', memberId: first };
  expect(opsPlace(new URL(opsHref('/ops/', place), 'https://example.test').hash)).toEqual(place);
  expect(opsPlace('#channel/a%2Fb%20%23%20team')).toEqual({ squad: 'a/b # team' });
  for (const hash of ['#agents', '#squads', '#schedules', '#dm/name/alpha', '#channel/%broken'])
    expect(opsPlace(hash)).toBe('home');
  expect(opsSection('#orchestration')).toBe('orchestration');
});

it('resolves a member-only DM link to the member listed on the board, else keeps it unknown', () => {
  const asked = opsPlace(`#dm/${first}`);
  expect(asked).toEqual({ memberId: first, squad: '' });
  expect(resolveOpsPlace(asked, board())).toEqual({
    squad: board().agents[0]!.squad,
    memberId: first,
  });
  const missing = opsPlace('#dm/00000000-0000-4000-8000-000000000999');
  expect(resolveOpsPlace(missing, board())).toBe(missing);
  expect(resolveOpsPlace(asked, undefined)).toBe(asked);
  const full = { squad: 'sample', memberId: first };
  expect(resolveOpsPlace(full, board())).toBe(full);
});

it('names a member-only place only after a loaded board, and says unavailable only when it lacks it', () => {
  const asked = opsPlace(`#dm/${first}`);
  // Before the board loads, the page shows its loading state: no unknown-member message.
  expect(opsPlaceLabel(asked, undefined)).toBe('Ops');
  expect(opsPlaceLabel(resolveOpsPlace(asked, board()), board())).toBe('first');
  const missing = opsPlace('#dm/00000000-0000-4000-8000-000000000999');
  expect(opsPlaceLabel(resolveOpsPlace(missing, board()), board())).toBe('Member unavailable');
  expect(opsPlaceLabel({ squad: 'sample' }, undefined)).toBe('#sample');
});

it('keeps selection and disclosure by identity and shows only verified unread counts', () => {
  const source = board();
  const selected = { squad: 'sample', memberId: first };
  const collapsed = new Set<string>();
  const disclosure = {
    collapsed,
    toggle: (squad: string) => {
      collapsed.add(squad);
    },
  };
  const menu = opsMenu(
    selected,
    source,
    '/ops/',
    disclosure,
    new Map([[first, { state: 'known', count: 1, more: false }]]),
  );
  const parent = menu.groups[0]!.items[0]!;
  expect(parent.children![0]).toMatchObject({
    label: 'first',
    current: true,
    emphasis: 'unread',
    count: { text: '1', needsYou: false },
  });
  expect(visibleCurrent(menu)?.id).toBe(`dm:sample:${first}`);
  parent.toggle!();
  expect(visibleCurrent(opsMenu(selected, source, '/ops/', disclosure))?.id).toBe('channel:sample');
  expect(
    opsMenu(
      selected,
      { ...source, agents: [agent(second, 'first')] },
      '/ops/',
    ).groups[0]!.items[0]!.children!.some((item) => item.current),
  ).toBe(false);
});

it('puts a member’s work under its name, marks one waiting on the person with words, and leaves the count slot to forms and unread', () => {
  const source: OpsBoard = {
    ...board(),
    agents: [
      { ...agent(first, 'first'), task: '  Build the rail row  ' },
      { ...agent(second, 'second'), task: 'Fix CI', pending: 'Pick a palette', waitingOnYou: 2 },
    ],
  };
  const rows = (forms: (id: string) => number = () => 0) =>
    opsMenu('home', source, '/ops/', undefined, undefined, undefined, forms).groups[0]!.items[0]!
      .children!;
  const [working, waiting] = rows();
  // The task is the detail line; a member with none keeps one line.
  expect(working!.detail).toBe('Build the rail row');
  expect(working!.leading?.label).toBe('Working');
  expect(working!.count).toBeUndefined();
  expect(
    opsMenu('home', { ...source, agents: [agent(first, 'first')] }, '/ops/').groups[0]!.items[0]!
      .children![0]!.detail,
  ).toBeUndefined();
  // Waiting on the person: a diamond in the waiting colour, its words in the detail line, never
  // colour alone; the mark keeps the presence word for the row's name.
  expect(waiting!.leading?.label).toBe('Working');
  expect(
    (waiting!.leading!.node as unknown as { dataset: Record<string, string> }).dataset,
  ).toEqual({ shape: 'diamond', tone: 'waiting' });
  expect(waiting!.detail).toBe('Waiting on you: Pick a palette');
  // Waiting is the mark and words, not a count: the slot stays free for unread and drafts.
  expect(waiting!.count).toBeUndefined();
  // Pending words alone also mark the row; forms waiting on the person take the count slot first.
  const one = (extra: Partial<OpsAgent>) =>
    opsMenu('home', { ...source, agents: [{ ...agent(second, 'second'), ...extra }] }, '/ops/')
      .groups[0]!.items[0]!.children![0]!;
  expect(one({ pending: 'Approve' }).detail).toBe('Waiting on you: Approve');
  expect(one({ pending: 'Approve' }).count).toBeUndefined();
  // A count without words keeps the task after the words.
  expect(one({ waitingOnYou: 1, task: 'Fix CI' }).detail).toBe('Waiting on you · Fix CI');
  expect(rows((id) => (id === second ? 5 : 0))[1]!.count).toEqual({ text: '5', needsYou: true });
  const unreadToo = opsMenu(
    'home',
    source,
    '/ops/',
    undefined,
    new Map([[second, { state: 'known' as const, count: 7, more: false }]]),
  ).groups[0]!.items[0]!.children![1]!;
  expect(unreadToo.count).toEqual({ text: '7', needsYou: false });
});

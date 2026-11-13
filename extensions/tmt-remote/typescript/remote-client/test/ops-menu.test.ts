import { expect, it, vi } from 'vite-plus/test';
import { opsMenu, opsSection, opsPlace, opsHref } from '../src/ops-menu.js';
import { visibleCurrent } from '@tmt/browser-ui/shell';
import type { OpsAgent, OpsBoard } from '../src/ops-source.js';

vi.stubGlobal('document', {
  createElement: () => ({ className: '', dataset: {}, style: {}, setAttribute() {} }),
});

const agent = (id: string, name: string): OpsAgent => ({
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
  agents: [agent(first, 'first'), agent(second, 'second')],
  squads: [{ name: 'sample', room: null, idleAlertMinutes: 30 }],
  schedules: [{ id: 'timer', squad: 'sample', when: 'hourly', what: '' }],
  truncated: false,
});

it('shows only local squad channels and their observed timer and idle badges', () => {
  const source = board();
  const menu = opsMenu('home', source, '/ops/');
  expect(menu.groups).toHaveLength(1);
  expect(menu.groups[0]!.label).toBe('This machine');
  expect(menu.groups[0]!.items.map((item) => item.label)).toEqual(['#sample']);
  expect(menu.groups[0]!.items[0]!.badges).toEqual(['⏱ 1', 'Idle 30m']);
  expect(menu.groups[0]!.items[0]!.children!.map((item) => item.label)).toEqual([
    'first',
    'second',
  ]);
  expect(menu.settings).toBeUndefined();
  expect(
    opsMenu('home', { ...source, schedules: null }, '/ops/').groups[0]!.items[0]!.badges,
  ).toEqual(['Idle 30m']);
  expect(
    opsMenu('home', { ...source, truncated: true }, '/ops/').groups[0]!.items[0]!.badges,
  ).toEqual(['Idle 30m']);
  expect(opsMenu('home', { ...source, unavailable: 'unavailable' }, '/ops/').groups).toEqual([]);
});

it('routes channels and DMs by scoped UUID and sends removed routes to the channel home', () => {
  const place = { squad: 'a/b # team', memberId: first };
  expect(opsPlace(new URL(opsHref('/ops/', place), 'https://example.test').hash)).toEqual(place);
  expect(opsPlace('#channel/a%2Fb%20%23%20team')).toEqual({ squad: 'a/b # team' });
  for (const hash of ['#agents', '#squads', '#schedules', '#dm/name/alpha', '#channel/%broken'])
    expect(opsPlace(hash)).toBe('home');
  expect(opsSection('#orchestration')).toBe('orchestration');
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

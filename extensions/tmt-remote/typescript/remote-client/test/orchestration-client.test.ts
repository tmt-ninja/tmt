import { expect, it } from 'vite-plus/test';
import {
  OrchestrationRefused,
  ROUTES_PAGE,
  ROUTES_PAGES,
  applyInput,
  decodeOverview,
  decodeRoutes,
  decodeTalks,
  previewLines,
  readSending,
  receivingCell,
  type Json,
  type OrchestrationApi,
} from '../src/orchestration-client.js';

const overview = (): Json => ({
  configurationRevision: 4,
  atMs: 1_000,
  timeZone: 'Asia/Taipei',
  range: { startMs: 0, endMs: 86_400_000 },
  plans: [{ id: 'p1', name: 'Night' }, { id: 7 }],
  members: [
    {
      identityId: 'a',
      name: 'ann',
      effective: {
        state: { value: 'active', source: { kind: 'plan', planId: 'p1' } },
        receiving: { value: { mode: 'batch', intervalMs: 1_200_000 }, source: { kind: 'default' } },
      },
      nextChangeAtMs: 5_000,
    },
  ],
  timeline: [{ startMs: 0, endMs: 10, planIds: ['p1', 3] }, { startMs: 'x' }],
});

it('decodes only what the page draws and refuses an unreadable overview', () => {
  const decoded = decodeOverview(overview());
  expect(decoded.plans).toEqual([{ id: 'p1', name: 'Night' }]);
  expect(decoded.timeline).toEqual([{ startMs: 0, endMs: 10, planIds: ['p1'] }]);
  const [member] = decoded.members;
  expect(member!.fields.state).toEqual({ value: 'active', source: { kind: 'plan', planId: 'p1' } });
  expect(member!.fields.sending).toEqual({ value: null, source: null });
  expect(member!.nextChangeAtMs).toBe(5_000);
  expect(() => decodeOverview({ ...overview(), atMs: -1 })).toThrow(TypeError);
  expect(() => decodeOverview({ ...overview(), members: [{ name: 'no id' }] })).toThrow(TypeError);
});

it('keys route verdicts by direction and skips rows it cannot read', () => {
  const routes = decodeRoutes([
    { from: 'a', to: 'b', verdict: 'allowed', source: { kind: 'grant', grantUntilMs: 9 } },
    { from: 'b', to: 'a', verdict: 'maybe', source: { kind: 'default' } },
    { from: 'a', to: 'c', verdict: 'blocked' },
  ]);
  expect([...routes.keys()]).toEqual(['a>b']);
  expect(routes.get('a>b')!.source).toEqual({ kind: 'grant', planId: null, grantUntilMs: 9 });
  expect(
    decodeTalks([
      {
        members: [{ identityId: 'a', name: 'ann' }, { identityId: 'b' }],
        count: 3,
        limit: 10,
        state: 'held',
        heldCount: 2,
      },
      { members: [{ identityId: 'a' }], count: 1 },
    ]),
  ).toEqual([
    { ids: ['a', 'b'], names: ['ann', 'b'], count: 3, limit: 10, held: true, heldCount: 2 },
  ]);
});

const api = (read: (input: Json) => Json): OrchestrationApi & { reads: Json[] } => {
  const reads: Json[] = [];
  return {
    reads,
    read: async (input) => {
      reads.push(input);
      return read(input);
    },
    write: async () => ({}),
  };
};
const route = (n: number) => ({
  from: `m${n}`,
  to: 'x',
  verdict: 'allowed',
  source: { kind: 'default' },
});

it('reads every routes page Core offers, then the talks view', async () => {
  const fake = api((input) => {
    if (input.view === 'talks') return { pairs: [] };
    return input.after === undefined
      ? { routes: [route(1)], nextAfter: 'c1' }
      : { routes: [route(2)], nextAfter: null };
  });
  const sending = await readSending(fake, 'm');
  expect([...sending.routes!.keys()]).toEqual(['m1>x', 'm2>x']);
  expect(sending.talks).toEqual([]);
  expect(sending.truncated).toBe(false);
  expect(fake.reads).toEqual([
    { view: 'routes', limit: ROUTES_PAGE, memberQuery: 'm' },
    { view: 'routes', limit: ROUTES_PAGE, memberQuery: 'm', after: 'c1' },
    { view: 'talks', limit: ROUTES_PAGE, memberQuery: 'm' },
  ]);
});

it('marks a cut-off route list truncated: the page bound or Core’s own limit', async () => {
  const endless = api((input) =>
    input.view === 'talks' ? { pairs: [] } : { routes: [], nextAfter: 'more' },
  );
  const bounded = await readSending(endless);
  expect(bounded.truncated).toBe(true);
  expect(endless.reads.filter((input) => input.view === 'routes')).toHaveLength(ROUTES_PAGES);
  const limited = api((input) => {
    if (input.view === 'talks') return { pairs: [] };
    if (input.after) throw new OrchestrationRefused('ORCH_LIMIT');
    return { routes: [route(1)], nextAfter: 'c1' };
  });
  const cut = await readSending(limited);
  expect(cut.truncated).toBe(true);
  expect(cut.routes!.size).toBe(1);
});

it('reads an older Core without the views as not available, and rethrows anything else', async () => {
  const older = api(() => {
    throw new OrchestrationRefused('ORCH_INPUT_INVALID');
  });
  expect(await readSending(older)).toEqual({ routes: null, talks: null, truncated: false });
  const failing = api(() => {
    throw new OrchestrationRefused('ORCH_STORAGE');
  });
  await expect(readSending(failing)).rejects.toMatchObject({ code: 'ORCH_STORAGE' });
});

it('shows Core’s own preview and applies exactly that preview with consent', () => {
  const name = (id: string) => (id === 'a' ? 'ann' : id);
  expect(
    previewLines(
      {
        mutation: { kind: 'focus.set' },
        changes: [{ identityId: 'a', fields: ['state', 'receiving'] }],
      },
      name,
    ),
  ).toEqual(['ann · state, receiving', 'Running work is never interrupted.']);
  expect(previewLines({ mutation: { kind: 'focus.clear' }, changes: [] }, name)[0]).toBe(
    "No member's effective policy changes at this time.",
  );
  const many = Array.from({ length: 10 }, (_, n) => ({ identityId: `m${n}`, fields: ['state'] }));
  expect(previewLines({ mutation: { kind: 'route.allow' }, changes: many }, name)).toContain(
    '… and 2 more members',
  );
  expect(
    previewLines({ mutation: { kind: 'talks.resume' }, releases: 1, held: [{}, {}] }, name),
  ).toEqual([
    'Releases 1 of 2 held messages.',
    'Expired held messages stay unsent.',
    "They go out through normal delivery; the pair's hour restarts.",
    'Running work is never interrupted.',
  ]);
  const preview = {
    mutation: { kind: 'focus.clear' },
    configurationRevision: 4,
    previewAtMs: 10,
    previewDigest: 'd',
    changes: [],
  };
  expect(applyInput(preview)).toEqual({
    phase: 'apply',
    mutation: { kind: 'focus.clear' },
    expectedConfigurationRevision: 4,
    previewAtMs: 10,
    previewDigest: 'd',
    consent: true,
  });
});

it('writes short receiving words for the matrix', () => {
  expect(receivingCell({ mode: 'direct' })).toBe('Direct');
  expect(receivingCell({ mode: 'batch', intervalMs: 1_200_000 })).toBe('B20');
  expect(receivingCell({ mode: 'batch' })).toBe('Batch');
  expect(receivingCell(null)).toBe('·');
});

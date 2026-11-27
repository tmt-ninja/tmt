import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import { mockDocument } from '../src/digest-mock.js';
import type { LimitAccount, UsageDocument } from '../src/digest-source.js';
import {
  allowance,
  coverage,
  coverageHeading,
  creditText,
  exchange,
  latestCredits,
  historyCharts,
  providers,
  providerGroups,
  windowKey,
  observedAgo,
  ranking,
  rankRows,
  resetsIn,
  seatName,
  tokenSeries,
  modelShares,
  modelCostShares,
  seatMix,
  trend,
  runway,
  runwayWords,
  savingsView,
} from '../src/digest-view.js';

const day = mockDocument('24h');

it('shapes every mock range like the public report: hourly for 24h, daily after', () => {
  expect(mockDocument('24h').usage.seats[0]!.series).toHaveLength(24);
  expect(mockDocument('7d').usage.seats[0]!.series).toHaveLength(7);
  expect(mockDocument('30d').usage.seats[0]!.series).toHaveLength(30);
  // Deterministic: a screenshot and a test see the same bytes on every run.
  expect(JSON.stringify(mockDocument('24h'))).toBe(JSON.stringify(mockDocument('24h')));
});

it('pins the mock to the digest usage vector: same keys at every level the page reads', () => {
  const vector = JSON.parse(
    readFileSync(
      new URL('../../../../tmt-digest/contracts/vectors/usage-report-v1.json', import.meta.url),
      'utf8',
    ),
  ).cases[0].expected;
  const keys = (value: object) => Object.keys(value).sort();
  const seat = vector.usage.seats[0];
  const mock = day.usage.seats[0]!;
  for (const key of ['id', 'name', 'retired', 'totals', 'lines', 'series', 'coverage']) {
    expect(keys(mock), key).toContain(key);
    expect(keys(seat), key).toContain(key);
  }
  expect(keys(mock.series[0]!)).toEqual(
    expect.arrayContaining(['fromMs', 'toMs', 'input', 'output', 'cached', 'complete']),
  );
  expect(keys(mock.coverage)).toEqual(keys(seat.coverage));
  expect(keys(day.limits[0]!)).toEqual(keys(vector.limits[0]));
  expect(keys(day.exchange!.pairs[0]!)).toEqual(
    expect.arrayContaining(['sender', 'recipient', 'kind', 'count']),
  );
  expect(keys(vector.exchange.pairs[0])).toEqual(
    expect.arrayContaining(['sender', 'recipient', 'kind', 'count']),
  );
  expect(day.version).toBe(vector.version);
});

it('token series put every seat on the union of buckets and keep an unobserved bucket null', () => {
  const data = tokenSeries(day, 'UTC');
  expect(data.x).toHaveLength(24);
  expect(data.x[0]).toMatch(/^\d\d:00$/);
  const last = data.layers.at(-1)!;
  expect(last.label).toBe('night-1');
  expect(last.values.slice(0, 12).every((value) => value === null)).toBe(true);
  expect(last.values.slice(12).some((value) => value !== null)).toBe(true);
  expect(data.partial).toBe(true);
  // Daily ranges label by date.
  expect(tokenSeries(mockDocument('7d'), 'UTC').x[0]).toMatch(/^\d\d-\d\d$/);
});

it('tokens are input plus output: cached input is never added again', () => {
  const doc: UsageDocument = {
    ...day,
    usage: {
      seats: [
        {
          ...day.usage.seats[0]!,
          totals: { input: 1000, output: 200, cached: 600 },
          series: [{ fromMs: 0, toMs: 1, input: 1000, output: 200, cached: 600, complete: true }],
        },
      ],
      unavailable: [],
    },
  };
  expect(rankRows(doc)[0]!.tokens).toBe(1200);
  expect(tokenSeries(doc).layers[0]!.values).toEqual([1200]);
});

it('ranks seats by tokens, shares sum to about 100 and a partial seat says so', () => {
  const rows = rankRows(day);
  const tokens = rows.map((row) => row.tokens);
  expect(tokens).toEqual(tokens.slice().sort((a, b) => b - a));
  expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeGreaterThanOrEqual(98);
  expect(rows.find((row) => row.name === 'night-1')!.partial).toBe(true);
  expect(rows.find((row) => row.name === 'tmt-lead')!.partial).toBe(false);
  expect(seatName({ id: '12345678-aaaa', name: null, retired: true })).toBe('12345678 (retired)');
});

it('a large team ranks the top 8 and folds the rest into one Other row', () => {
  const team = rankRows(mockDocument('24h', { seats: 24 }));
  expect(team).toHaveLength(24);
  const view = ranking(team);
  expect(view.top.map((row) => row.id)).toEqual(team.slice(0, 8).map((row) => row.id));
  const rest = team.slice(8).reduce((sum, row) => sum + row.tokens, 0);
  const total = team.reduce((sum, row) => sum + row.tokens, 0);
  expect(view.other).toEqual({ seats: 16, tokens: rest, share: Math.round((rest / total) * 100) });
  expect(view.partial).toBe(true);
  // A team of 8 or fewer folds nothing; a team with full evidence is not partial.
  expect(ranking(rankRows(day)).other).toBeNull();
  expect(ranking(team.map((row) => ({ ...row, partial: false }))).partial).toBe(false);
});

it('a one-provider sample has only the Codex weekly window and history', () => {
  const one = mockDocument('24h', { oneProvider: true });
  expect(providers(one).map((view) => view.provider)).toEqual(['Codex']);
  expect(one.limitHistory!.map((history) => history.provider)).toEqual(['codex']);
});

it('exchange counts talk and reply only, ranks by traffic and keeps a known none at zero', () => {
  const view = exchange(day)!;
  expect(view.participants).toHaveLength(day.usage.seats.length);
  const [a, b] = view.participants;
  const total = (id: string) =>
    view.participants.reduce(
      (sum, other) => sum + (view.value(id, other.id) ?? 0) + (view.value(other.id, id) ?? 0),
      0,
    );
  expect(total(a!.id)).toBeGreaterThanOrEqual(total(b!.id) - 0);
  // The mock's 99 acks from tmt-lead to core-1 are not messages.
  const lead = day.usage.seats[0]!.id;
  const core = day.usage.seats[1]!.id;
  const counted = day
    .exchange!.pairs.filter(
      (pair) => pair.sender.id === lead && pair.recipient.id === core && pair.kind !== 'ack',
    )
    .reduce((sum, pair) => sum + pair.count, 0);
  const all = exchange(day)!;
  expect(all.value(lead, core)).toBe(counted);
  expect(all.value(lead, core)).toBeLessThan(99);
  expect(exchange({ ...day, exchange: null })).toBeNull();
});

it('exchange retains every seat instead of silently keeping only the busiest eight', () => {
  const document = mockDocument('24h', { seats: 24 });
  const view = exchange(document)!;
  expect(view.participants.map((person) => person.id).sort()).toEqual(
    document.usage.seats.map((seat) => seat.id).sort(),
  );
});

it('allowance lists the weekly windows only, left = 100 - used, with the provider named', () => {
  const rows = allowance(day);
  expect(rows.map((row) => [row.provider, row.leftPercent])).toEqual([
    ['Codex', 55],
    ['Codex', 26],
    ['Codex', 62],
  ]);
  const stale = allowance({
    ...day,
    limits: [{ ...day.limits[0]!, stale: true, elapsedPercent: null, paceDeltaPoints: null }],
  });
  expect(stale[0]).toMatchObject({ stale: true, elapsedPercent: null, paceDeltaPoints: null });
  expect(resetsIn(day.observedAtMs + 40 * 3_600_000, day.observedAtMs)).toBe('1d 16h');
  expect(resetsIn(day.observedAtMs + 90 * 60_000, day.observedAtMs)).toBe('1h');
  expect(resetsIn(day.observedAtMs - 1, day.observedAtMs)).toBe('now');
});

it('history charts exist only when the history field is served', () => {
  const charts = historyCharts(day, 'UTC');
  expect(charts).toHaveLength(3);
  expect(charts[0]!.series[0]!.values.length).toBe(charts[0]!.x.length);
  expect(charts[0]!.reference!.values.every((v) => v !== null && v >= 0 && v <= 100)).toBe(true);
  expect(historyCharts({ ...day, limitHistory: undefined })).toEqual([]);
});

it('providers pair each weekly window with its history chart and a stable hue', () => {
  const views = providers(day, 'UTC');
  expect(views.map((view) => [view.provider, view.style])).toEqual([
    ['Codex', 1],
    ['Codex', 1],
    ['Codex', 1],
  ]);
  expect(views.every((view) => view.chart?.series[0]!.key === view.key)).toBe(true);
  expect(views[0]!.chart!.style).toBe(1);
  expect(providers({ ...day, limitHistory: undefined }).every((view) => !view.chart)).toBe(true);
  // #6751 B: the current window runs out at its last day's pace, the others last to their resets,
  // and a stale or unsampled window has no runway.
  const current = views.find((view) => view.leftPercent === 55)!;
  expect(current.runway).toMatchObject({ basis: 'recent', leftAtReset: 0 });
  expect(current.runway!.emptyAtMs).toBeLessThan(current.resetsAtMs);
  expect(views.filter((view) => view.runway?.emptyAtMs === null)).toHaveLength(2);
  const stale = { ...day, limits: day.limits.map((limit) => ({ ...limit, stale: true })) };
  expect(providers(stale).map((view) => view.runway)).toEqual([null, null, null]);
  expect(providers({ ...day, limitHistory: undefined }).every((view) => !view.runway)).toBe(true);
  // Hues follow the sorted sources, so a third provider gets its own instead of a shared grey.
  expect(providers(withShares('agy', 'claude', 'codex')).map((view) => view.style)).toEqual([
    3, 3, 3,
  ]);
});

/** `day` with a recorded driver share for each named driver (digest `usage-v1.md`). */
function withShares(...drivers: string[]): UsageDocument {
  return {
    ...day,
    pricing: { version: '2026-11-01', basis: 'standard-list', origin: 'embedded' },
    usage: {
      ...day.usage,
      providers: drivers.map((driver, at) => ({
        driver,
        totals: { input: 1000 * (at + 1), output: 10, cached: 0 },
        seats: [day.usage.seats[at % day.usage.seats.length]!.id],
        partialSeats: 0,
        inputCost: null,
        costUnavailable: ['no_price'],
      })),
    },
  };
}

it('gives every provider with recorded usage a card; one without a window says so, never 0%', () => {
  const doc = {
    ...withShares('agy', 'codex'),
    credits: {
      points: [
        {
          fromMs: 0,
          toMs: 1,
          balance: '18655.5134485000',
          observedAtMs: 8,
          hasCredits: true,
          unlimited: false,
          serviceTiers: [],
        },
        {
          fromMs: 1,
          toMs: 2,
          balance: '9',
          observedAtMs: 7,
          hasCredits: true,
          unlimited: false,
          serviceTiers: [],
        },
        {
          fromMs: 2,
          toMs: 3,
          balance: 'lots',
          observedAtMs: 9,
          hasCredits: true,
          unlimited: false,
          serviceTiers: [],
        },
      ],
    },
  };
  const groups = providerGroups(doc);
  expect(groups.map((group) => [group.source, group.label, group.windowless])).toEqual([
    ['agy', 'Agy', true],
    ['codex', 'Codex', false],
  ]);
  const [agy, codex] = groups;
  expect(agy!.primary).toBeUndefined();
  expect(agy!.other).toEqual([]);
  expect(agy!.usage).toEqual({ input: 1000, output: 10, cached: 0 });
  expect(agy!.credits).toBeNull();
  expect(agy!.note).toBe('No allowance reported by Agy.');
  expect(codex!.primary!.leftPercent).toBe(55);
  // The newest observation wins, not the latest bucket; a balance that is not a decimal is skipped.
  expect(codex!.credits).toEqual({ balance: '18655.5134485000', observedAtMs: 8 });
  // Model families never establish a provider: no share, no window, no card.
  expect(providerGroups(day).map((group) => group.source)).toEqual(['codex']);
  // Nor does a window that has reset: with no share, the provider has no card at all.
  expect(
    providerGroups({
      ...day,
      limits: day.limits.map((limit) => ({ ...limit, resetsAtMs: day.observedAtMs })),
    }),
  ).toEqual([]);
});

it('says why a provider with usage has no window: a read gap, a reset, or no allowance at all', () => {
  const base = withShares('agy', 'claude');
  const note = (doc: UsageDocument, source: string) =>
    providerGroups(doc).find((group) => group.source === source)!;
  // Claude has an allowance source: a missing window is a gap Core names, never "none".
  for (const [reason, words] of [
    ['not_observed', 'Allowance has not been observed yet.'],
    ['none_observed', 'Allowance has not been observed yet.'],
    ['expired', 'The weekly window has reset; no new one is reported yet.'],
    ['read_timeout', 'Allowance could not be read just now.'],
  ] as const) {
    const claude = note({ ...base, limitsUnavailable: [{ line: 'claude', reason }] }, 'claude');
    expect([claude.note, claude.windowless]).toEqual([words, false]);
  }
  const byAccount = note(
    { ...base, limitsUnavailable: [{ provider: 'claude', reason: 'expired' }] },
    'claude',
  );
  expect(byAccount.note).toBe('The weekly window has reset; no new one is reported yet.');
  // A window that has reset, with nothing from Core about it, says so too.
  const reset = note(
    {
      ...base,
      limitsUnavailable: [],
      limits: [{ ...day.limits[0]!, provider: 'claude', resetsAtMs: day.observedAtMs }],
    },
    'claude',
  );
  expect([reset.note, reset.primary]).toEqual([
    'The weekly window has reset; no new one is reported yet.',
    undefined,
  ]);
  // No window and no reason: the provider reports no allowance (agy today).
  const agy = note(
    { ...base, limitsUnavailable: [{ line: 'claude', reason: 'not_observed' }] },
    'agy',
  );
  expect([agy.note, agy.windowless]).toEqual(['No allowance reported by Agy.', true]);
  // A shown window has no note.
  expect(providerGroups(base).find((group) => group.source === 'codex')!.note).toBeNull();
});

it('reads the credit balance as the provider reports it: unlimited, none, or absent', () => {
  const point = { fromMs: 0, toMs: 1, balance: '0', observedAtMs: 1, serviceTiers: [] };
  const of = (points: unknown) => latestCredits({ ...day, credits: { points } as never });
  expect(of([{ ...point, hasCredits: true, unlimited: true }])!.balance).toBe('unlimited');
  expect(of([{ ...point, hasCredits: false, unlimited: false }])!.balance).toBeNull();
  expect(of([null, { ...point, hasCredits: 'yes', unlimited: false }])).toBeNull();
  expect(latestCredits({ ...day, credits: null })).toBeNull();
  expect(latestCredits(day)).toBeNull();
  expect(
    ['18655.5134485000', '12', '-0.50', 'unlimited'].map((balance) => creditText(balance)),
  ).toEqual(['18,655.51', '12', '-0.5', 'unlimited']);
});

it('names what the report cannot see, by cause, most seats first, for the top of the page', () => {
  const seat = { retired: false, reason: 'no_evidence' };
  const doc: UsageDocument = {
    ...day,
    usage: {
      ...day.usage,
      unavailable: [
        { ...seat, id: 'a', name: 'ben', cause: 'no_binding' },
        { ...seat, id: 'b', name: 'amy', cause: 'no_binding' },
        { ...seat, id: 'c', name: 'tui-9', cause: 'not_sampled' },
        { ...seat, id: 'd', name: 'next', cause: 'future_cause' },
        { ...seat, id: 'e', name: null, reason: 'read_failed' },
        { ...seat, id: 'f', name: 'remote-3', cause: 'idle' },
      ],
    },
  };
  const seen = coverage(doc);
  expect(seen.missing.map((gap) => [gap.id, gap.words, gap.seats])).toEqual([
    ['no_binding', 'not running under TMT', ['amy', 'ben']],
    ['future_cause', 'cause "future_cause"', ['next']],
    ['not_sampled', 'running, but no sample accepted yet', ['tui-9']],
    ['read_failed', 'could not be read', ['e']],
  ]);
  const none = { missing: [], idle: [], missingSeats: 0, partialSeats: 0, seats: 6 };
  expect(coverageHeading({ ...none, missingSeats: 2, partialSeats: 1 })).toBe(
    '2 seats have no usage in this range; 1 of 6 seats covers only part of it. Totals are lower bounds.',
  );
  expect(coverageHeading({ ...none, partialSeats: 1 })).toBe(
    '1 of 6 seats covers only part of this range. Totals are lower bounds.',
  );
  expect(coverageHeading({ ...none, partialSeats: 2 })).toBe(
    '2 of 6 seats cover only part of this range. Totals are lower bounds.',
  );
  expect(coverageHeading({ ...none, missingSeats: 1 })).toBe(
    '1 seat has no usage in this range. Totals are lower bounds.',
  );
  expect(coverageHeading({ ...none, idle: ['remote-3'] })).toBe(
    '1 seat was idle, with no recent turn.',
  );
  // An idle seat simply did not work: it is apart from the gaps and not counted as one.
  expect(seen.idle).toEqual(['remote-3']);
  expect(seen.missingSeats).toBe(5);
  expect(seen.seats).toBe(day.usage.seats.length);
  expect(seen.partialSeats).toBe(day.usage.seats.filter((row) => !row.coverage.complete).length);
  expect(coverage({ ...day, usage: { ...day.usage, unavailable: [] } }).missing).toEqual([]);
});

it('the product entry never pulls in the sample: no import of the mock from page code', () => {
  for (const file of ['digest-page', 'digest-source', 'digest-view', 'shell-app', 'browser']) {
    const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
    expect(source, file).not.toMatch(/from '\.\/digest-mock/);
  }
});

it('titles limits from their source even on Claude-model seats, and never infers a missing provider', () => {
  const doc = { ...day, limits: [{ ...day.limits[0]! }] };
  expect(doc.usage.seats.find((seat) => seat.id === doc.limits[0]!.seats[0])!.lines).toEqual([
    'claude',
  ]);
  expect(allowance(doc)[0]!.provider).toBe('Codex');
  expect(
    allowance({ ...doc, limits: [{ ...doc.limits[0]!, provider: undefined as never }] }),
  ).toEqual([]);
  expect(
    allowance({ ...doc, limits: [{ ...doc.limits[0]!, provider: 'future-source' }] })[0]!.provider,
  ).toBe('Future-source');
  expect(
    allowance({ ...doc, limits: [{ ...doc.limits[0]!, provider: 'constructor' }] })[0]!.provider,
  ).toBe('Constructor');
  expect(providerGroups(doc).find((group) => group.source === 'claude')).toBeUndefined();
});

it('chooses the latest current-seat window and drops resets already passed', () => {
  const [older, current] = day.limits;
  const retired = { ...day.usage.seats[0]!, retired: true };
  const doc = {
    ...day,
    usage: { ...day.usage, seats: [retired, ...day.usage.seats.slice(1)] },
    limits: [
      { ...older!, seats: [retired.id], observedAtMs: day.observedAtMs - 1 },
      { ...current!, seats: [...current!.seats, retired.id] },
      { ...older!, resetsAtMs: day.observedAtMs },
    ],
  };
  const group = providerGroups(doc)[0]!;
  expect(group.primary!.leftPercent).toBe(55);
  expect(group.primary!.reporters).toContain('tmt-lead (retired)');
  expect(group.other).toHaveLength(1);
  expect(group.other[0]!.reporters).toEqual(['tmt-lead (retired)']);
  expect(
    providerGroups({
      ...doc,
      usage: {
        seats: [],
        unavailable: [
          { id: current!.seats[0]!, name: 'unread', retired: false, reason: 'not_sampled' },
        ],
      },
    })[0]!.primary,
  ).toBeDefined();
  const retiredOnly = providerGroups({ ...doc, limits: [doc.limits[0]!] })[0]!;
  expect(retiredOnly.primary).toBeUndefined();
  // Its window is still active, reported only by a retired seat: that, not a reset or "none".
  expect(retiredOnly.note).toBe('No current seat has reported an active weekly window.');
});

it('matches history only to the same source, duration and reset, keeping multiple windows distinct', () => {
  const views = providers(day, 'UTC');
  expect(new Set(views.map((view) => view.key)).size).toBe(3);
  for (const view of views) {
    expect(view.chart!.series[0]!.key).toBe(view.key);
    expect(view.chart!.series[0]!.values.at(-1)).toBe(view.leftPercent);
  }
  const first = day.limitHistory![0]!;
  for (const mismatched of [
    { ...first, provider: 'claude' },
    { ...first, windowMinutes: 300 },
    { ...first, resetsAtMs: first.resetsAtMs + 1 },
  ])
    expect(providers({ ...day, limitHistory: [mismatched] }).every((view) => !view.chart)).toBe(
      true,
    );
  expect(windowKey({ provider: 'codex', windowMinutes: 10080, resetsAtMs: 1 })).not.toBe(
    windowKey({ provider: 'codex', windowMinutes: 300, resetsAtMs: 1 }),
  );
  expect(observedAgo(day.observedAtMs - 600_000, day.observedAtMs)).toBe('10m ago');
  expect(observedAgo(day.observedAtMs + 1, day.observedAtMs)).toBe('just now');
});

const WORK: LimitAccount = { key: '0123456789ab', label: 'work' };
const HOME: LimitAccount = { key: 'ba9876543210', label: 'home' };

/** The mock's three weekly windows, newest first, each named by `accounts` (null: no account). */
function named(accounts: readonly (LimitAccount | null)[]): UsageDocument {
  const weekly = day.limits.filter((limit) => limit.windowMinutes === 10080);
  expect(weekly).toHaveLength(accounts.length);
  return {
    ...day,
    limits: weekly.map((limit, at) =>
      accounts[at] ? { ...limit, account: accounts[at]! } : limit,
    ),
  };
}

it('one account, or none, reads exactly as a provider without accounts', () => {
  const shape = (doc: UsageDocument) =>
    providerGroups(doc).map((group) => [
      group.id,
      group.label,
      group.primary?.provider,
      group.primary?.leftPercent,
      group.other.length,
    ]);
  const plain = shape(named([null, null, null]));
  expect(plain[0]).toEqual(['codex', 'Codex', 'Codex', 55, 2]);
  expect(shape(named([WORK, WORK, WORK]))).toEqual(plain);
  // One named account beside windows that name none is still one account.
  expect(shape(named([WORK, null, null]))).toEqual(plain);
  expect(allowance(named([WORK, WORK, WORK])).every((row) => row.provider === 'Codex')).toBe(true);
});

it('shows one entry per account when a provider has several, labelled by the account', () => {
  const doc = named([WORK, WORK, HOME]);
  const groups = providerGroups(doc);
  const codex = groups.filter((group) => group.source === 'codex');
  expect(codex.map((group) => [group.id, group.label])).toEqual([
    ['codex-0123456789ab', 'Codex · work'],
    ['codex-ba9876543210', 'Codex · home'],
  ]);
  // Newest first: the account seen most recently leads, and each keeps only its own windows.
  expect(codex[0]!.primary!.leftPercent).toBe(55);
  expect(codex[0]!.other).toHaveLength(1);
  expect(codex[1]!.primary!.leftPercent).toBe(62);
  expect(codex[1]!.other).toHaveLength(0);
  expect(new Set(providers(doc).map((view) => view.key)).size).toBe(3);
  // The key only groups; neither the labels nor any shown name carry it.
  expect(
    JSON.stringify([
      ...groups.map((group) => group.label),
      ...allowance(doc).map((row) => row.provider),
    ]),
  ).not.toContain('0123456789ab');
  expect(groups.find((group) => group.source === 'claude')).toBeUndefined();
});

it('names the windows that report no account when a provider has several', () => {
  const groups = providerGroups(named([WORK, HOME, null])).filter(
    (group) => group.source === 'codex',
  );
  expect(groups.map((group) => group.label).sort()).toEqual([
    'Codex · home',
    'Codex · unknown account',
    'Codex · work',
  ]);
  expect(groups.map((group) => group.id)).toContain('codex-unknown');
});

it('matches history only to the account it names', () => {
  const doc = named([WORK, null, null]);
  const first = day.limitHistory![0]!;
  const chartOf = (history: object) =>
    providers({ ...doc, limitHistory: [{ ...first, ...history }] }).find(
      (view) => view.accountKey === WORK.key,
    )!.chart;
  expect(chartOf({ account: WORK })).toBeDefined();
  expect(chartOf({ account: HOME })).toBeUndefined();
  expect(chartOf({ account: undefined })).toBeUndefined();
  expect(windowKey({ ...first, account: WORK })).not.toBe(windowKey(first));
});

it('ignores a window whose account is malformed instead of folding it into another account', () => {
  const doc = named([WORK, HOME, null]);
  for (const bad of [
    { key: '0123456789AB', label: 'work' },
    { key: '0123456789ab', label: 'has space' },
    { key: '0123456789ab', label: '<b>x</b>' },
    { key: '0123456789ab' },
    'work',
  ]) {
    const limits = [...doc.limits];
    limits[2] = { ...limits[2]!, account: bad as never };
    expect(allowance({ ...doc, limits })).toHaveLength(2);
  }
});

/** Three seats: one model only, one with a remainder no model covers, one Core attributed none of. */
const mixed = (): UsageDocument => {
  const seat = day.usage.seats[0]!;
  return {
    ...day,
    usage: {
      ...day.usage,
      seats: [
        {
          ...seat,
          id: 'a',
          name: 'lead',
          totals: { input: 1000, output: 200, cached: 600 },
          byModel: [{ modelId: 'claude-opus-5-5', input: 1000, output: 200, cached: 600 }],
        },
        {
          ...seat,
          id: 'b',
          name: 'worker',
          totals: { input: 600, output: 100, cached: 100 },
          byModel: [{ modelId: 'gpt-6.1-terra', input: 500, output: 100, cached: 100 }],
          unattributed: { input: 100, output: 0, cached: 0 },
        },
        {
          ...seat,
          id: 'c',
          name: 'helper',
          totals: { input: 300, output: 0, cached: 0 },
          byModel: null,
          coverage: { ...seat.coverage, complete: false },
        },
      ],
    },
  };
};

it('shares tokens by model over every seat; what no model covers stays its own row (#6751 C)', () => {
  const shares = modelShares(mixed());
  expect(shares.models).toEqual([
    {
      model: 'claude-opus-5-5',
      totals: { input: 1000, output: 200, cached: 600 },
      tokens: 1200,
      share: 54.5,
      cachedRatio: 60,
      seats: 1,
    },
    {
      model: 'gpt-6.1-terra',
      totals: { input: 500, output: 100, cached: 100 },
      tokens: 600,
      share: 27.3,
      cachedRatio: 20,
      seats: 1,
    },
  ]);
  // The remainder of one seat and the whole of a seat Core attributed none of; no model is guessed.
  expect(shares.unattributed).toEqual({
    totals: { input: 400, output: 0, cached: 0 },
    tokens: 400,
    share: 18.2,
    cachedRatio: 0,
    seats: 2,
  });
  // Cached input over all input: 700 of 1,900.
  expect(shares.cachedRatio).toBe(36.8);
  expect(shares.partial).toBe(true);
  // No input at all is no ratio, never 0%.
  const idle = mixed();
  const empty = { ...idle, usage: { ...idle.usage, seats: [] } };
  expect(modelShares(empty)).toEqual({
    models: [],
    unattributed: null,
    cachedRatio: null,
    partial: false,
  });
});

it('gives each seat its share, cached ratio and model mix, largest seat first (#6751 C)', () => {
  expect(seatMix(mixed())).toEqual([
    {
      id: 'a',
      name: 'lead',
      tokens: 1200,
      share: 54.5,
      cachedRatio: 60,
      costLabel: 'Cost unknown. The report has no usable seat cost.',
      models: [{ model: 'claude-opus-5-5', share: 100 }],
      unattributed: 0,
      partial: false,
    },
    {
      id: 'b',
      name: 'worker',
      tokens: 700,
      share: 31.8,
      cachedRatio: 16.7,
      costLabel: 'Cost unknown. The report has no usable seat cost.',
      models: [{ model: 'gpt-6.1-terra', share: 85.7 }],
      unattributed: 14.3,
      partial: false,
    },
    {
      id: 'c',
      name: 'helper',
      tokens: 300,
      share: 13.6,
      cachedRatio: 0,
      costLabel: 'Cost unknown. The report has no usable seat cost.',
      models: [],
      unattributed: 100,
      partial: true,
    },
  ]);
});

it('adds every seat per bucket: hourly for 24h, daily for 7d and 30d, a lower bound marked (#6751 E)', () => {
  const hours = trend(day, 'UTC');
  expect(hours.x).toHaveLength(24);
  expect(hours.x[0]).toMatch(/^\d\d:00$/);
  // Each bucket is the sum of every seat's reading at that start.
  const at = hours.startsMs[13]!;
  const sum = day.usage.seats
    .flatMap((seat) => seat.series.filter((point) => point.fromMs === at))
    .reduce((total, point) => total + point.input + point.output, 0);
  expect(hours.tokens[13]).toBe(sum);
  expect(hours.partial.some(Boolean)).toBe(true);
  expect(hours.peak!.tokens).toBe(Math.max(...hours.tokens.map((value) => value ?? 0)));
  for (const [range, count] of [
    ['7d', 7],
    ['30d', 30],
  ] as const) {
    const days = trend(mockDocument(range), 'UTC');
    expect(days.x).toHaveLength(count);
    expect(days.x[0]).toMatch(/^\d\d-\d\d$/);
  }
  // A bucket that only an incomplete reading reached is a lower bound. Off Core's window grid (an
  // older report has no window), only the buckets some seat read are in the series.
  const seat = day.usage.seats[0]!;
  const one: UsageDocument = {
    ...day,
    usage: {
      ...day.usage,
      seats: [
        {
          ...seat,
          series: [
            { fromMs: 0, toMs: 3_600_000, input: 10, output: 5, cached: 5, complete: true },
            {
              fromMs: 7_200_000,
              toMs: 10_800_000,
              input: 0,
              output: 0,
              cached: 0,
              complete: false,
            },
          ],
        },
      ],
    },
  };
  const gap = trend(one, 'UTC');
  expect(gap.tokens).toEqual([15, 0]);
  expect(gap.partial).toEqual([false, true]);
  expect(gap.cachedRatio).toEqual([50, null]);
  expect(gap.peak).toEqual({ at: '00:00', tokens: 15 });
  // On Core's window every bucket keeps its place: one no seat read is null, never 0 or dropped.
  const asleep = trend(mockDocument('24h', { asleep: true }), 'UTC');
  expect(asleep.x).toHaveLength(24);
  expect(asleep.tokens.slice(15, 20)).toEqual([null, null, null, null, null]);
  expect(asleep.tokens.filter((value) => value === null)).toHaveLength(5);
  expect(asleep.cachedRatio[15]).toBeNull();
  expect(asleep.partial[15]).toBe(false);
});

it('projects a weekly window to its reset at the recent pace, or says when it runs out (#6751 B)', () => {
  const hour = 3_600_000;
  const reset = 1_800_000_000_000;
  const week = (points: [number, number][]) => ({
    provider: 'codex',
    windowMinutes: 10080,
    resetsAtMs: reset,
    points: points.map(([hoursBefore, percentLeft]) => ({
      atMs: reset - hoursBefore * hour,
      percentLeft,
    })),
  });
  // 10 points used over the last day, three days before the reset: 20% left at it.
  const lasts = runway(
    week([
      [96, 60],
      [84, 55],
      [72, 50],
    ]),
    reset - 72 * hour,
  )!;
  expect(lasts).toMatchObject({ basis: 'recent', perHour: 0.42, leftAtReset: 20, emptyAtMs: null });
  expect(runwayWords(lasts, reset - 72 * hour)).toBe(
    "At the last day's pace about 20% is left at the reset.",
  );
  // 20 points over the last day with 20 left and three days to go: empty in a day, two before it.
  const short = runway(
    week([
      [96, 40],
      [72, 20],
    ]),
    reset - 72 * hour,
  )!;
  expect(short).toMatchObject({ basis: 'recent', leftAtReset: 0, emptyAtMs: reset - 48 * hour });
  expect(runwayWords(short, reset - 72 * hour)).toBe(
    "At the last day's pace it runs out in 1d 0h, 2d 0h before the reset.",
  );
  // Under six hours of samples, the window's average since it began full: 30 used in two days.
  const young = runway(week([[120, 70]]), reset - 120 * hour)!;
  expect(young).toMatchObject({ basis: 'window', perHour: 0.63 });
  expect(young.emptyAtMs).toBe(reset - 120 * hour + Math.round((70 / 30) * 48 * hour));
  // No use over the day: what is left now is left at the reset.
  const still = runway(
    week([
      [96, 80],
      [72, 80],
    ]),
    reset - 72 * hour,
  )!;
  expect(runwayWords(still, reset - 72 * hour)).toBe(
    "No use at the last day's pace: 80% left at the reset.",
  );
  // Samples at or after the reset, or from before the window began, are not this window's.
  expect(
    runway(
      week([
        [0, 90],
        [-1, 100],
      ]),
      reset + hour,
    ),
  ).toBeNull();
  expect(runway(week([[200, 10]]), reset - 72 * hour)).toBeNull();
  // The previous window's last sample never sets this one's pace.
  expect(
    runway(
      week([
        [175, 10],
        [160, 90],
      ]),
      reset - 160 * hour,
    ),
  ).toMatchObject({
    basis: 'window',
    perHour: 1.25,
  });
  // A sample later than the owner's clock is not used either.
  expect(
    runway(
      week([
        [96, 60],
        [12, 0],
      ]),
      reset - 72 * hour,
    ),
  ).toMatchObject({ fromLeft: 60 });
});

it('computes cost share from report quotes and leaves the zero-total denominator unavailable', () => {
  const models = modelShares(day).models;
  const result = modelCostShares(day, models);
  expect(result.rows.get('gpt-6.2-sol')).toEqual({
    cost: { usdMicros: 700_000, lowerBound: true },
    share: 35,
  });
  expect(result.rows.get('claude-opus-5-5')?.share).toBe(60);
  expect(result.excluded).toEqual(['claude-fable-5-2']);
  expect(result.hasFloors).toBe(true);
  const zero = {
    ...day,
    usage: {
      ...day.usage,
      models: [
        { modelId: 'gpt-6.2-sol', cost: { usdMicros: 0, lowerBound: false }, costUnavailable: [] },
      ],
    },
  };
  const zeroShare = modelCostShares(zero, models);
  expect(zeroShare.hasDenominator).toBe(false);
  expect(zeroShare.rows.get('gpt-6.2-sol')).toEqual({
    cost: { usdMicros: 0, lowerBound: false },
    share: null,
  });
});

it('says what Digest saved, measured first, with every unknown figure as Unknown (#6751 D)', async () => {
  const { mockSavings } = await import('../src/digest-mock.js');
  const whole = savingsView(mockSavings('24h'));
  expect(whole.tiles.map((tile) => tile.label)).toEqual([
    'Wake-ups saved (measured)',
    'Upper bound',
    'Messages delivered',
    'Avoided cost (list price estimate)',
  ]);
  expect(whole.tiles.every((tile) => tile.value !== 'Unknown')).toBe(true);
  expect(whole.tiles[2]!.value).toMatch(/^\d+ in \d+$/);
  expect(whole.tiles[3]!.value).toMatch(/^\$\d/);
  expect(whole.coverageNote).toBeNull();
  expect(whole.costNote).toBeNull();
  expect(whole.pricing).toBe('Estimate at list price, price table 2026-11-27 (built-in).');
  // Busiest member first.
  expect(whole.rows[0]![0]).toBe('core-1');
  const partial = savingsView(mockSavings('7d', 'partial'));
  expect(partial.coverageNote).toBe(
    '1 member covers only part of this range; 1 member has no coverage record. Figures are lower bounds.',
  );
  // One member the report could not measure: the measured total is Unknown, never a smaller sum.
  expect(partial.tiles[0]!.value).toBe('Unknown');
  // Every member with a saving was priced, so the cost is theirs, with nothing to qualify.
  expect(partial.tiles[3]!.value).toMatch(/^\$\d/);
  expect(partial.costNote).toBeNull();
  const feat = partial.rows.find((row) => row[0] === 'feat-1')!;
  expect(feat.slice(3)).toEqual(['Unknown', feat[4], 'Unknown', 'Whole range']);
  expect(partial.rows.find((row) => row[0] === 'ux-1')![6]).toBe('Partial');
  expect(partial.rows.find((row) => row[0] === 'remote-1')![6]).toBe('No record');
});

it('keeps a reason the page has no words for, and a zero as a zero', () => {
  const empty = (reason: string) =>
    savingsView({
      since: '24h',
      members: [],
      total: {
        messages: 0,
        deliveries: 0,
        turnsSaved: 0,
        measuredSaved: null,
        delay: null,
        avoidedCost: { usdMicros: null, lowerBound: null, reason, covered: [], unpriced: [] },
      },
      pricing: null,
    });
  // What a real Digest with no history reports: words for its reason, not the code.
  expect(empty('no_known_arrivals').costNote).toBe(
    'Cost unknown: no message is known to have arrived while its member was idle.',
  );
  const view = savingsView({
    since: '24h',
    members: [],
    total: {
      messages: 0,
      deliveries: 0,
      turnsSaved: 0,
      measuredSaved: null,
      delay: null,
      avoidedCost: {
        usdMicros: null,
        lowerBound: null,
        reason: 'brand_new_reason',
        covered: [],
        unpriced: [],
      },
    },
    pricing: null,
  });
  expect(view.tiles.map((tile) => tile.value)).toEqual(['Unknown', '0', '0 in 0', 'Unknown']);
  expect(view.costNote).toBe('Cost unknown: brand_new_reason.');
  expect(view.pricing).toBeNull();
  expect(view.rows).toEqual([]);
});

it('shows the avoided cost as the report gives it: priced members only, with the unpriced models (#6794)', async () => {
  const { mockSavings } = await import('../src/digest-mock.js');
  const cost = (doc: ReturnType<typeof mockSavings>) => {
    const view = savingsView(doc);
    return { value: view.tiles[3]!.value, note: view.costNote };
  };
  // Every member priced: the report's sum, nothing to qualify.
  expect(cost(mockSavings('24h'))).toEqual({ value: '$0.559', note: null });
  const floor = mockSavings('24h');
  floor.total.avoidedCost.lowerBound = true;
  expect(cost(floor).value).toBe('at least $0.559');
  floor.total.avoidedCost.usdMicros = 1_239_001;
  expect(cost(floor).value).toBe('at least $1.239001');
  floor.total.avoidedCost.usdMicros = -559_000;
  expect(cost(floor).value).toBe('at least $0.559 in added cost');
  // core-1, ux-1 and feat-1 have unpriced wake-ups: the report's sum covers tmt-lead and remote-1.
  expect(cost(mockSavings('24h', 'mixed'))).toEqual({
    value: '$0.1505',
    note: 'Covers 2 of 5 members; no price for claude-fable-5-2, gpt-6.2-astra, gpt-6.2-sol.',
  });
  // No member priced: Unknown, with the models named.
  expect(cost(mockSavings('24h', 'unpriced'))).toEqual({
    value: 'Unknown',
    note: 'Cost unknown: no price for claude-fable-5-2, gpt-6-luna, gpt-6.2-astra, gpt-6.2-sol.',
  });
  // An older Digest lists no members: its total stretched a median over unpriced ones, so the
  // figure is not shown even though the report has one.
  const older = mockSavings('24h');
  older.total.avoidedCost = { ...older.total.avoidedCost, covered: null, unpriced: null };
  expect(older.total.avoidedCost.usdMicros).toBe(559_000);
  expect(cost(older)).toEqual({
    value: 'Unknown',
    note: 'Cost unknown: Digest on your machine does not say which members it covers. Upgrade TMT to see it.',
  });
  // A member listed without models still says why.
  const unnamed = mockSavings('24h', 'mixed');
  for (const member of unnamed.total.avoidedCost.unpriced!) member.models = [];
  expect(cost(unnamed).note).toBe('Covers 2 of 5 members; a model has no list price.');
});

import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vite-plus/test';
import {
  allowanceFromAnswers,
  createDigestSource,
  limitHistoryFrom,
  modelQuotes,
  providerRecords,
  seatQuote,
  type UsageDocument,
  readSavings,
  reportFromAnswers,
  savingsFromAnswer,
} from '../src/digest-source.js';
import { ownerAnswer } from '../src/owner-reads.js';

interface Vectors {
  cases: { name: string; target: string; expect: Record<string, unknown> }[];
}
const vectors = JSON.parse(
  readFileSync(new URL('../../../../../contracts/owner-reads-v1.json', import.meta.url), 'utf8'),
) as Vectors;
const answerOf = (name: string) => {
  const found = vectors.cases.find((vector) => vector.name.startsWith(name));
  if (!found) throw new Error(`no vector: ${name}`);
  return ownerAnswer<never>({ ...found.expect, observedAtMs: 1792635300000 });
};
const notSampled = answerOf('limits: no kept samples');
const kept = answerOf('limits: the kept weekly samples');
const weekly = answerOf('digest: the usage report passes');
const snapshot = allowanceFromAnswers(weekly, notSampled);
const read = vi.hoisted(() => vi.fn());
vi.mock('../src/owner-reads.js', async (original) => ({
  ...(await original<typeof import('../src/owner-reads.js')>()),
  ownerRead: read,
}));

it('turns the digest vector into the page report, keeping the document as it came', () => {
  const report = reportFromAnswers('7d', answerOf('digest: the usage report passes'), snapshot);
  expect(report).toMatchObject({ range: '7d', sample: false });
  expect(report.unavailable).toBeUndefined();
  expect(report.document).toMatchObject({ since: '7d', observedAtMs: 1792635300000 });
  // No kept samples is the owner's answer, not an empty history: the chart is simply left out.
  expect(report.document!.limitHistory).toBeUndefined();
});

it('accepts native v2 reported costs and preserves token records when cost evidence is invalid', () => {
  const native = JSON.parse(
    readFileSync(
      new URL('../../../../tmt-digest/contracts/vectors/usage-report-v1.json', import.meta.url),
      'utf8',
    ),
  ).cases[1].expected as UsageDocument;
  expect(providerRecords(native)?.find((row) => row.driver === 'agy')?.inputCost).toEqual({
    usdMicros: 150,
  });
  expect(modelQuotes(native).get('gpt-6-astra')).toEqual({ usdMicros: 26_000, lowerBound: true });
  expect(modelQuotes(native).get('future-model')).toBeNull();
  const first = native.usage.models![0]!;
  const valid = { ...first, cost: { usdMicros: 0, lowerBound: false } };
  const report = (...rows: NonNullable<UsageDocument['usage']['models']>) => ({
    ...native,
    usage: { ...native.usage, models: rows },
  });
  expect(modelQuotes(report(valid)).get(first.modelId)).toEqual(valid.cost);
  for (const malformed of [
    { ...valid, cost: { usdMicros: -1, lowerBound: false } },
    { ...valid, cost: { usdMicros: Number.MAX_SAFE_INTEGER + 1, lowerBound: false } },
    { ...valid, cost: { usdMicros: 42, lowerBound: 'false' } as never },
    { ...valid, costUnavailable: ['no_price'] },
  ])
    expect(modelQuotes(report(malformed)).get(first.modelId)).toBeNull();
  expect(modelQuotes(report(valid, valid)).get(first.modelId)).toBeNull();
  for (const basis of ['standard-base-input', 'unknown']) {
    const unsupported = { ...native, pricing: { ...native.pricing!, basis } };
    expect(modelQuotes(unsupported).size).toBe(0);
    expect(providerRecords(unsupported)?.find((row) => row.driver === 'agy')).toMatchObject({
      totals: { input: 100 },
      inputCost: null,
      costUnavailable: ['pricing_unavailable'],
    });
  }
});

it('reads the reported seat total without replacing it with any model-row quote', () => {
  const vectors = JSON.parse(
    readFileSync(
      new URL('../../../../tmt-digest/contracts/vectors/usage-report-v1.json', import.meta.url),
      'utf8',
    ),
  );
  const first = vectors.cases[0].expected as UsageDocument;
  const second = vectors.cases[1].expected as UsageDocument;
  const quote = (doc: UsageDocument, name: string) =>
    seatQuote(
      doc.usage.seats.find((seat) => seat.name === name),
      doc.pricing,
    );
  expect(quote(first, 'claude-seat')).toEqual({
    cost: { usdMicros: 5_820, lowerBound: false },
    reasons: [],
  });
  expect(quote(first, 'codex-a')).toEqual({
    cost: { usdMicros: 33_200, lowerBound: true },
    reasons: [],
  });
  expect(quote(first, 'codex-b')).toEqual({ cost: null, reasons: ['unattributed'] });
  expect(quote(second, 'retired-seat')).toEqual({ cost: null, reasons: ['no_price'] });
  const byModel = [{ cost: { usdMicros: 17, lowerBound: false }, costUnavailable: [] }];
  expect(
    seatQuote({ byModel, cost: null, costUnavailable: ['unattributed'] }, first.pricing),
  ).toEqual({ cost: null, reasons: ['unattributed'] });
});

it('keeps a real zero and rejects unusable seat costs while preserving their reported reasons', () => {
  const pricing = { basis: 'standard-list', version: '2026-11-15', origin: 'file' };
  const zero = { cost: { usdMicros: 0, lowerBound: false }, costUnavailable: [] };
  expect(seatQuote(zero, pricing)).toEqual({ cost: zero.cost, reasons: [] });
  expect(seatQuote(zero, { ...pricing, basis: 'standard-base-input' })).toEqual({
    cost: null,
    reasons: ['pricing_unavailable'],
  });
  for (const cost of [
    undefined,
    null,
    { usdMicros: '0', lowerBound: false },
    { usdMicros: -1, lowerBound: false },
    { usdMicros: 1.25, lowerBound: false },
    { usdMicros: Number.MAX_SAFE_INTEGER + 1, lowerBound: false },
    { usdMicros: 0 },
    { usdMicros: 0, lowerBound: 'false' },
  ]) {
    expect(seatQuote({ cost, costUnavailable: [] }, pricing)).toEqual({
      cost: null,
      reasons: ['cost_evidence_invalid'],
    });
    expect(
      seatQuote({ cost, costUnavailable: ['class_price_missing', 'unattributed'] }, pricing),
    ).toEqual({ cost: null, reasons: ['class_price_missing', 'unattributed'] });
  }
  expect(seatQuote({}, pricing).cost).toBeNull();
  expect(seatQuote({ ...zero, costUnavailable: ['no_price'] }, pricing)).toEqual({
    cost: null,
    reasons: ['no_price'],
  });
  expect(seatQuote({ ...zero, costUnavailable: [17] }, pricing)).toEqual({
    cost: null,
    reasons: ['cost_evidence_invalid'],
  });
});

it('says one plain sentence for each way the digest read is unavailable', () => {
  const reasons = ['digest: the Digest extension is absent', 'digest: the report command fails'];
  const texts = reasons.map(
    (name) => reportFromAnswers('24h', answerOf(name), snapshot).unavailable,
  );
  expect(texts[0]).toContain('tmt extension install digest');
  expect(texts[1]).toContain('tmt digest usage report');
  expect(reportFromAnswers('24h', { state: 'no-session' }, snapshot).unavailable).toContain(
    'Pair it from Remote',
  );
  expect(reportFromAnswers('24h', { state: 'unreachable' }, snapshot).unavailable).toContain(
    'tries again shortly',
  );
  for (const text of texts) expect(text).not.toMatch(/sample|mock/i);
});

it('never shows a report for another range than the one asked for', () => {
  const report = reportFromAnswers('24h', answerOf('digest: the usage report passes'), snapshot);
  expect(report.document).toBeUndefined();
  expect(report.unavailable).toContain('not available right now');
});

it('maps the kept weekly samples to the history of each reset, by source provider', () => {
  const history = limitHistoryFrom(kept as never)!;
  expect(history).toEqual([
    {
      provider: 'codex',
      windowMinutes: 10080,
      resetsAtMs: 1792500000000,
      points: [
        { atMs: 1792000000000, percentLeft: 80.5 },
        { atMs: 1792100000000, percentLeft: 70.25 },
      ],
    },
  ]);
  // Points of an earlier window (another reset time) are not drawn on this window's line.
  const two = {
    state: 'ok' as const,
    observedAtMs: 1,
    payload: {
      limitHistory: [
        {
          provider: 'claude',
          windowMinutes: 10080,
          points: [
            [1, 90, 100],
            [2, 10, 100],
            [3, 95, 200],
            [4, 80, 200],
          ] as const,
        },
      ],
    },
  };
  expect(limitHistoryFrom(two)![1]).toMatchObject({
    provider: 'claude',
    resetsAtMs: 200,
    points: [
      { atMs: 3, percentLeft: 95 },
      { atMs: 4, percentLeft: 80 },
    ],
  });
  expect(limitHistoryFrom({ state: 'unreachable' })).toBeUndefined();
  expect(limitHistoryFrom(notSampled as never)).toBeUndefined();
});

it('reads each history entry as data: a malformed one shows no history for its provider', () => {
  const ok = { provider: 'claude', windowMinutes: 10080, points: [[1, 50, 100]] };
  const answer = (limitHistory: unknown) => ({
    state: 'ok' as const,
    observedAtMs: 1,
    payload: { limitHistory } as never,
  });
  const history = limitHistoryFrom(
    answer([
      ok,
      { provider: 'codex', windowMinutes: 10080, points: 'not points' },
      { provider: 7, windowMinutes: 10080, points: [[1, 2, 3]] },
      { provider: 'codex', windowMinutes: Number.NaN, points: [[1, 2, 3]] },
      null,
      { provider: 'codex', windowMinutes: 10080, points: [[1, 'x', 3], [2, 40, 100], 'bad'] },
    ]),
  )!;
  expect(history.map((entry) => [entry.provider, entry.points.length])).toEqual([
    ['claude', 1],
    ['codex', 1],
  ]);
  expect(limitHistoryFrom(answer('not a list'))).toBeUndefined();
  expect(limitHistoryFrom(answer(undefined))).toBeUndefined();
});

it('keeps the account a history entry names and drops one whose account is malformed', () => {
  const entry = { provider: 'claude', windowMinutes: 10080, points: [[1, 50, 100]] };
  const account = { key: '0123456789ab', label: 'work' };
  const answer = (limitHistory: unknown) => ({
    state: 'ok' as const,
    observedAtMs: 1,
    payload: { limitHistory } as never,
  });
  const history = limitHistoryFrom(
    answer([
      entry,
      { ...entry, account },
      { ...entry, account: null },
      { ...entry, account: { key: '0123456789AB', label: 'work' } },
      { ...entry, account: { key: '0123456789ab', label: 'a b' } },
      { ...entry, account: { key: '0123456789ab' } },
      { ...entry, account: 'work' },
    ]),
  )!;
  expect(history).toHaveLength(3);
  expect(history[0]).not.toHaveProperty('account');
  expect(history[1]!.account).toEqual(account);
  expect(history[2]).not.toHaveProperty('account');
});

it('reads fixed weekly allowance for every range, sharing the selected 7d read and abort signal', async () => {
  const { mockDocument } = await import('../src/digest-mock.js');
  const signal = new AbortController().signal;
  for (const range of ['24h', '7d', '30d'] as const) {
    read.mockReset();
    read.mockImplementation(async (target: string) =>
      target === 'limits'
        ? kept
        : {
            state: 'ok',
            observedAtMs: 1,
            payload: {
              since: target.slice(7),
              report: mockDocument(target.slice(7) as typeof range),
            },
          },
    );
    const report = await createDigestSource().report(range, signal);
    expect(report.document!.since).toBe(range);
    expect(report.allowance!.since).toBe('7d');
    expect(report.allowance!.limits).toEqual(mockDocument('7d').limits);
    expect(read.mock.calls.filter(([target]) => target === 'digest/7d')).toHaveLength(1);
    // What Digest saved is read for the range asked for, beside the report.
    expect(read).toHaveBeenCalledWith(`digest/savings/${range}`, signal);
    expect(report.savings!.range).toBe(range);
    expect(read).toHaveBeenCalledTimes(range === '7d' ? 3 : 4);
    expect(read.mock.calls.every(([, actual]) => actual === signal)).toBe(true);
  }
});

it('does not substitute the selected range when the fixed allowance read fails or is miscorrelated', () => {
  for (const answer of [
    { state: 'unreachable' } as const,
    { state: 'ok', observedAtMs: 1, payload: { since: '24h', report: {} } } as never,
  ]) {
    const report = reportFromAnswers('7d', weekly, allowanceFromAnswers(answer, kept));
    expect(report.document).toBeDefined();
    expect(report.allowance).toBeUndefined();
    expect(report.allowanceUnavailable).toContain('Allowance could not be read');
  }
});

it('reuses one weekly read across switches, including in-flight requests, and refreshes at the mount cadence', async () => {
  const { mockDocument } = await import('../src/digest-mock.js');
  read.mockReset();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  read.mockImplementation(async (target: string) => {
    if (target === 'limits') return kept;
    if (target === 'digest/7d') await pending;
    return {
      state: 'ok',
      observedAtMs: 1,
      payload: { since: target.slice(7), report: mockDocument(target.slice(7) as '7d') },
    };
  });
  const source = createDigestSource();
  const first = source.report('24h');
  const second = source.report('30d');
  const third = source.report('7d');
  expect(read.mock.calls.map(([target]) => target)).toEqual([
    'digest/24h',
    'digest/savings/24h',
    'digest/7d',
    'limits',
    'digest/30d',
    'digest/savings/30d',
    'digest/savings/7d',
  ]);
  release();
  const results = await Promise.all([first, second, third]);
  expect(results.every((report) => report.allowance === results[0]!.allowance)).toBe(true);
  read.mockClear();
  await source.report('24h');
  expect(read.mock.calls.map(([target]) => target)).toEqual(['digest/24h', 'digest/savings/24h']);
  read.mockClear();
  // The weekly report is shared; what Digest saved over the week is still read again.
  await source.report('7d');
  expect(read.mock.calls.map(([target]) => target)).toEqual(['digest/savings/7d']);
  read.mockClear();
  await source.report('30d', undefined, true);
  expect(read.mock.calls.map(([target]) => target)).toEqual([
    'digest/30d',
    'digest/savings/30d',
    'digest/7d',
    'limits',
  ]);
  read.mockReset();
  read.mockResolvedValue({ state: 'unreachable' });
  const failedSource = createDigestSource();
  await failedSource.report('24h');
  read.mockClear();
  const failed = await failedSource.report('30d');
  expect(read.mock.calls.map(([target]) => target)).toEqual(['digest/30d', 'digest/savings/30d']);
  expect(failed.allowanceUnavailable).toContain('Allowance could not be read');
  read.mockClear();
  await createDigestSource().report('24h');
  expect(read.mock.calls.map(([target]) => target)).toEqual([
    'digest/24h',
    'digest/savings/24h',
    'digest/7d',
    'limits',
  ]);
});

it('reads what Digest saved from the shared vector: figures, plain names, the price table (#6751 D)', () => {
  const report = savingsFromAnswer('7d', answerOf('savings: the delivery report passes'));
  expect(report.unavailable).toBeUndefined();
  expect(report.document).toEqual({
    since: '7d',
    members: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'worker',
        complete: true,
        messages: 6,
        deliveries: 3,
        turnsSaved: 3,
        measuredSaved: 1,
        delay: { median: 15000, p90: 40000, max: 40000 },
        avoidedCost: {
          usdMicros: null,
          lowerBound: null,
          reason: 'wake_turns_unavailable',
          covered: null,
          unpriced: null,
        },
      },
    ],
    total: {
      messages: 6,
      deliveries: 3,
      turnsSaved: 3,
      measuredSaved: 1,
      delay: null,
      avoidedCost: {
        usdMicros: null,
        lowerBound: null,
        reason: 'wake_turns_unavailable',
        covered: [],
        unpriced: [],
      },
    },
    pricing: { version: '2026-11-27', asOf: '2026-11-27', origin: 'built-in' },
  });
});

it('shows a bad count as unknown and never coerces it; a negative measured saving stays (#6752)', () => {
  const member = {
    id: 'a',
    name: '<b>worker</b>',
    messages: '6',
    actual: { deliveries: -1, delayMs: { median: 1.5, p90: 2, max: 3 } },
    turnsSaved: 2 ** 60,
    measuredSaved: -2,
    avoidedCost: { usdMicros: Number.NaN, reason: 7 },
    coverage: null,
  };
  const report = savingsFromAnswer('24h', {
    state: 'ok',
    observedAtMs: 1,
    payload: {
      since: '24h',
      report: { since: '24h', members: [member, { name: 'no id' }, null], total: null },
    },
  });
  expect(report.document!.members).toEqual([
    {
      id: 'a',
      // Plain text as the report wrote it; the page sets it as text, never markup.
      name: '<b>worker</b>',
      complete: null,
      messages: null,
      deliveries: null,
      turnsSaved: null,
      measuredSaved: -2,
      delay: null,
      avoidedCost: {
        usdMicros: null,
        lowerBound: null,
        reason: null,
        covered: null,
        unpriced: null,
      },
    },
  ]);
  expect(report.document!.total.messages).toBeNull();
  expect(report.document!.pricing).toBeNull();
});

it('says why what Digest saved is unavailable, and never shows another range (#6751 D)', () => {
  expect(
    savingsFromAnswer('24h', answerOf('savings: the Digest extension is absent')).unavailable,
  ).toContain('tmt extension install digest');
  expect(
    savingsFromAnswer('30d', answerOf('savings: the report command fails')).unavailable,
  ).toContain('tmt digest decisions --report');
  expect(savingsFromAnswer('24h', { state: 'no-session' }).unavailable).toContain(
    'Pair it from Remote',
  );
  expect(
    savingsFromAnswer('24h', { state: 'unavailable', observedAtMs: 1, reason: 'unknown' })
      .unavailable,
  ).toContain('not available right now');
  const week = savingsFromAnswer('24h', answerOf('savings: the delivery report passes'));
  expect(week.document).toBeUndefined();
  expect(week.unavailable).toContain('not available right now');
});

it('reads the savings route of the range asked for', async () => {
  read.mockReset();
  read.mockResolvedValue({ state: 'no-session' });
  const signal = new AbortController().signal;
  await readSavings('30d', signal);
  expect(read).toHaveBeenCalledWith('digest/savings/30d', signal);
});

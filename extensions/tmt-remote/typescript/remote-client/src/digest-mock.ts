/**
 * MOCK: seeded sample usage shaped like the public report, for tests, the gallery and dev. The
 * product entry never imports this module (a test pins that), so the product page keeps its honest
 * empty state until #4325 serves the real read.
 */
import type {
  DigestSource,
  FlowPair,
  LimitHistory,
  LimitWindow,
  SavingsDocument,
  SavingsMember,
  UsageDocument,
  UsagePoint,
  UsageRange,
  UsageSeat,
} from './digest-source.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A fixed clock: the sample never moves, so a screenshot or test is the same every run. */
export const MOCK_NOW_MS = 1_800_000_000_000;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SEATS = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'tmt-lead', line: 'claude', scale: 3 },
  { id: '10000000-0000-4000-8000-000000000002', name: 'core-1', line: 'gpt', scale: 5 },
  { id: '10000000-0000-4000-8000-000000000003', name: 'ux-1', line: 'claude', scale: 4 },
  { id: '10000000-0000-4000-8000-000000000004', name: 'feat-1', line: 'gpt', scale: 3 },
  { id: '10000000-0000-4000-8000-000000000005', name: 'remote-1', line: 'claude', scale: 2 },
  { id: '10000000-0000-4000-8000-000000000006', name: 'night-1', line: 'gpt', scale: 1 },
] as const;

/** More seats for a team of `count`: the names a squad board uses, the long lead names included. */
const MORE = [
  'tmt-remote-lead',
  'tmt-infra-lead',
  'tmt-ux-lead',
  'core-2',
  'core-ops',
  'ux-2',
  'ux-3',
  'ux-4',
  'feat-2',
  'feat-3',
  'infra-1',
  'tmt-core-pm',
  'night-lead',
  'mkt-blog',
  'tmt-mkt-lead',
  'remote-2',
  'core-3',
  'tmt-feat-lead',
];

function seatSpec(index: number): { id: string; name: string; line: string; scale: number } {
  if (index < SEATS.length) return SEATS[index]!;
  const at = index - SEATS.length;
  return {
    id: `20000000-0000-4000-8000-${String(at + 1).padStart(12, '0')}`,
    name: MORE[at % MORE.length]!,
    line: at % 2 ? 'claude' : 'gpt',
    scale: 0.2 + ((at * 7) % 10) / 4,
  };
}

/** The seats with no evidence before the second half of the range: partial, never zero. */
const late = (index: number, seats: number) =>
  index === 5 || (seats > SEATS.length && index > 5 && index % 3 === 0);
/** A large team's second seat has one incomplete bucket: partial, near the top of the ranking. */
const lowerBound = (index: number, seats: number) =>
  late(index, seats) || (seats > SEATS.length && index === 1);

/** The window a range reads, bucketed evenly: hourly for 24h, daily after. */
function rangeWindow(range: UsageRange) {
  const step = range === '24h' ? HOUR : DAY;
  const count = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const fromMs = Math.floor(MOCK_NOW_MS / step) * step - count * step;
  return { step, count, fromMs, toMs: fromMs + count * step };
}

/** The 24h buckets the host slept through (`asleep`): no seat has a reading for them. */
const ASLEEP = new Set([15, 16, 17, 18, 19]);

/** The models a family's seats run, with their part of its tokens (#6751 C). */
const MODELS: Record<string, readonly (readonly [string, number])[]> = {
  claude: [
    ['claude-opus-5-5', 0.7],
    ['claude-fable-5-2', 0.3],
  ],
  gpt: [
    ['gpt-6.2-sol', 0.8],
    ['gpt-6.2-astra', 0.2],
  ],
};

/** Core's attribution of a seat's totals: night-1 has a quarter no model row covers. */
function attributed(
  index: number,
  line: string,
  totals: UsageSeat['totals'],
): Pick<UsageSeat, 'byModel' | 'unattributed'> {
  const covered = index === 5 ? 0.75 : 1;
  const part = (value: number, share: number) => Math.round(value * covered * share);
  const byModel = MODELS[line]!.map(([modelId, share]) => ({
    modelId,
    input: part(totals.input, share),
    output: part(totals.output, share),
    cached: part(totals.cached, share),
  }));
  const rest = (key: 'input' | 'output' | 'cached') =>
    totals[key] - byModel.reduce((sum, row) => sum + row[key], 0);
  const unattributed = { input: rest('input'), output: rest('output'), cached: rest('cached') };
  return unattributed.input + unattributed.output > 0 ? { byModel, unattributed } : { byModel };
}

function seat(
  index: number,
  range: UsageRange,
  seats: number = SEATS.length,
  asleep = false,
): UsageSeat {
  const spec = seatSpec(index);
  const next = random(100 + index);
  const { step, count, fromMs: start } = rangeWindow(range);
  const series: UsagePoint[] = [];
  for (let at = 0; at < count; at++) {
    if (late(index, seats) && at < count / 2) continue;
    if (asleep && range === '24h' && ASLEEP.has(at)) {
      next();
      next();
      // Core still lists the hour: no tokens and no coverage, which is no data.
      series.push({
        fromMs: start + at * step,
        toMs: start + (at + 1) * step,
        input: 0,
        output: 0,
        cached: 0,
        coveredMs: 0,
        complete: false,
      });
      continue;
    }
    const quiet = next() < 0.2;
    const input = quiet ? 0 : Math.round(next() * 90_000 * spec.scale * (step / HOUR) ** 0.5);
    const output = Math.round(input * 0.12);
    series.push({
      fromMs: start + at * step,
      toMs: start + (at + 1) * step,
      input,
      output,
      cached: Math.round(input * 0.6),
      coveredMs: lowerBound(index, seats) && at === count / 2 ? step / 2 : step,
      complete: !(lowerBound(index, seats) && at === count / 2),
    });
  }
  const totals = series.reduce(
    (sum, point) => ({
      input: sum.input + point.input,
      output: sum.output + point.output,
      cached: sum.cached + point.cached,
    }),
    { input: 0, output: 0, cached: 0 },
  );
  return {
    id: spec.id,
    name: spec.name,
    retired: false,
    totals,
    lines: [spec.line],
    ...attributed(index, spec.line, totals),
    series,
    coverage: {
      coveredMs: series.reduce((sum, point) => sum + (point.coveredMs ?? 0), 0),
      windowMs: count * step,
      startsAtMs: series[0]?.fromMs ?? null,
      complete: series.length === count && series.every((point) => point.complete),
      gap: series.length !== count || series.some((point) => point.coveredMs === 0),
    },
  };
}

function flow(): FlowPair[] {
  const next = random(9);
  const pairs: FlowPair[] = [];
  for (const from of SEATS) {
    for (const to of SEATS) {
      if (from.id === to.id || next() < 0.4) continue;
      const party = (s: (typeof SEATS)[number]) => ({ id: s.id, name: s.name, retired: false });
      pairs.push({
        sender: party(from),
        recipient: party(to),
        kind: next() < 0.7 ? 'talk' : 'reply',
        count: 1 + Math.round(next() * 40),
      });
    }
  }
  pairs.push({
    sender: { id: SEATS[0].id, name: SEATS[0].name, retired: false },
    recipient: { id: SEATS[1].id, name: SEATS[1].name, retired: false },
    kind: 'ack',
    count: 99,
  });
  return pairs;
}

const limits: LimitWindow[] = [
  {
    provider: 'codex',
    windowMinutes: 10080,
    resetsAtMs: MOCK_NOW_MS + 40 * HOUR,
    usedPercent: 74,
    observedAtMs: MOCK_NOW_MS - 20 * 60_000,
    elapsedPercent: 76.19,
    paceDeltaPoints: -2.19,
    stale: false,
    seats: [SEATS[0].id, SEATS[2].id, SEATS[4].id],
  },
  {
    provider: 'codex',
    windowMinutes: 10080,
    resetsAtMs: MOCK_NOW_MS + 100 * HOUR,
    usedPercent: 45,
    observedAtMs: MOCK_NOW_MS - 10 * 60_000,
    elapsedPercent: 40.48,
    paceDeltaPoints: 4.52,
    stale: false,
    seats: [SEATS[1].id, SEATS[3].id],
  },
  {
    provider: 'codex',
    windowMinutes: 10080,
    resetsAtMs: MOCK_NOW_MS + 80 * HOUR,
    usedPercent: 38,
    observedAtMs: MOCK_NOW_MS - 3 * DAY,
    elapsedPercent: 52.38,
    paceDeltaPoints: -14.38,
    stale: false,
    seats: [SEATS[2].id],
  },
  {
    provider: 'codex',
    windowMinutes: 300,
    resetsAtMs: MOCK_NOW_MS + 2 * HOUR,
    usedPercent: 30,
    observedAtMs: MOCK_NOW_MS - 5 * 60_000,
    elapsedPercent: 60,
    paceDeltaPoints: -30,
    stale: false,
    seats: [SEATS[0].id],
  },
];

/** Four-hourly samples over eight days. The current window used `burst` points in its last day
 * alone, so at that pace it runs out before its reset (#6751 B); the others last to theirs. */
function limitHistory(): LimitHistory[] {
  return [
    { left: 26, end: 40, burst: 0 },
    { left: 55, end: 100, burst: 20 },
    { left: 62, end: 80, burst: 0 },
  ].map(({ left, end, burst }) => ({
    provider: 'codex',
    windowMinutes: 10080,
    resetsAtMs: MOCK_NOW_MS + end * HOUR,
    points: Array.from({ length: 8 * 6 }, (_, at) => ({
      atMs: MOCK_NOW_MS - (47 - at) * 4 * HOUR,
      percentLeft: Math.max(
        0,
        (!burst
          ? 100 - ((100 - left) * (at + 1)) / 48
          : at < 42
            ? 100 - ((100 - left - burst) * (at + 1)) / 42
            : left + burst - (burst * (at - 41)) / 6) - (at === 20 ? 2 : 0),
      ),
    })).filter((_, at) => at !== 20 && at !== 21),
  }));
}

export interface MockShape {
  /** Seats in the report: the six named ones, then a squad board's names. */
  seats?: number;
  /** Only the OpenAI weekly window, as a team on one provider sees. */
  oneProvider?: boolean;
  /** The host slept for five hours of the 24h range: no seat has a reading for them. */
  asleep?: boolean;
}

export function mockDocument(range: UsageRange, shape: MockShape = {}): UsageDocument {
  const count = shape.seats ?? SEATS.length;
  const seats = Array.from({ length: count }, (_, index) =>
    seat(index, range, count, shape.asleep),
  );
  return {
    version: 1,
    observedAtMs: MOCK_NOW_MS,
    since: range,
    window: { fromMs: rangeWindow(range).fromMs, toMs: rangeWindow(range).toMs },
    usage: {
      seats,
      unavailable: [],
      // Fixed illustrative report quotes, independent of the sample's generated token series.
      models: [
        {
          modelId: 'claude-opus-5-5',
          cost: { usdMicros: 1_200_000, lowerBound: false },
          costUnavailable: [],
        },
        {
          modelId: 'gpt-6.2-sol',
          cost: { usdMicros: 700_000, lowerBound: true },
          costUnavailable: [],
        },
        {
          modelId: 'gpt-6.2-astra',
          cost: { usdMicros: 100_000, lowerBound: true },
          costUnavailable: [],
        },
        { modelId: 'claude-fable-5-2', cost: null, costUnavailable: ['no_price'] },
      ],
    },
    pricing: { version: '2026-11-27', basis: 'standard-list', origin: 'built-in' },
    limits: shape.oneProvider
      ? limits.filter((limit) => limit.seats.includes(SEATS[1].id))
      : limits,
    limitsUnavailable: [{ line: 'claude', reason: 'no_source' }],
    exchange: { sinceMs: MOCK_NOW_MS - DAY, observedAtMs: MOCK_NOW_MS, pairs: flow() },
    limitHistory: limitHistory().filter(
      (history) => !shape.oneProvider || history.resetsAtMs === MOCK_NOW_MS + 100 * HOUR,
    ),
  };
}

/**
 * What the sample's delivered digests saved over `range` (#6751 D), costed as Digest does
 * (#6794): a member's cost only when every wake-up had a price, the total their sum.
 * - `partial`: one member covers only part of the range, one has no coverage record, and one has
 *   no known idle arrival, so its saving is unknown.
 * - `mixed`: core-1 and feat-1 run models with no price row, and one of ux-1's wake-ups ran one.
 * - `unpriced`: no member's model has a price.
 */
export type SavingsVariant = 'whole' | 'partial' | 'mixed' | 'unpriced';

/** The unpriced models of each sample seat, by variant. */
const UNPRICED: Record<SavingsVariant, Record<number, string[]>> = {
  whole: {},
  partial: {},
  mixed: { 1: ['gpt-6.2-sol'], 2: ['claude-fable-5-2'], 3: ['gpt-6.2-astra'] },
  unpriced: {
    0: ['claude-fable-5-2'],
    1: ['gpt-6.2-sol'],
    2: ['claude-fable-5-2'],
    3: ['gpt-6.2-astra'],
    4: ['gpt-6-luna'],
  },
};

export function mockSavings(range: UsageRange, variant: SavingsVariant = 'whole'): SavingsDocument {
  const days = range === '24h' ? 1 : range === '7d' ? 7 : 30;
  const partial = variant === 'partial';
  const members: SavingsMember[] = SEATS.slice(0, 5).map((seat, index) => {
    const messages = (seat.scale * 4 + 2) * days;
    const deliveries = Math.ceil(messages / (2 + (index % 3)));
    const unknown = partial && index === 3;
    const measuredSaved = unknown ? null : Math.floor((messages - deliveries) * 0.6);
    const models = UNPRICED[variant][index];
    return {
      id: seat.id,
      name: seat.name,
      complete: partial && index === 2 ? false : partial && index === 4 ? null : true,
      messages,
      deliveries,
      turnsSaved: messages - deliveries,
      measuredSaved,
      delay: unknown ? null : { median: (40 + index * 25) * 1000, p90: 300_000, max: 900_000 },
      avoidedCost: {
        usdMicros: measuredSaved === null || models ? null : measuredSaved * 21_500,
        lowerBound: measuredSaved === null || models ? null : false,
        reason: measuredSaved === null ? 'no_known_arrivals' : models ? 'no_price' : null,
        covered: null,
        unpriced: null,
      },
    };
  });
  const sum = (pick: (member: SavingsMember) => number | null) =>
    members.some((member) => pick(member) === null)
      ? null
      : members.reduce((total, member) => total + pick(member)!, 0);
  const saving = members.filter((member) => (member.measuredSaved ?? 0) !== 0);
  const covered = saving.filter((member) => member.avoidedCost.usdMicros !== null);
  const unpriced = saving.filter((member) => member.avoidedCost.usdMicros === null);
  return {
    since: range,
    members,
    total: {
      messages: sum((member) => member.messages),
      deliveries: sum((member) => member.deliveries),
      turnsSaved: sum((member) => member.turnsSaved),
      measuredSaved: sum((member) => member.measuredSaved),
      delay: partial ? null : { median: 65_000, p90: 300_000, max: 900_000 },
      avoidedCost: {
        usdMicros:
          covered.length || !unpriced.length
            ? covered.reduce((total, member) => total + member.avoidedCost.usdMicros!, 0)
            : null,
        lowerBound: !covered.length && unpriced.length ? null : false,
        reason: !covered.length && unpriced.length ? 'no_price' : null,
        covered: covered.map((member) => ({
          id: member.id,
          measuredSaved: member.measuredSaved,
          usdMicros: member.avoidedCost.usdMicros,
          lowerBound: member.avoidedCost.lowerBound,
        })),
        unpriced: unpriced.map((member) => ({
          id: member.id,
          measuredSaved: member.measuredSaved,
          models: UNPRICED[variant][members.indexOf(member)]!,
          reason: 'no_price',
        })),
      },
    },
    pricing: { version: '2026-11-27', asOf: '2026-11-27', origin: 'built-in' },
  };
}

export const mockDigestSource: DigestSource = {
  async report(range) {
    return {
      range,
      sample: true,
      document: mockDocument(range),
      allowance: mockDocument('7d'),
      savings: { range, document: mockSavings(range) },
    };
  },
};

/**
 * The numbers the Digest page paints, derived from the public usage document. Pure: no DOM, no
 * clock, so every section is tested on plain data. A missing observation stays missing (`null`):
 * it is never turned into a zero here.
 */
import type { Layer, SeriesChartOptions } from '@tmt/browser-ui/chart';
import { isLimitAccount, modelQuotes, providerRecords, seatQuote } from './digest-source.js';
import type {
  LimitHistory,
  LimitWindow,
  SavingsDocument,
  UsageCost,
  UsageDocument,
  UsagePoint,
  UsageSeat,
  UsageTotals,
} from './digest-source.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Input plus output; cached input is part of input and is never added. */
export const tokensOf = (point: Pick<UsagePoint, 'input' | 'output'>) => point.input + point.output;

export function seatName(seat: { id: string; name: string | null; retired: boolean }): string {
  const base = seat.name ?? seat.id.slice(0, 8);
  return seat.retired ? `${base} (retired)` : base;
}

function stamp(ms: number, range: UsageDocument['since'], zone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const at = (type: string) => parts.find((part) => part.type === type)!.value;
  return range === '24h' ? `${at('hour')}:${at('minute')}` : `${at('month')}-${at('day')}`;
}

export interface TokenSeries {
  x: string[];
  layers: Layer[];
  /** True when any bucket is a lower bound (an incomplete read). */
  partial: boolean;
}

/** Tokens per bucket for every seat, on the union of the seats' bucket starts. */
export function tokenSeries(doc: UsageDocument, zone?: string): TokenSeries {
  const starts = [
    ...new Set(doc.usage.seats.flatMap((seat) => seat.series.map((point) => point.fromMs))),
  ].sort((a, b) => a - b);
  return {
    x: starts.map((at) => stamp(at, doc.since, zone)),
    layers: doc.usage.seats.map((seat) => {
      const byStart = new Map(seat.series.map((point) => [point.fromMs, point]));
      return {
        key: seat.id,
        label: seatName(seat),
        values: starts.map((at) => {
          const point = byStart.get(at);
          return point ? tokensOf(point) : null;
        }),
      };
    }),
    partial: doc.usage.seats.some((seat) => seat.series.some((point) => !point.complete)),
  };
}

export interface RankRow {
  id: string;
  name: string;
  tokens: number;
  /** Whole percent of the listed seats' tokens. */
  share: number;
  /** The seat's evidence does not cover the whole window. */
  partial: boolean;
}

/** Seats by tokens in the window, largest first (ties by name). */
export function rankRows(doc: UsageDocument): RankRow[] {
  const rows = doc.usage.seats.map((seat) => ({
    id: seat.id,
    name: seatName(seat),
    tokens: tokensOf(seat.totals),
    partial: !seat.coverage.complete,
  }));
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  return rows
    .map((row) => ({ ...row, share: total ? Math.round((row.tokens / total) * 100) : 0 }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

/** Seats the ranking lists before the rest fold into one row. */
export const RANKING_KEPT = 8;

export interface Ranking {
  /** The leading seats, largest first. */
  top: RankRow[];
  /** Every seat after them, folded: null when none is left out. */
  other: { seats: number; tokens: number; share: number } | null;
  /** True when any seat, listed or folded, lacks evidence for part of the window. */
  partial: boolean;
}

/** The ranking's top `kept` seats and one folded row for the rest. */
export function ranking(rows: readonly RankRow[], kept = RANKING_KEPT): Ranking {
  const rest = rows.slice(kept);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const tokens = rest.reduce((sum, row) => sum + row.tokens, 0);
  return {
    top: rows.slice(0, kept),
    other: rest.length
      ? { seats: rest.length, tokens, share: total ? Math.round((tokens / total) * 100) : 0 }
      : null,
    partial: rows.some((row) => row.partial),
  };
}

export interface Exchange {
  participants: { id: string; label: string }[];
  value: (from: string, to: string) => number | null;
}

const COUNTED = new Set(['talk', 'reply']);

/**
 * Who talks to whom: only talk and reply count (an ack or a result is not a conversation),
 * all seats ranked by messages sent plus received. Null without a flow
 * read; a pair with no message is a known none (0).
 */
export function exchange(doc: UsageDocument): Exchange | null {
  const flow = doc.exchange;
  if (!flow) return null;
  const labels = new Map<string, string>();
  for (const seat of doc.usage.seats) labels.set(seat.id, seatName(seat));
  const sent = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const pair of flow.pairs) {
    const { sender, recipient } = pair;
    if (!COUNTED.has(pair.kind) || !sender.id || !recipient.id || sender.id === recipient.id) {
      continue;
    }
    for (const party of [sender, recipient]) {
      if (!labels.has(party.id!)) labels.set(party.id!, seatName({ ...party, id: party.id! }));
    }
    pairs.set(
      `${sender.id}>${recipient.id}`,
      (pairs.get(`${sender.id}>${recipient.id}`) ?? 0) + pair.count,
    );
    for (const id of [sender.id, recipient.id]) sent.set(id, (sent.get(id) ?? 0) + pair.count);
  }
  const participants = [...labels]
    .map(([id, label]) => ({ id, label }))
    .sort(
      (a, b) => (sent.get(b.id) ?? 0) - (sent.get(a.id) ?? 0) || a.label.localeCompare(b.label),
    );
  return { participants, value: (from, to) => pairs.get(`${from}>${to}`) ?? 0 };
}

/** A driver's name as Core reports it, capitalised: no provider is special-cased (#6751). */
export function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Usable allowance windows: a named source and a well-formed account, or none. */
const sourced = (limit: LimitWindow) =>
  typeof limit.provider === 'string' &&
  limit.provider.length > 0 &&
  (limit.account == null || isLimitAccount(limit.account));

/** Weekly windows still active at the owner's read time, from a named source. */
const activeWeekly = (doc: UsageDocument) =>
  doc.limits.filter(
    (limit) =>
      sourced(limit) && limit.windowMinutes === 10080 && limit.resetsAtMs > doc.observedAtMs,
  );

/** Every provider the report knows, sorted: a recorded driver share or an active weekly window.
 * A window that has reset is no evidence of a provider on its own. */
export function providerSources(doc: UsageDocument): string[] {
  return [
    ...new Set([
      ...(providerRecords(doc) ?? []).map((row) => row.driver),
      ...activeWeekly(doc).map((limit) => limit.provider),
    ]),
  ].sort();
}

const CHART_HUES = 7;
/** One hue per source, shared by its meter and history, in the sources' order (1 to 7, then again). */
export function providerStyles(doc: UsageDocument): Map<string, number> {
  return new Map(providerSources(doc).map((source, at) => [source, (at % CHART_HUES) + 1]));
}

/** Why a provider shows no current window: Core's reason for it, a window that has reset, or no
 * allowance at all. A provider with an allowance source and no window is a read gap, not "none". */
function allowanceNote(doc: UsageDocument, source: string, others: boolean): string {
  const gap = (doc.limitsUnavailable ?? []).find(
    (entry) => entry?.provider === source || entry?.line === source,
  );
  switch (gap?.reason) {
    case undefined:
      break;
    case 'no_source':
      return noAllowance(source);
    case 'expired':
      return 'The weekly window has reset; no new one is reported yet.';
    case 'not_observed':
    case 'none_observed':
      return 'Allowance has not been observed yet.';
    default:
      return 'Allowance could not be read just now.';
  }
  // Windows that only retired seats reported are still active, so that comes before a reset.
  if (others) return 'No current seat has reported an active weekly window.';
  if (doc.limits.some((limit) => limit.provider === source && limit.resetsAtMs <= doc.observedAtMs))
    return 'The weekly window has reset; no new one is reported yet.';
  return noAllowance(source);
}

const noAllowance = (source: string) => `No allowance reported by ${providerLabel(source)}.`;

/** The driver whose credits the report carries (digest `usage-v1.md`: the Codex credit balance). */
const CREDITS_DRIVER = 'codex';

export interface CreditsView {
  /** The balance as the provider wrote it, or `unlimited`; null when the account has no credits. */
  balance: string | null;
  observedAtMs: number;
}

/** The newest observed balance in the window; null without a well-formed point. */
export function latestCredits(doc: UsageDocument): CreditsView | null {
  const points = Array.isArray(doc.credits?.points) ? doc.credits.points : [];
  let latest: CreditsView | null = null;
  for (const point of points) {
    if (
      !point ||
      !Number.isSafeInteger(point.observedAtMs) ||
      typeof point.hasCredits !== 'boolean' ||
      typeof point.unlimited !== 'boolean' ||
      typeof point.balance !== 'string' ||
      !/^-?\d{1,15}(\.\d{1,20})?$/.test(point.balance)
    )
      continue;
    if (latest && latest.observedAtMs >= point.observedAtMs) continue;
    latest = {
      balance: point.unlimited ? 'unlimited' : point.hasCredits ? point.balance : null,
      observedAtMs: point.observedAtMs,
    };
  }
  return latest;
}

/** A balance for reading: digits grouped, cut (never rounded) to two places; `unlimited` as is. */
export function creditText(balance: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(balance);
  if (!match) return balance;
  const digits = (match[3] ?? '').slice(0, 2).replace(/0+$/, '');
  return `${match[1]}${BigInt(match[2]!).toLocaleString('en-US')}${digits ? `.${digits}` : ''}`;
}

/** Core's causes, in words the person can act on; an unknown one is shown as Core wrote it. */
const CAUSES: Record<string, string> = {
  no_binding: 'not running under TMT',
  no_agent: 'no agent session in its pane',
  no_sampler: 'started outside tmt run, so only its Stop hook reports',
  not_sampled: 'running, but no sample accepted yet',
};
const REASONS: Record<string, string> = {
  not_found: 'not found',
  read_failed: 'could not be read',
};

export interface CoverageGap {
  /** The cause or reason id, for a stable order and element IDs. */
  id: string;
  words: string;
  seats: string[];
}

/** The banner's one-line heading: seats with no usage, seats with only part of the range, or,
 * with no gap at all, the idle seats. Counts agree with their verbs. */
export function coverageHeading(seen: Coverage): string {
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
  const parts = [
    seen.missingSeats
      ? `${seen.missingSeats} ${plural(seen.missingSeats, 'seat has', 'seats have')} no usage in this range`
      : '',
    seen.partialSeats
      ? `${seen.partialSeats} of ${seen.seats} ${plural(seen.seats, 'seat', 'seats')} ${plural(seen.partialSeats, 'covers', 'cover')} only part of ${seen.missingSeats ? 'it' : 'this range'}`
      : '',
  ].filter(Boolean);
  if (parts.length) return `${parts.join('; ')}. Totals are lower bounds.`;
  return `${seen.idle.length} ${plural(seen.idle.length, 'seat was', 'seats were')} idle, with no recent turn.`;
}

export interface Coverage {
  /** Seats with no evidence at all, grouped by why, most seats first; idle seats are apart. */
  missing: CoverageGap[];
  /** Running seats that simply had no recent turn (Core's `idle`): no gap in the evidence. */
  idle: string[];
  missingSeats: number;
  /** Seats whose evidence covers only part of the range. */
  partialSeats: number;
  /** Seats with any evidence. */
  seats: number;
}

/** What the report cannot see, for the top of the page (#6751 F). */
export function coverage(doc: UsageDocument): Coverage {
  const groups = new Map<string, CoverageGap>();
  const idle: string[] = [];
  for (const seat of doc.usage.unavailable) {
    const cause = typeof seat.cause === 'string' && seat.cause ? seat.cause : undefined;
    if (cause === 'idle') {
      idle.push(seatName({ ...seat, id: seat.id ?? '' }));
      continue;
    }
    const id = cause ?? (typeof seat.reason === 'string' ? seat.reason : 'unknown');
    const words = cause
      ? Object.hasOwn(CAUSES, cause)
        ? CAUSES[cause]!
        : `cause "${cause}"`
      : Object.hasOwn(REASONS, id)
        ? REASONS[id]!
        : 'no usage evidence';
    const gap = groups.get(id) ?? { id, words, seats: [] };
    gap.seats.push(seatName({ ...seat, id: seat.id ?? '' }));
    groups.set(id, gap);
  }
  const missing = [...groups.values()]
    .map((gap) => ({ ...gap, seats: gap.seats.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.seats.length - a.seats.length || a.id.localeCompare(b.id));
  return {
    missing,
    idle: idle.sort((a, b) => a.localeCompare(b)),
    missingSeats: missing.reduce((sum, gap) => sum + gap.seats.length, 0),
    partialSeats: doc.usage.seats.filter((seat) => !seat.coverage.complete).length,
    seats: doc.usage.seats.length,
  };
}

/** Exact source/window/reset identity, also used for history and stable disclosure IDs. */
export function windowKey(
  window: Pick<LimitWindow, 'provider' | 'account' | 'windowMinutes' | 'resetsAtMs'>,
): string {
  // The account key is hex, so it needs no encoding; a window without one keeps its old key.
  const account = window.account ? `.${window.account.key}` : '';
  return `${encodeURIComponent(window.provider)}${account}-${window.windowMinutes}-${window.resetsAtMs}`;
}

export interface AllowanceRow {
  key: string;
  source: string;
  /** The provider's name, with its account label after it only where the provider has several. */
  provider: string;
  /** Grouping only; never shown. Null for a window that names no account. */
  accountKey: string | null;
  leftPercent: number;
  /** Share of the window elapsed, null for a stale observation. */
  elapsedPercent: number | null;
  /** Used minus elapsed in points; negative is under an even pace. */
  paceDeltaPoints: number | null;
  resetsAtMs: number;
  observedAtMs: number;
  reporters: string[];
  current: boolean;
  stale: boolean;
}

/** Weekly windows still active at the owner's read time. Unknown sources stay explicit. */
export function allowance(doc: UsageDocument): AllowanceRow[] {
  const seats = new Map(
    [...doc.usage.seats, ...doc.usage.unavailable].map((seat) => [seat.id, seat]),
  );
  // Core owns exact source/window/reset deduplication. The page only selects active weeks.
  // A malformed account is no window at all, so it cannot fold into another account's.
  const active = activeWeekly(doc);
  // Accounts are named only where a provider has more than one: one account, or none, reads as
  // the provider alone, and the windows that name none beside several are the unknown account.
  const accounts = new Map<string, Set<string>>();
  for (const limit of active)
    if (limit.account)
      accounts.set(
        limit.provider,
        (accounts.get(limit.provider) ?? new Set()).add(limit.account.key),
      );
  return active
    .map((limit) => ({
      key: windowKey(limit),
      source: limit.provider,
      provider:
        providerLabel(limit.provider) +
        ((accounts.get(limit.provider)?.size ?? 0) > 1
          ? ` · ${limit.account?.label ?? 'unknown account'}`
          : ''),
      accountKey: limit.account?.key ?? null,
      leftPercent: Math.round((100 - limit.usedPercent) * 10) / 10,
      elapsedPercent: limit.elapsedPercent,
      paceDeltaPoints: limit.paceDeltaPoints,
      resetsAtMs: limit.resetsAtMs,
      observedAtMs: limit.observedAtMs,
      reporters: limit.seats
        .map((id) => (seats.has(id) ? seatName(seats.get(id)!) : id.slice(0, 8)))
        .sort(),
      current: limit.seats.some((id) => seats.has(id) && !seats.get(id)!.retired),
      stale: limit.stale,
    }))
    .sort((a, b) => b.observedAtMs - a.observedAtMs || a.key.localeCompare(b.key));
}

/** One chart per exact source/window/reset, never borrowed by another window. */
export function historyCharts(doc: UsageDocument, zone?: string): SeriesChartOptions[] {
  const styles = providerStyles(doc);
  return (doc.limitHistory ?? [])
    .filter((history) => history.points.length > 1)
    .map((history) => ({
      title: 'Weekly percent left',
      kind: 'line' as const,
      style: styles.get(history.provider) ?? 0,
      x: history.points.map((point) => stamp(point.atMs, '7d', zone)),
      series: [
        {
          key: windowKey(history),
          label: 'left',
          values: history.points.map((point) => point.percentLeft),
        },
      ],
      reference: {
        label: 'even pace',
        values: history.points.map((point) =>
          Math.max(
            0,
            Math.min(
              100,
              (100 * (history.resetsAtMs - point.atMs)) / (history.windowMinutes * 60_000),
            ),
          ),
        ),
      },
      max: 100,
      format: (value: number) => `${Math.round(value)}%`,
    }));
}

export interface ProviderView extends AllowanceRow {
  style: number;
  chart: SeriesChartOptions | undefined;
  /** Where the window is headed at the read's time (#6751 B); null when stale or unsampled. */
  runway: Runway | null;
}

export function providers(doc: UsageDocument, zone?: string): ProviderView[] {
  const charts = new Map(historyCharts(doc, zone).map((chart) => [chart.series[0]!.key, chart]));
  const histories = new Map(
    (doc.limitHistory ?? []).map((history) => [windowKey(history), history]),
  );
  const styles = providerStyles(doc);
  return allowance(doc).map((row) => {
    const history = histories.get(row.key);
    return {
      ...row,
      style: styles.get(row.source) ?? 0,
      chart: charts.get(row.key),
      runway: history && !row.stale ? runway(history, doc.observedAtMs) : null,
    };
  });
}

export interface ProviderGroup {
  /** Stable element ID part: the source, and the account key when the provider has several. */
  id: string;
  source: string;
  label: string;
  primary: ProviderView | undefined;
  other: ProviderView[];
  /** No window and no reason one is missing: the provider reports no allowance (agy today). */
  windowless: boolean;
  /** Why no current window shows, in plain words; null when one does. Never a 0%. */
  note: string | null;
  /** Its recorded tokens in the report's range; null when the report has no share for it. */
  usage: UsageTotals | null;
  credits: CreditsView | null;
}

/**
 * One group per provider the report knows (#6751 A), in the sources' order: its windows with the
 * most recent current-seat observation leading (retired-only windows stay in the disclosure), or
 * none at all for a provider that reports no allowance.
 */
export function providerGroups(doc?: UsageDocument): ProviderGroup[] {
  if (!doc) return [];
  const views = providers(doc);
  const shares = new Map((providerRecords(doc) ?? []).map((row) => [row.driver, row.totals]));
  const credits = latestCredits(doc);
  const extra = (source: string) => ({
    usage: shares.get(source) ?? null,
    credits: source === CREDITS_DRIVER ? credits : null,
  });
  return providerSources(doc).flatMap((source): ProviderGroup[] => {
    const windows = views.filter((view) => view.source === source);
    if (!windows.length) {
      const note = allowanceNote(doc, source, false);
      return [
        {
          id: source,
          source,
          label: providerLabel(source),
          primary: undefined,
          other: [],
          windowless: note === noAllowance(source),
          note,
          ...extra(source),
        },
      ];
    }
    // One group per account only where the provider has several; views arrive newest first, so
    // the account seen most recently leads. One account, or none, is one group, as before.
    const several = new Set(windows.flatMap((view) => (view.accountKey ? [view.accountKey] : [])));
    const accounts =
      several.size > 1 ? [...new Set(windows.map((view) => view.accountKey))] : [undefined];
    return accounts.map((account) => {
      const own =
        account === undefined ? windows : windows.filter((view) => view.accountKey === account);
      const primary = own.find((view) => view.current);
      return {
        id: account === undefined ? source : `${source}-${account ?? 'unknown'}`,
        source,
        label: account === undefined ? providerLabel(source) : own[0]!.provider,
        primary,
        other: own.filter((view) => view !== primary),
        windowless: false,
        note: primary ? null : allowanceNote(doc, source, true),
        ...extra(source),
      };
    });
  });
}

/** Age against the owner's clock, never the browser's possibly different wall clock. */
export function observedAgo(observedAtMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - observedAtMs) / 60_000));
  return minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}

/** Days between two instants, for the page's "resets in" words. */
export function resetsIn(resetsAtMs: number, nowMs: number): string {
  const ms = resetsAtMs - nowMs;
  if (ms <= 0) return 'now';
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`;
  return `${Math.max(1, Math.floor(ms / HOUR))}h`;
}

/** Cached input as a share of input, in percent to one decimal; null without input. */
export function cachedRatio(totals: Pick<UsageTotals, 'input' | 'cached'>): number | null {
  return totals.input > 0 ? Math.round((totals.cached / totals.input) * 1000) / 10 : null;
}

const percentOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

const plus = (a: UsageTotals, b: UsageTotals): UsageTotals => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cached: a.cached + b.cached,
});
const NONE: UsageTotals = { input: 0, output: 0, cached: 0 };

/** A seat's tokens by model as Core attributed them, and what no model row covers. A seat Core
 * attributed none of (`byModel` null or absent) is all unattributed: no model is guessed. */
function attribution(seat: UsageSeat): { models: [string, UsageTotals][]; rest: UsageTotals } {
  if (!Array.isArray(seat.byModel)) return { models: [], rest: seat.totals };
  return {
    models: seat.byModel.map((row) => [
      row.modelId,
      { input: row.input, output: row.output, cached: row.cached },
    ]),
    rest: seat.unattributed ?? NONE,
  };
}

export interface ModelShare {
  model: string;
  totals: UsageTotals;
  tokens: number;
  /** Percent of every seat's tokens in the range, one decimal. */
  share: number;
  cachedRatio: number | null;
  /** Seats whose tokens include this model. */
  seats: number;
}

export interface ModelShares {
  /** Models by tokens, largest first (ties by id). */
  models: ModelShare[];
  /** Tokens Core attributed to no model, as their own remainder; null when there are none. */
  unattributed: (Omit<ModelShare, 'model' | 'seats'> & { seats: number }) | null;
  /** Cached input over all input, for every seat together. */
  cachedRatio: number | null;
  /** A seat lacks evidence for part of the range, so every figure is a lower bound. */
  partial: boolean;
}

/** #6751 C: token share by model over every seat, with the cached-input ratio. */
export function modelShares(doc: UsageDocument): ModelShares {
  const byModel = new Map<string, { totals: UsageTotals; seats: number }>();
  let rest = NONE;
  let restSeats = 0;
  let all = NONE;
  for (const seat of doc.usage.seats) {
    const { models, rest: own } = attribution(seat);
    for (const [model, totals] of models) {
      const row = byModel.get(model) ?? { totals: NONE, seats: 0 };
      byModel.set(model, { totals: plus(row.totals, totals), seats: row.seats + 1 });
    }
    if (tokensOf(own) > 0) {
      rest = plus(rest, own);
      restSeats++;
    }
    all = plus(all, seat.totals);
  }
  const whole = tokensOf(all);
  const shareOf = (totals: UsageTotals) => ({
    totals,
    tokens: tokensOf(totals),
    share: percentOf(tokensOf(totals), whole),
    cachedRatio: cachedRatio(totals),
  });
  return {
    models: [...byModel]
      .map(([model, row]) => ({ model, ...shareOf(row.totals), seats: row.seats }))
      .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model)),
    unattributed: tokensOf(rest) > 0 ? { ...shareOf(rest), seats: restSeats } : null,
    cachedRatio: cachedRatio(all),
    partial: doc.usage.seats.some((seat) => !seat.coverage.complete),
  };
}

/** Shares are based on the report's priced models, including any estimates marked as floors. */
export function modelCostShares(doc: UsageDocument, models: readonly ModelShare[]) {
  const quotes = modelQuotes(doc);
  const rows = models.map(({ model }) => ({ model, cost: quotes.get(model) ?? null }));
  const pricedTotal = rows.reduce((total, { cost }) => total + (cost?.usdMicros ?? 0), 0);
  const hasDenominator = Number.isSafeInteger(pricedTotal) && pricedTotal > 0;
  return {
    rows: new Map(
      rows.map(({ model, cost }) => [
        model,
        {
          cost,
          share: cost && hasDenominator ? percentOf(cost.usdMicros, pricedTotal) : null,
        },
      ]),
    ),
    excluded: rows.filter(({ cost }) => cost === null).map(({ model }) => model),
    hasFloors: rows.some(({ cost }) => cost?.lowerBound),
    hasDenominator,
  };
}

export interface SeatMix {
  id: string;
  name: string;
  tokens: number;
  /** Percent of every seat's tokens in the range, one decimal. */
  share: number;
  cachedRatio: number | null;
  costLabel: string;
  /** The seat's tokens by model, largest first, as percent of the seat's own tokens. */
  models: { model: string; share: number }[];
  /** Percent of the seat's tokens no model row covers; 0 when Core attributed them all. */
  unattributed: number;
  partial: boolean;
}

/** #6751 C: each seat's share of the range and its model mix, largest seat first. */
export function seatMix(doc: UsageDocument): SeatMix[] {
  const whole = doc.usage.seats.reduce((sum, seat) => sum + tokensOf(seat.totals), 0);
  return doc.usage.seats
    .map((seat) => {
      const tokens = tokensOf(seat.totals);
      const { models, rest } = attribution(seat);
      return {
        id: seat.id,
        name: seatName(seat),
        tokens,
        share: percentOf(tokens, whole),
        cachedRatio: cachedRatio(seat.totals),
        costLabel: seatCostLabel(seat, doc.pricing),
        models: models
          .map(([model, totals]) => ({ model, tokens: tokensOf(totals) }))
          .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
          .map(({ model, tokens: own }) => ({ model, share: percentOf(own, tokens) })),
        unattributed: percentOf(tokensOf(rest), tokens),
        partial: !seat.coverage.complete,
      };
    })
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));
}

export interface Trend {
  x: string[];
  startsMs: number[];
  /** Every seat's tokens in the bucket; null when no seat has a reading for it. */
  tokens: (number | null)[];
  cachedRatio: (number | null)[];
  /** The bucket is a lower bound: a seat's reading in it was incomplete. */
  partial: boolean[];
  /** The busiest bucket; null when no bucket has tokens. */
  peak: { at: string; tokens: number } | null;
}

/** Series buckets per range: hourly for a day, daily for longer. */
const BUCKETS: Record<UsageDocument['since'], number> = { '24h': 24, '7d': 7, '30d': 30 };

/** Every bucket's start in Core's window, so one that no seat has a reading for stays in place;
 * null without a window, or when a reading falls off its grid. */
function bucketStarts(doc: UsageDocument, observed: Iterable<number>): number[] | null {
  const window = doc.window;
  if (!window || !(window.toMs > window.fromMs)) return null;
  const step = (window.toMs - window.fromMs) / BUCKETS[doc.since];
  if (!Number.isSafeInteger(step)) return null;
  const starts = Array.from({ length: BUCKETS[doc.since] }, (_, at) => window.fromMs + at * step);
  const grid = new Set(starts);
  for (const at of observed) if (!grid.has(at)) return null;
  return starts;
}

/** #6751 E: all seats together per bucket: hourly for `24h`, daily for `7d` and `30d`. A bucket
 * of Core's window that no seat has a reading for is null, never 0; an older report without the
 * window has only the buckets some seat read. */
export function trend(doc: UsageDocument, zone?: string): Trend {
  const buckets = new Map<number, { totals: UsageTotals; partial: boolean }>();
  for (const seat of doc.usage.seats)
    for (const point of seat.series) {
      // Core lists every bucket: one with no tokens and no coverage was not read (#6751 E).
      if (point.coveredMs === 0 && tokensOf(point) === 0) continue;
      const bucket = buckets.get(point.fromMs) ?? { totals: NONE, partial: false };
      buckets.set(point.fromMs, {
        totals: plus(bucket.totals, point),
        partial: bucket.partial || !point.complete,
      });
    }
  const grid = bucketStarts(doc, buckets.keys());
  const startsMs = grid ?? [...buckets.keys()].sort((a, b) => a - b);
  const x = startsMs.map((at) => stamp(at, doc.since, zone));
  const read = (at: number) => buckets.get(at);
  const tokens = startsMs.map((at) => {
    const bucket = read(at);
    return bucket ? tokensOf(bucket.totals) : null;
  });
  let peak: Trend['peak'] = null;
  tokens.forEach((value, at) => {
    if (value !== null && value > 0 && (!peak || value > peak.tokens))
      peak = { at: x[at]!, tokens: value };
  });
  return {
    x,
    startsMs,
    tokens,
    cachedRatio: startsMs.map((at) => {
      const bucket = read(at);
      return bucket ? cachedRatio(bucket.totals) : null;
    }),
    partial: startsMs.map((at) => read(at)?.partial ?? false),
    peak,
  };
}

/** The recent pace looks back a day (ms), and needs six hours of samples (ms) to stand on. */
const RUNWAY_RECENT_MS = 86_400_000;
const RUNWAY_RECENT_MIN_MS = 21_600_000;

export interface Runway {
  /** `recent`: the last day of samples; `window`: the window's average since it began full. */
  basis: 'recent' | 'window';
  /** Percent of the allowance used per hour at that pace, never negative. */
  perHour: number;
  fromAtMs: number;
  fromLeft: number;
  resetsAtMs: number;
  /** Percent left at the reset at that pace, one decimal; 0 when it runs out first. */
  leftAtReset: number;
  /** When it reaches 0 before the reset at that pace; null when it lasts to the reset. */
  emptyAtMs: number | null;
}

/**
 * #6751 B: where a weekly window is headed from its sampled history. The pace is the change over
 * the last day of samples when they span six hours, else the window's average since its start
 * (every window starts full). Null without a sample inside the window before its reset.
 */
export function runway(history: LimitHistory, nowMs: number): Runway | null {
  const startsAtMs = history.resetsAtMs - history.windowMinutes * 60_000;
  const points = history.points
    .filter((point) => point.atMs <= nowMs && point.atMs < history.resetsAtMs)
    .filter((point) => point.atMs >= startsAtMs)
    .sort((a, b) => a.atMs - b.atMs);
  const last = points.at(-1);
  if (!last) return null;
  const recent = points.find((point) => point.atMs >= last.atMs - RUNWAY_RECENT_MS)!;
  let basis: Runway['basis'];
  let perMs: number;
  if (last.atMs - recent.atMs >= RUNWAY_RECENT_MIN_MS) {
    basis = 'recent';
    perMs = (recent.percentLeft - last.percentLeft) / (last.atMs - recent.atMs);
  } else if (last.atMs > startsAtMs) {
    basis = 'window';
    perMs = (100 - last.percentLeft) / (last.atMs - startsAtMs);
  } else return null;
  perMs = Math.max(0, perMs);
  const projected = last.percentLeft - perMs * (history.resetsAtMs - last.atMs);
  const emptyAtMs = projected < 0 ? Math.round(last.atMs + last.percentLeft / perMs) : null;
  return {
    basis,
    perHour: Math.round(perMs * HOUR * 100) / 100,
    fromAtMs: last.atMs,
    fromLeft: last.percentLeft,
    resetsAtMs: history.resetsAtMs,
    leftAtReset: emptyAtMs === null ? Math.round(projected * 10) / 10 : 0,
    emptyAtMs,
  };
}

/** The runway in words, against the owner's clock. */
export function runwayWords(projection: Runway, nowMs: number): string {
  const pace = projection.basis === 'recent' ? "the last day's pace" : "this window's average pace";
  if (projection.emptyAtMs !== null)
    return `At ${pace} it runs out in ${resetsIn(projection.emptyAtMs, nowMs)}, ${resetsIn(projection.resetsAtMs, projection.emptyAtMs)} before the reset.`;
  if (projection.perHour === 0)
    return `No use at ${pace}: ${Math.round(projection.fromLeft)}% left at the reset.`;
  return `At ${pace} about ${Math.round(projection.leftAtReset)}% is left at the reset.`;
}

/** A figure the report could not give: never shown as zero. */
export const UNKNOWN = 'Unknown';

/** A duration in ms as the page reads it: 45s, 2m 40s, 1h 5m. */
export function durationText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** Format the reported micro-dollars exactly so a floor never rounds up. */
export function usdText(micros: number): string {
  if (micros < 0) return `−${usdText(-micros)}`;
  const dollars = Math.floor(micros / 1_000_000).toLocaleString('en-US');
  const cents = String(micros % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `$${dollars}.${cents}`;
}

export function costEstimate({ usdMicros, lowerBound }: UsageCost): string {
  if (!lowerBound) return usdText(usdMicros);
  return usdMicros < 0
    ? `at least ${usdText(-usdMicros)} in added cost`
    : `at least ${usdText(usdMicros)}`;
}

const SEAT_COST_REASONS: Readonly<Record<string, string>> = {
  unattributed: 'Some tokens have no recorded model.',
  no_price: 'A model has no list price.',
  class_price_missing: 'A token type has no list price.',
  unsafe_cost: 'The cost exceeds the supported range.',
  pricing_unavailable: 'The list-price basis or version is unavailable.',
  cost_evidence_invalid: 'The report has no usable seat cost.',
};

function seatCostLabel(seat: UsageSeat, pricing: UsageDocument['pricing']): string {
  const { cost, reasons } = seatQuote(seat, pricing);
  if (cost) return costEstimate(cost);
  const detail = reasons.map((reason) =>
    Object.hasOwn(SEAT_COST_REASONS, reason)
      ? SEAT_COST_REASONS[reason]
      : 'The report could not estimate the cost.',
  );
  return `Cost unknown. ${[...new Set(detail)].join(' ')}`;
}

/** Why the report could not estimate the avoided cost, in plain words; an unknown reason as is. */
const COST_REASONS: Record<string, string> = {
  wake_turns_unavailable: 'TMT on your machine has no wake-up measurements yet',
  no_measured_turn: 'no wake-up was measured in this range',
  no_price: 'a model has no list price',
  unattributed: 'some tokens name no model',
  no_known_arrivals: 'no message is known to have arrived while its member was idle',
};

const figure = (value: number | null) => (value === null ? UNKNOWN : value.toLocaleString('en-US'));

export interface SavingsView {
  tiles: { label: string; value: string }[];
  /** Beside the cost: why it is unknown, or whose saved wake-ups it does not cover and why. */
  costNote: string | null;
  /** Member rows: name, messages, deliveries, measured, upper bound, median delay, coverage. */
  rows: string[][];
  /** Members with only part of the range or no coverage record: the figures are lower bounds. */
  coverageNote: string | null;
  /** The price table the estimate used. */
  pricing: string | null;
}

const reasonWords = (reason: string | null) =>
  reason ? (COST_REASONS[reason] ?? reason) : 'no estimate was reported';

/**
 * The avoided cost exactly as the report gives it (#6794): the sum over the members whose own
 * cost is known, with whom it covers and the models that had no price. A report that does not
 * list them comes from an older Digest whose total stretched a median over unpriced members, so
 * its cost is Unknown rather than shown.
 */
function avoidedCost(doc: SavingsDocument): { value: string; note: string | null } {
  const cost = doc.total.avoidedCost;
  if (!cost.covered || !cost.unpriced)
    return {
      value: UNKNOWN,
      note: 'Cost unknown: Digest on your machine does not say which members it covers. Upgrade TMT to see it.',
    };
  const models = [...new Set(cost.unpriced.flatMap((member) => member.models))].sort();
  const others = new Set(
    cost.unpriced
      .filter((member) => !member.models.length)
      .map((member) => reasonWords(member.reason ?? 'no_price')),
  );
  const why = [...(models.length ? [`no price for ${models.join(', ')}`] : []), ...others].join(
    '; ',
  );
  if (cost.usdMicros === null)
    return { value: UNKNOWN, note: `Cost unknown: ${why || reasonWords(cost.reason)}.` };
  if (!doc.pricing || cost.lowerBound === null)
    return {
      value: UNKNOWN,
      note: 'Cost unknown: this report does not identify a pricing v2 estimate.',
    };
  const members = cost.covered.length + cost.unpriced.length;
  return {
    value: costEstimate({ usdMicros: cost.usdMicros, lowerBound: cost.lowerBound }),
    note: cost.unpriced.length
      ? `Covers ${cost.covered.length} of ${members} members; ${why}.`
      : null,
  };
}

/** #6751 D: what the delivered digests saved, measured first; a null is Unknown, never 0. */
export function savingsView(doc: SavingsDocument): SavingsView {
  const total = doc.total;
  const partial = doc.members.filter((member) => member.complete === false).length;
  const none = doc.members.filter((member) => member.complete === null).length;
  const parts: string[] = [];
  if (partial)
    parts.push(
      `${partial} ${partial === 1 ? 'member covers' : 'members cover'} only part of this range`,
    );
  if (none) parts.push(`${none} ${none === 1 ? 'member has' : 'members have'} no coverage record`);
  const cost = avoidedCost(doc);
  const messages =
    total.messages === null || total.deliveries === null
      ? figure(total.messages)
      : `${figure(total.messages)} in ${figure(total.deliveries)}`;
  const byMessages = (a: SavingsDocument['members'][number], b: typeof a) =>
    (b.messages ?? -1) - (a.messages ?? -1) || (a.name ?? a.id).localeCompare(b.name ?? b.id);
  return {
    tiles: [
      { label: 'Wake-ups saved (measured)', value: figure(total.measuredSaved) },
      { label: 'Upper bound', value: figure(total.turnsSaved) },
      { label: 'Messages delivered', value: messages },
      { label: 'Avoided cost (list price estimate)', value: cost.value },
    ],
    costNote: cost.note,
    rows: [...doc.members]
      .sort(byMessages)
      .map((member) => [
        member.name ?? member.id.slice(0, 8),
        figure(member.messages),
        figure(member.deliveries),
        figure(member.measuredSaved),
        figure(member.turnsSaved),
        member.delay ? durationText(member.delay.median) : UNKNOWN,
        member.complete === null ? 'No record' : member.complete ? 'Whole range' : 'Partial',
      ]),
    coverageNote: parts.length ? `${parts.join('; ')}. Figures are lower bounds.` : null,
    pricing: doc.pricing
      ? `Estimate at list price, price table ${doc.pricing.version} (${doc.pricing.origin}).`
      : null,
  };
}

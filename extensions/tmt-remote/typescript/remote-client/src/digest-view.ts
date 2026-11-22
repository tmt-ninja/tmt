/**
 * The numbers the Digest page paints, derived from the public usage document. Pure: no DOM, no
 * clock, so every section is tested on plain data. A missing observation stays missing (`null`):
 * it is never turned into a zero here.
 */
import type { Layer, SeriesChartOptions } from '@tmt/browser-ui/chart';
import { isLimitAccount, providerRecords } from './digest-source.js';
import type { LimitWindow, UsageDocument, UsagePoint, UsageTotals } from './digest-source.js';

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
}

export function providers(doc: UsageDocument, zone?: string): ProviderView[] {
  const charts = new Map(historyCharts(doc, zone).map((chart) => [chart.series[0]!.key, chart]));
  const styles = providerStyles(doc);
  return allowance(doc).map((row) => ({
    ...row,
    style: styles.get(row.source) ?? 0,
    chart: charts.get(row.key),
  }));
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

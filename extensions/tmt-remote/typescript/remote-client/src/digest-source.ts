/**
 * What the Digest web view (`/digest/`) reads: the usage report the terminal Digest shows. The
 * types follow the public document of `tmt digest usage report --json` (digest `usage-v1.md`) and
 * the exchange flow of `tmt x flow --json`, and what Digest saved is `tmt digest decisions
 * --report --json` (digest `digest-v1.md`); the page depends only on `DigestSource`. The product
 * source reads the owner's browser reads (`x/-/digest/<range>`, `x/-/digest/savings/<range>` and
 * `x/-/limits`, contracts/remote-channel-v1.md); the seeded sample lives in `digest-mock.ts` for
 * tests, the gallery and dev only.
 */
import { ownerRead, type OwnerReadAnswer, type OwnerReadReason } from './owner-reads.js';

export const USAGE_RANGES = ['24h', '7d', '30d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export interface UsageTotals {
  input: number;
  output: number;
  /** Part of `input`, never added to it. */
  cached: number;
}

export interface UsagePoint extends UsageTotals {
  fromMs: number;
  toMs: number;
  /** False: the bucket is a lower bound, not an error. */
  complete: boolean;
}

export interface ModelUsage extends UsageTotals {
  modelId: string;
}

export interface UsageSeat {
  id: string;
  /** Null when Core could not resolve the name. */
  name: string | null;
  retired: boolean;
  totals: UsageTotals;
  /** The model families its tokens belong to (`claude`, `gpt`, `other`, `unattributed`). */
  lines: readonly string[];
  /** Core's attribution by model; null when Core attributed none of the total, absent on older
   * reports. The rows may sum to less than `totals`. */
  byModel?: readonly ModelUsage[] | null;
  /** What no model row covers, present only when `byModel` is not null and falls short. */
  unattributed?: UsageTotals;
  /** Hourly for 24h, daily for 7d and 30d, oldest first. */
  series: readonly UsagePoint[];
  coverage: {
    coveredMs: number;
    windowMs: number;
    startsAtMs: number | null;
    complete: boolean;
    gap: boolean;
  };
}

/** A recorded driver's share, independent of allowance windows and model families. */
export interface UsageProvider {
  driver: string;
  totals: UsageTotals;
  seats: readonly string[];
  partialSeats: number;
  inputCost: { usdMicros: number } | null;
  costUnavailable: readonly string[];
}

const safeCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isTotals(value: unknown): value is UsageTotals {
  const totals = value as Partial<UsageTotals> | null;
  return (
    !!totals &&
    safeCount(totals.input) &&
    safeCount(totals.output) &&
    safeCount(totals.cached) &&
    totals.cached <= totals.input &&
    Number.isSafeInteger(totals.input + totals.output)
  );
}

/** An older or malformed projection is unavailable, never verified empty. */
export function providerRecords(doc: UsageDocument): readonly UsageProvider[] | undefined {
  const rows: unknown = doc.usage.providers;
  if (!Array.isArray(rows)) return undefined;
  const seen = new Set<string>();
  const parsed: UsageProvider[] = [];
  const priced =
    doc.pricing?.basis === 'standard-base-input' &&
    typeof doc.pricing.version === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(doc.pricing.version);
  for (const value of rows) {
    const row = value as Partial<UsageProvider> | null;
    if (
      !row ||
      typeof row.driver !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.driver) ||
      seen.has(row.driver) ||
      !isTotals(row.totals) ||
      !Array.isArray(row.seats) ||
      !row.seats.every((id) => typeof id === 'string') ||
      !safeCount(row.partialSeats) ||
      row.partialSeats > row.seats.length
    )
      return undefined;
    seen.add(row.driver);
    const reasons = row.costUnavailable;
    const validReasons =
      Array.isArray(reasons) &&
      reasons.every((reason) => typeof reason === 'string' && /^[a-z_]{1,64}$/.test(reason));
    const validCost = validReasons && reasons.length === 0 && safeCount(row.inputCost?.usdMicros);
    const inputCost = priced && validCost ? { usdMicros: row.inputCost!.usdMicros } : null;
    const costUnavailable = inputCost
      ? []
      : row.inputCost === null && validReasons && reasons.length
        ? reasons
        : [validCost && !priced ? 'pricing_unavailable' : 'cost_evidence_invalid'];
    parsed.push({
      driver: row.driver,
      totals: row.totals,
      seats: row.seats,
      partialSeats: row.partialSeats,
      inputCost,
      costUnavailable,
    });
  }
  return parsed.filter((row) => row.totals.input + row.totals.output > 0);
}

export interface UsageUnavailable {
  id: string;
  name: string | null;
  retired: boolean;
  reason: string;
  /** Core's reason nothing is sampled, on a `no_evidence` row; a later host may add values. */
  cause?: string;
}

/** One bucket's credit balance, the newest observation among the seats (digest `usage-v1.md`). */
export interface CreditPoint {
  fromMs: number;
  toMs: number;
  /** The provider's decimal text in its credit unit. */
  balance: string;
  observedAtMs: number;
  hasCredits: boolean;
  unlimited: boolean;
  serviceTiers: readonly string[];
}

/**
 * Which of a provider's accounts a limit belongs to, as Core reports it in `rateLimits.account`
 * (#5274): an opaque grouping key, never shown, and a display label, shown as text.
 */
export interface LimitAccount {
  key: string;
  label: string;
}

const ACCOUNT_KEY = /^[0-9a-f]{12}$/;
const ACCOUNT_LABEL = /^[A-Za-z0-9._-]{1,32}$/;

/** The shape Core writes; anything else is no account, so it cannot fold into another's. */
export function isLimitAccount(value: unknown): value is LimitAccount {
  const account = value as Partial<LimitAccount> | null;
  return (
    typeof account?.key === 'string' &&
    ACCOUNT_KEY.test(account.key) &&
    typeof account.label === 'string' &&
    ACCOUNT_LABEL.test(account.label)
  );
}

/** An account window, newest observation wins; windows are never summed. */
export interface LimitWindow {
  /** The driver of the source line, as Core reports it; never inferred from a seat's models. */
  provider: string;
  /** Absent for a provider with one implicit account and for a Core that predates the field. */
  account?: LimitAccount;
  windowMinutes: number;
  resetsAtMs: number;
  usedPercent: number;
  observedAtMs: number;
  /** Null for a stale window. */
  elapsedPercent: number | null;
  paceDeltaPoints: number | null;
  stale: boolean;
  /** The seats that reported it. */
  seats: readonly string[];
}

export interface FlowParty {
  id: string | null;
  name: string | null;
  retired: boolean;
}

export interface FlowPair {
  sender: FlowParty;
  recipient: FlowParty;
  /** `talk`, `reply`, `ack`, `result`; the page counts talk and reply like the terminal. */
  kind: string;
  count: number;
}

/**
 * Percent left of a weekly window sampled over time, from `x/-/limits` (the board's local cache).
 * Without it the page shows the latest window only.
 */
export interface LimitHistory {
  provider: string;
  account?: LimitAccount;
  windowMinutes: number;
  resetsAtMs: number;
  points: readonly { atMs: number; percentLeft: number }[];
}

export interface UsageDocument {
  version: 1;
  observedAtMs: number;
  since: UsageRange;
  usage: {
    seats: readonly UsageSeat[];
    /** Absent on older report producers. */
    providers?: readonly UsageProvider[];
    providerUnattributed?: UsageTotals;
    unavailable: readonly UsageUnavailable[];
  };
  limits: readonly LimitWindow[];
  /** A line whose seats reported no limits, or an account Core knows without a current window. */
  limitsUnavailable: readonly { line?: string; provider?: string; reason: string }[];
  exchange: { sinceMs: number; observedAtMs: number; pairs: readonly FlowPair[] } | null;
  limitHistory?: readonly LimitHistory[];
  pricing?: { version: string; basis: string; origin: string };
  /** Codex's credit balance over the window; null when no seat observed one, absent on older reports. */
  credits?: { points: readonly CreditPoint[] } | null;
}

export interface AllowanceReport {
  /** Fixed weekly snapshot, independent of the selected usage range. */
  allowance?: UsageDocument;
  allowanceUnavailable?: string;
}

export interface DigestReport extends AllowanceReport {
  range: UsageRange;
  /** Whether this is sample data, not the owner's usage. */
  sample: boolean;
  /** Why the source cannot report; the page then shows only this. */
  unavailable?: string;
  document?: UsageDocument;
  /** What the delivered digests saved over the same range (#6751 D), read with the report. */
  savings?: SavingsReport;
}

export interface DigestSource {
  /** Range switches reuse this mount's allowance; the minute refresh requests a fresh read. */
  report(
    range: UsageRange,
    signal?: AbortSignal,
    refreshAllowance?: boolean,
  ): Promise<DigestReport>;
}

/** What `x/-/digest/<range>` answers: the usage report document, unchanged, under `report`. */
interface DigestPayload {
  since: UsageRange;
  report: UsageDocument;
}

/** What `x/-/limits` answers: the weekly samples the board keeps, as the terminal prints them. */
interface LimitsPayload {
  limitHistory: readonly {
    provider: string;
    /** Present only for an account Core named. */
    account?: LimitAccount;
    windowMinutes: number;
    /** `[observedAtMs, percentLeft, resetsAtMs]`, oldest first. */
    points: readonly (readonly [number, number, number])[];
  }[];
}

/** One plain sentence per reason, each saying what the person can do. */
const REASONS: Record<OwnerReadReason | 'no-session' | 'unreachable', string> = {
  not_installed:
    'Digest is not installed on your machine. Run `tmt extension install digest`, then reload this page.',
  core_unavailable: 'TMT on your machine did not answer. This page tries again shortly.',
  timeout: 'Your machine took too long to read usage. This page tries again shortly.',
  read_failed:
    'Your machine could not read usage. Run `tmt digest usage report` in a terminal to see it.',
  too_large:
    'The usage report is too large for the browser. Run `tmt digest usage report` in a terminal to see it.',
  not_sampled:
    'Your machine could not read usage. Run `tmt digest usage report` in a terminal to see it.',
  unknown:
    'Usage is not available right now. Run `tmt digest usage report` in a terminal to see it.',
  'no-session':
    'This browser has no owner session for your machine. Pair it from Remote to see your usage.',
  unreachable: 'Your machine did not answer. This page tries again shortly.',
};

/** Keep each reset's samples separate, including older windows still active this week. */
export function limitHistoryFrom(
  answer: OwnerReadAnswer<LimitsPayload>,
): readonly LimitHistory[] | undefined {
  if (answer.state !== 'ok') return undefined;
  const histories: unknown = answer.payload.limitHistory;
  if (!Array.isArray(histories)) return undefined;
  const isPoint = (point: unknown): point is readonly [number, number, number] =>
    Array.isArray(point) && point.length === 3 && point.every((value) => Number.isFinite(value));
  return histories.flatMap((entry: unknown) => {
    const history = entry as Partial<LimitsPayload['limitHistory'][number]> | null;
    if (
      typeof history?.provider !== 'string' ||
      !Number.isFinite(history.windowMinutes) ||
      !Array.isArray(history.points) ||
      (history.account != null && !isLimitAccount(history.account))
    )
      return [];
    const groups = new Map<number, { atMs: number; percentLeft: number }[]>();
    for (const [atMs, percentLeft, reset] of history.points.filter(isPoint)) {
      const points = groups.get(reset) ?? [];
      points.push({ atMs, percentLeft });
      groups.set(reset, points);
    }
    return [...groups].map(([resetsAtMs, points]) => ({
      provider: history.provider!,
      ...(history.account ? { account: history.account } : {}),
      windowMinutes: history.windowMinutes as number,
      resetsAtMs,
      points: points.sort((a, b) => a.atMs - b.atMs),
    }));
  });
}

/** A failed weekly read stays explicit; the selected usage range is never its fallback. */
export function allowanceFromAnswers(
  weekly: OwnerReadAnswer<DigestPayload>,
  limits: OwnerReadAnswer<LimitsPayload>,
): AllowanceReport {
  if (
    weekly.state !== 'ok' ||
    weekly.payload.since !== '7d' ||
    weekly.payload.report?.since !== '7d'
  )
    return { allowanceUnavailable: 'Allowance could not be read. This page tries again shortly.' };
  const limitHistory = limitHistoryFrom(limits);
  return { allowance: { ...weekly.payload.report, ...(limitHistory ? { limitHistory } : {}) } };
}

/** Selected usage and independently acquired allowance through the existing owner reads. */
export function reportFromAnswers(
  range: UsageRange,
  digest: OwnerReadAnswer<DigestPayload>,
  allowance: AllowanceReport,
): DigestReport {
  if (digest.state !== 'ok') {
    const reason = digest.state === 'unavailable' ? digest.reason : digest.state;
    return { range, sample: false, ...allowance, unavailable: REASONS[reason] };
  }
  const document = digest.payload.report;
  if (digest.payload.since !== range || document?.since !== range)
    return { range, sample: false, ...allowance, unavailable: REASONS.unknown };
  return { range, sample: false, document, ...allowance };
}

/** One source per mount: range switches share even an in-flight weekly read, never global state. */
export function createDigestSource(): DigestSource {
  let weekly: Promise<OwnerReadAnswer<DigestPayload>> | undefined;
  let allowance: Promise<AllowanceReport> | undefined;
  return {
    async report(range, signal = new AbortController().signal, refreshAllowance = false) {
      if (refreshAllowance) {
        weekly = undefined;
        allowance = undefined;
      }
      const selected =
        range === '7d' && weekly ? weekly : ownerRead<DigestPayload>(`digest/${range}`, signal);
      // What Digest saved follows the selected range: every switch and refresh reads it again.
      const savings = readSavings(range, signal);
      if (!allowance) {
        weekly = range === '7d' ? selected : ownerRead<DigestPayload>('digest/7d', signal);
        allowance = Promise.all([weekly, ownerRead<LimitsPayload>('limits', signal)]).then(
          ([weekly, limits]) => allowanceFromAnswers(weekly, limits),
        );
      }
      const [digest, snapshot, saved] = await Promise.all([selected, allowance, savings]);
      return { ...reportFromAnswers(range, digest, snapshot), savings: saved };
    },
  };
}

/** A count the delivery report names: a safe whole number from zero, else unknown (null); a value
 * is never coerced, and a null stays null (#6752). */
const count = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
/** `measuredSaved` may be negative (Digest added wake-ups), so it is any safe whole number. */
const whole = (value: unknown): number | null =>
  Number.isSafeInteger(value) ? (value as number) : null;
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** One row of `digest decisions --report` (digest `digest-v1.md`, Delivery report), as read. */
export interface SavingsFigures {
  messages: number | null;
  deliveries: number | null;
  /** Upper bound: every held message counted as its own wake-up. */
  turnsSaved: number | null;
  /** Measured: idle arrivals less their checklists' deliveries; null when none qualifies. */
  measuredSaved: number | null;
  /** Arrival to delivery, in ms; null when any of the three is unknown. */
  delay: { median: number; p90: number; max: number } | null;
  /** An estimate; `usdMicros` null with the report's reason when nothing could be priced. */
  avoidedCost: SavingsCost;
}

/**
 * The avoided cost as the report gives it (#6794): a member's only when every measured wake-up
 * had a price; the total the sum over `covered`, with every other member with a saving in
 * `unpriced` and no cost. A negative figure is Digest adding wake-ups. `covered` and `unpriced`
 * are null on a member's row and on a total from a Digest that does not list them.
 */
export interface SavingsCost {
  usdMicros: number | null;
  reason: string | null;
  covered: { id: string; measuredSaved: number | null; usdMicros: number | null }[] | null;
  unpriced:
    | { id: string; measuredSaved: number | null; models: string[]; reason: string | null }[]
    | null;
}

export interface SavingsMember extends SavingsFigures {
  id: string;
  /** Plain text for display; null when the roster could not name it. */
  name: string | null;
  /** The member's evidence covers the whole range; null without a coverage row. */
  complete: boolean | null;
}

export interface SavingsDocument {
  since: UsageRange;
  members: SavingsMember[];
  total: SavingsFigures;
  /** The price table the estimate used; null when the report names none. */
  pricing: { version: string; asOf: string; origin: string } | null;
}

export interface SavingsReport {
  range: UsageRange;
  document?: SavingsDocument;
  /** Why it cannot be shown, in words the person can act on. */
  unavailable?: string;
}

function savingsFigures(row: Record<string, unknown>): SavingsFigures {
  const actual = record(row.actual);
  const delay = record(actual.delayMs);
  const median = count(delay.median);
  const p90 = count(delay.p90);
  const max = count(delay.max);
  const cost = record(row.avoidedCost);
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const rows = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map(record)
          .filter(
            (entry): entry is Record<string, unknown> & { id: string } =>
              typeof entry.id === 'string',
          )
      : null;
  return {
    messages: count(row.messages),
    deliveries: count(actual.deliveries),
    turnsSaved: whole(row.turnsSaved),
    measuredSaved: whole(row.measuredSaved),
    delay: median !== null && p90 !== null && max !== null ? { median, p90, max } : null,
    avoidedCost: {
      usdMicros: whole(cost.usdMicros),
      reason: text(cost.reason),
      covered:
        rows(cost.covered)?.map((entry) => ({
          id: entry.id,
          measuredSaved: whole(entry.measuredSaved),
          usdMicros: whole(entry.usdMicros),
        })) ?? null,
      unpriced:
        rows(cost.unpriced)?.map((entry) => ({
          id: entry.id,
          measuredSaved: whole(entry.measuredSaved),
          models: Array.isArray(entry.models)
            ? entry.models.filter((model): model is string => typeof model === 'string')
            : [],
          reason: text(entry.reason),
        })) ?? null,
    },
  };
}

const SAVINGS_REASONS: Record<OwnerReadReason | 'no-session' | 'unreachable', string> = {
  not_installed:
    'Digest is not installed on your machine. Run `tmt extension install digest`, then reload this page.',
  core_unavailable: 'TMT on your machine did not answer. This page tries again shortly.',
  timeout: 'Your machine took too long to read what Digest saved. This page tries again shortly.',
  read_failed:
    'Your machine could not read what Digest saved. Run `tmt digest decisions --report` in a terminal to see it.',
  too_large:
    'The savings report is too large for the browser. Run `tmt digest decisions --report` in a terminal to see it.',
  not_sampled:
    'Your machine could not read what Digest saved. Run `tmt digest decisions --report` in a terminal to see it.',
  unknown:
    'What Digest saved is not available right now. Run `tmt digest decisions --report` in a terminal to see it.',
  'no-session':
    'This browser has no owner session for your machine. Pair it from Remote to see what Digest saved.',
  unreachable: 'Your machine did not answer. This page tries again shortly.',
};

/** What `x/-/digest/savings/<range>` answers, read to the figures the page shows (#6751 D). */
export function savingsFromAnswer(
  range: UsageRange,
  answer: OwnerReadAnswer<{ since?: unknown; report?: unknown }>,
): SavingsReport {
  if (answer.state !== 'ok') {
    const reason = answer.state === 'unavailable' ? answer.reason : answer.state;
    return { range, unavailable: SAVINGS_REASONS[reason] ?? SAVINGS_REASONS.unknown };
  }
  const report = record(answer.payload.report);
  if (answer.payload.since !== range || report.since !== range || !Array.isArray(report.members))
    return { range, unavailable: SAVINGS_REASONS.unknown };
  const pricing = record(record(report.wakeMethod).pricing);
  return {
    range,
    document: {
      since: range,
      members: report.members.flatMap((entry: unknown) => {
        const row = record(entry);
        if (typeof row.id !== 'string') return [];
        const coverage = row.coverage === null ? null : record(row.coverage);
        return [
          {
            id: row.id,
            name: typeof row.name === 'string' ? row.name : null,
            complete: coverage && typeof coverage.complete === 'boolean' ? coverage.complete : null,
            ...savingsFigures(row),
          },
        ];
      }),
      total: savingsFigures(record(report.total)),
      pricing:
        typeof pricing.version === 'string' &&
        typeof pricing.asOf === 'string' &&
        typeof pricing.origin === 'string'
          ? { version: pricing.version, asOf: pricing.asOf, origin: pricing.origin }
          : null,
    },
  };
}

/** One read of what Digest saved over `range`; the page's refresh owns the cadence. */
export async function readSavings(range: UsageRange, signal: AbortSignal): Promise<SavingsReport> {
  return savingsFromAnswer(range, await ownerRead(`digest/savings/${range}`, signal));
}

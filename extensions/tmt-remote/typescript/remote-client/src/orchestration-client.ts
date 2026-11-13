/** Owner-browser orchestration through one verified Session (#4894): Core's own read views and its
 * preview-then-apply writes, passed through the door unchanged. Decoding keeps only what the page
 * draws; an older Core without the `talks` or `routes` views reads as not available. */
import type { Session } from './device.js';
import { verifiedSessionRequest } from './operations.js';

export type Json = Record<string, unknown>;
export interface OrchestrationApi {
  read(input: Json): Promise<Json>;
  write(input: Json): Promise<Json>;
}
/** Core's own refusal of an orchestration call, relayed by the door as `{refused}`. */
export class OrchestrationRefused extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ?? `Orchestration refused: ${code}.`);
    this.name = 'OrchestrationRefused';
  }
}
const object = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Orchestration answered with an unreadable document.');
  return value as Json;
};
export function orchestrationApi(
  session: Session,
  options: { timeoutMs?: number } = {},
): OrchestrationApi {
  const call = verifiedSessionRequest(session, options);
  const parse = (value: unknown): Json => {
    const answer = object(value);
    if (answer.refused && typeof answer.refused === 'object') {
      const refused = answer.refused as Json;
      throw new OrchestrationRefused(
        typeof refused.code === 'string' ? refused.code : 'ORCH_REFUSED',
        typeof refused.message === 'string' ? refused.message : undefined,
      );
    }
    return answer;
  };
  const ask = (operation: string, input: Json) =>
    call(operation, crypto.randomUUID(), { version: 1, operation, input }, parse);
  return {
    read: (input) => ask('orchestration.read', input),
    write: (input) => ask('orchestration.write', input),
  };
}

export interface Source {
  kind: string;
  planId: string | null;
}
export interface Field {
  value: unknown;
  source: Source | null;
}
export interface Member {
  identityId: string;
  name: string;
  fields: Record<'state' | 'receiving' | 'sending' | 'routine' | 'talkLimit', Field>;
  /** Core's plans in effect for this member at the selected time, highest first. */
  activePlans: string[];
  nextChangeAtMs: number | null;
}
export type Target =
  | { kind: 'all' }
  | { kind: 'identity'; id: string }
  | { kind: 'pattern'; pattern: string };
export type Schedule =
  | { kind: 'always' }
  | { kind: 'once'; startMs: number; endMs: number }
  | {
      kind: 'weekly';
      intervalWeeks: number;
      /** ISO weekdays, Monday 1 to Sunday 7. */
      weekdays: number[];
      start: string;
      end: string;
      allDay: boolean;
    };
export interface Plan {
  /** The admitted Core document, retained intact for a future enabled-only preview. */
  raw: Json;
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  targets: Target[];
  schedule: Schedule;
}
export interface Overview {
  configurationRevision: number;
  atMs: number;
  timeZone: string;
  range: { startMs: number; endMs: number };
  /** The plan the timeline is narrowed to, or null for every plan. */
  selectedPlanId: string | null;
  plans: Plan[];
  members: Member[];
  timeline: { startMs: number; endMs: number; planIds: string[] }[];
}
export type Verdict = 'allowed' | 'blocked' | 'needs_person';
export interface Route {
  verdict: Verdict;
  source: Source & { grantUntilMs?: number };
}
export interface TalkPair {
  ids: [string, string];
  names: [string, string];
  count: number;
  limit: number | null;
  held: boolean;
  heldCount: number;
}
/** What Core reports about sending: route verdicts keyed `from>to`, and this hour's pairs. `null`
 * means this Core has no such view. */
export interface Sending {
  routes: Map<string, Route> | null;
  talks: TalkPair[] | null;
  truncated: boolean;
}

const safe = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown): value is string => typeof value === 'string';
function source(value: unknown): Source | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Json;
  return text(row.kind) ? { kind: row.kind, planId: text(row.planId) ? row.planId : null } : null;
}
function target(value: unknown): Target | null {
  const row = value && typeof value === 'object' ? (value as Json) : {};
  if (row.kind === 'all') return { kind: 'all' };
  if (row.kind === 'identity' && text(row.id)) return { kind: 'identity', id: row.id };
  if (row.kind === 'pattern' && text(row.pattern)) return { kind: 'pattern', pattern: row.pattern };
  return null;
}
const weekday = (day: unknown): day is number => safe(day) && day >= 1 && day <= 7;
function schedule(value: unknown): Schedule | null {
  const row = value && typeof value === 'object' ? (value as Json) : {};
  if (row.kind === 'always') return { kind: 'always' };
  if (row.kind === 'once' && safe(row.startMs) && safe(row.endMs))
    return { kind: 'once', startMs: row.startMs, endMs: row.endMs };
  if (
    row.kind === 'weekly' &&
    safe(row.intervalWeeks) &&
    Array.isArray(row.weekdays) &&
    row.weekdays.every(weekday) &&
    text(row.start) &&
    text(row.end)
  )
    return {
      kind: 'weekly',
      intervalWeeks: row.intervalWeeks,
      weekdays: row.weekdays as number[],
      start: row.start,
      end: row.end,
      allDay: row.allDay === true,
    };
  return null;
}
/** The overview the page draws, or a TypeError for a document it cannot read. */
export function decodeOverview(value: Json): Overview {
  const range = object(value.range);
  const members = Array.isArray(value.members) ? value.members : [];
  const plans = Array.isArray(value.plans) ? value.plans : [];
  const timeline = Array.isArray(value.timeline) ? value.timeline : [];
  if (
    !safe(value.configurationRevision) ||
    !safe(value.atMs) ||
    !text(value.timeZone) ||
    !safe(range.startMs) ||
    !safe(range.endMs)
  )
    throw new TypeError('Orchestration answered with an unreadable overview.');
  return {
    configurationRevision: value.configurationRevision,
    atMs: value.atMs,
    timeZone: value.timeZone,
    range: { startMs: range.startMs, endMs: range.endMs },
    selectedPlanId: text(value.selectedPlanId) ? value.selectedPlanId : null,
    // A plan the page cannot read whole is left out, never drawn with guessed values.
    plans: plans.flatMap((plan) => {
      const row = object(plan);
      const targets = Array.isArray(row.targets) ? row.targets.map(target) : [null];
      const rule = schedule(row.schedule);
      if (
        !text(row.id) ||
        !text(row.name) ||
        !Number.isSafeInteger(row.priority) ||
        typeof row.enabled !== 'boolean' ||
        targets.includes(null) ||
        !rule
      )
        return [];
      return [
        {
          raw: structuredClone(row),
          id: row.id,
          name: row.name,
          priority: Number(row.priority),
          enabled: row.enabled,
          targets: targets as Target[],
          schedule: rule,
        },
      ];
    }),
    members: members.map((member) => {
      const row = object(member);
      const effective = object(row.effective);
      const field = (name: string): Field => {
        const entry =
          effective[name] && typeof effective[name] === 'object' ? (effective[name] as Json) : {};
        return { value: entry.value ?? null, source: source(entry.source) };
      };
      if (!text(row.identityId) || !text(row.name))
        throw new TypeError('Orchestration answered with an unreadable member.');
      return {
        identityId: row.identityId,
        name: row.name,
        fields: {
          state: field('state'),
          receiving: field('receiving'),
          sending: field('sending'),
          routine: field('routine'),
          talkLimit: field('talkLimit'),
        },
        activePlans: Array.isArray(row.activePlans) ? row.activePlans.filter(text) : [],
        nextChangeAtMs: safe(row.nextChangeAtMs) ? row.nextChangeAtMs : null,
      };
    }),
    timeline: timeline.flatMap((interval) => {
      const row = object(interval);
      return safe(row.startMs) && safe(row.endMs) && Array.isArray(row.planIds)
        ? [{ startMs: row.startMs, endMs: row.endMs, planIds: row.planIds.filter(text) }]
        : [];
    }),
  };
}
const VERDICTS: readonly Verdict[] = ['allowed', 'blocked', 'needs_person'];
export function decodeRoutes(rows: unknown[]): Map<string, Route> {
  const routes = new Map<string, Route>();
  for (const value of rows) {
    const row = object(value);
    const routeSource = source(row.source);
    if (
      !text(row.from) ||
      !text(row.to) ||
      !VERDICTS.includes(row.verdict as Verdict) ||
      !routeSource
    )
      continue;
    const grant = object(row.source).grantUntilMs;
    routes.set(`${row.from}>${row.to}`, {
      verdict: row.verdict as Verdict,
      source: { ...routeSource, ...(safe(grant) ? { grantUntilMs: grant } : {}) },
    });
  }
  return routes;
}
export function decodeTalks(rows: unknown[]): TalkPair[] {
  return rows.flatMap((value) => {
    const row = object(value);
    const members = Array.isArray(row.members) ? row.members.map(object) : [];
    const [a, b] = members;
    if (!a || !b || !text(a.identityId) || !text(b.identityId) || !safe(row.count)) return [];
    return [
      {
        ids: [a.identityId, b.identityId],
        names: [text(a.name) ? a.name : a.identityId, text(b.name) ? b.name : b.identityId],
        count: row.count,
        limit: safe(row.limit) ? row.limit : null,
        held: row.state === 'held',
        heldCount: safe(row.heldCount) ? row.heldCount : 0,
      },
    ];
  });
}

/** Core refuses a view it does not know; the page reads that as not available. */
const unknownView = (error: unknown) =>
  error instanceof OrchestrationRefused && error.code === 'ORCH_INPUT_INVALID';
export const ROUTES_PAGE = 256;
export const ROUTES_PAGES = 32;
/** Every routes page Core offers (at most 32), then this hour's talk pairs. */
export async function readSending(api: OrchestrationApi, memberQuery?: string): Promise<Sending> {
  const query = memberQuery ? { memberQuery } : {};
  let routes: Map<string, Route> | null = new Map();
  let truncated = false;
  let after: unknown = undefined;
  for (let page = 0; page < ROUTES_PAGES; page += 1) {
    let answer: Json;
    try {
      answer = await api.read({
        view: 'routes',
        limit: ROUTES_PAGE,
        ...query,
        ...(after === undefined ? {} : { after }),
      });
    } catch (error) {
      if (page === 0 && unknownView(error)) {
        routes = null;
        break;
      }
      if (error instanceof OrchestrationRefused && error.code === 'ORCH_LIMIT') {
        truncated = true;
        break;
      }
      throw error;
    }
    for (const [key, route] of decodeRoutes(Array.isArray(answer.routes) ? answer.routes : []))
      routes.set(key, route);
    after = answer.nextAfter ?? undefined;
    if (after === undefined) break;
    if (page === ROUTES_PAGES - 1) truncated = true;
  }
  let talks: TalkPair[] | null;
  try {
    const answer = await api.read({ view: 'talks', limit: ROUTES_PAGE, ...query });
    talks = decodeTalks(Array.isArray(answer.pairs) ? answer.pairs : []);
  } catch (error) {
    if (!unknownView(error)) throw error;
    talks = null;
  }
  return { routes, talks, truncated };
}

export type JobState = 'on' | 'held' | 'paused' | 'no_owner';
export interface Job {
  id: string;
  displayId: string;
  title: string;
  /** Core's schedule in short words: `every 1h`, `daily 23:30`, or the cron expression. */
  schedule: string;
  state: JobState;
  nextRunAtMs: number | null;
}
const JOB_STATES: readonly JobState[] = ['on', 'held', 'paused', 'no_owner'];
function jobSchedule(value: unknown): string {
  const row = value && typeof value === 'object' ? (value as Json) : {};
  if (row.kind === 'every' && safe(row.seconds)) {
    const minutes = Math.round(row.seconds / 60);
    return minutes % 60 === 0 ? `every ${minutes / 60}h` : `every ${minutes} min`;
  }
  if (row.kind === 'at' && text(row.at))
    return text(row.on) ? `${row.on} ${row.at}` : `daily ${row.at}`;
  if (row.kind === 'cron' && text(row.expression)) return row.expression;
  return '—';
}
export function decodeJobs(rows: unknown[]): Job[] {
  return rows.flatMap((value) => {
    const row = object(value);
    if (!text(row.jobId) || !JOB_STATES.includes(row.state as JobState)) return [];
    const displayId = text(row.displayId) ? row.displayId : row.jobId;
    return [
      {
        id: row.jobId,
        displayId,
        title:
          text(row.title) && row.title
            ? row.title
            : text(row.messagePreview)
              ? row.messagePreview
              : displayId,
        schedule: jobSchedule(row.schedule),
        state: row.state as JobState,
        nextRunAtMs: safe(row.nextRunAtMs) ? row.nextRunAtMs : null,
      },
    ];
  });
}
export const JOBS_PAGE = 50;
/** One member's jobs, first page only (`more` when Core has another). */
export async function readJobs(
  api: OrchestrationApi,
  ownerIdentityId: string,
): Promise<{ jobs: Job[]; more: boolean }> {
  const answer = await api.read({ view: 'jobs', ownerIdentityId, limit: JOBS_PAGE });
  return {
    jobs: decodeJobs(Array.isArray(answer.jobs) ? answer.jobs : []),
    more: text(answer.nextCursor),
  };
}

/** The confirm dialog's lines for a preview: Core's own effect, never a local guess. */
export function previewLines(preview: Json, name: (id: string) => string): string[] {
  const lines: string[] = [];
  const mutation = object(preview.mutation ?? {});
  if (mutation.kind === 'talks.resume') {
    const releases = safe(preview.releases) ? preview.releases : 0;
    const held = Array.isArray(preview.held) ? preview.held.length : 0;
    lines.push(`Releases ${releases} of ${held} held messages.`);
    if (releases < held) lines.push('Expired held messages stay unsent.');
    lines.push("They go out through normal delivery; the pair's hour restarts.");
  } else {
    const changes = Array.isArray(preview.changes) ? preview.changes.map(object) : [];
    if (!changes.length) lines.push("No member's effective policy changes at this time.");
    for (const change of changes.slice(0, 8)) {
      const fields = Array.isArray(change.fields) ? change.fields.filter(text) : [];
      lines.push(
        `${name(text(change.identityId) ? change.identityId : '?')} · ${fields.join(', ')}`,
      );
    }
    if (changes.length > 8) lines.push(`… and ${changes.length - 8} more members`);
  }
  lines.push('Running work is never interrupted.');
  return lines;
}
/** Apply exactly the preview the person confirmed. */
export function applyInput(preview: Json): Json {
  return {
    phase: 'apply',
    mutation: preview.mutation,
    expectedConfigurationRevision: preview.configurationRevision,
    previewAtMs: preview.previewAtMs,
    previewDigest: preview.previewDigest,
    consent: true,
  };
}
/** Short receiving words for a matrix cell. */
export function receivingCell(value: unknown): string {
  if (!value || typeof value !== 'object') return '·';
  const row = value as Json;
  switch (row.mode) {
    case 'direct':
      return 'Direct';
    case 'auto':
      return 'Auto';
    case 'urgent':
      return 'Urgent';
    case 'hold':
      return 'Hold';
    case 'batch':
      return safe(row.intervalMs) ? `B${Math.round(row.intervalMs / 60000)}` : 'Batch';
    default:
      return text(row.mode) ? row.mode : '·';
  }
}

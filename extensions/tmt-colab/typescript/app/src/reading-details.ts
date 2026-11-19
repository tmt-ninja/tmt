import { exactKeys, requireValue } from '@tmt/colab-client';
import {
  activity,
  pageProgress,
  sectionSummaries,
  type SectionSummary,
  type PageActivity,
  type PageProgress,
  type PageState,
} from './bootstrap.js';
import { validReadingId } from './reading-link.js';
import { jsonResponse } from './registration.js';

export const READING_DETAILS_BYTES = 192 * 1024;
export const READING_DETAILS_PAGES = 20;
export const NEEDS_PASSAGES = 20;
export const LATEST_POINTS = 160;

export interface WorkFactView {
  asOfMs: number;
  lastActivityAtMs?: number | null;
  state:
    | 'done'
    | 'blocked'
    | 'needs-you'
    | 'waiting-ci'
    | 'waiting-release'
    | 'working'
    | 'possibly-stalled'
    | 'discussing'
    | 'unknown';
  known: boolean;
  titleDiscovery?: {
    state: 'unconfigured' | 'unknown' | 'partial' | 'complete';
    number: string;
    explicitCount: number;
    ignored: string[];
  };
  pulls: {
    url: string;
    fact: {
      state: 'open' | 'merged' | 'closed';
      checks: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;
      released: boolean | null;
      tag: string | null;
      observedAtMs: number;
    } | null;
  }[];
  activity: {
    state: 'unknown' | 'working' | 'idle' | 'waiting' | 'ended';
    lastActivityMs: number | null;
    observedAtMs: number;
  } | null;
  /** The page's counted sections, decided with the facts this read used (#6619). */
  sections?: SectionSummary[];
  sectionsOmitted?: true;
}
/** Owner-only, bounded derived observations. No GitHub response or page markup is trusted. */
export interface WorkFactOptions {
  blockId?: string;
  exclusion?: { url: string; ignore: boolean };
}
export async function readWorkFacts(
  mount: URL,
  pageId: string,
  signal?: AbortSignal,
  options?: WorkFactOptions,
): Promise<WorkFactView> {
  requireValue(validReadingId(pageId));
  const response = await fetch(new URL('api/work-facts', mount), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pageId, ...options }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]),
  });
  const value = await jsonResponse(response, READING_DETAILS_BYTES);
  exactKeys(value, [
    'pageId',
    'known',
    'pulls',
    'state',
    'activity',
    'asOfMs',
    ...(value && typeof value === 'object' && 'lastActivityAtMs' in value
      ? ['lastActivityAtMs']
      : []),
    ...(value && typeof value === 'object' && 'titleDiscovery' in value ? ['titleDiscovery'] : []),
    ...(value && typeof value === 'object' && 'sections' in value ? ['sections'] : []),
    ...(value && typeof value === 'object' && 'sectionsOmitted' in value
      ? ['sectionsOmitted']
      : []),
  ]);
  if ('sections' in value) sectionSummaries(value.sections);
  if ('sectionsOmitted' in value) requireValue(value.sectionsOmitted === true);
  if ('lastActivityAtMs' in value)
    requireValue(
      value.lastActivityAtMs === null ||
        (Number.isSafeInteger(value.lastActivityAtMs) && Number(value.lastActivityAtMs) >= 0),
    );
  requireValue(Number.isSafeInteger(value.asOfMs) && Number(value.asOfMs) >= 0);
  requireValue(
    value.pageId === pageId &&
      typeof value.known === 'boolean' &&
      Array.isArray(value.pulls) &&
      value.pulls.length <= 20,
  );
  requireValue(
    [
      'done',
      'blocked',
      'needs-you',
      'waiting-ci',
      'waiting-release',
      'working',
      'possibly-stalled',
      'discussing',
      'unknown',
    ].includes(value.state as string),
  );
  if ('titleDiscovery' in value) {
    const title = value.titleDiscovery;
    exactKeys(title, ['state', 'number', 'explicitCount', 'ignored']);
    requireValue(
      Array.isArray(title.ignored) &&
        title.ignored.length <= 20 &&
        title.ignored.every(
          (url) =>
            typeof url === 'string' &&
            /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(
              url,
            ),
        ),
    );
    requireValue(
      ['unconfigured', 'unknown', 'partial', 'complete'].includes(String(title.state)) &&
        typeof title.number === 'string' &&
        /^[A-Za-z0-9_-]{1,64}$/.test(title.number) &&
        Number.isSafeInteger(title.explicitCount) &&
        Number(title.explicitCount) >= 0 &&
        Number(title.explicitCount) <= value.pulls.length,
    );
  }
  for (const item of value.pulls) {
    exactKeys(item, ['url', 'fact']);
    requireValue(
      typeof item.url === 'string' &&
        /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(
          item.url,
        ),
    );
    if (item.fact !== null) {
      exactKeys(item.fact, ['state', 'checks', 'released', 'tag', 'observedAtMs']);
      requireValue(['open', 'merged', 'closed'].includes(item.fact.state as string));
      requireValue(
        item.fact.checks === null ||
          ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'EXPECTED'].includes(
            item.fact.checks as string,
          ),
      );
      requireValue(item.fact.released === null || typeof item.fact.released === 'boolean');
      requireValue(
        item.fact.tag === null ||
          (typeof item.fact.tag === 'string' &&
            item.fact.tag.length <= 256 &&
            !/\p{Cc}/u.test(item.fact.tag)),
      );
      requireValue(
        Number.isSafeInteger(item.fact.observedAtMs) && Number(item.fact.observedAtMs) >= 0,
      );
    }
  }
  if (value.activity !== null) {
    exactKeys(value.activity, ['state', 'lastActivityMs', 'observedAtMs']);
    requireValue(
      ['unknown', 'working', 'idle', 'waiting', 'ended'].includes(value.activity.state as string),
    );
    requireValue(
      value.activity.lastActivityMs === null ||
        (Number.isSafeInteger(value.activity.lastActivityMs) &&
          Number(value.activity.lastActivityMs) >= 0),
    );
    requireValue(
      Number.isSafeInteger(value.activity.observedAtMs) && Number(value.activity.observedAtMs) >= 0,
    );
  }
  return value as unknown as WorkFactView;
}

/** Owner-local labels for an admitted set of to-do blocks; a missing label is never invented. */
export async function readWorkNumbers(
  mount: URL,
  pageId: string,
  blocks: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  requireValue(validReadingId(pageId) && blocks.length <= 2048 && blocks.every(validReadingId));
  const response = await fetch(new URL('api/work-numbers', mount), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pageId, blocks }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
  });
  const value = await jsonResponse(response, READING_DETAILS_BYTES);
  exactKeys(value, ['pageId', 'numbers']);
  requireValue(
    value.pageId === pageId &&
      value.numbers !== null &&
      typeof value.numbers === 'object' &&
      !Array.isArray(value.numbers),
  );
  const allowed = new Set(blocks);
  const result: Record<string, string> = {};
  for (const [id, number] of Object.entries(value.numbers)) {
    requireValue(
      allowed.has(id) && typeof number === 'string' && /^[A-Z]{1,6}-[1-9][0-9]{0,18}$/.test(number),
    );
    result[id] = number;
  }
  return result;
}
export interface ReadingDescriptor {
  id: string;
  title: string;
  agent: string;
  why: string;
  state: 'unread' | 'read';
}
export type NeedKind = 'review' | 'question' | 'reading';
/** One pending item the page's count includes: `id` is the pending-target ID (a question's is its
 * group's). `why` is a reading's reason only. */
export interface NeedDescriptor {
  kind: NeedKind;
  id: string;
  title: string;
  agent?: string;
  why?: string;
}
/** The page's newest comment as an excerpt; `who` is a display-only device label. */
export interface LatestComment {
  who?: string;
  atMs: number;
  text: string;
}
export type ReadingDetails =
  | {
      pageId: string;
      state: 'ready';
      fingerprint: string;
      summary: PageActivity;
      pageState?: PageState | null;
      progress?: PageProgress | null;
      readings: ReadingDescriptor[];
      /** The first pending items by rank (review, question, reading); the count stays `summary.needsYou`. */
      needs: NeedDescriptor[];
      latest?: LatestComment;
    }
  | { pageId: string; state: 'pending' | 'unavailable' };

function text(value: unknown, limit: number): asserts value is string {
  requireValue(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      [...value].length <= limit &&
      !/\p{Cc}/u.test(value),
  );
}

/** Strict display-only metadata: a malformed response never becomes an empty ready result. */
export function readingDetails(value: unknown, pageId: string): ReadingDetails {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireValue(
    'state' in value && 'pageId' in value && value.pageId === pageId && validReadingId(pageId),
  );
  if (value.state === 'pending' || value.state === 'unavailable') {
    exactKeys(value, ['pageId', 'state']);
    return { pageId, state: value.state };
  }
  requireValue(value.state === 'ready');
  return completeDetails(value, pageId);
}

const NEED_KINDS: readonly NeedKind[] = ['review', 'question', 'reading'];

function need(item: unknown): NeedDescriptor {
  requireValue(item !== null && typeof item === 'object' && !Array.isArray(item));
  const optional = ['agent', 'why'].filter((key) => key in item);
  exactKeys(item, ['kind', 'id', 'title', ...optional]);
  requireValue(NEED_KINDS.includes(item.kind as NeedKind));
  requireValue(typeof item.id === 'string' && validReadingId(item.id));
  text(item.title, 200);
  if ('agent' in item) text(item.agent, 64);
  if ('why' in item) {
    requireValue(item.kind === 'reading');
    text(item.why, 200);
  }
  return {
    kind: item.kind as NeedKind,
    id: item.id,
    title: item.title,
    ...('agent' in item ? { agent: item.agent as string } : {}),
    ...('why' in item ? { why: item.why as string } : {}),
  };
}

function latestComment(value: unknown): LatestComment {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  exactKeys(value, ['atMs', 'text', ...('who' in value ? ['who'] : [])]);
  if ('who' in value) text(value.who, 64);
  text(value.text, LATEST_POINTS);
  requireValue(Number.isSafeInteger(value.atMs) && (value.atMs as number) >= 0);
  return {
    ...('who' in value ? { who: value.who as string } : {}),
    atMs: value.atMs as number,
    text: value.text as string,
  };
}

function completeDetails(value: unknown, pageId: string): ReadingDetails {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  exactKeys(value, [
    'pageId',
    'state',
    'fingerprint',
    'summary',
    'readings',
    'needs',
    ...('pageState' in value ? ['pageState'] : []),
    ...('progress' in value ? ['progress'] : []),
    ...('latest' in value ? ['latest'] : []),
  ]);
  requireValue(typeof value.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(value.fingerprint));
  activity(value.summary);
  requireValue('pageState' in value === 'progress' in value);
  if ('pageState' in value) {
    requireValue(
      value.pageState === null ||
        value.pageState === 'todo' ||
        value.pageState === 'in-progress' ||
        value.pageState === 'done',
    );
    requireValue((value.pageState === null) === (value.progress === null));
    if (value.progress !== null) pageProgress(value.progress);
  }
  requireValue(Array.isArray(value.readings) && value.readings.length <= 50);
  const ids = new Set<string>();
  const readings: ReadingDescriptor[] = [];
  for (const item of value.readings) {
    exactKeys(item, ['id', 'title', 'agent', 'why', 'state']);
    requireValue(typeof item.id === 'string' && validReadingId(item.id) && !ids.has(item.id));
    ids.add(item.id);
    text(item.title, 200);
    text(item.agent, 64);
    text(item.why, 200);
    requireValue(item.state === 'unread' || item.state === 'read');
    readings.push({
      id: item.id,
      title: item.title,
      agent: item.agent,
      why: item.why,
      state: item.state,
    });
  }
  requireValue(Array.isArray(value.needs) && value.needs.length <= NEEDS_PASSAGES);
  const needs = value.needs.map(need);
  requireValue(new Set(needs.map((item) => item.id)).size === needs.length);
  return {
    pageId,
    state: 'ready',
    fingerprint: value.fingerprint,
    summary: value.summary,
    ...('pageState' in value
      ? {
          pageState: value.pageState as PageState | null,
          progress: value.progress as PageProgress | null,
        }
      : {}),
    readings,
    needs,
    ...('latest' in value ? { latest: latestComment(value.latest) } : {}),
  };
}

/** Owner-mounted HTTP only. Hosted/member adapters do not expose this optional port. */
export async function readReadingDetails(
  mount: URL,
  pageId: string,
  signal: AbortSignal,
): Promise<ReadingDetails> {
  requireValue(validReadingId(pageId));
  signal.throwIfAborted();
  const response = await fetch(new URL(`api/pages/${pageId}/summary-details`, mount), {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  return readingDetails(await jsonResponse(response, READING_DETAILS_BYTES), pageId);
}

type Read = (id: string, signal: AbortSignal) => Promise<ReadingDetails>;

/** One shell opening. At most `READING_DETAILS_PAGES` distinct pages are read, one at a time;
 * a failed or unavailable read still counts, so a reader never fans out beyond the cap. */
export class ReadingDetailsQueue {
  #lifetime = new AbortController();
  #selected = new Set<string>();
  #pending: string[] = [];
  #running: Promise<void> | undefined;
  constructor(
    private readonly read: Read,
    private readonly publish: (id: string, details: ReadingDetails) => void,
  ) {}
  enqueue(pageIds: readonly string[]): void {
    if (this.#lifetime.signal.aborted) return;
    for (const id of pageIds) {
      if (this.#selected.has(id)) continue;
      if (this.#selected.size === READING_DETAILS_PAGES) break;
      this.#selected.add(id);
      this.#pending.push(id);
    }
    this.#start();
  }
  #start(): void {
    if (this.#running || !this.#pending.length || this.#lifetime.signal.aborted) return;
    this.#running = this.#drain().finally(() => {
      this.#running = undefined;
      this.#start();
    });
  }
  async #drain(): Promise<void> {
    while (this.#pending.length && !this.#lifetime.signal.aborted) {
      const id = this.#pending.shift()!;
      try {
        const details = await this.read(id, this.#lifetime.signal);
        if (!this.#lifetime.signal.aborted) this.publish(id, details);
      } catch {
        // Optional details: a failed attempt says the page's details are unavailable (never a
        // guess) and still consumes this generation's cap. A canceled one says nothing.
        if (!this.#lifetime.signal.aborted) this.publish(id, { pageId: id, state: 'unavailable' });
      }
    }
  }
  close(): Promise<void> {
    this.#lifetime.abort();
    this.#pending = [];
    return this.#running ?? Promise.resolve();
  }
}

/** One open page's optional progress projection. A burst keeps one read active and one latest
 * invalidation, never a request per observation. Only the latest generation can publish. */
export class ProgressReads {
  #lifetime = new AbortController();
  #generation = 0;
  #dirty = false;
  #running?: Promise<void>;
  constructor(
    private read: (signal: AbortSignal) => Promise<ReadingDetails | null>,
    private publish: (details: ReadingDetails | null) => void,
  ) {}
  /** Join reads already requested by the admitted projection without invalidating them. */
  async settled(): Promise<void> {
    while (this.#running) await this.#running;
  }
  refresh(): Promise<void> {
    if (this.#lifetime.signal.aborted) return Promise.resolve();
    this.#generation++;
    this.#dirty = true;
    return this.#start();
  }
  #start(): Promise<void> {
    this.#running ??= this.#drain().finally(() => {
      this.#running = undefined;
      if (this.#dirty && !this.#lifetime.signal.aborted) void this.#start();
    });
    return this.#running;
  }
  async #drain(): Promise<void> {
    while (this.#dirty && !this.#lifetime.signal.aborted) {
      this.#dirty = false;
      const generation = this.#generation;
      const details = await this.read(this.#lifetime.signal).catch(() => null);
      if (!this.#lifetime.signal.aborted && generation === this.#generation) this.publish(details);
    }
  }
  invalidate(): void {
    this.#generation++;
    this.#dirty = false;
  }
  close(): void {
    this.#lifetime.abort();
    this.#dirty = false;
  }
}

/** One owner's last observed activity (#6474): display only, never a send or a grant. */
export interface OwnerActivityView {
  state: 'unknown' | 'working' | 'idle' | 'waiting' | 'ended';
  lastActivityMs: number | null;
  observedAtMs: number;
}
const ACTIVITY_STATES = ['unknown', 'working', 'idle', 'waiting', 'ended'];
/** Work home's batch: the owner service reads at most 256 owners some page names, after its own
 * `changes.cursor` compare, and answers with what it observed. */
export async function readWorkActivity(
  mount: URL,
  owners: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, OwnerActivityView>> {
  requireValue(owners.length <= 256 && owners.every((owner) => owner.length > 0));
  const response = await fetch(new URL('api/work-activity', mount), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ owners }),
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]),
  });
  const value = await jsonResponse(response, READING_DETAILS_BYTES);
  exactKeys(value, ['owners']);
  const rows = value.owners;
  requireValue(rows !== null && typeof rows === 'object' && !Array.isArray(rows));
  const answer: Record<string, OwnerActivityView> = {};
  for (const [owner, row] of Object.entries(rows as Record<string, unknown>)) {
    requireValue(owners.includes(owner) && row !== null && typeof row === 'object');
    exactKeys(row, ['state', 'lastActivityMs', 'observedAtMs']);
    const { state, lastActivityMs, observedAtMs } = row as Record<string, unknown>;
    requireValue(
      typeof state === 'string' &&
        ACTIVITY_STATES.includes(state) &&
        (lastActivityMs === null || Number.isSafeInteger(lastActivityMs)) &&
        Number.isSafeInteger(observedAtMs),
    );
    answer[owner] = row as unknown as OwnerActivityView;
  }
  return answer;
}

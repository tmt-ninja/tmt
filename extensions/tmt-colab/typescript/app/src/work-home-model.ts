import type { PageWorkRow, SectionSummary } from './bootstrap.js';
import type { ListStatus, TodoAsk } from './bootstrap.js';
import { text } from './strings.js';
import { projectNameError } from './projects.js';
import type { PageSummary } from './transport.js';

/**
 * Work Home derives its views and counts from the owner list. The caller supplies scope and time.
 */
export interface WorkItem {
  /** `page` or `page:block` for a to-do. */
  key: string;
  pageId: string;
  /** The to-do's block, for a to-do item. */
  blockId?: string;
  pageTitle?: string;
  number?: string;
  title: string;
  status: ListStatus;
  high: boolean;
  /** The next step, or the blocked reason for a blocked item. */
  next?: string;
  owner?: { id?: string; name: string };
  /** The item's last admitted activity (its page's). */
  lastMs?: number;
  doneAtMs?: number;
  /** The release a retained fact proved for the page's PR. */
  release?: string;
  projects: readonly string[];
  /** The page's counted sections (#6619); a page with any shows them as its one number. */
  sections?: readonly SectionSummary[];
  work?: PageWorkRow;
  needsYou?: number;
}

export type Period = 'today' | 'week' | 'month';
/** The statuses the overview counts, in the spec's order; waiting for CI and for release share one. */
export const OVERVIEW = [
  'working',
  'waiting',
  'needs-you',
  'blocked',
  'possibly-stalled',
  'discussing',
  'unchecked',
] as const;
export type OverviewStatus = (typeof OVERVIEW)[number];

/**
 * Work home's view in its URL (#6612), so Back, Forward, a reload and a pasted link open the same
 * view: the project, the done period (`week` is the absence of the key), the overview status the
 * sections are narrowed to, the done-chart cell (its start time) and the expanded sections (`''`
 * names the section of work in no project). A value it cannot read is dropped: the default view.
 */
export interface WorkSearch {
  project?: string;
  period?: 'today' | 'month';
  status?: OverviewStatus;
  day?: number;
  more?: string[];
  order?: true;
}
const projectName = (name: unknown): name is string =>
  typeof name === 'string' && projectNameError(name) === undefined;
/** Every key is named, so one it cannot read replaces the raw value rather than reaching the page. */
export function validateWorkSearch(search: Record<string, unknown>): WorkSearch {
  const out: WorkSearch = {
    project: undefined,
    period: undefined,
    status: undefined,
    day: undefined,
    more: undefined,
    order: undefined,
  };
  if (search.order === true) out.order = true;
  if (projectName(search.project)) out.project = search.project;
  if (search.period === 'today' || search.period === 'month') out.period = search.period;
  out.status = OVERVIEW.find((status) => status === search.status);
  const day = Number(search.day);
  if (Number.isSafeInteger(day) && day > 0) out.day = day;
  if (Array.isArray(search.more)) {
    const names = [
      ...new Set(search.more.filter((name) => name === '' || projectName(name))),
    ].slice(0, 32) as string[];
    if (names.length) out.more = names;
  }
  return out;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export function overviewStatus(status: ListStatus): OverviewStatus | undefined {
  switch (status) {
    case 'done':
      return undefined;
    case 'waiting-ci':
    case 'waiting-release':
      return 'waiting';
    case 'unknown':
      return 'unchecked';
    default:
      return status;
  }
}

/**
 * Page and to-do views use separate inputs. Project order also includes unassigned to-dos
 * so they can be ranked or assigned (#6688).
 */
export function workItems(
  pages: readonly PageSummary[],
  view: 'pages' | 'todos' | 'order' = 'pages',
): WorkItem[] {
  const items: WorkItem[] = [];
  for (const page of pages) {
    const summary = page.summary;
    if (page.archived || !summary) continue;
    const fields = summary.fields;
    const status: ListStatus = summary.status ?? 'unchecked';
    const projects = page.projects ?? [];
    const lastMs = page.lastUpdateAtMs ?? undefined;
    if (view !== 'todos')
      items.push({
        key: page.id,
        pageId: page.id,
        ...(page.workNumber ? { number: page.workNumber } : {}),
        title: page.title,
        status,
        high: fields?.priority === 'high',
        ...(status === 'blocked' && fields?.blocked
          ? { next: fields.blocked }
          : fields?.next
            ? { next: fields.next }
            : {}),
        ...(fields?.owner ? { owner: { id: fields.owner.id, name: fields.owner.name } } : {}),
        ...(lastMs === undefined ? {} : { lastMs }),
        ...(summary.doneAtMs === undefined ? {} : { doneAtMs: summary.doneAtMs }),
        ...(summary.release ? { release: summary.release } : {}),
        projects,
        ...(summary.sections?.length ? { sections: summary.sections } : {}),
        ...(summary.work ? { work: summary.work } : {}),
        ...(summary.needsYou ? { needsYou: summary.needsYou } : {}),
      });
    if (view === 'pages') continue;
    for (const todo of summary.todos ?? []) {
      const needsYou = !todo.checked && todo.ask === 'needs-you';
      if (!todo.number) continue;
      if (
        view === 'todos' &&
        (todo.checked || todo.pullStatus === 'done' || (!todo.assignee && !needsYou))
      )
        continue;
      items.push({
        key: `${page.id}:${todo.id}`,
        pageId: page.id,
        blockId: todo.id,
        pageTitle: page.title,
        number: todo.number,
        title: todo.text || page.title,
        // Done when checked; otherwise the state of the Ask it came from, else in discussion.
        status:
          view === 'todos' && needsYou
            ? 'needs-you'
            : (todo.pullStatus ?? (todo.checked ? 'done' : todoStatus(todo.ask))),
        high: false,
        next: !todo.checked && todo.ask === 'answered' ? text.workHome.answered : page.title,
        ...(todo.assignee ? { owner: { name: todo.assignee } } : {}),
        ...(lastMs === undefined ? {} : { lastMs }),
        ...(todo.doneAtMs === undefined ? {} : { doneAtMs: todo.doneAtMs }),
        projects,
      });
    }
  }
  return items;
}

/** An open to-do's status from its Ask (#6474 follow-up): a sent Ask is in progress, an answer
 * waiting on the person needs them, and a handled answer stays in progress until the to-do is
 * checked. A to-do no Ask made is in discussion. */
function todoStatus(ask: TodoAsk | undefined): ListStatus {
  if (ask === 'needs-you') return 'needs-you';
  return ask ? 'working' : 'discussing';
}

export const inProject = (item: WorkItem, project: string | undefined) =>
  project === undefined || item.projects.includes(project);

/** The order inside a project section: the spec's status groups, high priority, then recent. */
const RANK: Partial<Record<ListStatus, number>> = {
  blocked: 0,
  'possibly-stalled': 1,
  'needs-you': 2,
  working: 3,
  'waiting-ci': 4,
  'waiting-release': 4,
};
export function byAttention(a: WorkItem, b: WorkItem): number {
  return (
    (RANK[a.status] ?? 5) - (RANK[b.status] ?? 5) ||
    Number(b.high) - Number(a.high) ||
    (b.lastMs ?? 0) - (a.lastMs ?? 0) ||
    a.key.localeCompare(b.key)
  );
}

export function byTodoAttention(a: WorkItem, b: WorkItem): number {
  return Number(b.status === 'needs-you') - Number(a.status === 'needs-you') || byAttention(a, b);
}

export interface Overview {
  open: number;
  counts: Record<OverviewStatus, number>;
}
export function overview(items: readonly WorkItem[]): Overview {
  const counts = Object.fromEntries(OVERVIEW.map((status) => [status, 0])) as Record<
    OverviewStatus,
    number
  >;
  const open = items.filter((item) => item.status !== 'done');
  for (const item of open) counts[overviewStatus(item.status)!] += 1;
  return { open: open.length, counts };
}

export interface DoneCell {
  /** Inclusive start and exclusive end, owner clock. */
  from: number;
  to: number;
  count: number;
  current: boolean;
}
export interface DoneChart {
  cells: DoneCell[];
  total: number;
  previous: number;
}
/** Done items per cell: today by hour up to now, else by local day, the last cell today. */
export function doneChart(items: readonly WorkItem[], period: Period, now: number): DoneChart {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const bounds: [number, number][] = [];
  if (period === 'today') {
    for (let hour = 0; hour <= new Date(now).getHours(); hour += 1)
      bounds.push([today + hour * HOUR, today + (hour + 1) * HOUR]);
  } else {
    const days = period === 'week' ? 7 : 30;
    for (let back = days - 1; back >= 0; back -= 1) {
      const start = new Date(today);
      start.setDate(start.getDate() - back);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      bounds.push([start.getTime(), end.getTime()]);
    }
  }
  const done = items.flatMap((item) => (item.doneAtMs === undefined ? [] : [item.doneAtMs]));
  const from = bounds[0][0];
  const span = period === 'today' ? DAY : bounds.at(-1)![1] - from;
  const cells = bounds.map(([start, end], index) => ({
    from: start,
    to: end,
    count: done.filter((at) => at >= start && at < end).length,
    current: index === bounds.length - 1,
  }));
  return {
    cells,
    total: done.filter((at) => at >= from && at <= now).length,
    previous: done.filter((at) => at >= from - span && at < from).length,
  };
}

export interface ProjectSection {
  /** The project's name; `undefined` for work in no project, which comes last. */
  name?: string;
  /** The work-number prefix its items share, when one does. */
  prefix?: string;
  open: WorkItem[];
  counts: Partial<Record<OverviewStatus, number>>;
}
/**
 * One section per project, in the owner's project order: its open items by attention. A project
 * with no open work and nothing done in the last 7 days is left out.
 */
export function projectSections(
  items: readonly WorkItem[],
  projects: readonly string[],
  now: number,
): ProjectSection[] {
  const names = [...projects];
  for (const item of items)
    for (const project of item.projects) if (!names.includes(project)) names.push(project);
  const section = (name: string | undefined): ProjectSection | undefined => {
    const mine = items.filter((item) =>
      name === undefined ? item.projects.length === 0 : item.projects.includes(name),
    );
    const open = mine.filter((item) => item.status !== 'done').sort(byAttention);
    const recent = mine.some(
      (item) => item.doneAtMs !== undefined && now - item.doneAtMs < 7 * DAY,
    );
    if (!open.length && !recent) return undefined;
    const counts: Partial<Record<OverviewStatus, number>> = {};
    for (const item of open) {
      const status = overviewStatus(item.status)!;
      counts[status] = (counts[status] ?? 0) + 1;
    }
    const prefixes = new Set(open.map((item) => item.number?.split('-')[0]));
    const prefix = prefixes.size === 1 ? [...prefixes][0] : undefined;
    return {
      ...(name === undefined ? {} : { name }),
      ...(prefix && prefix !== 'W' ? { prefix } : {}),
      open,
      counts,
    };
  };
  return [...names.map(section), section(undefined)].filter(
    (found): found is ProjectSection => found !== undefined,
  );
}

/** The most recently done items, newest first, optionally within one chart cell. */
export function recentlyDone(
  items: readonly WorkItem[],
  limit: number,
  within?: { from: number; to: number },
): WorkItem[] {
  return items
    .filter(
      (item) =>
        item.status === 'done' &&
        item.doneAtMs !== undefined &&
        (!within || (item.doneAtMs >= within.from && item.doneAtMs < within.to)),
    )
    .sort((a, b) => b.doneAtMs! - a.doneAtMs! || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** The owners whose activity Work home asks about: the open pages' owners with an id, at most 256. */
export function activityOwners(items: readonly WorkItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items)
    if (item.status !== 'done' && !item.blockId && item.owner?.id) ids.add(item.owner.id);
  return [...ids].sort().slice(0, 256);
}

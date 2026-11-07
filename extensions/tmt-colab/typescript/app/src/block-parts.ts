import type { PageViewRowFilter, WorkBundleTicket } from '@tmt/browser-ui/blocks';
import type { BlockRecord } from './block-model.js';
import type { ParentPageViewSpec } from './parent-page-view.js';

/** A page writer's props are untrusted (#6005): each part reads only the fields it draws, as plain
 * values of their schema type; an enum outside its set takes the part's default. */
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const choice = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;
const integer = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** A page view's filters, as authored. */
export function pageViewFilters(block: BlockRecord): PageViewRowFilter[] {
  const value = block.props.filters;
  return (Array.isArray(value) ? value : [])
    .filter(
      (filter): filter is PageViewRowFilter =>
        !!filter &&
        ['project', 'state', 'owner'].includes((filter as PageViewRowFilter).field) &&
        typeof (filter as PageViewRowFilter).value === 'string',
    )
    .slice(0, 20);
}

/** A live page view's spec for the trusted parent's owner list (`ParentPageView`). */
export function pageViewSpec(block: BlockRecord): ParentPageViewSpec {
  const props = block.props;
  return {
    tag: 'tmt-ui-page-view',
    index: 0,
    title: text(props.label) || 'Pages',
    filters: pageViewFilters(block),
    limit: integer(props.limit, 1, 200) ?? 20,
    sort: choice(props.sort, ['updated', 'title'] as const, 'updated'),
    groupBy: choice(props.groupBy, ['state', 'project', 'owner', 'none'] as const, 'state'),
    columns: strings(props.columns).slice(0, 32),
    density: choice(props.density, ['compact', 'comfortable'] as const, 'compact'),
    selectable: props.selectable === true,
    ...(text(props.selected) && { selected: text(props.selected) }),
    state: choice(props.state, ['auto', 'loading', 'empty', 'error'] as const, 'auto'),
  };
}

/** A work bundle's fields: the page it points at, its number, work line and ticket links (the
 * validator admits only `https://github.com/` tickets). */
export function workBundleProps(block: BlockRecord): {
  page: string;
  number?: number;
  work?: string;
  tickets: WorkBundleTicket[];
} {
  const props = block.props;
  const tickets = (Array.isArray(props.tickets) ? props.tickets : [])
    .filter(
      (ticket): ticket is WorkBundleTicket =>
        !!ticket &&
        typeof (ticket as WorkBundleTicket).label === 'string' &&
        typeof (ticket as WorkBundleTicket).href === 'string' &&
        (ticket as WorkBundleTicket).href.startsWith('https://github.com/'),
    )
    .slice(0, 20);
  return {
    page: text(props.page) ?? '',
    ...(integer(props.number, 1, 0xffffffff) !== undefined && {
      number: integer(props.number, 1, 0xffffffff),
    }),
    ...(text(props.work) !== undefined && { work: text(props.work) }),
    tickets,
  };
}

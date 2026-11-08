import type { PageListRow } from '../data-table/index.js';

/** A page view's filter, as authored. */
export interface PageViewRowFilter {
  field: 'project' | 'state' | 'owner';
  value: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * The rows a page view with authored `rows` shows (a mockup or an agent's snapshot list): each
 * authored item read field by field as plain text, never markup, filtered, sorted (`title`, else
 * newest first) and cut at `limit`. An item without a string `id` and `name` is left out. The
 * `tmt-ui-page-view` tag draws authored rows by the same rules in the render frame.
 */
export function authoredPageViewRows(
  rows: unknown,
  {
    filters = [],
    sort,
    limit = 20,
  }: { filters?: readonly PageViewRowFilter[]; sort?: 'updated' | 'title'; limit?: number } = {},
): PageListRow[] {
  if (!Array.isArray(rows)) return [];
  const read = rows
    .slice(0, 200)
    .filter(
      (item): item is Record<string, unknown> =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).id === 'string' &&
        typeof (item as Record<string, unknown>).name === 'string',
    )
    .map((item) => {
      const subpages = item.subpages as { done?: unknown; total?: unknown } | undefined;
      const done = subpages?.done;
      const total = subpages?.total;
      return {
        row: {
          id: item.id as string,
          name: item.name as string,
          title: item.name as string,
          projects: Array.isArray(item.projects)
            ? item.projects.filter((value): value is string => typeof value === 'string')
            : [],
          stage: typeof item.stage === 'string' ? { id: item.stage, label: item.stage } : undefined,
          updated: text(item.updated),
          subpages:
            Number.isSafeInteger(done) &&
            Number.isSafeInteger(total) &&
            (total as number) > 0 &&
            (done as number) >= 0 &&
            (done as number) <= (total as number)
              ? { done: done as number, total: total as number }
              : undefined,
          needsYou: item.needsYou === true,
          author: text(item.author),
          access: text(item.access) || 'Team',
        } satisfies PageListRow,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      };
    })
    .filter(({ row }) =>
      filters.every(({ field, value }) =>
        field === 'project'
          ? row.projects.includes(value)
          : field === 'state'
            ? row.stage?.id === value || row.stage?.label === value
            : row.author === value,
      ),
    );
  read.sort((a, b) =>
    sort === 'title' ? a.row.name.localeCompare(b.row.name) : b.updatedAt - a.updatedAt,
  );
  return read.slice(0, Math.max(1, Math.min(200, limit))).map(({ row }) => row);
}

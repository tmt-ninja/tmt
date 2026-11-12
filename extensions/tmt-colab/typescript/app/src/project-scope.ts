import type { PageSummary } from './transport.js';

/** The pages in every one of the projects; none keeps every page. */
export function inProjects(
  pages: readonly PageSummary[],
  projects: readonly string[],
): readonly PageSummary[] {
  return projects.length === 0
    ? pages
    : pages.filter((page) => projects.every((name) => page.projects?.includes(name)));
}

export interface ScopeRow {
  /** `undefined` is All pages. */
  name: string | undefined;
  count: number;
  /** Pages in it with an item waiting on the viewer. */
  waiting: number;
}
/** All pages, then each project of the space (those with no page too) in code point order, each with
 * the pages shown in it and how many of them wait on the viewer. */
export function scopeRows(pages: readonly PageSummary[], projects: readonly string[]): ScopeRow[] {
  const waiting = (list: readonly PageSummary[]) =>
    list.filter((page) => page.summary?.waiting).length;
  return [
    { name: undefined, count: pages.length, waiting: waiting(pages) },
    ...projects.map((name) => {
      const members = pages.filter((page) => page.projects?.includes(name));
      return { name, count: members.length, waiting: waiting(members) };
    }),
  ];
}

import type { PageState } from './bootstrap.js';
import { SaveNotApplied, SaveRefused } from './save.js';
import type { PageSummary } from './transport.js';
import { subpages, type StoredWork } from './work.js';

/** A sub-page row of the work panel. */
export interface SubpageRow {
  id: string;
  /** The page whose list holds the link; Detach removes it there. */
  parent: string;
  title?: string;
  state?: PageState | null;
}
/** Direct sub-page progress: each sub-page counts once, by its own manual state, never recursively. */
export interface SubpageCounts {
  done: number;
  inProgress: number;
  todo: number;
  unknown: number;
  total: number;
}
/** Why a page cannot be attached under this one; the owner's admission decides again. */
export type AttachRefusal =
  | { kind: 'self' }
  | { kind: 'attached'; parentTitle?: string }
  | { kind: 'loop' };

/** The two owner writes are not atomic; only a confirmed refusal proves a detached page is free. */
export async function moveBetweenParents(
  oldParent: string | undefined,
  target: string,
  write: (parent: string, action: 'subpage.attach' | 'subpage.detach') => Promise<void>,
): Promise<'attached' | 'detached' | 'unknown'> {
  if (oldParent) {
    try {
      await write(oldParent, 'subpage.detach');
    } catch {
      return 'unknown';
    }
  }
  try {
    await write(target, 'subpage.attach');
    return 'attached';
  } catch (failure) {
    return oldParent && (failure instanceof SaveRefused || failure instanceof SaveNotApplied)
      ? 'detached'
      : 'unknown';
  }
}

/** Show locations consistently in both page pickers. */
export function pageLocation(page: PageSummary, pages: readonly PageSummary[]): string | undefined {
  const byId = new Map(pages.map((item) => [item.id, item]));
  const names: string[] = [];
  const seen = new Set([page.id]);
  let project = page.projects?.[0];
  let parent = page.summary?.parent?.page;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const item = byId.get(parent);
    if (!item) break;
    names.unshift(item.title);
    project = item.projects?.[0] ?? project;
    parent = item.summary?.parent?.page;
  }
  const root = project ?? 'All pages';
  if (names[0] !== root) names.unshift(root);
  return names.join(' / ');
}

/** Apply the existing tree admission rules to a prospective parent. */
export function parentRefusal(
  pageId: string,
  parentId: string,
  pages: readonly PageSummary[],
): AttachRefusal | undefined {
  const page = pages.find((item) => item.id === pageId);
  if (page?.summary?.parent?.page === parentId) return { kind: 'attached' };
  const withoutParent = pages.map((item) =>
    item.id === pageId && item.summary
      ? { ...item, summary: { ...item.summary, parent: undefined } }
      : item,
  );
  return subpageTree(parentId, undefined, withoutParent).refusal(pageId);
}

/**
 * The sub-page tree as the owner list shows it. This page's own work names its direct sub-pages in
 * order; a deeper level comes from the list's parent links (`summary.parent`), in each parent's
 * own order. A page the list does not name has no title or state and no children here: nothing is
 * read to find them. Archived pages are left out at every level.
 */
export function subpageTree(
  pageId: string,
  work: StoredWork | undefined,
  pages: readonly PageSummary[] | undefined,
): {
  top: readonly SubpageRow[];
  childrenOf(id: string): readonly SubpageRow[];
  counts(rows: readonly SubpageRow[]): SubpageCounts;
  refusal(candidate: string): AttachRefusal | undefined;
} {
  const byId = new Map((pages ?? []).map((page) => [page.id, page]));
  const row = (id: string, parent: string): SubpageRow => {
    const page = byId.get(id);
    return { id, parent, title: page?.title, state: page?.state };
  };
  const listed = subpages(work);
  // An archived sub-page keeps its link (unarchiving brings its row back in place), but the panel
  // shows and counts only the pages in use (#5867).
  const archived = (id: string) => byId.get(id)?.archived === true;
  const top = listed.filter((child) => !archived(child)).map((child) => row(child, pageId));
  const below = new Map<string, { row: SubpageRow; index: number }[]>();
  for (const page of pages ?? []) {
    const link = page.summary?.parent;
    if (!link || link.page === pageId || page.archived) continue;
    const rows = below.get(link.page) ?? [];
    rows.push({ row: row(page.id, link.page), index: link.index });
    below.set(link.page, rows);
  }
  const ordered = new Map(
    [...below].map(([parent, rows]) => [
      parent,
      rows
        .sort((a, b) => a.index - b.index || (a.row.id < b.row.id ? -1 : 1))
        .map(({ row }) => row),
    ]),
  );
  const childrenOf = (id: string) => (id === pageId ? top : (ordered.get(id) ?? []));
  const counts = (rows: readonly SubpageRow[]): SubpageCounts => {
    const found = { done: 0, inProgress: 0, todo: 0, unknown: 0, total: rows.length };
    for (const { state } of rows) {
      if (state === 'done') found.done += 1;
      else if (state === 'in-progress') found.inProgress += 1;
      else if (state === 'todo') found.todo += 1;
      else found.unknown += 1;
    }
    return found;
  };
  const ancestors = new Set<string>();
  // The list's parent links can loop after a writers' race; the walk stops at a repeat.
  for (
    let link = byId.get(pageId)?.summary?.parent;
    link && !ancestors.has(link.page);
    link = byId.get(link.page)?.summary?.parent
  )
    ancestors.add(link.page);
  const refusal = (candidate: string): AttachRefusal | undefined => {
    if (candidate === pageId) return { kind: 'self' };
    if (ancestors.has(candidate)) return { kind: 'loop' };
    const link = byId.get(candidate)?.summary?.parent;
    if (link) return { kind: 'attached', parentTitle: byId.get(link.page)?.title };
    if (listed.includes(candidate))
      return { kind: 'attached', parentTitle: byId.get(pageId)?.title };
    return undefined;
  };
  return { top, childrenOf, counts, refusal };
}

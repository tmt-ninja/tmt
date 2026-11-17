import type { ListStatus } from './bootstrap.js';
import type { PageSummary } from './transport.js';

/** The stages the page list tabs name; the owner derives them from a page's sub-pages. */
export type PageStage = 'in-progress' | 'discussion' | 'done';
/** What the page list's tabs show: a stage, or every active page. */
export type HomeStage = PageStage | 'all';
export const HOME_STAGES: readonly HomeStage[] = ['all', 'discussion', 'in-progress', 'done'];
/** The tab a bare list URL opens on (every active page); the route search keeps any other. */
export const DEFAULT_VIEW: HomeStage = 'all';
/** A tab of the owner's list: a stage, the pages that need you, or the archived ones. */
export type HomeView = HomeStage | 'needs' | 'archived';

/**
 * The stage a page's summary says. A fresh summary without work is a page with no sub-page, so it is in
 * discussion; a page without a summary has not reported yet and is at no stage.
 */
export function pageStage(page: PageSummary): PageStage | undefined {
  const summary = page.summary;
  if (!summary) return undefined;
  const tab = summary.status && statusTab(summary.status);
  // A page that needs the person is in the Needs you tab, not a stage tab.
  if (tab === 'needs') return undefined;
  return tab ?? summary.work?.stage ?? 'discussion';
}

/** Which list tab a computed status belongs to (#6520): one map for the Stage cell and the tabs. */
export function statusTab(state: ListStatus): PageStage | 'needs' {
  switch (state) {
    case 'needs-you':
    case 'blocked':
      return 'needs';
    case 'working':
    case 'possibly-stalled':
    case 'waiting-ci':
    case 'waiting-release':
      return 'in-progress';
    case 'done':
      return 'done';
    case 'discussing':
    case 'unknown':
    case 'unchecked':
      return 'discussion';
  }
}

/** The page needs the person: something awaits them, or its computed status says so. */
export function needsYou(page: PageSummary): boolean {
  const summary = page.summary;
  return (
    !!summary && (summary.waiting || (!!summary.status && statusTab(summary.status) === 'needs'))
  );
}

/** How many of `pages` are at each stage; a page that has not reported counts under none. */
export function stageCounts(pages: readonly PageSummary[]): Record<PageStage, number> {
  const counts = { 'in-progress': 0, discussion: 0, done: 0 };
  for (const page of pages) {
    const stage = pageStage(page);
    if (stage) counts[stage] += 1;
  }
  return counts;
}

/**
 * The last `stage:<name>` word of the free text, taken out of it: a stage is one state with the
 * tabs, so it never stays in the search as a token. Any other word, `stage:` with an unknown name
 * included, stays as text.
 */
export function takeStage(q: string): { q: string; stage?: HomeStage } {
  let stage: HomeStage | undefined;
  const rest: string[] = [];
  for (const word of q.split(/\s+/).filter(Boolean)) {
    const named = /^stage:(.+)$/i.exec(word)?.[1]?.toLowerCase();
    const known = HOME_STAGES.find((name) => name === named);
    if (known) stage = known;
    else rest.push(word);
  }
  return { q: rest.join(' '), ...(stage ? { stage } : {}) };
}

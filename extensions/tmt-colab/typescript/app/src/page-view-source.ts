import { isDesignSystemPage } from './design-system-pages.js';
import { relativeTime } from './display-time.js';
import { rememberPages, rememberedPages, watchRememberedPages } from './quick-switcher-source.js';
import type { PageSummary, PageTransport } from './transport.js';

/** Bounded display fields for the trusted parent page-view overlay. */
export interface PageViewRecord {
  id: string;
  name: string;
  href: string;
  projects: string[];
  stage: string;
  updated: string;
  updatedAt?: number;
  subpages?: { done: number; total: number };
  needsYou?: boolean;
  author: string;
  access: string;
}
const text = (value: string | undefined, max: number) => (value ?? '').slice(0, max);
export function pageViewRecords(
  pages: readonly PageSummary[],
  pageHref: (id: string) => string = (id) => `/pages/${encodeURIComponent(id)}`,
): PageViewRecord[] {
  const rows = pages
    .filter((page) => !page.archived && !isDesignSystemPage(page))
    .slice(0, 200)
    .map((page) => ({
      id: text(page.id, 128),
      name: text(page.title, 256),
      href: text(pageHref(page.id), 512),
      projects: (page.projects ?? []).slice(0, 20).map((project) => text(project, 80)),
      stage: text(
        ({ todo: 'To do', 'in-progress': 'In progress', done: 'Done' } as Record<string, string>)[
          page.state ?? ''
        ] ??
          page.summary?.work?.stage ??
          '',
        80,
      ),
      updated: page.lastUpdateAtMs == null ? '' : relativeTime(page.lastUpdateAtMs, Date.now()),
      ...(page.lastUpdateAtMs == null ? {} : { updatedAt: page.lastUpdateAtMs }),
      ...(page.summary?.needsYou ? { needsYou: true } : {}),
      ...(page.progress
        ? { subpages: { done: page.progress.done, total: page.progress.total } }
        : page.summary?.work
          ? { subpages: { done: page.summary.work.done, total: page.summary.work.total } }
          : {}),
      author: text(page.summary?.author, 128),
      access: page.sharing,
    }));
  // Bound the parent projection without truncating a record in the middle.
  while (rows.length && new TextEncoder().encode(JSON.stringify(rows)).byteLength > 64 * 1024)
    rows.pop();
  return rows;
}

/** Fetch once when requested; later owner-list refreshes update the mounted view. */
export function watchPageView(
  transport: PageTransport,
  space: string | undefined,
  publish: (rows: PageViewRecord[]) => void,
  failed: () => void,
  pageHref?: (id: string) => string,
): () => void {
  const abort = new AbortController();
  const send = (rows: readonly PageSummary[]) => {
    if (!abort.signal.aborted) publish(pageViewRecords(rows, pageHref));
  };
  const cached = rememberedPages(transport, space);
  if (cached) send(cached);
  const stop = watchRememberedPages(transport, space, send);
  void transport.spaceHome(abort.signal).then(
    (home) => {
      if (!abort.signal.aborted) rememberPages(transport, space, home.pages);
    },
    () => {
      if (!abort.signal.aborted && !cached) failed();
    },
  );
  return () => {
    abort.abort();
    stop();
  };
}

/** A live page list for a page whose content only its owner wrote (#6064). The list's rows and the
 * height they give it are an oracle on the owner's pages, so a page another writer touched gets none:
 * it is refused at subscribe, and every later publish is withheld once the page stops qualifying
 * (an epoch or writer change), which leaves the fixed "unavailable" state. */
export function gatePageViewSource(
  source: (publish: (rows: PageViewRecord[]) => void, failed: () => void) => () => void,
  admitted: () => boolean,
): typeof source {
  return (publish, failed) => {
    if (!admitted()) {
      failed();
      return () => {};
    }
    return source((rows) => (admitted() ? publish(rows) : failed()), failed);
  };
}

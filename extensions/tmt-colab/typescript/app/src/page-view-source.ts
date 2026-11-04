import { isDesignSystemPage } from './design-system-pages.js';
import { relativeTime } from './display-time.js';
import { rememberPages, rememberedPages, watchRememberedPages } from './quick-switcher-source.js';
import type { PageSummary, PageTransport } from './transport.js';

/** Only bounded, display-only fields cross into the untrusted page frame. */
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
  // The frame port has a strict bound; never truncate a record in the middle.
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

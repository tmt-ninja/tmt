import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  UiTheme,
} from '@tmt/browser-ui/ui';
import '@tmt/browser-ui/ui.css';
import { browserUiClasses as c } from '@tmt/browser-ui/static';
import { ArrowLeft, ListTree } from 'lucide-react';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { text } from './strings.js';
import { getTheme, subscribeTheme } from './theme.js';
import type { PageTransport } from './transport.js';
import { useLinkedPages } from './work-stages.js';
import { subpageTree, type SubpageRow } from './work-tree.js';
import type { StoredWork } from './work.js';
import './page-hierarchy.css';

const t = text.pageHierarchy;

/** One page in a hierarchy menu: its title, opening it, and its own state. */
function PageItem({ row, href, current }: { row: SubpageRow; href: string; current?: boolean }) {
  const title = row.title ?? text.workBand.unknownPage;
  return (
    <DropdownMenuItem asChild>
      <a href={href} className="page-hierarchy-item" aria-current={current ? 'page' : undefined}>
        <span className="page-hierarchy-title" title={title}>
          {current ? t.thisPage(title) : title}
        </span>
        <span className={`page-hierarchy-state ${c.countChip}`} data-state={row.state ?? 'unknown'}>
          {row.state ? text.workBand.taskState[row.state] : text.workBand.unknown}
        </span>
      </a>
    </DropdownMenuItem>
  );
}

/**
 * The page's place in its hierarchy for the shared bar (#5506): `parent` goes before the title (a
 * hierarchy icon, the direct parent's name linking to it, and its progress chip, whose menu goes back
 * up or across to a sibling). The owner list also tells the page whether it has sub-pages.
 */
export function usePageHierarchy({
  transport,
  space,
  pageId,
  work,
  pageHref,
}: {
  transport: PageTransport;
  space?: string;
  pageId: string;
  work?: StoredWork;
  pageHref(pageId: string): string;
}): { parent?: ReactNode; hasSubpages: boolean; parentPage?: { id: string; title: string } } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  const { pages } = useLinkedPages(transport, space, work);
  const tree = useMemo(() => subpageTree(pageId, work, pages), [pageId, work, pages]);
  const link = pages?.find((page) => page.id === pageId)?.summary?.parent;
  const holder = link && pages?.find((page) => page.id === link.page);
  let parent: ReactNode;
  if (link && holder) {
    const siblings = tree.childrenOf(link.page);
    const counts = tree.counts(siblings);
    parent = (
      <UiTheme theme={theme}>
        <span className={`page-hierarchy-parent ${c.countChip}`}>
          <ListTree className="page-hierarchy-icon" aria-hidden="true" />
          <span>{t.parentLabel}</span>
          <a className="page-hierarchy-name" href={pageHref(link.page)} title={holder.title}>
            {holder.title}
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`page-hierarchy-count ${c.countChip}`}
                aria-label={t.parentMenu(holder.title, counts.done, counts.total)}
              >
                {t.subpages(counts.total)} · {t.count(counts.done, counts.total)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="page-hierarchy-menu">
              <DropdownMenuItem asChild>
                <a href={pageHref(link.page)} className="page-hierarchy-item">
                  <ArrowLeft aria-hidden="true" />
                  <span className="page-hierarchy-title">{t.back(holder.title)}</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t.siblings(holder.title, siblings.length)}</DropdownMenuLabel>
              {siblings.map((row) => (
                <PageItem
                  key={row.id}
                  row={row}
                  href={pageHref(row.id)}
                  current={row.id === pageId}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="page-hierarchy-separator" aria-hidden="true">
            ›
          </span>
        </span>
      </UiTheme>
    );
  }
  return {
    parent,
    hasSubpages: tree.top.length > 0,
    parentPage: link && holder ? { id: link.page, title: holder.title } : undefined,
  };
}

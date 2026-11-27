import { useEffect, useMemo, useState } from 'react';
import { classifyPageLink } from './page-link-request.js';
import type { PageRouting } from './page-routing.js';
import { rememberedPages, rememberPages, watchRememberedPages } from './quick-switcher-source.js';
import { githubTicket, type TicketLinks } from './ticket-links.js';
import type { PageTransport, SpaceHome } from './transport.js';

export type TicketTarget =
  | { kind: 'github'; repository: string; number: string; href: string }
  | { kind: 'colab'; page?: string; prefix?: string; workNumber?: string; href: string };

/** A deleted page also makes a prefix ambiguous. */
export function ticketPageByPrefix(home: SpaceHome, prefix: string): string | undefined {
  const matches = home.pageIds?.filter((page) => page.pageId.startsWith(prefix));
  return matches?.length === 1 && !matches[0]?.deleted ? matches[0]?.pageId : undefined;
}

export function useTicketLinks({
  transport,
  space,
  enabled,
  needsWorkNumbers,
  repository,
  routing,
  base,
  preview,
}: {
  transport: PageTransport;
  space?: string;
  enabled: boolean;
  needsWorkNumbers: boolean;
  repository?: string;
  routing: PageRouting;
  base(): string;
  preview(target: TicketTarget): void;
}) {
  const [catalog, setCatalog] = useState<{
    transport: PageTransport;
    space?: string;
    home: SpaceHome;
  }>();
  useEffect(() => {
    if (!enabled || !needsWorkNumbers) return;
    const controller = new AbortController();
    const stop = watchRememberedPages(transport, space, (pages) => {
      setCatalog((list) =>
        list?.transport === transport && list.space === space
          ? { transport, space, home: { ...list.home, pages } }
          : { transport, space, home: { title: '', pages } },
      );
    });
    void transport.spaceHome(controller.signal).then(
      (home) => {
        if (controller.signal.aborted) return;
        rememberPages(transport, space, home.pages);
        setCatalog({ transport, space, home });
      },
      () => {},
    );
    return () => {
      controller.abort();
      stop();
    };
  }, [enabled, needsWorkNumbers, transport, space]);

  const home =
    catalog?.transport === transport && catalog.space === space ? catalog.home : undefined;
  return useMemo(() => {
    const pages = enabled ? (home?.pages ?? rememberedPages(transport, space) ?? []) : [];
    const byNumber = new Map<string, string | null>();
    const workHrefs = new Map<string, { page: string; workNumber: string }>();
    for (const page of pages) {
      if (!page.workNumber) continue;
      byNumber.set(page.workNumber, byNumber.has(page.workNumber) ? null : page.id);
    }
    for (const [workNumber, page] of byNumber) {
      if (page) workHrefs.set(new URL(routing.pageHref(page), base()).href, { page, workNumber });
    }

    const open = (target: TicketTarget, newTab: boolean): void => {
      if (newTab) window.open(target.href, '_blank', 'noopener,noreferrer');
      else preview(target);
    };
    const authored = (href: string, newTab: boolean) => {
      if (!enabled) return false;
      const link = classifyPageLink(href, base(), space);
      if (link.kind !== 'internal') return false;
      const [, kind, id] = link.route.split('/');
      if (!id) return false;
      const page = kind === 'pages' ? id : home && ticketPageByPrefix(home, id);
      open({ kind: 'colab', page, prefix: page ? undefined : id, href: link.href }, newTab);
      return true;
    };

    const references: TicketLinks | undefined = enabled
      ? {
          href(reference) {
            if (reference.kind === 'github')
              return repository ? githubTicket(repository, reference.text.slice(1)) : undefined;
            const id = byNumber.get(reference.text);
            return id ? new URL(routing.pageHref(id), base()).href : undefined;
          },
          open(href, newTab) {
            const work = workHrefs.get(href);
            if (work) {
              open({ kind: 'colab', ...work, href }, newTab);
              return;
            }
            if (!repository) return;
            const prefix = githubTicket(repository, '');
            const number = href.slice(prefix.length);
            if (href.startsWith(prefix) && /^[1-9][0-9]{0,18}$/.test(number))
              open({ kind: 'github', repository, number, href }, newTab);
          },
        }
      : undefined;
    return { references, authored };
  }, [enabled, home, transport, space, routing, base, repository, preview]);
}

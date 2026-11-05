import { useCallback, useContext, useMemo, useRef } from 'react';
import type { DesignSystemEntry, DesignTreeNode } from './design-system-pages.js';
import { ensureBuiltInDiscussion, findBuiltInDiscussion } from './design-built-in.js';
import type { PageRouting } from './page-routing.js';
import type { PageTransport } from './transport.js';
import { EmbeddedPageContext, type ShippedPage } from './embedded-page.js';

const treeNodes = (node: DesignTreeNode): DesignTreeNode[] => [
  node,
  ...node.children.flatMap(treeNodes),
];

/** A Design page's address: the built-in tmt GUI's pages by their docs path under `/ds/gui`, as the
 * docs site routes them, a space's own system's pages by id. */
export function designPageHref(
  system: Pick<DesignSystemEntry, 'id' | 'builtIn'>,
  base: string,
  node: Pick<DesignTreeNode, 'id' | 'key'>,
) {
  return system.builtIn && node.key !== undefined
    ? `${base}/ds/gui${node.key ? `/${node.key}` : ''}`
    : `${base}/systems/${encodeURIComponent(system.id)}/${encodeURIComponent(node.id)}`;
}

/** A Design page's links: pages of the selected tree stay in Design (with their anchor); any other
 * page opens as it would in Colab. Under the shell's root `/design` mount the router's base is `/`,
 * so a Colab route would land at the app root, which is no route: such a page opens at its Colab
 * address instead, as a document navigation. */
export function designPageRouting(
  colab: PageRouting,
  system: Pick<DesignSystemEntry, 'id' | 'tree' | 'builtIn'>,
  base: string,
  to: { navigate(href: string): void; leave(href: string): void },
): PageRouting {
  const nodes = treeNodes(system.tree);
  // A page route names the whole id; a `/p/<prefix>` link in the page names its start.
  // A built-in page's id is its docs path, which a link names whole and encoded.
  const design = (route: string) => {
    const [, kind, raw] = /^\/(pages|short)\/([^/?#]+)$/.exec(route) ?? [];
    const key = raw && decodeURIComponent(raw);
    const node =
      key &&
      (nodes.find(({ id, kind: type }) => type !== 'section' && id === key) ??
        (kind === 'short'
          ? nodes.find(({ id, kind: type }) => type !== 'section' && id.startsWith(key))
          : undefined));
    return node ? designPageHref(system, base, node) : undefined;
  };
  const atRoot = base === '/design';
  const colabHref = (route: string, search?: string) =>
    `/colab${route}${search ? `?${search}` : ''}`;
  return {
    ...colab,
    open(route, anchor) {
      const href = design(route);
      if (href) to.navigate(anchor ? `${href}#${encodeURIComponent(anchor)}` : href);
      else if (atRoot)
        to.leave(colabHref(route, anchor && new URLSearchParams({ anchor }).toString()));
      else colab.open(route, anchor);
    },
    pageHref: (id, hint) =>
      (!hint && design(`/pages/${encodeURIComponent(id)}`)) ||
      (atRoot
        ? colabHref(
            `/pages/${encodeURIComponent(id)}`,
            hint && new URLSearchParams(hint).toString(),
          )
        : colab.pageHref(id, hint)),
  };
}

/** A Design page (#6060): only the renderer, annotations, discussion and Chat with @agent, hosted
 * in the Design workspace under the Design header. A space's own system's page is its Colab page; a
 * built-in tmt GUI page is the source this build ships, discussed on a Colab page made on its first
 * Comment or Chat. Links to pages of the selected tree stay in Design; any other link opens as it
 * would in Colab. */
export function DesignPage({
  transport,
  pageId,
  shipped,
  system,
  base,
  anchor,
  navigate,
}: {
  transport: PageTransport;
  pageId: string;
  /** A built-in page's shipped title and source. */
  shipped?: { title: string; source: string };
  system: DesignSystemEntry;
  base: string;
  anchor?: string;
  navigate(href: string): void;
}) {
  const go = useRef(navigate);
  go.current = navigate;
  const routing = useCallback(
    (colab: PageRouting) =>
      designPageRouting(colab, system, base, {
        navigate: (href) => go.current(href),
        leave: (href) => location.assign(href),
      }),
    [system, base],
  );
  const title = shipped?.title;
  const source = shipped?.source;
  const page = useMemo<ShippedPage | undefined>(
    () =>
      title === undefined || source === undefined
        ? undefined
        : {
            title,
            source,
            find: () => findBuiltInDiscussion(transport, pageId, title),
            ...(transport.management && {
              create: () => ensureBuiltInDiscussion(transport, pageId, { title, source }),
            }),
          },
    [transport, pageId, title, source],
  );
  const EmbeddedPage = useContext(EmbeddedPageContext);
  if (!EmbeddedPage) throw new Error('Design pages need the Colab page view.');
  // The context carries one module-level component, so nothing is created during render.
  return (
    // eslint-disable-next-line react/static-components
    <EmbeddedPage
      key={pageId}
      pageId={pageId}
      shipped={page}
      anchor={anchor}
      routing={routing}
      design
    />
  );
}

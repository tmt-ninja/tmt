import { useCallback, useContext, useRef } from 'react';
import type { DesignSystemEntry, DesignTreeNode } from './design-system-pages.js';
import type { PageRouting } from './page-routing.js';
import { EmbeddedPageContext } from './embedded-page.js';

const treeIds = (node: DesignTreeNode): string[] => [node.id, ...node.children.flatMap(treeIds)];

/** A Design page's links: pages of the selected tree stay in Design (with their anchor); any other
 * page opens as it would in Colab. Under the shell's root `/design` mount the router's base is `/`,
 * so a Colab route would land at the app root, which is no route: such a page opens at its Colab
 * address instead, as a document navigation. */
export function designPageRouting(
  colab: PageRouting,
  system: Pick<DesignSystemEntry, 'id' | 'tree'>,
  base: string,
  to: { navigate(href: string): void; leave(href: string): void },
): PageRouting {
  const ids = treeIds(system.tree);
  // A page route names the whole id; a `/p/<prefix>` link in the page names its start.
  const design = (route: string) => {
    const [, kind, key] = /^\/(pages|short)\/([^/?#]+)$/.exec(route) ?? [];
    const id =
      key && ids.find((entry) => (kind === 'pages' ? entry === key : entry.startsWith(key)));
    return id
      ? `${base}/systems/${encodeURIComponent(system.id)}/${encodeURIComponent(id)}`
      : undefined;
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

/** A Design page is a Colab page (#5866): the same reader frame, annotations, discussion and Chat
 * with @agent, hosted in the Design workspace. Links to pages of the selected tree stay in Design;
 * any other link opens as it would in Colab. */
export function DesignPage({
  pageId,
  system,
  base,
  anchor,
  navigate,
}: {
  pageId: string;
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
  const EmbeddedPage = useContext(EmbeddedPageContext);
  if (!EmbeddedPage) throw new Error('Design pages need the Colab page view.');
  // The context carries one module-level component, so nothing is created during render.
  // eslint-disable-next-line react/static-components
  return <EmbeddedPage key={pageId} pageId={pageId} anchor={anchor} routing={routing} />;
}

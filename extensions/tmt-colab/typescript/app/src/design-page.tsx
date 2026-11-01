import { useCallback, useRef } from 'react';
import type { DesignSystemEntry, DesignTreeNode } from './design-system-pages.js';
import type { PageRouting } from './page-routing.js';
import { EmbeddedPage } from './router.js';

const treeIds = (node: DesignTreeNode): string[] => [node.id, ...node.children.flatMap(treeIds)];

/** A Design page is a Colab page (#5866): the same reader frame, annotations, discussion and Chat
 * with @agent, hosted in the Design workspace. Links to pages of the selected tree stay in Design;
 * any other link opens as it would in Colab. */
export function DesignPage({
  pageId,
  system,
  base,
  navigate,
}: {
  pageId: string;
  system: DesignSystemEntry;
  base: string;
  navigate(href: string): void;
}) {
  const go = useRef(navigate);
  go.current = navigate;
  const routing = useCallback(
    (colab: PageRouting): PageRouting => {
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
      return {
        ...colab,
        open(route, anchor) {
          const href = design(route);
          if (href) go.current(anchor ? `${href}#${encodeURIComponent(anchor)}` : href);
          else colab.open(route, anchor);
        },
        pageHref: (id, hint) =>
          (!hint && design(`/pages/${encodeURIComponent(id)}`)) || colab.pageHref(id, hint),
      };
    },
    [system, base],
  );
  return <EmbeddedPage key={pageId} pageId={pageId} routing={routing} />;
}

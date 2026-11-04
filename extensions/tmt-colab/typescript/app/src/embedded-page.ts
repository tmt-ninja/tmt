import { createContext, type ComponentType } from 'react';
import type { PageRouting } from './page-routing.js';

export interface EmbeddedPageProps {
  pageId: string;
  /** The anchor to open the page at (a heading or a Design example), as the page route's search. */
  anchor?: string;
  /** The host's routing of the page's own links, over the page route's. */
  routing?(base: PageRouting): PageRouting;
  /** Show the page as a Design page: renderer, annotations and Chat only (#6060). */
  design?: boolean;
}
/** The Colab page view a lazy module hosts (#5866). The router provides it, so Design shows Colab
 * pages without importing the router (which would split the router out of the Colab module). */
export const EmbeddedPageContext = createContext<ComponentType<EmbeddedPageProps> | null>(null);
/** The release the Design header shows for a system in place of its draft (#5967); undefined, or
 * a system it does not name, shows the draft. */
export const ShownReleaseContext = createContext<
  ((system: string) => string | undefined) | undefined
>(undefined);

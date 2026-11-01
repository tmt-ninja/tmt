import { createContext, type ComponentType } from 'react';
import type { PageRouting } from './page-routing.js';

export interface EmbeddedPageProps {
  pageId: string;
  /** The host's routing of the page's own links, over the page route's. */
  routing?(base: PageRouting): PageRouting;
}
/** The Colab page view a lazy module hosts (#5866). The router provides it, so Design shows Colab
 * pages without importing the router (which would split the router out of the Colab module). */
export const EmbeddedPageContext = createContext<ComponentType<EmbeddedPageProps> | null>(null);

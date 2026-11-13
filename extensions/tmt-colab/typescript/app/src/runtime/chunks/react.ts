import * as React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { icons } from '../icons.js';
import { installScopePortals } from '../ds-scope.js';
import { sharedParts, ui } from '../entry.js';

type WorkPage = {
  title: string;
  href: string;
  summary?: string;
  projects?: readonly string[];
  stage?: string;
  owner?: string;
  needsYou?: boolean;
  updated?: string;
};
const workPages = new Map<string, WorkPage | null>();
const workListeners = new Set<() => void>();
const subscribeWork = (listener: () => void) => {
  workListeners.add(listener);
  return () => {
    workListeners.delete(listener);
  };
};
function useWorkPage(page: string): WorkPage | null | undefined {
  return React.useSyncExternalStore(
    subscribeWork,
    () => (registerBlockData ? workPages.get(page) : null),
    () => null,
  );
}
type BlockData = { type: 'work-bundle'; page: string; data: WorkPage | null };
const registerBlockData = (
  window as Window & { __colabBlockData?: (sink: (value: BlockData) => void) => void }
).__colabBlockData;
registerBlockData?.((value) => {
  if (
    value.type === 'work-bundle' &&
    typeof value.page === 'string' &&
    value.page.length <= 128 &&
    (value.data === null ||
      (value.data && typeof value.data.title === 'string' && typeof value.data.href === 'string'))
  ) {
    workPages.set(value.page, value.data);
    workListeners.forEach((listener) => listener());
  }
});
/**
 * The `react` page-runtime chunk (#1693, #6077): what a page that asks for React, or one whose
 * design-system components run on it, finds on `window.tmt`, with no network and no build step.
 * `html` is htm bound to React, so a page writes components as tagged templates instead of JSX.
 * `ui` and `sharedParts` are the base's registry, which the later chunks fill before the seal.
 */
const runtime = Object.freeze({
  React,
  createRoot,
  html: htm.bind(React.createElement),
  icons,
  sharedParts,
  sharedData: Object.freeze({ page: useWorkPage }),
  ui,
});
Object.defineProperty(window, 'tmt', { value: runtime, enumerable: true });

// Component scopes can be present in the initial page or inserted by the page later.
if (typeof document !== 'undefined') installScopePortals(document);

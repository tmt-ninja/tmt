import * as React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { icons } from './icons.js';
import { installScopePortals } from './ds-scope.js';
import { TerminalFrame } from './terminal-frame.js';
import type { ChunkParts } from './register.js';

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
 * The bundled page runtime (#1693): what an opted-in page's own script finds on `window.tmt`, with
 * no network and no build step. `html` is htm bound to React, so a page writes components as tagged
 * templates instead of JSX. Nothing here talks to the parent; the frame stays an opaque sandbox.
 */
// Filled by the chunks the parent chose for this page (#6085), then sealed before any author or
// design-system script runs.
const ui: Record<string, unknown> = { TerminalFrame };
const sharedParts: Record<string, unknown> = {};
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
const loadedChunks = new Set<string>();
window.__colabRuntimeChunk = (name: string, parts: ChunkParts) => {
  if (loadedChunks.has(name)) return;
  loadedChunks.add(name);
  Object.assign(ui, parts.ui);
  Object.assign(sharedParts, parts.parts);
};
window.__colabRuntimeSeal = () => {
  delete window.__colabRuntimeChunk;
  delete window.__colabRuntimeSeal;
  delete (window as { __colabDefine?: unknown }).__colabDefine;
  delete (window as { __colabRequire?: unknown }).__colabRequire;
  Object.freeze(ui);
  Object.freeze(sharedParts);
};

// Component scopes can be present in the initial page or inserted by the page later.
if (typeof document !== 'undefined') installScopePortals(document);

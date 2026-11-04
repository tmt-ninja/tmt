import * as React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { icons } from './icons.js';
import { installScopePortals } from './ds-scope.js';
import { PageListTable } from '@tmt/browser-ui/data-table';
import { UiTheme } from '@tmt/browser-ui/ui';

type ViewRows =
  | {
      id: string;
      name: string;
      href?: string;
      projects: string[];
      stage: string;
      updated: string;
      author: string;
      access: string;
    }[]
  | null
  | undefined;
let pageRows: ViewRows;
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
window.addEventListener('tmt-work-bundle-data', (event) => {
  const value = (event as CustomEvent<{ page?: unknown; data?: WorkPage | null }>).detail;
  if (
    !value ||
    typeof value.page !== 'string' ||
    value.page.length > 128 ||
    (value.data !== null &&
      (!value.data || typeof value.data.title !== 'string' || typeof value.data.href !== 'string'))
  )
    return;
  workPages.set(value.page, value.data);
  workListeners.forEach((listener) => listener());
});
const subscribeWork = (listener: () => void) => {
  workListeners.add(listener);
  return () => {
    workListeners.delete(listener);
  };
};
function useWorkPage(page: string): WorkPage | null | undefined {
  return React.useSyncExternalStore(
    subscribeWork,
    () => workPages.get(page),
    () => undefined,
  );
}
const pageListeners = new Set<() => void>();
window.addEventListener('tmt-page-view-data', (event) => {
  const value = (event as CustomEvent<unknown>).detail;
  if (value !== null && (!Array.isArray(value) || value.length > 200)) return;
  pageRows = value as ViewRows;
  pageListeners.forEach((listener) => listener());
});
const subscribePages = (listener: () => void) => {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
};
function SharedPageListTable({
  livePageView,
  ...props
}: React.ComponentProps<typeof PageListTable> & { livePageView?: boolean }) {
  const incoming = React.useSyncExternalStore(
    subscribePages,
    () => pageRows,
    () => undefined,
  );
  let rows =
    livePageView && Array.isArray(incoming)
      ? incoming
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              Array.isArray(item.projects),
          )
          .map((item) => ({
            ...item,
            title: item.href ? React.createElement('a', { href: item.href }, item.name) : item.name,
            stage: item.stage ? { id: item.stage, label: item.stage } : undefined,
          }))
      : props.rows;
  if (livePageView && props.rowGroup) {
    const groups = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) {
      const id = props.rowGroup(row).id;
      const group = groups.get(id) ?? [];
      group.push(row);
      groups.set(id, group);
    }
    rows = [...groups.values()].flat();
  }
  const state = !livePageView
    ? props.state
    : incoming === undefined
      ? 'loading'
      : incoming === null
        ? 'error'
        : rows.length
          ? 'ready'
          : 'empty';
  return React.createElement(
    UiTheme,
    null,
    React.createElement(PageListTable, { ...props, rows, state }),
  );
}

/**
 * The bundled page runtime (#1693): what an opted-in page's own script finds on `window.tmt`, with
 * no network and no build step. `html` is htm bound to React, so a page writes components as tagged
 * templates instead of JSX. Nothing here talks to the parent; the frame stays an opaque sandbox.
 */
const runtime = Object.freeze({
  React,
  createRoot,
  html: htm.bind(React.createElement),
  icons,
  sharedParts: Object.freeze({
    PageListTable: SharedPageListTable,
  }),
  sharedData: Object.freeze({ page: useWorkPage }),
});
Object.defineProperty(window, 'tmt', { value: runtime, enumerable: true });

// Component scopes can be present in the initial page or inserted by the page later.
if (typeof document !== 'undefined') installScopePortals(document);

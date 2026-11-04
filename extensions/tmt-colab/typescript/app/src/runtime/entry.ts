import * as React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { icons } from './icons.js';
import { installScopePortals } from './ds-scope.js';
import { PageListTable } from '@tmt/browser-ui/data-table';
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Alert,
  AlertTitle,
  AlertDescription,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  Tabs,
  TabsList,
  TabsTrigger,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  Popover,
  PopoverTrigger,
  PopoverContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Button,
  Checkbox,
  DsScope,
  Input,
  Separator,
  Skeleton,
  Surface,
  Switch,
  Textarea,
  UiTheme,
} from '@tmt/browser-ui/ui';
import {
  BrandMark,
  BrowserAction,
  BrowserAvatar,
  BrowserCheckbox,
  BrowserDisclosure,
  BrowserSection,
  BrowserStatusTile,
  BrowserToggle,
  BusyMark,
} from '@tmt/browser-ui/react';

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
      updatedAt?: number;
      subpages?: { done: number; total: number };
      needsYou?: boolean;
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
const pageListeners = new Set<() => void>();
type BlockData =
  | { type: 'page-view'; rows: ViewRows }
  | { type: 'work-bundle'; page: string; data: WorkPage | null };
const registerBlockData = (
  window as Window & { __colabBlockData?: (sink: (value: BlockData) => void) => void }
).__colabBlockData;
if (!registerBlockData) pageRows = null;
registerBlockData?.((value) => {
  if (value.type === 'page-view') {
    if (value.rows !== null && (!Array.isArray(value.rows) || value.rows.length > 200)) return;
    pageRows = value.rows;
    pageListeners.forEach((listener) => listener());
  } else if (
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
const subscribePages = (listener: () => void) => {
  pageListeners.add(listener);
  return () => {
    pageListeners.delete(listener);
  };
};
function SharedPageListTable({
  livePageView,
  pageViewOptions,
  ...props
}: React.ComponentProps<typeof PageListTable> & {
  livePageView?: boolean;
  pageViewOptions?: { filters: { field: string; value: string }[]; sort: string; limit: number };
}) {
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
  if (pageViewOptions) {
    rows = rows.filter((row) =>
      pageViewOptions.filters.every((filter) =>
        filter.field === 'project'
          ? row.projects.includes(filter.value)
          : filter.field === 'state'
            ? row.stage?.id === filter.value || row.stage?.label === filter.value
            : filter.field === 'owner'
              ? row.author === filter.value
              : false,
      ),
    );
    if (pageViewOptions.sort === 'title')
      rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    else if (pageViewOptions.sort === 'updated')
      rows = [...rows].sort(
        (a, b) =>
          ((b as typeof b & { updatedAt?: number }).updatedAt ?? 0) -
          ((a as typeof a & { updatedAt?: number }).updatedAt ?? 0),
      );
    rows = rows.slice(0, pageViewOptions.limit);
  }
  if (props.rowGroup) {
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
    ? props.state === 'ready' && rows.length === 0
      ? 'empty'
      : props.state
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
  ui: Object.freeze({
    Button,
    Badge,
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardAction,
    CardContent,
    CardFooter,
    Alert,
    AlertTitle,
    AlertDescription,
    Empty,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription,
    EmptyContent,
    Tabs,
    TabsList,
    TabsTrigger,
    Dialog,
    DialogTrigger,
    DialogContent,
    DialogTitle,
    DialogDescription,
    Sheet,
    SheetTrigger,
    SheetContent,
    SheetTitle,
    SheetDescription,
    Popover,
    PopoverTrigger,
    PopoverContent,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    UiTheme,
    Checkbox,
    DsScope,
    Input,
    Separator,
    Skeleton,
    Surface,
    Switch,
    Textarea,
    BrowserAvatar,
    BrowserAction,
    BrandMark,
    BrowserCheckbox,
    BrowserDisclosure,
    BrowserSection,
    BrowserStatusTile,
    BrowserToggle,
    BusyMark,
  }),
});
Object.defineProperty(window, 'tmt', { value: runtime, enumerable: true });

// Component scopes can be present in the initial page or inserted by the page later.
if (typeof document !== 'undefined') installScopePortals(document);

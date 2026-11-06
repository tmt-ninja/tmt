/** Private owner-list fixture for moving an open page through the real router. */
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from '../src/router.js';
import { SaveRefused } from '../src/save.js';
import type { ManagementPort, Selection } from '../src/management.js';
import { localTransport, type PageBinding, type PageSummary } from '../src/transport.js';
import '@tmt/browser-ui/static.css';
import '../src/style.css';

const pageId = 'notes';
const oldId = '20000000-0000-4000-8000-000000000102';
const targetId = '20000000-0000-4000-8000-000000000103';
let parent: string | undefined;
let refuse: boolean;
let writes: string[];
let archived = false;
let publish: (() => void) | undefined;
let root: Root | undefined;

/** Observable fixture state: the page's current owner and the ordered writes. */
export function moveState() {
  return { parent, writes, archived };
}

export function updatePage() {
  publish?.();
}

export function mountMove() {
  root?.unmount();
  document.getElementById('root')!.style.display = 'none';
  let host = document.getElementById('page-move-fixture');
  if (!host) {
    host = document.createElement('div');
    host.id = 'page-move-fixture';
    document.body.append(host);
  }
  root = createRoot(host);
  parent = oldId;
  refuse = true;
  writes = [];
  archived = false;
  const view = {
    title: 'Release plan',
    source: '<h1>Release plan</h1>',
    work: { version: 2 as const, order: [] },
  };
  const binding: PageBinding = {
    subscribe(next) {
      publish = () => next(view);
      publish();
      return () => {
        publish = undefined;
      };
    },
    canWork: () => true,
    async work() {
      return {};
    },
    async edit() {
      return { merged: false };
    },
    async export() {
      throw new Error('Not used');
    },
    close() {},
  };
  const page = { id: pageId, sharing: 'private' as const, ...view, binding };
  const base = localTransport('Fixture', [page]);
  const listing = (): PageSummary[] => [
    {
      id: pageId,
      title: view.title,
      sharing: 'private',
      archived,
      ...(parent
        ? {
            summary: {
              comments: 0,
              waiting: false,
              needsYou: 0,
              parent: { page: parent, index: 0 },
            },
          }
        : {}),
    },
    { id: oldId, title: 'Planning', sharing: 'private', projects: ['Product'] },
    { id: targetId, title: 'Design', sharing: 'private', projects: ['Product'] },
    {
      id: '20000000-0000-4000-8000-000000000104',
      title: 'Design',
      sharing: 'private',
      summary: { comments: 0, waiting: false, needsYou: 0, parent: { page: oldId, index: 1 } },
    },
  ];
  const management: ManagementPort = {
    read: async () => ({}) as never,
    prepare: async (_view, selection) => ({ selection }) as never,
    send: async (pending) => {
      const { operation } = (pending as never as { selection: Selection }).selection;
      archived = operation === 'page.archive';
      return {} as never;
    },
    verify: async () => ({}) as never,
    setProjects: async () => {},
    manageProject: async () => {},
    setPinned: async () => {},
  };
  const transport = {
    ...base,
    management,
    async spaceHome() {
      return { title: 'Fixture', pages: listing() };
    },
    async page(id: string) {
      if (id === pageId) return page;
      const listed = listing().find((entry) => entry.id === id);
      if (!listed) throw new Error('No such page');
      return {
        ...listed,
        source: '<p>Parent</p>',
        binding: {
          ...binding,
          async work(action: 'subpage.attach' | 'subpage.detach') {
            writes.push(`${id}:${action}`);
            if (action === 'subpage.detach') parent = undefined;
            if (action === 'subpage.attach') {
              if (refuse) {
                refuse = false;
                throw new SaveRefused('fixture-refused', 'Refused');
              }
              parent = id;
            }
            return {};
          },
        },
      };
    },
  };
  location.hash = `/pages/${pageId}`;
  root.render(<RouterProvider router={createAppRouter(transport)} />);
}

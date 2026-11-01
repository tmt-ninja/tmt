/** A private in-memory space exercising the real Design APIs, router, header and renderer. */
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { startShellHost } from '@tmt/browser-ui/shell-host';
import { createAppRouter } from '../src/router.js';
import { ShellHostSlot } from '../src/colab-shell.js';
import { hostInShell } from '../src/entry.js';
import { createDesignSystem } from '../src/design-system-pages.js';
import type { PageBinding, PageTransport, PageView } from '../src/transport.js';
import '@tmt/browser-ui/static.css';
import '../src/style.css';

interface PageRecord {
  id: string;
  title: string;
  source: string;
  order: string[];
  projects: string[];
  attachments: { id: string; bytes: Uint8Array }[];
  listeners: Set<(view: PageView) => void>;
}
export async function mountDesign(url = '/colab/design/', owner = true) {
  const controls = { failUpload: false };
  const pages = new Map<string, PageRecord>();
  const counts = { opened: 0, closed: 0, active: 0, edits: 0 };
  const make = (title: string) => {
    const id = crypto.randomUUID();
    pages.set(id, {
      id,
      title,
      source: `<h1>${title}</h1>`,
      order: [],
      projects: [],
      attachments: [],
      listeners: new Set(),
    });
    return id;
  };
  const snapshot = (id: string) => {
    const page = pages.get(id);
    if (!page) throw new Error('Page unavailable');
    return {
      id,
      title: page.title,
      source: page.source,
      sharing: 'private' as const,
      layout: 'column' as const,
      work: { version: 2, order: [...page.order] },
      projects: [...page.projects],
      attachments: page.attachments.map((entry) => ({ attachmentId: entry.id })),
    };
  };
  const notify = (page: PageRecord) => {
    for (const listener of page.listeners) listener(snapshot(page.id) as unknown as PageView);
  };
  const binding = (id: string): PageBinding => {
    const page = pages.get(id)!;
    let closed = false;
    counts.opened++;
    counts.active++;
    return {
      close: () => {
        if (!closed) {
          closed = true;
          counts.closed++;
          counts.active--;
        }
      },
      subscribe: (listener: (view: PageView) => void) => {
        page.listeners.add(listener);
        return () => {
          page.listeners.delete(listener);
        };
      },
      edit: async (source: string, base: string) => {
        if (base !== page.source) throw new Error('stale base');
        page.source = source;
        counts.edits++;
        notify(page);
        return { merged: false };
      },
      work: async (action: string, body: Record<string, unknown>) => {
        if (action === 'subpage.detach') {
          page.order = page.order.filter((child) => child !== body.pageId);
          notify(page);
          return {};
        }
        if (action !== 'subpage.create') throw new Error(action);
        const child = make(String(body.title));
        page.order.push(child);
        notify(page);
        return { childPage: child };
      },
      files: {
        target: () => ({ kind: 'document', source: page.source }),
        add: async (stored: { id: string; bytes: Uint8Array }[]) => {
          page.attachments.push(...stored);
          notify(page);
        },
        attachments: {
          settle: async () => {},
          upload: async (input: { bytes: Uint8Array }) => {
            if (controls.failUpload) throw new Error('Fixture upload refused');
            const attachmentId = crypto.randomUUID();
            return {
              id: attachmentId,
              bytes: input.bytes,
              original: { descriptor: { attachmentId } },
            };
          },
          open: async (_reference: unknown, descriptor: { attachmentId: string }) => {
            const stored = page.attachments.find((entry) => entry.id === descriptor.attachmentId);
            if (!stored) throw new Error('Attachment unavailable');
            return stored.bytes;
          },
        },
      },
    } as unknown as PageBinding;
  };
  const transport = {
    page: async (id: string) => ({ ...snapshot(id), binding: binding(id) }),
    spaceHome: async () => ({
      title: 'Private Design fixture',
      projects: [...new Set([...pages.values()].flatMap((page) => page.projects))],
      pages: [...pages.keys()].map(snapshot),
    }),
    management: {
      setProjects: async (changes: { pageId: string; projects: string[] }[]) => {
        for (const change of changes) pages.get(change.pageId)!.projects = [...change.projects];
      },
    },
  } as unknown as PageTransport;
  // Load development-only CSS before applying the exact parent policy, so the proof tests the
  // mounted embed rather than Vite's inline stylesheet loader (production uses self-hosted CSS).
  await import('../src/design-route.js');
  await import('../../../../../design/browser-ui/docs/embed.js');
  const home = make('Notes');
  const initial = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
  if (!owner) delete (transport as { management?: unknown }).management;
  (window as unknown as { designFixture: unknown }).designFixture = {
    pages,
    counts,
    controls,
    initial,
    home,
  };
  const policy = (window as unknown as { designParentPolicy?: string }).designParentPolicy;
  if (policy) {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = policy;
    document.head.append(meta);
  }
  const element = document.getElementById('root')!;
  element.className = 'tmt-ui-shell';
  element.innerHTML =
    '<div class="tmt-ui-shell-content"><div class="tmt-ui-shell-bar"></div><div class="tmt-ui-shell-main"></div></div>';
  history.replaceState(null, '', url);
  hostInShell(null);
  const host = startShellHost(element, [
    {
      id: 'colab',
      paths: ['/colab', '/colab/'],
      rail: 'colab',
      load: async () => ({
        mount: (slot) => {
          const root = createRoot(slot.main);
          const router = createAppRouter(transport);
          root.render(
            <ShellHostSlot value={slot}>
              <RouterProvider router={router} />
            </ShellHostSlot>,
          );
          return () => root.unmount();
        },
      }),
    },
  ]);
  host.setCommonControls({
    openSearch: () => {},
    remote: { kind: 'unconfirmed', href: '/remote/' },
  });
}

/** A private in-memory space exercising the real Design APIs, router, header and renderer. */
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { startShellHost } from '@tmt/browser-ui/shell-host';
import { createAppRouter } from '../src/router.js';
import { ShellHostSlot } from '../src/colab-shell.js';
import { hostInShell } from '../src/entry.js';
import { createDesignSystem } from '../src/design-system-pages.js';
import { SaveOutcomeUnknown } from '../src/save.js';
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
  /** Bumped by every change, as the serve's page-read token moves with the page's head. */
  revision: number;
}
export async function mountDesign(url = '/colab/design/', owner = true) {
  const controls = {
    failUpload: false,
    holdCreate: false,
    createStarted: false,
    releaseCreate: undefined as (() => void) | undefined,
    refuseCreate: false,
    unknownCreate: false,
  };
  const pages = new Map<string, PageRecord>();
  const counts = { opened: 0, closed: 0, active: 0, edits: 0 };
  const anchors: { pageId: string; body: string; anchor: unknown }[] = [];
  // The live page list a mounted transport serves: every page's revision, after each change.
  const listWatchers = new Set<(revisions: ReadonlyMap<string, string>) => void>();
  const listed = () => {
    const revisions = new Map(
      [...pages.values()].map((page) => [
        page.id,
        `v1:${page.revision.toString(16).padStart(64, '0')}`,
      ]),
    );
    for (const watcher of listWatchers) watcher(revisions);
  };
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
      revision: 0,
    });
    listed();
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
      attachments: page.attachments.map((entry) => ({
        attachmentId: entry.id,
        filename: 'example.txt',
      })),
    };
  };
  const notify = (page: PageRecord) => {
    page.revision++;
    listed();
    for (const listener of page.listeners) listener(snapshot(page.id) as unknown as PageView);
  };
  const binding = (id: string): PageBinding => {
    const page = pages.get(id)!;
    let closed = false;
    counts.opened++;
    counts.active++;
    // Enough discussion to annotate: comments are recorded, never sent anywhere.
    const unused = async (): Promise<never> => {
      throw new Error('Not used by the Design fixture');
    };
    const discussion = {
      deviceId: '20000000-0000-4000-8000-000000000001',
      create: async (body: string, anchor: unknown) => {
        anchors.push({ pageId: id, body, anchor });
        return unused();
      },
      createChat: unused,
      reply: unused,
      edit: unused,
      deleteComment: unused,
      setStatus: unused,
      notificationFailed: unused,
      updateThread: unused,
    } as unknown as NonNullable<PageBinding['discussion']>;
    return {
      discussion,
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
        if (controls.holdCreate) {
          controls.holdCreate = false;
          controls.createStarted = true;
          await new Promise<void>((resolve) => {
            controls.releaseCreate = resolve;
          });
        }
        if (controls.refuseCreate) {
          controls.refuseCreate = false;
          throw new Error('Fixture creation refused');
        }
        if (controls.unknownCreate) {
          controls.unknownCreate = false;
          throw new SaveOutcomeUnknown('fixture-operation');
        }
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
    watchPages: (changed: (revisions: ReadonlyMap<string, string>) => void) => {
      listWatchers.add(changed);
      queueMicrotask(listed);
      return () => {
        listWatchers.delete(changed);
      };
    },
    spaceHome: async () => ({
      title: 'Private Design fixture',
      projects: [...new Set([...pages.values()].flatMap((page) => page.projects))],
      pages: [...pages.keys()].map(snapshot),
    }),
    management: {
      setProjects: async (changes: { pageId: string; projects: string[] }[]) => {
        // As the real client refuses: one request lists its pages in ID order.
        const order = changes.map((change) => change.pageId);
        if (order.join() !== [...order].sort().join())
          throw new Error('Invalid colab-v1 value or proof');
        for (const change of changes) pages.get(change.pageId)!.projects = [...change.projects];
      },
    },
  } as unknown as PageTransport;
  // Load development-only CSS before applying the exact parent policy, so the proof tests the
  // mounted embed rather than Vite's inline stylesheet loader (production uses self-hosted CSS).
  await import('../src/design-route.js');
  await import('@tmt/browser-ui/docs-embed');
  const home = make('Notes');
  const initial = await createDesignSystem(transport, { name: 'Acme', prefix: 'acme' });
  if (!owner) delete (transport as { management?: unknown }).management;
  (window as unknown as { designFixture: unknown }).designFixture = {
    pages,
    counts,
    anchors,
    // What an agent's `page patch --find --replace` does to the page's draft: one exact match, as
    // the owner applies it, then the live update every open view receives.
    patch(pageId: string, find: string, replace: string) {
      const page = pages.get(pageId)!;
      if (page.source.split(find).length !== 2) throw new Error('find must match exactly once');
      page.source = page.source.replace(find, () => replace);
      counts.edits++;
      notify(page);
    },
    addAttachment(pageId: string, id: string) {
      const page = pages.get(pageId)!;
      page.attachments.push({ id, bytes: new Uint8Array([1]) });
      notify(page);
    },
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
  const load = async () => ({
    mount: (slot: import('@tmt/browser-ui/shell-host').ShellSlot) => {
      const root = createRoot(slot.main);
      const router = createAppRouter(transport, '10000000-0000-4000-8000-00000000d351');
      root.render(
        <ShellHostSlot value={slot}>
          <RouterProvider router={router} />
        </ShellHostSlot>,
      );
      return () => root.unmount();
    },
  });
  const host = startShellHost(element, [
    { id: 'colab', paths: ['/colab', '/colab/'], rail: 'colab', load },
    { id: 'design', paths: ['/design', '/design/'], rail: 'design', load },
  ]);
  host.setCommonControls({
    openSearch: () => {},
    remote: { kind: 'unconfirmed', href: '/remote/' },
  });
}

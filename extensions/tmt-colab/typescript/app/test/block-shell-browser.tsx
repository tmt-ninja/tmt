/** The real app shell (rail, header, page stage) around a page of blocks over an in-memory page:
 * what the handle's room depends on is the stage's margin inside the shell, which the fixture host
 * of structured-page-browser.tsx (a 720px column) does not have (#6273). */
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { startShellHost } from '@tmt/browser-ui/shell-host';
import { createAppRouter } from '../src/router.js';
import { ShellHostSlot } from '../src/colab-shell.js';
import { hostInShell } from '../src/entry.js';
import type { BlockEntry } from '../src/blocks.js';
import type { PageBinding, PageTransport, PageView } from '../src/transport.js';
import '@tmt/browser-ui/static.css';
import '../src/style.css';

const PAGE = '20000000-0000-4000-8000-0000000000b1';
const text = (s: string) => ({ s, marks: [] });
const entry = (
  type: string,
  pos: string,
  s: string | undefined,
  props: Record<string, unknown> = {},
  parent = 'root',
): BlockEntry => ({
  type,
  parent,
  pos,
  props,
  ...(s !== undefined && { text: text(s) }),
});
/** Two paragraphs at the top level and one inside a card (the depths the handle must work at),
 * then a callout and a block under it. */
const blocks: Record<string, BlockEntry> = {
  head: entry('heading', 'B', 'Block page', { level: 2 }),
  one: entry('paragraph', 'C', '第一個最上層的區塊'),
  two: entry('paragraph', 'D', '第二個最上層的區塊'),
  card: entry('card', 'E', undefined, { title: 'Card' }),
  nested: entry('paragraph', 'B', '卡片裡面的區塊', {}, 'card'),
  // A callout draws the shared notice: it stays in the page's flow, not where the page's own
  // status notice goes (#6280).
  callout: entry('callout', 'F', '先做這個，再做下一個。', { tone: 'working', label: '做的順序' }),
  after: entry('paragraph', 'G', '提示下面的區塊'),
};

export async function mountBlockShell(url = `/colab/pages/${PAGE}`) {
  // The batches the editor sent: what a click on Insert block does, as the page answers later.
  const batches: { op: string; after?: string | null }[][] = [];
  (window as unknown as { blockShell: unknown }).blockShell = { batches };
  const view = (): PageView =>
    ({
      title: 'Block page',
      source: '',
      pageType: 'blocks',
      blocks: structuredClone(blocks),
      seq: 1,
      sharing: 'private',
      layout: 'column',
      work: { version: 2, order: [] },
      projects: [],
      attachments: [],
    }) as unknown as PageView;
  const unused = async (): Promise<never> => {
    throw new Error('Not used by the block shell fixture');
  };
  const binding = {
    discussion: {
      deviceId: '20000000-0000-4000-8000-000000000001',
      create: unused,
      createChat: unused,
      reply: unused,
      edit: unused,
      deleteComment: unused,
      setStatus: unused,
      notificationFailed: unused,
      updateThread: unused,
    },
    close: () => {},
    subscribe: (listener: (next: PageView) => void) => {
      listener(view());
      return () => {};
    },
    // The handle's room is the subject here, so a batch is kept and changes nothing.
    blocks: async (ops: { op: string; after?: string | null }[]) => {
      batches.push(ops);
      return { seq: 1 };
    },
  } as unknown as PageBinding;
  const snapshot = () => ({ id: PAGE, ...view(), binding });
  const transport = {
    page: async () => snapshot(),
    watchPages: (changed: (revisions: ReadonlyMap<string, string>) => void) => {
      queueMicrotask(() => changed(new Map([[PAGE, `v1:${'1'.padStart(64, '0')}`]])));
      return () => {};
    },
    spaceHome: async () => ({ title: 'Block shell fixture', projects: [], pages: [snapshot()] }),
  } as unknown as PageTransport;
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
  ]);
  host.setCommonControls({
    openSearch: () => {},
    remote: { kind: 'unconfirmed', href: '/remote/' },
  });
}

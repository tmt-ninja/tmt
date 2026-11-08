import type { BlockRecord } from './block-model.js';
import { blockRecords } from './block-projection.js';
import { BlockTree } from './block-tree.js';
import type { ParentPageViewSource } from './parent-page-view.js';
import type { PageSnapshot, PageView } from './transport.js';

/**
 * Other pages for the @ picker (#6208): the page list under the page list's own authority (the
 * gated owner list, as the page-view block reads it), and one other page's blocks, read only when
 * the person opens that page in the menu. Nothing here is read while typing, and nothing outlives
 * the menu: each read takes the menu's signal.
 */
export interface MentionPages {
  /** The owner's pages (no archived or design-system page), read once per menu. */
  list(signal: AbortSignal): Promise<readonly { id: string; title: string }[]>;
  /** One page's blocks in reading order, at most `PAGE_BLOCKS`; none for a page that holds none. */
  blocks(pageId: string, signal: AbortSignal): Promise<readonly BlockRecord[]>;
}

/** How long one page may take to read. */
export const PAGE_READ_MS = 10_000;
/** How many of a page's blocks the menu reads. */
export const PAGE_BLOCKS = 500;
/** How many page rows the menu shows. */
export const PAGE_ROWS = 5;

const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

/** The live source: `pages` is the router's gated page-list source, `open` opens a page as the
 * work-bundle block does, and `admitted` is the same owner-only gate, checked again per read. */
export function mentionPages(
  pages: ParentPageViewSource,
  open: (pageId: string, signal: AbortSignal) => Promise<PageSnapshot>,
  admitted: () => boolean,
): MentionPages {
  return {
    list(signal) {
      return Promise.race([
        aborted(signal),
        new Promise<readonly { id: string; title: string }[]>((resolve, reject) => {
          let stop = () => {};
          let done = false;
          const settle = (rows?: readonly { id: string; name: string }[]) => {
            if (done) return;
            done = true;
            queueMicrotask(() => stop());
            if (rows) resolve(rows.map(({ id, name }) => ({ id, title: name })));
            else reject(new Error('The page list is not available here.'));
          };
          stop = pages(
            (rows) => settle(rows),
            () => settle(),
          );
          if (done) stop();
          signal.addEventListener('abort', () => stop(), { once: true });
        }),
      ]);
    },
    async blocks(pageId, signal) {
      if (!admitted()) throw new Error('The page list is not available here.');
      const opened = await open(pageId, signal);
      const binding = opened.binding;
      try {
        if (opened.id !== pageId || !binding) throw new Error('That page could not be opened.');
        // The first view says what the page holds; nothing else of it is kept.
        let stop = () => {};
        const view = await Promise.race([
          aborted(signal),
          new Promise<PageView>((resolve, reject) => {
            stop = binding.subscribe(resolve, reject);
          }),
        ]).finally(() => stop());
        if (!admitted()) throw new Error('The page list is not available here.');
        if (!view.blocks) return [];
        return new BlockTree(blockRecords(view.blocks).records).flat().slice(0, PAGE_BLOCKS);
      } finally {
        binding?.close();
      }
    },
  };
}

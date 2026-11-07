import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockOp, BlockRecord } from './block-model.js';
import { BlockTextSync, TEXT_FLUSH_MS } from './block-text-sync.js';
import { BlockTree } from './block-tree.js';

/** What the focused block shows while it is edited. */
export interface Editing {
  id: string;
  text: string;
  caret: number;
  /** Moves on every text the page sends, so the editor replaces its text even when it is equal to
   * the last one sent. */
  version: number;
}

/**
 * The structured page's editing state (#6005): the tree the page draws from `records` (the page's
 * latest blocks), and the one focused text block's typing. Typing goes out through `send` as one
 * op once it rests `TEXT_FLUSH_MS` (or when focus leaves); `send` resolves once the page shows the
 * op and rejects when the serve refuses it. While an op is out, the page's text for that block is
 * held and merged when it settles (`BlockTextSync`).
 */
export function useBlockEditing(
  records: readonly BlockRecord[],
  send: (ops: BlockOp[]) => Promise<void>,
) {
  const tree = useMemo(() => new BlockTree(records), [records]);
  const [editing, setEditing] = useState<Editing>();
  const sync = useRef<BlockTextSync | undefined>(undefined);
  const caret = useRef(0);
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sendRef = useRef(send);
  sendRef.current = send;

  // `flush` and `show` call each other; `flush` reaches `show` through a ref, so both stay stable.
  const showRef = useRef<(current: BlockTextSync, shown: { text: string; caret: number }) => void>(
    () => {},
  );
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const current = sync.current;
    const op = current?.flush();
    if (!current || !op) return;
    void sendRef.current([op]).then(
      () => showRef.current(current, current.settled(true, caret.current)),
      () => showRef.current(current, current.settled(false, caret.current)),
    );
  }, []);
  const show = useCallback(
    (current: BlockTextSync, shown: { text: string; caret: number }) => {
      if (sync.current !== current) return;
      caret.current = shown.caret;
      setEditing({
        id: current.id,
        text: shown.text,
        caret: shown.caret,
        version: ++version.current,
      });
      // Typing that waited for the op in flight goes out now.
      if (current.pending && !current.sending) timer.current = setTimeout(flush, TEXT_FLUSH_MS);
    },
    [flush],
  );
  showRef.current = show;

  // The page's text for the focused block moved: merge it into what the editor shows.
  useEffect(() => {
    const current = sync.current;
    if (!current) return;
    const block = tree.get(current.id);
    if (!block || !tree.visible(current.id)) {
      // Deleted or gone under another writer: the editor closes; unsent typing is kept on the op.
      flush();
      sync.current = undefined;
      setEditing(undefined);
      return;
    }
    show(current, current.remote(block.text ?? '', caret.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const focus = useCallback(
    (id: string) => {
      if (sync.current?.id === id) return;
      flush();
      const block = tree.get(id);
      if (!block || block.text === undefined) return;
      sync.current = new BlockTextSync(id, block.text);
      caret.current = [...block.text].length;
      setEditing({ id, text: block.text, caret: caret.current, version: ++version.current });
    },
    [tree, flush],
  );
  const typed = useCallback(
    (id: string, text: string, at: number) => {
      const current = sync.current;
      if (current?.id !== id) return;
      current.typed(text);
      caret.current = at;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, TEXT_FLUSH_MS);
    },
    [flush],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { tree, editing, focus, typed, flush };
}

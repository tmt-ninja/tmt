import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { insertGroups, nextBlockMenuItem } from '@tmt/browser-ui/blocks';
import { type BlockOp, type BlockRecord, isBlockType, TEXT_TYPES } from './block-model.js';
import { filterInsert, insertType, opensInsert, type InsertEntry } from './block-insert.js';
import { insertBlock, joinBlock, joinTarget, splitBlock } from './block-ops.js';
import { BlockTextSync, TEXT_FLUSH_MS } from './block-text-sync.js';
import { BlockTree } from './block-tree.js';

/** The insert menu's entries: the design system's catalog, the one the menu draws. */
const INSERT_ENTRIES: readonly InsertEntry[] = insertGroups.flatMap((group) =>
  group.items.map(({ id, label, shortcut }) => ({ id, label, shortcut })),
);

/** The insert menu open on a block: what follows `/` filters it. */
export interface InsertMenu {
  id: string;
  entries: InsertEntry[];
  /** The active entry's id. */
  active?: string;
}

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
 *
 * Enter and Backspace at a block's edges are one batch each: the split or join with the typing not
 * sent yet. They wait for the text op on its way, so each batch starts from what the page shows.
 */
export function useBlockEditing(
  records: readonly BlockRecord[],
  send: (ops: BlockOp[]) => Promise<void>,
) {
  const tree = useMemo(() => new BlockTree(records), [records]);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const [editing, setEditing] = useState<Editing>();
  const sync = useRef<BlockTextSync | undefined>(undefined);
  const caret = useRef(0);
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The send on its way; a structural gesture waits for it. */
  const inflight = useRef<Promise<void>>(Promise.resolve());
  /** A block this tab inserted and focused before the page shows it. */
  const arriving = useRef<string | undefined>(undefined);
  const sendRef = useRef(send);
  sendRef.current = send;
  /** The block the insert menu is open on, and its active entry. */
  const [menuAt, setMenuAt] = useState<{ id: string; query: string; active?: string }>();
  const menuRef = useRef(menuAt);
  menuRef.current = menuAt;

  const open = useCallback((next: BlockTextSync, at: number) => {
    sync.current = next;
    caret.current = at;
    setEditing({ id: next.id, text: next.text, caret: at, version: ++version.current });
  }, []);

  // `flush` and `show` call each other; `flush` reaches `show` through a ref, so both stay stable.
  const showRef = useRef<(current: BlockTextSync, shown: { text: string; caret: number }) => void>(
    () => {},
  );
  /** Send `ops`, with `current`'s text op among them, and show its settle in the editor. */
  const out = useCallback((current: BlockTextSync | undefined, ops: BlockOp[]) => {
    const sent = sendRef.current(ops);
    inflight.current = sent.then(
      () => {
        if (current) showRef.current(current, current.settled(true, caret.current));
      },
      () => {
        if (current) showRef.current(current, current.settled(false, caret.current));
      },
    );
    return sent;
  }, []);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const current = sync.current;
    const op = current?.flush();
    if (!current || !op) return;
    void out(current, [op]);
  }, [out]);
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
      // Not on the page yet: this tab's own insert is on its way.
      if (arriving.current === current.id) return;
      // Deleted or gone under another writer: the editor closes; unsent typing is kept on the op.
      flush();
      sync.current = undefined;
      setEditing(undefined);
      return;
    }
    if (arriving.current === current.id) arriving.current = undefined;
    show(current, current.remote(block.text ?? '', caret.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const focus = useCallback(
    (id: string) => {
      if (sync.current?.id === id) return;
      flush();
      const block = tree.get(id);
      if (!block || block.text === undefined) return;
      open(new BlockTextSync(id, block.text), [...block.text].length);
    },
    [tree, flush, open],
  );
  const typed = useCallback(
    (id: string, text: string, at: number) => {
      const current = sync.current;
      if (current?.id !== id) return;
      current.typed(text);
      caret.current = at;
      const menu = menuRef.current;
      if (menu?.id === id) setMenuAt(text.startsWith('/') ? { ...menu, query: text } : undefined);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, TEXT_FLUSH_MS);
    },
    [flush],
  );

  /** Enter at scalar `at`: the rest of the text starts a new block, focused at its start. */
  const split = useCallback(
    async (current: BlockTextSync, at: number) => {
      clearTimeout(timer.current);
      await inflight.current;
      if (sync.current !== current) return;
      const before = treeRef.current;
      const newId = crypto.randomUUID();
      const text = current.text;
      const ops = splitBlock(before, current.id, at, newId, {
        text,
        base: current.base,
      });
      const tail = [...text].slice(at).join('');
      arriving.current = newId;
      open(new BlockTextSync(newId, tail), 0);
      try {
        await out(undefined, ops);
      } catch {
        // Refused: nothing changed on the page. The person's text goes back where it was.
        if (sync.current?.id === newId) {
          arriving.current = undefined;
          const back = new BlockTextSync(current.id, before.get(current.id)?.text ?? '');
          back.typed(text);
          open(back, at);
          timer.current = setTimeout(flush, TEXT_FLUSH_MS);
        }
      }
    },
    [open, out, flush],
  );

  /** Backspace at the start: the text joins the end of the text block before it, focused at the
   * join, and this block is deleted. */
  const join = useCallback(
    async (current: BlockTextSync) => {
      clearTimeout(timer.current);
      await inflight.current;
      if (sync.current !== current) return;
      const before = treeRef.current;
      const previous = joinTarget(before, current.id);
      if (!previous) return;
      const ops = joinBlock(before, current.id, current.text);
      const into = new BlockTextSync(previous.id, previous.text!);
      into.typed(previous.text! + current.text);
      // The join's text op is the one `into` has on its way.
      into.flush();
      open(into, [...previous.text!].length);
      await out(into, ops).catch(() => {});
    },
    [open, out],
  );

  /** The insert menu's choice: a new block of its type replaces the slash paragraph (a block's
   * type is fixed once made), focused when it holds text; a paragraph just clears the slash. */
  const pick = useCallback(
    async (entry: string) => {
      const current = sync.current;
      const at = menuRef.current;
      if (!current || at?.id !== current.id) return;
      setMenuAt(undefined);
      const type = insertType(entry);
      if (type === 'paragraph') {
        current.typed('');
        open(current, 0);
        flush();
        return;
      }
      clearTimeout(timer.current);
      await inflight.current;
      if (sync.current !== current) return;
      const newId = crypto.randomUUID();
      const text = TEXT_TYPES.has(type);
      const ops: BlockOp[] = [
        insertBlock(treeRef.current, {
          id: newId,
          type,
          after: current.id,
          ...(text && { text: '' }),
        }),
        { op: 'delete', id: current.id },
      ];
      if (text) {
        arriving.current = newId;
        open(new BlockTextSync(newId, ''), 0);
      } else {
        sync.current = undefined;
        setEditing(undefined);
      }
      await out(undefined, ops).catch(() => {
        if (arriving.current === newId) arriving.current = undefined;
      });
    },
    [open, out, flush],
  );

  /** A key in the focused block; true when the block took it. */
  const key = useCallback(
    (id: string, event: KeyboardEvent, text: string, at: number, collapsed: boolean): boolean => {
      const current = sync.current;
      if (current?.id !== id || event.altKey || event.metaKey || event.ctrlKey) return false;
      const block = treeRef.current.get(id);
      if (!block || !TEXT_TYPES.has(block.type)) return false;
      current.typed(text);
      const menu = menuRef.current?.id === id ? menuRef.current : undefined;
      if (menu) {
        const ids = filterInsert(INSERT_ENTRIES, text).map((entry) => entry.id);
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && ids.length) {
          setMenuAt({ ...menu, active: nextBlockMenuItem(ids, menu.active, event.key) });
          return true;
        }
        if (event.key === 'Escape') {
          // Closes and keeps what was typed.
          setMenuAt(undefined);
          return true;
        }
        if (event.key === 'Enter' && ids.length) {
          void pick(menu.active && ids.includes(menu.active) ? menu.active : ids[0]!);
          return true;
        }
      } else if (
        event.key === '/' &&
        isBlockType(block.type) &&
        opensInsert(event.key, { type: block.type, text })
      )
        // The slash is typed as usual; what follows it filters the menu.
        setMenuAt({ id, query: '/' });
      if (event.key === 'Enter' && !event.shiftKey && block.type !== 'code' && collapsed) {
        void split(current, at);
        return true;
      }
      if (event.key === 'Backspace' && at === 0 && collapsed && !event.shiftKey) {
        if (!joinTarget(treeRef.current, id)) return false;
        void join(current);
        return true;
      }
      return false;
    },
    [split, join, pick],
  );

  const menu = useMemo((): InsertMenu | undefined => {
    if (!menuAt || editing?.id !== menuAt.id) return undefined;
    const entries = filterInsert(INSERT_ENTRIES, menuAt.query);
    const active =
      menuAt.active && entries.some((entry) => entry.id === menuAt.active)
        ? menuAt.active
        : entries[0]?.id;
    return { id: menuAt.id, entries, ...(active && { active }) };
  }, [menuAt, editing?.id]);
  const hover = useCallback((entry: string) => {
    setMenuAt((at) => (at ? { ...at, active: entry } : at));
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return { tree, editing, focus, typed, flush, key, menu, pick, hover };
}

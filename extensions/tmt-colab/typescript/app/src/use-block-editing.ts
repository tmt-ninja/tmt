import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { blockKeyAction, insertGroups, nextBlockMenuItem } from '@tmt/browser-ui/blocks';
import { type BlockOp, type BlockRecord, isBlockType, TEXT_TYPES } from './block-model.js';
import { filterInsert, insertType, opensInsert, type InsertEntry } from './block-insert.js';
import { applyOps } from './block-apply.js';
import { BlockHistory } from './block-history.js';
import {
  deleteBlocks,
  duplicateBlock,
  insertBlock,
  joinBlock,
  joinTarget,
  moveBlock,
  nudgeBlock,
  splitBlock,
} from './block-ops.js';
import {
  type BlockSelection,
  extendSelection,
  selectBlock,
  selectedIds,
  settleSelection,
} from './block-selection.js';
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

/** The block menu's actions this editor runs, in the design system's catalog order (Move to…, copy
 * link and @ this block come with their own steps). */
export const BLOCK_MENU_ACTIONS = ['move-up', 'move-down', 'duplicate', 'delete'] as const;
export type BlockMenuAction = (typeof BLOCK_MENU_ACTIONS)[number];

/** How long the status line after a delete stays. */
export const TOAST_MS = 6000;

/** The status line after a delete, with Undo. */
export interface DeleteToast {
  /** How many blocks the delete took. */
  count: number;
  /** Moves with every delete, so a new one restarts the line. */
  id: number;
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
 * op (with the first view order that shows it) and rejects when the serve refuses it. While an op
 * is out, the page's text for that block is held and merged when it settles; views older than the
 * commit are dropped by their order (`BlockTextSync`).
 *
 * Enter and Backspace at a block's edges are one batch each: the split or join with the typing not
 * sent yet. They wait for the text op on its way, so each batch starts from what the page shows.
 */
export function useBlockEditing(
  records: readonly BlockRecord[],
  send: (ops: BlockOp[]) => Promise<number | void>,
  /** The local order of the view `records` came from (`PageView.seq`), when the page gives one. */
  seq?: number,
) {
  /** This tab's batches on their way: the page draws them at once and drops each when it settles
   * (the page then shows it, or it was refused). */
  const [pending, setPending] = useState<readonly { key: number; ops: BlockOp[] }[]>([]);
  const batchKey = useRef(0);
  /** The page as the serve shows it: what the focused block's text merges with. */
  const pageTree = useMemo(() => new BlockTree(records), [records]);
  /** The page as drawn: the serve's blocks with this tab's batches on their way applied. A batch
   * the serve would refuse is left out. */
  const tree = useMemo(() => {
    let drawn: readonly BlockRecord[] = records;
    for (const batch of pending)
      try {
        drawn = applyOps(drawn, batch.ops);
      } catch {
        // Drawn without it; the serve refuses it too, and the page stays as it shows.
      }
    return pending.length ? new BlockTree(drawn) : pageTree;
  }, [records, pending, pageTree]);
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
  /** This tab's own gestures, for ⌘Z and Undo (`BlockHistory`). */
  const history = useRef(new BlockHistory());
  const [selection, setSelection] = useState<BlockSelection>();
  const [toast, setToast] = useState<DeleteToast>();
  /** The block menu open on a block, and its active action. */
  const [blockMenu, setBlockMenu] = useState<{ id: string; active?: string }>();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    const key = ++batchKey.current;
    setPending((now) => [...now, { key, ops }]);
    const sent = sendRef.current(ops);
    const drop = () => setPending((now) => now.filter((batch) => batch.key !== key));
    sent.then(drop, drop);
    inflight.current = sent.then(
      (at) => {
        if (current)
          showRef.current(
            current,
            current.settled(true, caret.current, typeof at === 'number' ? at : undefined),
          );
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

  // A selected block the page no longer draws leaves the selection.
  useEffect(() => {
    setSelection((now) => settleSelection(tree, now));
  }, [tree]);

  // The page's text for the focused block moved: merge it into what the editor shows.
  useEffect(() => {
    const current = sync.current;
    if (!current) return;
    // The serve's page, not the drawn one: the focused text merges with what others wrote, and this
    // tab's own batches settle through `BlockTextSync`.
    const block = pageTree.get(current.id);
    if (!block || !pageTree.visible(current.id)) {
      // Not on the page yet: this tab's own insert is on its way.
      if (arriving.current === current.id) return;
      // Deleted or gone under another writer: the editor closes; unsent typing is kept on the op.
      flush();
      sync.current = undefined;
      setEditing(undefined);
      return;
    }
    if (arriving.current === current.id) arriving.current = undefined;
    show(current, current.remote(block.text ?? '', caret.current, seq));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTree]);

  const focus = useCallback(
    (id: string) => {
      setSelection(undefined);
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
      history.current.record(before, ops);
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
      history.current.record(before, ops);
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
      history.current.record(treeRef.current, ops);
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
      } else if (event.key === 'Escape') {
        // Typing turns into selecting this block; the typing goes out as it would on blur.
        flush();
        sync.current = undefined;
        setEditing(undefined);
        setSelection(selectBlock(id));
        return true;
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
    [split, join, pick, flush],
  );

  /** Take this tab's latest gesture back (or make it again), as a new batch that merges with what
   * others wrote meanwhile. A restored block is selected again. */
  const replay = useCallback(
    (direction: 'undo' | 'redo') => {
      const ops = direction === 'undo' ? history.current.undo() : history.current.redo();
      if (!ops) return;
      clearTimeout(toastTimer.current);
      setToast(undefined);
      const restored = ops.filter((op) => op.op === 'restore').map((op) => op.id);
      if (restored.length)
        setSelection({ anchor: restored[0]!, focus: restored[restored.length - 1]! });
      void out(undefined, ops).catch(() => {});
    },
    [out],
  );
  const undo = useCallback(() => replay('undo'), [replay]);

  /** One gesture of this tab: recorded for ⌘Z, then sent. */
  const gesture = useCallback(
    (ops: BlockOp[]) => {
      if (!ops.length) return;
      history.current.record(treeRef.current, ops);
      void out(undefined, ops).catch(() => {});
    },
    [out],
  );

  /** Delete these blocks: they go at once, and the status line offers Undo. */
  const deleteIds = useCallback(
    (chosen: readonly string[]) => {
      const before = treeRef.current;
      const ops = deleteBlocks(before, chosen);
      if (!ops.length) return;
      // The block after the deleted ones (else the one before) takes the selection, so the keys
      // and ⌘Z stay on the page.
      const ids = before.flat().map((block) => block.id);
      const gone = new Set(chosen);
      const last = Math.max(...chosen.map((id) => ids.indexOf(id)));
      const first = Math.min(...chosen.map((id) => ids.indexOf(id)));
      const next =
        ids.slice(last + 1).find((id) => !gone.has(id)) ??
        ids
          .slice(0, first)
          .reverse()
          .find((id) => !gone.has(id));
      setSelection(next ? selectBlock(next) : undefined);
      clearTimeout(toastTimer.current);
      setToast((now) => ({ count: ops.length, id: (now?.id ?? 0) + 1 }));
      toastTimer.current = setTimeout(() => setToast(undefined), TOAST_MS);
      gesture(ops);
    },
    [gesture],
  );

  /** A block menu action, or its key, on `id`. */
  const act = useCallback(
    (action: BlockMenuAction, id: string) => {
      setBlockMenu(undefined);
      const tree = treeRef.current;
      if (action === 'delete') return deleteIds([id]);
      if (action === 'move-up' || action === 'move-down') {
        gesture(nudgeBlock(tree, id, action === 'move-up' ? 'up' : 'down'));
        setSelection(selectBlock(id));
        return;
      }
      // Duplicate: a copy right after it, a card with copies of its blocks.
      const ops = duplicateBlock(tree, id, () => crypto.randomUUID());
      gesture(ops);
      const copy = ops[0]?.op === 'insert' ? ops[0].id : undefined;
      if (copy) setSelection(selectBlock(copy));
    },
    [deleteIds, gesture],
  );

  /** A drop from the handle: `id` goes to `index` among `parent`'s children. */
  const move = useCallback(
    (id: string, parent: string, index: number) => {
      gesture(moveBlock(treeRef.current, id, parent, index));
      setSelection(selectBlock(id));
    },
    [gesture],
  );

  /** Open the block menu on `id` (the handle's ⋯, or the menu key); the block is selected so the
   * menu's keys reach the page. */
  const openBlockMenu = useCallback(
    (id: string) => {
      flush();
      sync.current = undefined;
      setEditing(undefined);
      setMenuAt(undefined);
      setSelection(selectBlock(id));
      setBlockMenu({ id, active: BLOCK_MENU_ACTIONS[0] });
    },
    [flush],
  );

  /** ＋ on the handle: an empty paragraph right after `id` holding "/", with the insert menu. */
  const insertAfter = useCallback(
    (id: string) => {
      const newId = crypto.randomUUID();
      const ops = [
        insertBlock(treeRef.current, { id: newId, type: 'paragraph', after: id, text: '/' }),
      ];
      flush();
      setSelection(undefined);
      setBlockMenu(undefined);
      arriving.current = newId;
      const next = new BlockTextSync(newId, '/');
      open(next, 1);
      setMenuAt({ id: newId, query: '/' });
      history.current.record(treeRef.current, ops);
      void out(undefined, ops).catch(() => {
        if (arriving.current === newId) arriving.current = undefined;
      });
    },
    [flush, open, out],
  );

  /** A key on the page outside a block's editor; true when taken. */
  const pageKey = useCallback(
    (event: KeyboardEvent): boolean => {
      const menuOn = blockMenu;
      if (menuOn) {
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          setBlockMenu({
            ...menuOn,
            active: nextBlockMenuItem(BLOCK_MENU_ACTIONS, menuOn.active, event.key),
          });
          return true;
        }
        if (event.key === 'Enter' && menuOn.active) {
          act(menuOn.active as BlockMenuAction, menuOn.id);
          return true;
        }
        if (event.key === 'Escape') {
          setBlockMenu(undefined);
          return true;
        }
      }
      const selecting = Boolean(selection) && !sync.current;
      const action = blockKeyAction(event, selecting);
      if (action === 'undo') {
        replay('undo');
        return true;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (
        mod &&
        (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))
      ) {
        replay('redo');
        return true;
      }
      if (!selection || !selecting) return false;
      const ids = treeRef.current.flat().map((block) => block.id);
      switch (action) {
        case 'menu':
          openBlockMenu(selection.focus);
          return true;
        case 'delete':
          deleteIds(selectedIds(treeRef.current, selection));
          return true;
        case 'escape':
          setSelection(undefined);
          return true;
        case 'move-up':
        case 'move-down':
          act(action, selection.focus);
          return true;
        case 'duplicate':
          act('duplicate', selection.focus);
          return true;
        case 'extend-previous':
        case 'extend-next':
          setSelection(
            extendSelection(
              treeRef.current,
              selection,
              action === 'extend-previous' ? 'up' : 'down',
            ),
          );
          return true;
        case 'previous':
        case 'next': {
          const at = ids.indexOf(selection.focus) + (action === 'previous' ? -1 : 1);
          const next = ids[Math.max(0, Math.min(ids.length - 1, at))];
          if (next) setSelection(selectBlock(next));
          return true;
        }
      }
      if (event.key === 'Enter' && selection.anchor === selection.focus) {
        focus(selection.focus);
        return true;
      }
      return false;
    },
    [blockMenu, selection, replay, deleteIds, focus, act, openBlockMenu],
  );
  const selected = useMemo(() => selectedIds(tree, selection), [tree, selection]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const menu = useMemo((): InsertMenu | undefined => {
    if (!menuAt || editing?.id !== menuAt.id) return undefined;
    const entries = filterInsert(INSERT_ENTRIES, menuAt.query);
    const active =
      menuAt.active && entries.some((entry) => entry.id === menuAt.active)
        ? menuAt.active
        : entries[0]?.id;
    return { id: menuAt.id, entries, ...(active && { active }) };
  }, [menuAt, editing?.id]);
  const closeMenu = useCallback(() => setMenuAt(undefined), []);
  const hover = useCallback((entry: string) => {
    setMenuAt((at) => (at ? { ...at, active: entry } : at));
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    tree,
    editing,
    focus,
    typed,
    flush,
    key,
    menu,
    pick,
    hover,
    closeMenu,
    selected,
    selectionFocus: selection?.focus,
    pageKey,
    blockMenu,
    act,
    move,
    openBlockMenu,
    insertAfter,
    closeBlockMenu: () => setBlockMenu(undefined),
    hoverBlockMenu: (action: string) =>
      setBlockMenu((now) => (now ? { ...now, active: action } : now)),
    toast,
    undo,
  };
}

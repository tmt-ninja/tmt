import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { blockKeyAction, insertGroups, nextBlockMenuItem } from '@tmt/browser-ui/blocks';
import {
  type BlockOp,
  type BlockRecord,
  isBlockType,
  PAGE_PARENT,
  TEXT_TYPES,
  type TableColumnEdit,
  type TableRowAction,
  type TextMark,
  tableColumns,
} from './block-model.js';
import { filterInsert, insertType, opensInsert, type InsertEntry } from './block-insert.js';
import { BlockHistory } from './block-history.js';
import {
  addRow,
  deleteBlocks,
  duplicateBlock,
  editQuestion,
  insertBlock,
  joinBlock,
  joinTarget,
  moveBlock,
  newQuestionProps,
  nudgeBlock,
  type QuestionEdit,
  splitBlock,
} from './block-ops.js';
import {
  type BlockSelection,
  extendSelection,
  selectBlock,
  selectedIds,
  settleSelection,
} from './block-selection.js';
import { BlockTextSync, type Shown, type TableCell, TEXT_FLUSH_MS } from './block-text-sync.js';
import { marked, typedMarks } from './block-marks.js';
import { indentBlock } from './block-ops.js';
import type { TextRange } from './block-text-editor.js';
import { applyOps } from './block-apply.js';
import { richType, validMarkValue } from './blocks.js';
import { BlockTree } from './block-tree.js';
import { attachment } from '@tmt/colab-client';
import type { StoredAttachment } from './attachment-service.js';
import { type BlockFiles, fileBlock, fitsAttachments, readBlockFile } from './block-uploads.js';
import { SaveNotApplied, SaveOutcomeUnknown, SaveRefused } from './save.js';
import { text as strings } from './strings.js';
import {
  type MentionEntry,
  mentionEntries,
  type MentionPagesState,
  mentionQuery,
} from './block-mention.js';
import { type MentionPages, PAGE_READ_MS } from './mention-pages.js';

/** The insert menu's entries: the design system's catalog, the one the menu draws. */
const INSERT_ENTRIES: readonly InsertEntry[] = insertGroups.flatMap((group) =>
  group.items.map(({ id, label, shortcut }) => ({ id, label, shortcut })),
);

/** The text `current` edits as `tree` draws it: a block's text, or a cell's; none when the tree
 * does not draw it (deleted, or not on the page yet). */
function drawnText(
  tree: BlockTree,
  { id, cell }: { id: string; cell?: TableCell },
): string | undefined {
  if (!cell) {
    const block = tree.get(id);
    return block && tree.visible(id) ? (block.text ?? '') : undefined;
  }
  const { table, column } = cell;
  if (!tree.visible(table) || !tableColumns(tree.get(table)!.props).some((c) => c.id === column))
    return undefined;
  const row = tree.rows(table).find((r) => r.id === id);
  return row && (row.cells?.[column] ?? '');
}

/** The insert menu open on a block: what follows `/` filters it. */
export interface InsertMenu {
  id: string;
  entries: InsertEntry[];
  /** The active entry's id. */
  active?: string;
}

/** The @ menu open in the focused block (#6203): what follows the @ filters it. */
export interface MentionMenu {
  id: string;
  entries: MentionEntry[];
  /** The active entry's id. */
  active?: string;
  /** Another page's blocks are being read (#6208). */
  reading?: boolean;
}

/** The active row: the one the keys or pointer chose, else the first that is not the way back. */
function activeMention(entries: readonly MentionEntry[], active?: string): string | undefined {
  if (active && entries.some((entry) => entry.id === active)) return active;
  return (entries.find((entry) => entry.mark !== 'back') ?? entries[0])?.id;
}

/** The block menu's actions this editor runs, in the design system's catalog order (Move to…, copy
 * link and @ this block come with their own steps). */
export const BLOCK_MENU_ACTIONS = ['move-up', 'move-down', 'duplicate', 'delete'] as const;
export type BlockMenuAction = (typeof BLOCK_MENU_ACTIONS)[number];

/** How long the status line after a delete stays. */
export const TOAST_MS = 6000;

/** The format keys with ⌘ (Ctrl elsewhere) on a selected range: each toggles its mark. */
const FORMAT_KEYS: Readonly<Record<string, 'bold' | 'italic' | 'code'>> = {
  b: 'bold',
  i: 'italic',
  e: 'code',
};

/** The status line after a delete, with Undo, or a notice about files that were not added. */
export interface DeleteToast {
  /** How many blocks the delete took. */
  count: number;
  /** Why files were not added (#6202), or that a batch was refused (#6220); no Undo then. */
  notice?: string;
  /** Sends a refused batch again; the notice then has Retry and stays until it is sent. */
  retry?: () => void;
  /** Moves with every line, so a new one restarts it. */
  id: number;
}

/** A file block this tab is adding (#6202): its tile while the file uploads, or once the upload
 * or its batch failed, with Retry. */
export type BlockUpload = { state: 'loading' } | { state: 'failed'; retry(): void };

/** What the focused block, or table cell, shows while it is edited. */
export interface Editing {
  /** The block, or a cell's row. */
  id: string;
  /** A cell's column; absent for a block. */
  column?: string;
  text: string;
  caret: number;
  /** Moves on every text the page sends, so the editor replaces its text even when it is equal to
   * the last one sent. */
  version: number;
  /** The text the editor showed when `text` was made; absent when the editor opens on `text`. Keys
   * it takes before it draws `text` merge onto it from here (#6221). */
  from?: string;
}

/** A batch the serve refused for good: what the status line says, and whether it may be sent
 * again (not when its outcome is in doubt: it may have landed). */
interface Refusal {
  key: number;
  ops: BlockOp[];
  message: string;
  retryable: boolean;
}
function refusalOf(key: number, ops: BlockOp[], error: unknown): Refusal {
  if (error instanceof SaveRefused)
    return {
      key,
      ops,
      retryable: true,
      message:
        error.code === 'COLAB_STALE_BASE'
          ? strings.blockEdit.stale
          : error.message
            ? strings.blockEdit.refused(error.message)
            : strings.blockEdit.failed,
    };
  if (error instanceof SaveNotApplied)
    return { key, ops, retryable: true, message: strings.blockEdit.notApplied };
  if (error instanceof SaveOutcomeUnknown)
    return { key, ops, retryable: false, message: strings.blockEdit.unknown };
  return { key, ops, retryable: false, message: strings.blockEdit.failed };
}

/** The status line for the oldest refused batch: it stays until Retry sends the batch again, and
 * a timed notice (a delete's Undo) is shown over it while that lasts. */
function shownRefusal(refusal: Refusal | undefined, retry: () => void): DeleteToast | undefined {
  return refusal && { count: 0, notice: refusal.message, retry, id: -refusal.key };
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
  /** Sends one batch; `stored` files join the page's attachment list in that same batch. */
  send: (ops: BlockOp[], stored?: readonly StoredAttachment[]) => Promise<number | void>,
  /** The local order of the view `records` came from (`PageView.seq`), when the page gives one. */
  seq?: number,
  /** The page's files, when this tab may add them (#6202). */
  files?: BlockFiles,
  /** The agents an @ can name (#6203). */
  agents: readonly string[] = [],
  /** Other pages an @ can name, under the page list's authority (#6208); absent without it. */
  pages?: MentionPages,
) {
  /** This tab's batches on their way: the page draws them at once and drops each when it settles
   * (the page then shows it, or it was refused). A file's placeholder is drawn the same way while
   * the file uploads, and is never sent. */
  const [pending, setPending] = useState<readonly { key: number; ops: BlockOp[] }[]>([]);
  /** The batches the serve refused for good, oldest first (#6220): the page no longer draws them,
   * and the status line says so and sends the oldest again on Retry. */
  const [refusals, setRefusals] = useState<readonly Refusal[]>([]);
  const [uploads, setUploads] = useState<ReadonlyMap<string, BlockUpload>>(new Map());
  const [failedFirstText, setFailedFirstText] = useState<string>();
  const batchKey = useRef(0);
  /** The page as the serve shows it: what the focused block's text merges with. */
  const pageTree = useMemo(() => new BlockTree(records), [records]);
  const pageRef = useRef(pageTree);
  pageRef.current = pageTree;
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
  /** The question block whose editor is open (#6194): a new question from the insert menu, or
   * Enter on a selected one. */
  const [authoring, setAuthoring] = useState<string>();
  const menuRef = useRef(menuAt);
  menuRef.current = menuAt;
  /** The @ the caret is in (#6203): its scalar offset in the block's text, what follows it, and the
   * active entry. */
  /** The insert menu's entries this page offers: "Image or file" only where files can be added. */
  const insertEntries = useMemo(
    () => (files ? INSERT_ENTRIES : INSERT_ENTRIES.filter((entry) => entry.id !== 'file')),
    [files],
  );
  const insertRef = useRef(insertEntries);
  insertRef.current = insertEntries;
  /** "Image or file" was chosen: the page opens its file picker, and the files go after `after`. */
  const [choosing, setChoosing] = useState<{ after: string; id: number }>();
  const [mentionAt, setMentionAt] = useState<{
    id: string;
    from: number;
    query: string;
    active?: string;
  }>();
  const mentionRef = useRef(mentionAt);
  mentionRef.current = mentionAt;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  /** The other pages in the @ menu (#6208): the list, or the page opened in it. Every read takes the
   * menu's signal, so closing the menu ends it; the list is read once per menu. */
  const [other, setOther] = useState<MentionPagesState>();
  const otherRef = useRef(other);
  otherRef.current = other;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const menuReads = useRef<AbortController | undefined>(undefined);
  const pageRead = useRef<AbortController | undefined>(undefined);
  const pageList = useRef<readonly { id: string; title: string }[]>([]);
  const mentionOpen = !!mentionAt;
  useEffect(() => {
    if (!mentionOpen) {
      menuReads.current?.abort();
      menuReads.current = undefined;
      pageRead.current = undefined;
      pageList.current = [];
      setOther(undefined);
      return;
    }
    const source = pagesRef.current;
    if (!source || menuReads.current) return;
    const reads = new AbortController();
    menuReads.current = reads;
    // A reader without the page list's authority gets no rows and no hint: the menu is #6203's.
    source.list(reads.signal).then(
      (list) => {
        if (reads.signal.aborted) return;
        pageList.current = list;
        setOther((now) => now ?? { pages: list });
      },
      () => {},
    );
  }, [mentionOpen]);
  useEffect(() => () => menuReads.current?.abort(), []);
  /** Open another page in the @ menu: its blocks are read once, bounded by `PAGE_READ_MS`. */
  const openPage = useCallback((page: { id: string; title: string }) => {
    const source = pagesRef.current;
    const reads = menuReads.current;
    if (!source || !reads) return;
    pageRead.current?.abort();
    const read = new AbortController();
    pageRead.current = read;
    const signal = AbortSignal.any([reads.signal, read.signal, AbortSignal.timeout(PAGE_READ_MS)]);
    setOther({ open: page, state: 'loading' });
    setMentionAt((at) => (at ? { ...at, active: undefined } : at));
    source.blocks(page.id, signal).then(
      (blocks) => {
        if (pageRead.current === read && !reads.signal.aborted)
          setOther({ open: page, state: 'ready', blocks });
      },
      () => {
        if (pageRead.current === read && !reads.signal.aborted)
          setOther({ open: page, state: 'failed' });
      },
    );
  }, []);
  /** Back from an opened page to the list. */
  const closePage = useCallback(() => {
    pageRead.current?.abort();
    pageRead.current = undefined;
    setOther({ pages: pageList.current });
    setMentionAt((at) => (at ? { ...at, active: undefined } : at));
  }, []);

  const open = useCallback((next: BlockTextSync, at: number) => {
    sync.current = next;
    caret.current = at;
    setEditing({
      id: next.id,
      column: next.cell?.column,
      text: next.text,
      caret: at,
      version: ++version.current,
    });
  }, []);

  // `flush` and `show` call each other; `flush` reaches `show` through a ref, so both stay stable.
  const showRef = useRef<(current: BlockTextSync, shown: Shown) => void>(() => {});
  /** Send `ops`, with `current`'s text op among them, and show its settle in the editor. Resolves
   * `true` once the page shows the batch and `false` when the serve refused it for good; it never
   * rejects. A refusal goes to the status line with Retry (#6220), unless `report` is off: typing
   * stays in the editor and goes out again with the next op, and a file's tile has its own Retry. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** The latest batch of this tab, settled: `true` once admitted, `false` when refused. */
  const lastBatch = useRef<Promise<boolean>>(Promise.resolve(true));
  /** `notice`, which is defined after the sends that report to it. */
  const noticeRef = useRef<(message: string) => void>(() => {});
  const out = useCallback(
    (
      current: BlockTextSync | undefined,
      ops: BlockOp[],
      stored?: readonly StoredAttachment[],
      report = stored === undefined,
    ): Promise<boolean> => {
      const key = ++batchKey.current;
      setPending((now) => [...now, { key, ops }]);
      // This tab's batches commit in the order it made them (a column's rename after its add): each
      // goes once the one before it settles, and is drawn at once meanwhile. A stale batch is sent
      // again inside its own turn (`resendStale`), so a later batch never lands before it.
      const sent = queue.current.then(() => sendRef.current(ops, stored));
      queue.current = sent.then(
        () => {},
        () => {},
      );
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
      const settled = sent.then(
        () => true,
        (error: unknown) => {
          if (report) {
            const refusal = refusalOf(key, ops, error);
            if (refusal.retryable) {
              // A timed line (a delete's Undo) no longer tells the truth: the batch did not land.
              clearTimeout(toastTimer.current);
              setToast(undefined);
              setRefusals((now) => [...now, refusal]);
            } else noticeRef.current(refusal.message);
          }
          return false;
        },
      );
      lastBatch.current = settled;
      return settled;
    },
    [],
  );
  /** The typing not sent yet, with the marks its new characters take from the text they were
   * typed into (as the editor draws them). */
  const typedOps = useCallback((current: BlockTextSync): BlockOp[] => {
    const op = current.flush();
    if (!op) return [];
    if (op.op !== 'text' || !('set' in op)) return [op];
    const from = [treeRef.current.get(op.id), pageRef.current.get(op.id)].find(
      (block) => block?.text === op.base,
    );
    return [op, ...typedMarks(op.id, op.base, op.set, from?.marks)];
  }, []);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const current = sync.current;
    const ops = current ? typedOps(current) : [];
    if (!current || !ops.length) return;
    void out(current, ops, undefined, false);
  }, [out, typedOps]);
  /** Flush the active editor and wait until its latest batch is admitted or refused. */
  const settle = useCallback(async () => {
    do {
      flush();
      await lastBatch.current;
    } while (sync.current?.pending);
  }, [flush]);
  const show = useCallback(
    (current: BlockTextSync, shown: Shown) => {
      if (sync.current !== current) return;
      caret.current = shown.caret;
      setEditing({
        id: current.id,
        column: current.cell?.column,
        text: shown.text,
        caret: shown.caret,
        version: ++version.current,
        from: shown.from,
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
    const text = drawnText(pageTree, current);
    if (text === undefined) {
      // Not on the page yet: this tab's own insert is on its way.
      if (arriving.current === current.id) return;
      // Deleted or gone under another writer: the editor closes; unsent typing is kept on the op.
      flush();
      sync.current = undefined;
      setEditing(undefined);
      return;
    }
    if (arriving.current === current.id) arriving.current = undefined;
    show(current, current.remote(text, caret.current, seq));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTree]);

  const focus = useCallback(
    (id: string) => {
      setSelection(undefined);
      if (sync.current?.id === id && !sync.current.cell) return;
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
      // An @ at a word's start opens the @ menu in a block that takes marks; what follows filters it.
      const block = treeRef.current.get(id);
      const found = block && !current.cell && richType(block.type) ? mentionQuery(text, at) : null;
      setMentionAt((now) =>
        found
          ? {
              id,
              ...found,
              ...(now?.id === id && now.from === found.from && { active: now.active }),
            }
          : undefined,
      );
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, TEXT_FLUSH_MS);
    },
    [flush],
  );

  /** The person focused a table cell: its text is edited as a block's is, and goes out as
   * `set-cell`. */
  const focusCell = useCallback(
    (table: string, row: string, column: string) => {
      setSelection(undefined);
      const current = sync.current;
      if (current?.id === row && current.cell?.column === column) return;
      flush();
      const text = drawnText(treeRef.current, { id: row, cell: { table, column } });
      if (text === undefined) return;
      open(new BlockTextSync(row, text, { table, column }), [...text].length);
    },
    [flush, open],
  );
  /** A new empty row after `after` (last when absent), its first cell focused: one gesture. */
  const addRowTo = useCallback(
    async (table: string, after?: string | null) => {
      const first = tableColumns(treeRef.current.get(table)?.props ?? {})[0];
      if (!first) return;
      clearTimeout(timer.current);
      flush();
      await inflight.current;
      const row = crypto.randomUUID();
      const ops = [addRow(table, row, after)];
      history.current.record(treeRef.current, ops);
      arriving.current = row;
      open(new BlockTextSync(row, '', { table, column: first.id }), 0);
      if (!(await out(undefined, ops))) {
        // Refused: no row was added, and the editor closes.
        if (sync.current?.id === row) {
          arriving.current = undefined;
          sync.current = undefined;
          setEditing(undefined);
        }
      }
    },
    [flush, open, out],
  );
  /** A key in the focused cell; true when the cell took it. Tab and Shift+Tab move along the
   * table's cells, and Tab in the last cell adds a row; Esc selects the table. A cell is plain
   * text, so the format keys and Enter do nothing. */
  const cellKey = useCallback(
    (event: KeyboardEvent, text: string): boolean => {
      const current = sync.current;
      if (!current?.cell) return false;
      const { table, column } = current.cell;
      const formatKey =
        (event.metaKey || event.ctrlKey) && !event.altKey && FORMAT_KEYS[event.key.toLowerCase()];
      if (formatKey || event.key === 'Enter') return true;
      if (event.altKey || event.metaKey || event.ctrlKey) return false;
      current.typed(text);
      if (event.key === 'Escape') {
        flush();
        sync.current = undefined;
        setEditing(undefined);
        setSelection(selectBlock(table));
        return true;
      }
      if (event.key !== 'Tab') return false;
      const tree = treeRef.current;
      const columns = tableColumns(tree.get(table)?.props ?? {}).map((c) => c.id);
      const rows = tree.rows(table).map((r) => r.id);
      const at = rows.indexOf(current.id) * columns.length + columns.indexOf(column);
      const next = at + (event.shiftKey ? -1 : 1);
      if (next >= rows.length * columns.length) void addRowTo(table, rows.at(-1));
      else if (next >= 0 && at >= 0)
        focusCell(table, rows[Math.floor(next / columns.length)]!, columns[next % columns.length]!);
      // Tab never leaves the table, even at its first cell.
      return true;
    },
    [flush, focusCell, addRowTo],
  );

  /** Enter at scalar `at`: the rest of the text starts a new block, focused at its start. */
  const split = useCallback(
    async (current: BlockTextSync, at: number) => {
      clearTimeout(timer.current);
      const length = [...current.text].length;
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
      // Keys typed while the op before was in flight landed at the split: the caret stays after
      // them in the new block, so typing goes on in order.
      open(
        new BlockTextSync(newId, tail),
        Math.max(0, Math.min([...tail].length, [...text].length - length)),
      );
      if (!(await out(undefined, ops))) {
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
      await out(into, ops);
    },
    [open, out],
  );

  /** A format key or a pasted link on `range` of the focused block: the mark goes on, or off when
   * the whole range has it, in one batch with the typing not sent yet. */
  const format = useCallback(
    async (current: BlockTextSync, range: TextRange, mark: TextMark, value: unknown = true) => {
      clearTimeout(timer.current);
      await inflight.current;
      if (sync.current !== current || range.from >= range.to) return;
      const block = treeRef.current.get(current.id);
      if (!block) return;
      const ops = typedOps(current);
      let local: BlockRecord;
      try {
        [local] = applyOps([block], ops) as [BlockRecord];
      } catch {
        return;
      }
      // The page moved under the typing: the range no longer names what the person selected.
      if (local.text !== current.text) {
        if (ops.length) void out(current, ops, undefined, false);
        return;
      }
      const on = marked(
        local.marks,
        range.from,
        range.to,
        mark,
        value === true ? undefined : value,
      );
      const valued = mark === 'link' || mark === 'agent' || mark === 'block';
      const op: BlockOp = {
        op: 'text',
        id: current.id,
        format: { ...range, mark, value: on ? (valued ? null : false) : value },
      };
      history.current.record(new BlockTree([local]), [op]);
      await out(current, [...ops, op]);
    },
    [out, typedOps],
  );
  /** Tab or Shift+Tab in a list item or to-do: its indent moves, with the typing not sent yet. */
  const indent = useCallback(
    async (current: BlockTextSync, by: 1 | -1) => {
      clearTimeout(timer.current);
      await inflight.current;
      if (sync.current !== current) return;
      const ops = indentBlock(treeRef.current, current.id, by);
      if (!ops.length) return;
      history.current.record(treeRef.current, ops);
      await out(current, [...typedOps(current), ...ops]);
    },
    [out, typedOps],
  );
  /** A URL pasted over a selected range links the range. */
  const pasteUrl = useCallback(
    (id: string, url: string, text: string, range: TextRange): boolean => {
      const current = sync.current;
      const block = treeRef.current.get(id);
      if (current?.id !== id || !block || !richType(block.type) || !validMarkValue('link', url))
        return false;
      current.typed(text);
      void format(current, range, 'link', url);
      return true;
    },
    [format],
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
      if (type === 'paragraph' || entry === 'file') {
        current.typed('');
        open(current, 0);
        flush();
        // The picked files go after the cleared paragraph (#6202).
        if (entry === 'file') setChoosing((now) => ({ after: current.id, id: (now?.id ?? 0) + 1 }));
        return;
      }
      clearTimeout(timer.current);
      await inflight.current;
      if (sync.current !== current) return;
      const newId = crypto.randomUUID();
      const text = TEXT_TYPES.has(type);
      const question = type === 'question';
      const ops: BlockOp[] = [
        insertBlock(treeRef.current, {
          id: newId,
          type,
          after: current.id,
          ...(text && { text: '' }),
          ...(question && { props: newQuestionProps() }),
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
        if (question) setAuthoring(newId);
      }
      if (!(await out(undefined, ops)) && arriving.current === newId) arriving.current = undefined;
    },
    [open, out, flush],
  );

  /** A notice in the status line, in place of a delete's. */
  const notice = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast((now) => ({ count: 0, notice: message, id: (now?.id ?? 0) + 1 }));
    toastTimer.current = setTimeout(() => setToast(undefined), TOAST_MS);
  }, []);
  noticeRef.current = notice;
  const refusalsRef = useRef(refusals);
  refusalsRef.current = refusals;
  /** Sends the oldest refused batch again, as a new turn of this tab's queue. */
  const retryRefused = useCallback(() => {
    const [first] = refusalsRef.current;
    if (!first) return;
    setRefusals((now) => now.filter((refusal) => refusal.key !== first.key));
    void out(undefined, first.ops);
  }, [out]);
  /** Files whose uploads are under way: they count against the page's cap until their batch. */
  const adding = useRef(0);
  /**
   * Add files to the page (#6202), after `after` (the focused, else the selected, else the last
   * block). Each file is one gesture: its tile shows at once while it uploads, then one batch
   * inserts its block and lists the file. Files the page cannot take are refused before any
   * upload. A failed upload, or a batch the serve refused, leaves the tile failed with Retry; a
   * stored file is never uploaded again, and one never listed is left for the sweep.
   */
  const attach = useCallback(
    async (picked: readonly File[], after?: string) => {
      if (!files || !picked.length) return;
      if (!fitsAttachments(files.count() + adding.current, picked.length))
        return notice(strings.blockFiles.full(attachment.DOCUMENT_ATTACHMENTS));
      // Each file holds its place under the cap until it is refused, its upload fails or its
      // batch settles (the page's list then counts it, or it was not added).
      adding.current += picked.length;
      clearTimeout(timer.current);
      flush();
      const current = sync.current;
      await inflight.current;
      const top = treeRef.current.children();
      let anchor = after ?? current?.id ?? selection?.focus ?? top[top.length - 1]?.id;
      for (const file of picked) {
        const read = await readBlockFile(file);
        if (typeof read === 'string') {
          adding.current--;
          notice(strings.blockFiles[read](file.name));
          continue;
        }
        const id = crypto.randomUUID();
        const place = (stored?: StoredAttachment) =>
          insertBlock(treeRef.current, {
            id,
            ...fileBlock(read, stored),
            ...(anchor ? { after: anchor } : { parent: PAGE_PARENT }),
          });
        let placeholder: BlockOp;
        try {
          placeholder = place();
        } catch {
          // Inside a block that holds no image (a card's row, say): after it at the top level.
          anchor = top[top.length - 1]?.id;
          try {
            placeholder = place();
          } catch {
            adding.current--;
            notice(strings.blockFiles.noPlace);
            continue;
          }
        }
        const after = anchor;
        anchor = id;
        const tile = ++batchKey.current;
        const draw = (upload?: BlockUpload) => {
          setUploads((now) => {
            const next = new Map(now);
            if (upload) next.set(id, upload);
            else next.delete(id);
            return next;
          });
          setPending((now) =>
            upload
              ? now.some((batch) => batch.key === tile)
                ? now
                : [...now, { key: tile, ops: [placeholder] }]
              : now.filter((batch) => batch.key !== tile),
          );
        };
        const commit = (stored: StoredAttachment) => {
          anchor = after;
          const ops = [place(stored)];
          anchor = id;
          history.current.record(treeRef.current, ops);
          // The tile gives way to the batch in one render: the page draws the block either way.
          draw();
          void out(undefined, ops, [stored])
            .then((sent) => {
              if (!sent) draw({ state: 'failed', retry: () => commit(stored) });
            })
            .finally(release);
        };
        let counted = true;
        function release() {
          if (!counted) return;
          counted = false;
          adding.current--;
        }
        const upload = async () => {
          draw({ state: 'loading' });
          let stored: StoredAttachment;
          try {
            stored = await files.upload(read.input);
          } catch {
            release();
            draw({ state: 'failed', retry: () => void upload() });
            return;
          }
          commit(stored);
        };
        await upload();
      }
    },
    [files, flush, notice, out, selection?.focus],
  );

  /** The @ menu's rows now, for the block it is open in. */
  const mentionRows = useCallback(
    (at: NonNullable<typeof mentionAt>) =>
      mentionEntries(treeRef.current, agentsRef.current, at.query, at.id, otherRef.current),
    [],
  );
  /** The @ menu's choice (#6203): the @ and what followed it become the chip text and a space, and
   * the chip text takes the `agent` or `block` mark, in one batch with the typing. */
  const pickMention = useCallback(
    (entryId: string) => {
      const current = sync.current;
      const at = mentionRef.current;
      if (!current || at?.id !== current.id) return;
      const entry = mentionRows(at).find((row) => row.id === entryId);
      if (!entry) return;
      // Another page opens in the menu, or the menu goes back to the list (#6208).
      if (entry.mark === 'page' || entry.mark === 'retry') {
        const page = pageList.current.find((item) => item.id === entry.value);
        const opened =
          otherRef.current && 'open' in otherRef.current ? otherRef.current.open : page;
        if (opened) openPage(entry.mark === 'page' && page ? page : opened);
        return;
      }
      if (entry.mark === 'back') {
        closePage();
        return;
      }
      setMentionAt(undefined);
      const chars = [...current.text];
      const end = Math.min(chars.length, at.from + 1 + [...at.query].length);
      const label = [...entry.label];
      const next = [...chars.slice(0, at.from), ...label, ' ', ...chars.slice(end)].join('');
      current.typed(next);
      const to = at.from + label.length;
      open(current, to + 1);
      void format(current, { from: at.from, to }, entry.mark as 'agent' | 'block', entry.value);
    },
    [mentionRows, open, format, openPage, closePage],
  );

  /** A key in the focused block; true when the block took it. */
  const key = useCallback(
    (id: string, event: KeyboardEvent, text: string, at: number, range: TextRange): boolean => {
      const current = sync.current;
      const block = treeRef.current.get(id);
      const formatKey =
        (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
          ? FORMAT_KEYS[event.key.toLowerCase()]
          : undefined;
      if (current?.id === id && block && formatKey && richType(block.type)) {
        current.typed(text);
        if (range.from < range.to) void format(current, range, formatKey);
        return true;
      }
      const collapsed = range.from === range.to;
      if (current?.id !== id || event.altKey || event.metaKey || event.ctrlKey) return false;
      if (event.key === 'Tab' && block && (block.type === 'list' || block.type === 'todo')) {
        current.typed(text);
        void indent(current, event.shiftKey ? -1 : 1);
        // Tab never leaves an indentable block, even at an edge.
        return true;
      }
      if (!block || !TEXT_TYPES.has(block.type)) return false;
      current.typed(text);
      const mention = mentionRef.current?.id === id ? mentionRef.current : undefined;
      if (mention) {
        const rows = mentionRows(mention);
        const ids = rows.map((entry) => entry.id);
        const active = activeMention(rows, mention.active);
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) && ids.length) {
          setMentionAt({ ...mention, active: nextBlockMenuItem(ids, active, event.key) });
          return true;
        }
        const opened = otherRef.current && 'open' in otherRef.current;
        // → opens the active page; ←, or Backspace with nothing after the @, goes back (#6208).
        if (event.key === 'ArrowRight' && active?.startsWith('page:')) {
          pickMention(active);
          return true;
        }
        if (
          opened &&
          (event.key === 'ArrowLeft' || (event.key === 'Backspace' && mention.query === ''))
        ) {
          closePage();
          return true;
        }
        if (event.key === 'Escape') {
          // Closes and keeps what was typed.
          setMentionAt(undefined);
          return true;
        }
        if ((event.key === 'Enter' || event.key === 'Tab') && ids.length && !event.shiftKey) {
          if (active) pickMention(active);
          return true;
        }
      }
      const menu = menuRef.current?.id === id ? menuRef.current : undefined;
      if (menu) {
        const ids = filterInsert(insertRef.current, text).map((entry) => entry.id);
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
    [split, join, pick, flush, format, indent, mentionRows, pickMention, closePage],
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
      void out(undefined, ops);
    },
    [out],
  );
  const undo = useCallback(() => replay('undo'), [replay]);

  /** One gesture of this tab: recorded for ⌘Z, then sent. */
  const gesture = useCallback(
    (ops: BlockOp[]) => {
      if (!ops.length) return;
      history.current.record(treeRef.current, ops);
      void out(undefined, ops);
    },
    [out],
  );
  /** A to-do's checkbox: one gesture, recorded for ⌘Z. */
  const check = useCallback(
    (id: string, checked: boolean) =>
      gesture(
        checked
          ? [{ op: 'props', id, set: { checked: true }, unset: [] }]
          : [{ op: 'props', id, set: {}, unset: ['checked'] }],
      ),
    [gesture],
  );

  /** One edit in the question editor: one gesture, recorded for ⌘Z. */
  const questionEdit = useCallback(
    (id: string, edit: QuestionEdit) => {
      const block = treeRef.current.get(id);
      if (block) gesture(editQuestion(block, edit));
    },
    [gesture],
  );

  /** The row menu: a new row above or below `row` (its first cell focused), or `row` removed. */
  const rowAction = useCallback(
    (table: string, row: string, action: TableRowAction) => {
      if (action !== 'remove') {
        const rows = treeRef.current.rows(table).map((r) => r.id);
        const index = rows.indexOf(row);
        if (index < 0) return;
        void addRowTo(table, action === 'below' ? row : index > 0 ? rows[index - 1]! : null);
        return;
      }
      // A cell open in the removed row closes with it; its typing is sent first.
      if (sync.current?.cell?.table === table && sync.current.id === row) {
        clearTimeout(timer.current);
        flush();
        sync.current = undefined;
        setEditing(undefined);
      }
      gesture([{ op: 'table', id: table, action: 'remove-row', row }]);
    },
    [addRowTo, flush, gesture],
  );
  /** The column menu: add, rename, move or remove a column, one gesture each. */
  const columnAction = useCallback(
    (table: string, edit: TableColumnEdit) => {
      const open = sync.current?.cell;
      if (edit.action === 'remove-column' && open?.table === table && open.column === edit.column) {
        clearTimeout(timer.current);
        flush();
        sync.current = undefined;
        setEditing(undefined);
      }
      gesture([{ op: 'table', id: table, ...edit }]);
    },
    [flush, gesture],
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

  /** Insert a paragraph and move the one editor to it while the batch settles. */
  const insertParagraph = useCallback(
    (text: string, after?: string) => {
      if (after === undefined) setFailedFirstText(undefined);
      const newId = crypto.randomUUID();
      const ops = [insertBlock(treeRef.current, { id: newId, type: 'paragraph', after, text })];
      flush();
      setSelection(undefined);
      setBlockMenu(undefined);
      arriving.current = newId;
      const next = new BlockTextSync(newId, text);
      open(next, [...text].length);
      setMenuAt(text.startsWith('/') ? { id: newId, query: text } : undefined);
      history.current.record(treeRef.current, ops);
      // The first block of an empty page keeps its own alert and Retry (#6187); `out` reports any
      // other refusal in the status line.
      const sent = out(undefined, ops, undefined, after !== undefined);
      void sent.then((ok) => {
        if (ok) return;
        if (after === undefined)
          setFailedFirstText(sync.current?.id === newId ? sync.current.text : text);
        if (arriving.current === newId) arriving.current = undefined;
      });
      return sent;
    },
    [flush, open, out],
  );
  /** ＋ on the handle opens the same slash paragraph and insert menu. */
  const insertAfter = useCallback((id: string) => void insertParagraph('/', id), [insertParagraph]);

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
        // A question opens its editor.
        if (treeRef.current.get(selection.focus)?.type === 'question') {
          setAuthoring(selection.focus);
          setSelection(undefined);
          return true;
        }
        // A table is entered at its first cell, or by adding its first row.
        const table = treeRef.current.get(selection.focus);
        const first = table?.type === 'table' && tableColumns(table.props)[0];
        const row = first && treeRef.current.rows(table.id)[0];
        if (!first) focus(selection.focus);
        else if (row) focusCell(table.id, row.id, first.id);
        else void addRowTo(table.id);
        return true;
      }
      return false;
    },
    [blockMenu, selection, replay, deleteIds, focus, focusCell, addRowTo, act, openBlockMenu],
  );
  const selected = useMemo(() => selectedIds(tree, selection), [tree, selection]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const menu = useMemo((): InsertMenu | undefined => {
    if (!menuAt || editing?.id !== menuAt.id) return undefined;
    const entries = filterInsert(insertEntries, menuAt.query);
    const active =
      menuAt.active && entries.some((entry) => entry.id === menuAt.active)
        ? menuAt.active
        : entries[0]?.id;
    return { id: menuAt.id, entries, ...(active && { active }) };
  }, [menuAt, editing?.id, insertEntries]);
  const closeMenu = useCallback(() => setMenuAt(undefined), []);
  const mention = useMemo((): MentionMenu | undefined => {
    if (!mentionAt || editing?.id !== mentionAt.id) return undefined;
    const entries = mentionEntries(tree, agents, mentionAt.query, mentionAt.id, other);
    const active = activeMention(entries, mentionAt.active);
    const reading = other && 'open' in other && other.state === 'loading';
    return { id: mentionAt.id, entries, ...(active && { active }), ...(reading && { reading }) };
  }, [mentionAt, editing?.id, tree, agents, other]);
  const hoverMention = useCallback((entry: string) => {
    setMentionAt((at) => (at ? { ...at, active: entry } : at));
  }, []);
  const hover = useCallback((entry: string) => {
    setMenuAt((at) => (at ? { ...at, active: entry } : at));
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    tree,
    editing,
    focus,
    focusCell,
    cellKey,
    addRowTo,
    rowAction,
    columnAction,
    pasteUrl,
    check,
    authoring,
    author: setAuthoring,
    questionEdit,
    typed,
    flush,
    settle,
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
    insertFirst: insertParagraph,
    failedFirstText,
    closeBlockMenu: () => setBlockMenu(undefined),
    hoverBlockMenu: (action: string) =>
      setBlockMenu((now) => (now ? { ...now, active: action } : now)),
    toast: toast ?? shownRefusal(refusals[0], retryRefused),
    undo,
    attach,
    uploads,
    choosing,
    mention,
    pickMention,
    hoverMention,
  };
}

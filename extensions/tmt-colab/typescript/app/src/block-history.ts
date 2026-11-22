import { typedMarks } from './block-marks.js';
import type { BlockOp, BlockRecord } from './block-model.js';
import { inverseOps } from './block-ops.js';
import { BlockTree } from './block-tree.js';

/** How many gestures ⌘Z can take back. */
export const UNDO_DEPTH = 100;
/** A pause this long ends a typing run, so one ⌘Z takes back what was typed since (#6742). */
export const RUN_PAUSE_MS = 1000;
/** A typing run also ends after this many characters changed: about a paragraph, never three. */
export const RUN_SCALARS = 200;

/** One block's typing, or one table cell's (`cell`, with the row as `id`), from the text it
 * started from (`before`, whose text is `base`) to `set`. */
interface Run {
  readonly id: string;
  readonly cell?: { readonly table: string; readonly column: string };
  readonly before: BlockRecord;
  readonly base: string;
  set: string;
  open: boolean;
}

/** Typing sent: a block's whole text, or a cell's. */
export type Typed =
  | { readonly op: 'text'; readonly id: string; readonly set: string; readonly base: string }
  | {
      readonly op: 'table';
      readonly id: string;
      readonly action: 'set-cell';
      readonly row: string;
      readonly column: string;
      readonly text: string;
      readonly base?: string;
    };
type Entry = { ops: BlockOp[]; inverse: BlockOp[]; run?: Run };

/** How many characters differ between `a` and `b`, after their common start and end. */
function changed(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let end = 0;
  while (
    end < x.length - start &&
    end < y.length - start &&
    x[x.length - 1 - end] === y[y.length - 1 - end]
  )
    end++;
  return x.length - start - end + (y.length - start - end);
}

/** The run as a step: its whole text from where it started with the marks the typed text took,
 * and the text back as it was, with its marks. */
function runEntry(run: Run): { ops: BlockOp[]; inverse: BlockOp[] } {
  if (run.cell) {
    // A cell is plain text: its whole text, and back.
    const cell = (text: string, base: string): BlockOp => ({
      op: 'table',
      id: run.cell!.table,
      action: 'set-cell',
      row: run.id,
      column: run.cell!.column,
      text,
      base,
      overlap: 'both',
    });
    return { ops: [cell(run.set, run.base)], inverse: [cell(run.base, run.set)] };
  }
  const text: BlockOp = { op: 'text', id: run.id, set: run.set, base: run.base, overlap: 'both' };
  return {
    ops: [text, ...typedMarks(run.id, run.base, run.set, run.before.marks)],
    inverse: inverseOps(new BlockTree([run.before]), [text]),
  };
}

/**
 * This tab's undo and redo of its own gestures (#6005): each entry is one gesture's ops and the
 * ops that take it back, made from the tree it was applied to. Undo sends the inverse as a new
 * batch, so it merges with whatever others wrote meanwhile like any other edit; it never rewinds
 * another writer's change. A new gesture clears redo.
 */
export class BlockHistory {
  readonly #undo: Entry[] = [];
  readonly #redo: Entry[] = [];

  /** Record a gesture just sent, with the tree it was made from. No ops records nothing. It ends
   * the typing run before it. */
  record(before: BlockTree, ops: readonly BlockOp[]) {
    if (!ops.length) return;
    this.#push({ ops: [...ops], inverse: inverseOps(before, ops) });
  }
  /**
   * Typing just sent in one block or one table cell (#6742): `before` is the block (the row, for a
   * cell) as it was when that text was its page text (the op's base). It joins the open run of the
   * same block or cell, so one ⌘Z takes back a run, not a keystroke; a `fresh` run (after a pause),
   * another block or cell, another gesture in between, a change by someone else in between (the
   * base moved), or a run past `RUN_SCALARS` starts a new step.
   */
  typing(before: BlockRecord, op: Typed, fresh: boolean) {
    const cell = op.op === 'table' ? { table: op.id, column: op.column } : undefined;
    const id = op.op === 'table' ? op.row : op.id;
    const set = op.op === 'table' ? op.text : op.set;
    const base = op.op === 'table' ? (op.base ?? before.cells?.[op.column] ?? '') : op.base;
    const top = this.#undo.at(-1);
    const run = top?.run;
    if (
      top &&
      run?.open &&
      !fresh &&
      run.id === id &&
      run.cell?.table === cell?.table &&
      run.cell?.column === cell?.column &&
      run.set === base &&
      changed(run.base, set) <= RUN_SCALARS
    ) {
      run.set = set;
      Object.assign(top, runEntry(run));
      this.#redo.length = 0;
      return;
    }
    const next: Run = { id, ...(cell && { cell }), before, base, set, open: true };
    this.#push({ ...runEntry(next), run: next });
  }
  #push(entry: Entry) {
    const top = this.#undo.at(-1);
    if (top?.run) top.run.open = false;
    this.#undo.push(entry);
    if (this.#undo.length > UNDO_DEPTH) this.#undo.shift();
    this.#redo.length = 0;
  }
  canUndo(): boolean {
    return this.#undo.length > 0;
  }
  canRedo(): boolean {
    return this.#redo.length > 0;
  }
  /** The ops that take the latest gesture back, or nothing to undo. */
  undo(): BlockOp[] | undefined {
    const entry = this.#undo.pop();
    if (!entry) return undefined;
    if (entry.run) entry.run.open = false;
    this.#redo.push(entry);
    return entry.inverse;
  }
  /** The ops that make the latest undone gesture again. */
  redo(): BlockOp[] | undefined {
    const entry = this.#redo.pop();
    if (!entry) return undefined;
    this.#undo.push(entry);
    return entry.ops;
  }
}

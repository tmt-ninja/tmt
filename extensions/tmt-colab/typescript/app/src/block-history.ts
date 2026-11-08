import type { BlockOp } from './block-model.js';
import { inverseOps } from './block-ops.js';
import type { BlockTree } from './block-tree.js';

/** How many gestures ⌘Z can take back. */
export const UNDO_DEPTH = 100;

/**
 * This tab's undo and redo of its own gestures (#6005): each entry is one gesture's ops and the
 * ops that take it back, made from the tree it was applied to. Undo sends the inverse as a new
 * batch, so it merges with whatever others wrote meanwhile like any other edit; it never rewinds
 * another writer's change. A new gesture clears redo.
 */
export class BlockHistory {
  readonly #undo: { ops: BlockOp[]; inverse: BlockOp[] }[] = [];
  readonly #redo: { ops: BlockOp[]; inverse: BlockOp[] }[] = [];

  /** Record a gesture just sent, with the tree it was made from. No ops records nothing. */
  record(before: BlockTree, ops: readonly BlockOp[]) {
    if (!ops.length) return;
    this.#undo.push({ ops: [...ops], inverse: inverseOps(before, ops) });
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

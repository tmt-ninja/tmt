import type { BlockTree } from './block-tree.js';

/**
 * Block selection (#6005, spec 選取區塊): Esc turns typing in a block into selecting that block;
 * Shift+↑↓ and Shift+click extend from the anchor over the blocks in reading order. A selection is
 * a contiguous run of drawn blocks; a block the tree no longer draws (deleted or moved away by
 * another writer) leaves it, and an empty selection is none.
 */
export interface BlockSelection {
  /** Where the selection started; Shift extends from here. */
  readonly anchor: string;
  /** The end that moves. */
  readonly focus: string;
}

const order = (tree: BlockTree) => tree.flat().map((block) => block.id);

/** The selected blocks in reading order. */
export function selectedIds(tree: BlockTree, selection: BlockSelection | undefined): string[] {
  if (!selection) return [];
  const ids = order(tree);
  const from = ids.indexOf(selection.anchor);
  const to = ids.indexOf(selection.focus);
  if (from < 0 && to < 0) return [];
  if (from < 0 || to < 0) return [ids[Math.max(from, to)]!];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Esc while typing in `id`: that block alone. */
export function selectBlock(id: string): BlockSelection {
  return { anchor: id, focus: id };
}

/** Shift+↑ / Shift+↓: the focus moves one block, stopping at the page's ends. */
export function extendSelection(
  tree: BlockTree,
  selection: BlockSelection,
  direction: 'up' | 'down',
): BlockSelection {
  const ids = order(tree);
  const at = ids.indexOf(selection.focus);
  if (at < 0) return selection;
  const next = ids[Math.max(0, Math.min(ids.length - 1, at + (direction === 'up' ? -1 : 1)))]!;
  return { anchor: selection.anchor, focus: next };
}

/** Shift+click on `id`: from the anchor to it. */
export function extendTo(selection: BlockSelection, id: string): BlockSelection {
  return { anchor: selection.anchor, focus: id };
}

/** The selection after the page changed: kept while both ends are still drawn, otherwise only
 * the end still drawn, or none. */
export function settleSelection(
  tree: BlockTree,
  selection: BlockSelection | undefined,
): BlockSelection | undefined {
  if (!selection) return undefined;
  const anchor = tree.visible(selection.anchor);
  const focus = tree.visible(selection.focus);
  if (anchor && focus) return selection;
  if (anchor) return selectBlock(selection.anchor);
  if (focus) return selectBlock(selection.focus);
  return undefined;
}

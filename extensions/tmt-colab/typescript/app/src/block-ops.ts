import {
  type BlockOp,
  type BlockType,
  canHold,
  CONTAINER_TYPES,
  isBlockType,
  PAGE_PARENT,
  type Parent,
  TEXT_TYPES,
} from './block-model.js';
import type { BlockTree } from './block-tree.js';

/**
 * What each editor gesture sends (#6005, spec 編輯 / 瀏覽器裡的動作): the same block ops an agent's
 * `tmt colab block batch` takes, made from the tree the page shows now, with the ops that undo
 * them. A gesture that would change nothing makes no ops.
 */

/** The sibling a block placed at `index` among `parent`'s drawn children comes after (`null` is
 * first), leaving out `moving`. */
function afterAt(tree: BlockTree, parent: Parent, index: number, moving?: string): string | null {
  const siblings = tree.children(parent).filter((block) => block.id !== moving);
  const at = Math.max(0, Math.min(index, siblings.length));
  return siblings[at - 1]?.id ?? null;
}

/** A new block right after `after` (or first in `parent` when `after` is absent): the insert menu,
 * Enter at the end of a block, the handle's +. A card never goes inside a card. */
export function insertBlock(
  tree: BlockTree,
  input: {
    id: string;
    type: BlockType;
    parent?: Parent;
    after?: string;
    props?: Record<string, unknown>;
    text?: string;
  },
): BlockOp {
  const parent = input.after ? tree.parentOf(input.after) : (input.parent ?? PAGE_PARENT);
  if (parent === undefined) throw new Error('That block is not on the page.');
  if (parent !== PAGE_PARENT) {
    const holder = tree.get(parent);
    if (!holder || !canHold(holder.type, input.type))
      throw new Error(
        holder && CONTAINER_TYPES.has(holder.type)
          ? 'A card cannot hold a card.'
          : 'That block cannot hold blocks.',
      );
  }
  return {
    op: 'insert',
    id: input.id,
    type: input.type,
    parent,
    after: input.after ?? null,
    ...(input.props && { props: input.props }),
    ...(input.text !== undefined && { text: input.text }),
  };
}

/** A drop: the block goes to `index` among `parent`'s children (as the drop line shows, counted
 * with the block still in its place). No ops for a drop where it already is, and a block never
 * goes inside itself. */
export function moveBlock(tree: BlockTree, id: string, parent: Parent, index: number): BlockOp[] {
  if (!tree.visible(id)) throw new Error('That block is not on the page.');
  if (parent !== PAGE_PARENT) {
    const holder = tree.get(parent);
    if (!holder || !tree.visible(parent) || !CONTAINER_TYPES.has(holder.type))
      throw new Error('That block cannot hold blocks.');
    if (tree.within(parent, id)) throw new Error('A block cannot go inside itself.');
    if (!canHold(holder.type, tree.get(id)!.type)) throw new Error('A card cannot hold a card.');
  }
  const from = tree.parentOf(id);
  const current = tree.indexOf(id);
  // Counted with the block in place: a drop just after itself is where it is.
  const target = from === parent && index > current ? index - 1 : index;
  if (from === parent && target === current) return [];
  return [{ op: 'move', id, parent, after: afterAt(tree, parent, target, id) }];
}

/** ⌥⇧↑ / ⌥⇧↓: one place up or down among its siblings; past the first or last it leaves its card,
 * landing just before or after it. At the page's own edge it stays. */
export function nudgeBlock(tree: BlockTree, id: string, direction: 'up' | 'down'): BlockOp[] {
  const parent = tree.parentOf(id);
  if (parent === undefined) throw new Error('That block is not on the page.');
  const index = tree.indexOf(id);
  const count = tree.children(parent).length;
  if (direction === 'up' ? index > 0 : index < count - 1)
    return moveBlock(tree, id, parent, direction === 'up' ? index - 1 : index + 2);
  if (parent === PAGE_PARENT) return [];
  const outer = tree.parentOf(parent)!;
  const at = tree.indexOf(parent);
  return moveBlock(tree, id, outer, direction === 'up' ? at : at + 1);
}

/** Delete: each selected block once; a block under another selected block goes with it. */
export function deleteBlocks(tree: BlockTree, ids: readonly string[]): BlockOp[] {
  const chosen = ids.filter((id) => tree.visible(id));
  return [...new Set(chosen)]
    .filter((id) => !chosen.some((other) => other !== id && tree.within(id, other)))
    .sort((a, b) => order(tree, a) - order(tree, b))
    .map((id) => ({ op: 'delete', id }));
}
const order = (tree: BlockTree, id: string) => tree.flat().findIndex((block) => block.id === id);

/** Enter inside a text block: the text before the caret stays, the rest starts a new block of the
 * same type right after it (a list item makes a list item). */
export function splitBlock(tree: BlockTree, id: string, at: number, newId: string): BlockOp[] {
  const block = tree.get(id);
  if (
    !block ||
    !tree.visible(id) ||
    !isBlockType(block.type) ||
    !TEXT_TYPES.has(block.type) ||
    block.text === undefined
  )
    throw new Error('Only a text block splits.');
  const type = block.type;
  const text = block.text;
  const head = text.slice(0, at);
  return [
    ...(head === text ? [] : [{ op: 'text' as const, id, set: head, base: text }]),
    insertBlock(tree, { id: newId, type, after: id, text: text.slice(at) }),
  ];
}

/** Backspace at the start of a text block: its text joins the end of the text block before it,
 * and it is deleted. No ops when nothing text-like comes before it. */
export function joinBlock(tree: BlockTree, id: string): BlockOp[] {
  const block = tree.get(id);
  const parent = tree.parentOf(id);
  if (!block || parent === undefined || block.text === undefined) return [];
  const previous = tree.children(parent)[tree.indexOf(id) - 1];
  if (!previous || !TEXT_TYPES.has(previous.type) || previous.text === undefined) return [];
  return [
    ...(block.text
      ? [
          {
            op: 'text' as const,
            id: previous.id,
            set: previous.text + block.text,
            base: previous.text,
          },
        ]
      : []),
    { op: 'delete', id },
  ];
}

/** The ops that undo `ops`, made from the tree before they were applied, in reverse order. */
export function inverseOps(before: BlockTree, ops: readonly BlockOp[]): BlockOp[] {
  return ops
    .map((op): BlockOp => {
      switch (op.op) {
        case 'insert':
          return { op: 'delete', id: op.id };
        case 'delete':
          return { op: 'restore', id: op.id };
        case 'restore':
          return { op: 'delete', id: op.id };
        case 'text':
          if ('set' in op) return { op: 'text', id: op.id, set: op.base, base: op.set };
          // The editor sends whole text, never these; they come from agents.
          throw new Error('Only whole-text edits are undone here.');
        case 'table':
          throw new Error('Table edits are undone by their table.');
        case 'move': {
          // Back where it was drawn: after the sibling that was before it, or first.
          const parent = before.parentOf(op.id);
          if (parent === undefined) throw new Error('That block is not on the page.');
          const index = before.indexOf(op.id);
          return { op: 'move', id: op.id, parent, after: afterAt(before, parent, index, op.id) };
        }
        case 'props': {
          const block = before.get(op.id);
          if (!block) throw new Error('That block is not on the page.');
          const touched = [...Object.keys(op.set), ...op.unset];
          const set: Record<string, unknown> = {};
          const unset: string[] = [];
          for (const key of new Set(touched))
            if (Object.hasOwn(block.props, key)) set[key] = block.props[key];
            else unset.push(key);
          return { op: 'props', id: op.id, set, unset };
        }
      }
    })
    .reverse();
}

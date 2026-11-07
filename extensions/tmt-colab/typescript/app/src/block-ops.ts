import { markOps, marksThrough, typedMarks } from './block-marks.js';
import {
  type BlockOp,
  type BlockRecord,
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

/** ⌘D: a copy of the block right after it; a card's copy holds copies of its blocks. A table is
 * not copied here: its rows are table ops, which come with the table step. */
export function duplicateBlock(tree: BlockTree, id: string, newId: () => string): BlockOp[] {
  const block = tree.get(id);
  if (!block || !tree.visible(id) || !isBlockType(block.type) || block.type === 'table') return [];
  const copy = newId();
  const ops: BlockOp[] = [
    insertBlock(tree, {
      id: copy,
      type: block.type,
      after: id,
      props: { ...block.props },
      ...(block.text !== undefined && { text: block.text }),
    }),
  ];
  let after: string | null = null;
  for (const child of tree.children(id)) {
    if (!isBlockType(child.type) || child.type === 'table') continue;
    const childCopy = newId();
    ops.push({
      op: 'insert',
      id: childCopy,
      type: child.type,
      parent: copy,
      after,
      props: { ...child.props },
      ...(child.text !== undefined && { text: child.text }),
    });
    after = childCopy;
  }
  return ops;
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

/** What the focused block holds: the person's text and the page text it started from. Without it
 * the block's page text is used. */
export interface Typed {
  text: string;
  base: string;
}

/** Enter inside a text block at scalar offset `at`: the text before the caret stays, the rest starts
 * a new block of the same type right after it (a list item makes a list item). The kept text goes
 * as a whole-text op from `typed`'s base, so typing not sent yet lands in the same batch. */
export function splitBlock(
  tree: BlockTree,
  id: string,
  at: number,
  newId: string,
  typed?: Typed,
): BlockOp[] {
  const block = tree.get(id);
  if (
    !block ||
    !tree.visible(id) ||
    !isBlockType(block.type) ||
    !TEXT_TYPES.has(block.type) ||
    block.text === undefined
  )
    throw new Error('Only a text block splits.');
  const { text, base } = typed ?? { text: block.text, base: block.text };
  const scalars = [...text];
  const head = scalars.slice(0, at).join('');
  // The marks as the person sees them: the page's, carried through the typing not sent yet.
  const marks = marksThrough(block.text, text, block.marks);
  const baseMarks = marksThrough(block.text, base, block.marks);
  return [
    ...(head === base
      ? []
      : [
          { op: 'text' as const, id, set: head, base, overlap: 'both' as const },
          ...typedMarks(id, base, head, baseMarks),
        ]),
    insertBlock(tree, { id: newId, type: block.type, after: id, text: scalars.slice(at).join('') }),
    ...markOps(newId, marks, at, scalars.length, -at),
  ];
}

/** The text block Backspace at the start of `id` joins into: the one right before it among its
 * siblings, when that one holds text. */
export function joinTarget(tree: BlockTree, id: string): BlockRecord | undefined {
  const parent = tree.parentOf(id);
  if (parent === undefined) return undefined;
  const previous = tree.children(parent)[tree.indexOf(id) - 1];
  return previous && TEXT_TYPES.has(previous.type) && previous.text !== undefined
    ? previous
    : undefined;
}

/** Backspace at the start of a text block: its text (`text`, else its page text) joins the end of
 * the text block before it, and it is deleted. No ops when nothing text-like comes before it. */
export function joinBlock(tree: BlockTree, id: string, text?: string): BlockOp[] {
  const block = tree.get(id);
  const previous = joinTarget(tree, id);
  const moved = text ?? block?.text;
  if (!block || !previous || moved === undefined) return [];
  const marks = marksThrough(block.text ?? '', moved, block.marks);
  return [
    ...(moved
      ? [
          {
            op: 'text' as const,
            id: previous.id,
            set: previous.text + moved,
            base: previous.text!,
            overlap: 'both' as const,
          },
          ...markOps(previous.id, marks, 0, [...moved].length, [...previous.text!].length),
        ]
      : []),
    { op: 'delete', id },
  ];
}

/** The ops that undo `ops`, made from the tree before they were applied, in reverse order. */
export function inverseOps(before: BlockTree, ops: readonly BlockOp[]): BlockOp[] {
  return ops
    .map((op): BlockOp | BlockOp[] => {
      switch (op.op) {
        case 'insert':
          return { op: 'delete', id: op.id };
        case 'delete':
          return { op: 'restore', id: op.id };
        case 'restore':
          return { op: 'delete', id: op.id };
        case 'text':
          if ('set' in op)
            return { op: 'text', id: op.id, set: op.base, base: op.set, overlap: 'both' };
          if ('format' in op) {
            // Marks that go with text the same batch inserts or replaces leave with that text.
            if (ops.some((other) => other.id === op.id && (other.op === 'insert' || (other.op === 'text' && 'set' in other))))
              return [];
            // The mark cleared on the range, then set back where it was.
            const { from, to, mark } = op.format;
            const valued = mark === 'link' || mark === 'agent' || mark === 'block';
            return [
              { op: 'text', id: op.id, format: { from, to, mark, value: valued ? null : false } },
              ...(before.get(op.id)?.marks ?? [])
                .filter((run) => run.mark === mark && run.from < to && run.to > from)
                .map(
                  (run): BlockOp => ({
                    op: 'text',
                    id: op.id,
                    format: {
                      from: Math.max(run.from, from),
                      to: Math.min(run.to, to),
                      mark,
                      value: run.value ?? true,
                    },
                  }),
                ),
            ];
          }
          // The editor sends whole text and marks, never these; they come from agents.
          throw new Error('Only whole-text and format edits are undone here.');
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
    .reverse()
    .flat();
}

/** The deepest indent a list item or to-do takes (the validator's `indent` bound). */
export const MAX_INDENT = 2;

/** A list item's or to-do's indent, as drawn: an integer from 0 to `MAX_INDENT`. */
export function indentOf(block: BlockRecord): 0 | 1 | 2 {
  const indent = block.props.indent;
  return indent === 1 || indent === 2 ? indent : 0;
}

/** The number a numbered list item shows: one more than the numbered items before it at its
 * indent in the same run. A run ends at a block that is not a list item, at a bulleted item of the
 * same indent and at an item of a smaller indent; deeper items inside it do not end it. */
export function listNumber(tree: BlockTree, id: string): number {
  const block = tree.get(id);
  const parent = tree.parentOf(id);
  if (!block || parent === undefined) return 1;
  const level = indentOf(block);
  const siblings = tree.children(parent);
  let number = 1;
  for (let at = tree.indexOf(id) - 1; at >= 0; at--) {
    const before = siblings[at]!;
    if (before.type !== 'list') break;
    const indent = indentOf(before);
    if (indent < level) break;
    if (indent > level) continue;
    if (before.props.style !== 'number') break;
    number++;
  }
  return number;
}

/** Tab (`by` 1) or Shift+Tab (`by` -1) on a list item or to-do: its indent moves one step, within
 * 0 and `MAX_INDENT`. No op when it is already at that edge, or the block takes no indent. */
export function indentBlock(tree: BlockTree, id: string, by: 1 | -1): BlockOp[] {
  const block = tree.get(id);
  if (!block || (block.type !== 'list' && block.type !== 'todo')) return [];
  const now = indentOf(block);
  const next = Math.max(0, Math.min(MAX_INDENT, now + by));
  if (next === now) return [];
  return [
    next === 0
      ? { op: 'props', id, set: {}, unset: ['indent'] }
      : { op: 'props', id, set: { indent: next }, unset: [] },
  ];
}

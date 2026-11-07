import { CONTAINER_TYPES, PAGE_PARENT, type Parent } from './block-model.js';
import type { BlockTree } from './block-tree.js';

/** A drawn block's box on screen, top and bottom in page pixels. */
export interface BlockBox {
  readonly id: string;
  readonly top: number;
  readonly bottom: number;
}

/** Where a drop lands (spec 移動): before the block at `index` in `parent` (counted with the dragged
 * block in its place), and the card it goes into, which the editor tints. */
export interface DropTarget {
  readonly parent: Parent;
  readonly index: number;
  /** The card the block goes into, or none at the top level. */
  readonly into?: string;
  /** The block the accent line is drawn above, or below the last one when it is absent. */
  readonly lineBefore?: string;
}

/** The share of a card's height, at its top and its bottom, that still drops beside the card;
 * the rest drops inside it. The band never reaches over the card's own children. */
const CARD_EDGE = 0.25;

/**
 * The drop target for a pointer at `y` while `dragging` moves (#6005): the drawn sibling run the
 * pointer is over, in the innermost card it is inside. Over a card's middle the block goes into
 * it (at its end, or before the child the pointer is over); near its top or bottom edge it goes
 * beside it. A block never drops into itself or a card inside it.
 */
export function dropTarget(
  tree: BlockTree,
  boxes: readonly BlockBox[],
  y: number,
  dragging: string,
): DropTarget {
  const box = new Map(boxes.map((entry) => [entry.id, entry]));
  // A card's edge band: a share of its height, but no deeper than its padding before its first
  // child (or after its last one).
  const edge = (card: string, at: BlockBox, side: 'top' | 'bottom') => {
    const band = (at.bottom - at.top) * CARD_EDGE;
    const inner = tree.children(card).flatMap((block) => box.get(block.id) ?? []);
    if (!inner.length) return band;
    return side === 'top'
      ? Math.min(band, inner[0]!.top - at.top)
      : Math.min(band, at.bottom - inner.at(-1)!.bottom);
  };
  const level = (parent: Parent): DropTarget => {
    const children = tree.children(parent).filter((block) => box.has(block.id));
    for (const [index, child] of children.entries()) {
      const at = box.get(child.id)!;
      if (y >= at.bottom) continue;
      const inside =
        CONTAINER_TYPES.has(child.type) &&
        child.id !== dragging &&
        !tree.within(child.id, dragging) &&
        y >= at.top + edge(child.id, at, 'top') &&
        y < at.bottom - edge(child.id, at, 'bottom');
      if (inside) {
        const nested = level(child.id);
        return { ...nested, into: nested.into ?? child.id };
      }
      const after = y >= (at.top + at.bottom) / 2;
      const target = after ? index + 1 : index;
      return {
        parent,
        index: target,
        ...(children[target] && { lineBefore: children[target].id }),
      };
    }
    return { parent, index: children.length };
  };
  return level(PAGE_PARENT);
}

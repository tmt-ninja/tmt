import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { type BlockBox, type DropTarget, dropTarget } from './block-drop.js';
import type { BlockTree } from './block-tree.js';

/** How far the pointer moves on the grip before a press becomes a drag (a shorter press is a
 * click, which opens the block menu). */
const DRAG_PX = 4;

/** The block being dragged and where it would land. */
export interface Drag {
  id: string;
  target?: DropTarget;
  /** The pointer, in viewport pixels, where the ghost follows it. */
  x: number;
  y: number;
}

/**
 * Dragging a block by the handle's grip (#6005, spec 移動): while the pointer moves, the drop
 * target follows it over the drawn blocks (`dropTarget`); releasing drops the block there, Esc
 * cancels. A press that does not move is the grip's click.
 */
export function useBlockDrag(
  tree: BlockTree,
  root: () => HTMLElement | null,
  onDrop: (id: string, parent: string, index: number) => void,
) {
  const [drag, setDrag] = useState<Drag>();
  const press = useRef<{ id: string; y: number; moved: boolean } | undefined>(undefined);
  /** The last drag moved, so the click that ends it does not open the menu. */
  const dragged = useRef(false);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const boxes = useCallback((): BlockBox[] => {
    const host = root();
    if (!host) return [];
    return [...host.querySelectorAll<HTMLElement>('[data-block-id]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.blockId!, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
    });
  }, [root]);

  useEffect(() => {
    const end = () => {
      press.current = undefined;
      setDrag(undefined);
    };
    const moveTo = (event: globalThis.PointerEvent) => {
      const at = press.current;
      if (!at) return;
      if (!at.moved && Math.abs(event.pageY - at.y) < DRAG_PX) return;
      at.moved = true;
      setDrag({
        id: at.id,
        target: dropTarget(treeRef.current, boxes(), event.pageY, at.id),
        x: event.clientX,
        y: event.clientY,
      });
    };
    const release = (event: globalThis.PointerEvent) => {
      const at = press.current;
      if (!at) return;
      dragged.current = at.moved;
      if (at.moved) {
        const target = dropTarget(treeRef.current, boxes(), event.pageY, at.id);
        dropRef.current(at.id, target.parent, target.index);
      }
      end();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && press.current) {
        dragged.current = press.current.moved;
        end();
      }
    };
    addEventListener('pointermove', moveTo);
    addEventListener('pointerup', release);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointermove', moveTo);
      removeEventListener('pointerup', release);
      removeEventListener('keydown', key, true);
    };
  }, [boxes]);

  const start = useCallback((id: string, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragged.current = false;
    press.current = { id, y: event.pageY, moved: false };
  }, []);
  /** Whether the grip's click ends a drag rather than asking for the menu. */
  const wasDrag = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);
  return { drag, start, wasDrag };
}

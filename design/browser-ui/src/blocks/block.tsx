import type { ComponentProps, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { GripVertical, Plus } from 'lucide-react';
import './blocks.css';

/** The blocks of one page, read as one document: the gutter holds the one shared handle. */
export function BlockDocument({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="block-doc"
      className={['tmt-block-doc', className].filter(Boolean).join(' ')}
      {...props}
    >
      <div className="tmt-block-doc-body">{children}</div>
    </div>
  );
}

export type BlockKind =
  | 'heading'
  | 'text'
  | 'list-item'
  | 'todo'
  | 'table'
  | 'card'
  | 'callout'
  | 'code';
/** A forced look for docs and tests; live blocks take hover from the pointer and selection from `selected`. */
export type BlockState = 'idle' | 'hover' | 'selected' | 'dragging';

export interface BlockProps extends Omit<ComponentProps<'div'>, 'aria-label'> {
  /** Names the block for assistive technology: its type and opening text, such as "Table: Ticket status". */
  label: string;
  kind?: BlockKind;
  /** The heading level, so the spacing above a heading follows it. */
  level?: 2 | 3;
  state?: BlockState;
  selected?: boolean;
  /** 1 inside a card. */
  depth?: 0 | 1;
  readonly?: boolean;
  children?: ReactNode;
}

/**
 * The shell every block sits in. It draws nothing at rest; the pointer gives the hover tint and
 * `selected` the selection tint, with no border. Keyboard focus draws the ring (:focus-visible).
 */
export function Block({
  label,
  kind,
  level,
  state,
  selected,
  depth,
  readonly,
  className,
  ...props
}: BlockProps) {
  return (
    <div
      data-slot="block"
      role="group"
      aria-label={label}
      aria-selected={selected ? 'true' : undefined}
      data-kind={kind}
      data-level={level}
      data-state={state && state !== 'idle' ? state : undefined}
      data-depth={depth || undefined}
      data-readonly={readonly ? '' : undefined}
      className={['tmt-block', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

export interface BlockHandleProps {
  /** Opens the insert menu below the block. */
  onInsert?(): void;
  /** Opens the block menu; the same button is the drag grip. */
  onMenu?(): void;
  onGripPointerDown?(event: PointerEvent<HTMLButtonElement>): void;
  menuOpen?: boolean;
  insertLabel?: string;
  menuLabel?: string;
}

/**
 * The editor's one handle. Render it once, inside the hovered or keyboard-focused block; it sits
 * in the gutter 8px left of that block. It is out of the Tab order: the keyboard opens the same
 * block menu from the focused block (see blockKeyAction).
 */
export function BlockHandle({
  onInsert,
  onMenu,
  onGripPointerDown,
  menuOpen,
  insertLabel = 'Insert block',
  menuLabel = 'Block actions',
}: BlockHandleProps) {
  return (
    <div data-slot="block-handle" className="tmt-block-handle">
      <button
        type="button"
        tabIndex={-1}
        className="tmt-block-handle-button"
        aria-label={insertLabel}
        onClick={onInsert}
      >
        <Plus aria-hidden="true" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="tmt-block-handle-button"
        data-grip=""
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={menuOpen ? 'true' : 'false'}
        onClick={onMenu}
        onPointerDown={onGripPointerDown}
      >
        <GripVertical aria-hidden="true" />
      </button>
    </div>
  );
}

/** Where a dragged block lands. */
export function BlockDropLine() {
  return <div data-slot="block-drop" className="tmt-block-drop" role="presentation" />;
}

/** The block being dragged, under the pointer. The host positions it. */
export function BlockGhost({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="block-ghost"
      aria-hidden="true"
      className={['tmt-block-ghost', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

export type BlockKeyAction =
  | 'menu'
  | 'escape'
  | 'previous'
  | 'next'
  | 'extend-previous'
  | 'extend-next'
  | 'move-up'
  | 'move-down'
  | 'duplicate'
  | 'delete'
  | 'undo';

/**
 * The block keyboard contract as one table, for every editor: Menu, Shift+F10 or Cmd/Ctrl+/ open
 * the block menu; Esc leaves typing for selection; arrows move and Shift+arrows extend the
 * selection; Alt+Shift+arrows move; Cmd/Ctrl+D duplicates; Delete or Backspace deletes the
 * selection; Cmd/Ctrl+Z undoes. `selecting` is false while the person types inside a block.
 */
export function blockKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey'>,
  selecting: boolean,
): BlockKeyAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (
    event.key === 'ContextMenu' ||
    (event.shiftKey && event.key === 'F10') ||
    (mod && event.key === '/')
  )
    return 'menu';
  if (event.key === 'Escape') return 'escape';
  if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') return 'undo';
  if (!selecting) return null;
  const up = event.key === 'ArrowUp';
  const down = event.key === 'ArrowDown';
  if (event.altKey && event.shiftKey && (up || down)) return up ? 'move-up' : 'move-down';
  if (up || down) {
    if (event.shiftKey) return up ? 'extend-previous' : 'extend-next';
    return up ? 'previous' : 'next';
  }
  if (mod && event.key.toLowerCase() === 'd') return 'duplicate';
  if (event.key === 'Delete' || event.key === 'Backspace') return 'delete';
  return null;
}

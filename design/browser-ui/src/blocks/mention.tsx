import type { MouseEventHandler, ReactNode } from 'react';
import './blocks.css';

export interface BlockMentionProps {
  /** The block's type icon. */
  icon?: ReactNode;
  /** Scrolls to the block and selects it; without it the chip is plain text, as in a draft. */
  href?: string;
  /** Type and opening text, such as "Table: Ticket status". */
  children?: ReactNode;
  /** The host opens the link itself (a block on another page goes through its trusted path). */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

/** An @block chip, in a paragraph or a comment. */
export function BlockMention({ icon, href, children, onClick }: BlockMentionProps) {
  const body = (
    <>
      {icon !== undefined && <span aria-hidden="true">{icon}</span>}
      <span className="tmt-block-mention-text">{children}</span>
    </>
  );
  return href === undefined ? (
    <span data-slot="block-mention" className="tmt-block-mention">
      {body}
    </span>
  ) : (
    <a data-slot="block-mention" className="tmt-block-mention" href={href} onClick={onClick}>
      {body}
    </a>
  );
}

export interface BlockToastProps {
  /** What happened, such as "Deleted 1 block (Table)". */
  children?: ReactNode;
  onUndo?(): void;
  undoLabel?: string;
  /** The undo key, shown after the button. */
  shortcut?: string;
}

/** The status line after a delete or move, with Undo; without `onUndo`, a notice with no action.
 * The host places it and times it out. */
export function BlockToast({
  children,
  onUndo,
  undoLabel = 'Undo',
  shortcut = '⌘Z',
}: BlockToastProps) {
  return (
    <div data-slot="block-toast" role="status" className="tmt-block-toast">
      <span className="tmt-block-toast-message">{children}</span>
      {onUndo && (
        <button type="button" className="tmt-block-toast-undo" onClick={onUndo}>
          {undoLabel}
        </button>
      )}
      {onUndo && shortcut && (
        <kbd className="tmt-block-kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </div>
  );
}

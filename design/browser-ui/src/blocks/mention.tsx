import type { ReactNode } from 'react';
import './blocks.css';

export interface BlockMentionProps {
  /** The block's type icon. */
  icon?: ReactNode;
  /** Scrolls to the block and selects it; without it the chip is plain text, as in a draft. */
  href?: string;
  /** Type and opening text, such as "Table: Ticket status". */
  children?: ReactNode;
}

/** An @block chip, in a paragraph or a comment. */
export function BlockMention({ icon, href, children }: BlockMentionProps) {
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
    <a data-slot="block-mention" className="tmt-block-mention" href={href}>
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

/** The status line after a delete or move, with Undo. The host places it and times it out. */
export function BlockToast({
  children,
  onUndo,
  undoLabel = 'Undo',
  shortcut = '⌘Z',
}: BlockToastProps) {
  return (
    <div data-slot="block-toast" role="status" className="tmt-block-toast">
      <span className="tmt-block-toast-message">{children}</span>
      <button type="button" className="tmt-block-toast-undo" onClick={onUndo}>
        {undoLabel}
      </button>
      {shortcut && (
        <kbd className="tmt-block-kbd" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </div>
  );
}

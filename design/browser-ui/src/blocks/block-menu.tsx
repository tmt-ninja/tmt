import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import './blocks.css';

type MenuKind = 'insert' | 'actions';
const MenuKindContext = createContext<MenuKind>('insert');

export interface BlockMenuProps extends Omit<ComponentProps<'div'>, 'role' | 'aria-label'> {
  /** `insert` is the slash/insert listbox; `actions` is the block menu from the handle or menu key. */
  kind?: MenuKind;
  label: string;
  /** `sheet` is the phone's bottom sheet. */
  placement?: 'below' | 'above' | 'sheet';
  /** The id of the active item, for aria-activedescendant: focus stays where the person types. */
  activeId?: string;
}

/**
 * The floating block menu. The host owns the query, the open state and the active item; keep focus
 * in the editor and drive the active item with nextBlockMenuItem.
 */
export function BlockMenu({
  kind = 'insert',
  label,
  placement = 'below',
  activeId,
  className,
  ...props
}: BlockMenuProps) {
  return (
    <MenuKindContext.Provider value={kind}>
      <div
        data-slot="block-menu"
        role={kind === 'insert' ? 'listbox' : 'menu'}
        aria-label={label}
        aria-activedescendant={activeId}
        data-placement={placement}
        tabIndex={-1}
        className={['tmt-block-menu', className].filter(Boolean).join(' ')}
        {...props}
      />
    </MenuKindContext.Provider>
  );
}

/** A group heading, such as Basic or Structure; hide it while a query leaves one group. */
export function BlockMenuGroup({ children }: { children?: ReactNode }) {
  return (
    <div data-slot="block-menu-group" role="presentation" className="tmt-block-menu-group">
      {children}
    </div>
  );
}

export interface BlockMenuItemProps extends Omit<ComponentProps<'div'>, 'role'> {
  icon?: ReactNode;
  description?: ReactNode;
  /** The typed shortcut (/table, []) or key (⌘D). */
  shortcut?: string;
  active?: boolean;
  danger?: boolean;
}

export function BlockMenuItem({
  icon,
  description,
  shortcut,
  active,
  danger,
  children,
  className,
  ...props
}: BlockMenuItemProps) {
  const kind = useContext(MenuKindContext);
  return (
    <div
      data-slot="block-menu-item"
      role={kind === 'insert' ? 'option' : 'menuitem'}
      aria-selected={kind === 'insert' ? (active ? 'true' : 'false') : undefined}
      data-active={active ? '' : undefined}
      data-danger={danger ? '' : undefined}
      className={['tmt-block-menu-item', className].filter(Boolean).join(' ')}
      {...props}
    >
      {icon !== undefined && (
        <span className="tmt-block-menu-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="tmt-block-menu-label">
        {children}
        {description !== undefined && (
          <small className="tmt-block-menu-description">{description}</small>
        )}
      </span>
      {shortcut !== undefined && <kbd className="tmt-block-kbd">{shortcut}</kbd>}
    </div>
  );
}

export function BlockMenuSeparator() {
  return <hr data-slot="block-menu-separator" className="tmt-block-menu-separator" />;
}

/** No type matches the query; Esc closes and keeps the typed text. */
export function BlockMenuEmpty({ children }: { children?: ReactNode }) {
  return (
    <div data-slot="block-menu-empty" role="presentation" className="tmt-block-menu-empty">
      {children}
    </div>
  );
}

/** The key hints: ↑↓ choose, Enter insert, Esc close. Leave it out of the phone sheet. */
export function BlockMenuFooter({ children }: { children?: ReactNode }) {
  return (
    <div data-slot="block-menu-footer" aria-hidden="true" className="tmt-block-menu-footer">
      {children}
    </div>
  );
}

export function BlockKbd({ children }: { children?: ReactNode }) {
  return <kbd className="tmt-block-kbd">{children}</kbd>;
}

/** The active item after ArrowUp, ArrowDown, Home or End; it wraps, and other keys keep it. */
export function nextBlockMenuItem(ids: readonly string[], active: string | undefined, key: string) {
  if (!ids.length) return undefined;
  const at = active === undefined ? -1 : ids.indexOf(active);
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  if (key === 'ArrowDown') return ids[(at + 1) % ids.length];
  if (key === 'ArrowUp') return ids[at <= 0 ? ids.length - 1 : at - 1];
  return active ?? ids[0];
}

export type BlockAction =
  | 'move-to'
  | 'move-up'
  | 'move-down'
  | 'duplicate'
  | 'copy-link'
  | 'mention'
  | 'delete';

/** The block menu's items in their order, with their keys. A block menu never turns a block into another type. */
export const blockActions: readonly {
  id: BlockAction;
  label: string;
  shortcut?: string;
  danger?: boolean;
}[] = [
  { id: 'move-to', label: 'Move to…' },
  { id: 'move-up', label: 'Move up', shortcut: '⌥⇧↑' },
  { id: 'move-down', label: 'Move down', shortcut: '⌥⇧↓' },
  { id: 'duplicate', label: 'Duplicate', shortcut: '⌘D' },
  { id: 'copy-link', label: 'Copy link to block' },
  { id: 'mention', label: '@ this block in a comment' },
  { id: 'delete', label: 'Delete', shortcut: 'Del', danger: true },
];

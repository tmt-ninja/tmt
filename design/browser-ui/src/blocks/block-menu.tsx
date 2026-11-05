import { CircleHelp, Code2, Heading2, ListChecks, Table2, Text } from 'lucide-react';
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
  /**
   * Catalog rows, in this order, before any children: an insert menu draws the insert types with
   * their icon, description, shortcut and group heading; a block menu draws the block actions with
   * their keys. An entry is a catalog label, `<id>:<text>` (the row of that id, showing `text`) or
   * `group:<id>:<heading>` (a group's heading); anything else is a plain row.
   */
  items?: readonly string[];
  /** The active row, by its entry, id or text. */
  activeItem?: string;
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
  items,
  activeItem,
  className,
  children,
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
      >
        {items && <CatalogRows kind={kind} labels={items} active={activeItem} />}
        {children}
      </div>
    </MenuKindContext.Provider>
  );
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type InsertItem = (typeof insertGroups)[number]['items'][number];
type Action = (typeof blockActions)[number];
interface Row {
  /** The text the row shows. */
  text: string;
  /** What `activeItem` may name: the entry as written, its id and its text. */
  names: string[];
  item?: InsertItem;
  action?: Action;
  group?: string;
}

/**
 * Read `items` entries. `group:<id>:<heading>` renames a catalog group; `<id>:<label>` is the
 * catalog row of that id with its own text (a page in another language keeps the icon,
 * description and shortcut); any other entry is the row of that label, else a plain row. A
 * malformed entry is a plain row with its text; nothing throws.
 */
function readItems(kind: MenuKind, entries: readonly string[]) {
  const headings = new Map<string, string>();
  const rows: Row[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const heading = /^group:([a-z][a-z-]*):(.+)$/.exec(entry);
    if (heading && kind === 'insert' && insertGroups.some((group) => group.id === heading[1])) {
      headings.set(heading[1]!, heading[2]!.trim());
      continue;
    }
    const keyed = /^([a-z][a-z-]*):(.+)$/.exec(entry);
    const id = keyed?.[1];
    const text = keyed?.[2]?.trim();
    if (kind === 'actions') {
      const byId = id ? blockActions.find((action) => action.id === id) : undefined;
      const action = byId ?? blockActions.find((candidate) => same(candidate.label, entry));
      const shown = byId && text ? text : (action?.label ?? entry);
      rows.push({ text: shown, names: [entry, shown, ...(action ? [action.id] : [])], action });
      continue;
    }
    let found: { item: InsertItem; group: string } | undefined;
    for (const group of insertGroups)
      for (const item of group.items)
        if (!found && (id && text ? item.id === id : same(item.label, entry)))
          found = { item, group: group.id };
    const shown = found && id && text ? text : (found?.item.label ?? entry);
    rows.push({
      text: shown,
      names: [entry, shown, ...(found ? [found.item.id] : [])],
      item: found?.item,
      group: found?.group,
    });
  }
  return { headings, rows };
}

/** The rows a labelled catalog menu draws: insert types in runs of one group, or block actions. */
function CatalogRows({
  kind,
  labels,
  active,
}: {
  kind: MenuKind;
  labels: readonly string[];
  active: string | undefined;
}) {
  const { headings, rows } = readItems(kind, labels);
  const isActive = (row: Row) =>
    active !== undefined && row.names.some((name) => same(name, active));
  if (kind === 'actions')
    return rows.map((row, index) => (
      <div key={`${index}-${row.text}`}>
        {row.action?.id === 'delete' && index > 0 && <BlockMenuSeparator />}
        <BlockMenuItem
          shortcut={row.action?.shortcut}
          danger={row.action?.danger}
          active={isActive(row)}
        >
          {row.text}
        </BlockMenuItem>
      </div>
    ));
  // Consecutive rows of one group share a heading; headings show only when there are two groups.
  const runs: Row[][] = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last && last[0]!.group === row.group) last.push(row);
    else runs.push([row]);
  }
  const headed = new Set(rows.map((row) => row.group).filter(Boolean)).size > 1;
  return runs.map((run, index) => {
    const id = run[0]!.group;
    const name = id && (headings.get(id) ?? insertGroups.find((group) => group.id === id)?.name);
    const content = run.map((row, at) => (
      <BlockMenuItem
        key={`${at}-${row.text}`}
        icon={row.item?.icon}
        description={row.item?.description}
        shortcut={row.item?.shortcut}
        active={isActive(row)}
      >
        {row.text}
      </BlockMenuItem>
    ));
    return name ? (
      <div key={`${index}-${id}`} role="group" aria-label={name}>
        {headed && <BlockMenuGroup>{name}</BlockMenuGroup>}
        {content}
      </div>
    ) : (
      <div key={`${index}-plain`} role="presentation">
        {content}
      </div>
    );
  });
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

/** The insert menu's block types, in their groups: the one catalog the editor and the
 * block-menu tag draw. */
export const insertGroups: readonly {
  /** The stable id an `items` entry names: `group:<id>:<heading>`. */
  id: string;
  name: string;
  items: readonly {
    id: string;
    label: string;
    description: string;
    shortcut: string;
    icon: ReactNode;
  }[];
}[] = [
  {
    id: 'basic',
    name: 'Basic',
    items: [
      {
        id: 'text',
        label: 'Paragraph',
        description: 'Plain text',
        shortcut: '/text',
        icon: <Text />,
      },
      {
        id: 'heading',
        label: 'Heading',
        description: '## or ###',
        shortcut: '##',
        icon: <Heading2 />,
      },
      {
        id: 'table',
        label: 'Table',
        description: 'Columns and rows',
        shortcut: '/table',
        icon: <Table2 />,
      },
      {
        id: 'todo',
        label: 'To-do',
        description: 'Items to check off',
        shortcut: '[]',
        icon: <ListChecks />,
      },
    ],
  },
  {
    id: 'structure',
    name: 'Structure',
    items: [
      {
        id: 'question',
        label: 'Question',
        description: 'Choices or a short answer',
        shortcut: '/q',
        icon: <CircleHelp />,
      },
      {
        id: 'code',
        label: 'Code',
        description: 'A file or a command',
        shortcut: '```',
        icon: <Code2 />,
      },
    ],
  },
];

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

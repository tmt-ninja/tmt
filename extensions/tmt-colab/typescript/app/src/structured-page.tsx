// The parts draw on the design system's UI layer (buttons, selects, chips), as the router's do.
import '@tmt/browser-ui/ui.css';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Block,
  blockActions,
  BlockDocument,
  BlockDropLine,
  BlockGhost,
  BlockHandle,
  BlockMenu,
  BlockMenuEmpty,
  BlockMenuFooter,
  BlockKbd,
  BlockMenuItem,
  BlockToast,
  insertGroups,
  MarkedText,
  authoredPageViewRows,
  ConnectedWorkBundle,
  MockupBlock,
  PageView,
  QuestionBlock,
  WorkBundle,
  type WorkBundleSource,
  Callout,
  calloutLabels,
  CardBlock,
  HeadingBlock,
  ListItemBlock,
  TableBlock,
  TextBlock,
  TodoBlock,
  type BlockKind,
  type CalloutTone,
} from '@tmt/browser-ui/blocks';
import {
  type BlockRecord,
  PAGE_PARENT,
  type TableColumn,
  type TableColumnEdit,
  type TableRowAction,
  newColumnId,
  tableColumns,
  TEXT_TYPES,
} from './block-model.js';
import { PageMenu } from './page-menu.js';
import { indentOf, listNumber, type QuestionEdit } from './block-ops.js';
import { mockupSource, mockupStage, pageViewSpec, workBundleProps } from './block-parts.js';
import {
  blockQuestion,
  QuestionEditor,
  type QuestionPage,
  StructuredQuestion,
} from './structured-question.js';
import { ParentPageView, type ParentPageViewSource } from './parent-page-view.js';
import { StructuredImages } from './block-images.js';
import type { DocumentImageInput } from './document-images.js';
import type { Theme } from './theme.js';
import { Button, Input } from '@tmt/browser-ui/ui';
import { BlockTextEditor, type TextRange } from './block-text-editor.js';
import type { BlockTree } from './block-tree.js';
import { text as strings } from './strings.js';
import { type Drag, useBlockDrag } from './use-block-drag.js';
import {
  BLOCK_MENU_ACTIONS,
  type BlockMenuAction,
  type BlockUpload,
  type DeleteToast,
  type InsertMenu,
  type MentionMenu,
} from './use-block-editing.js';

/** The catalog row of each insert entry, for its icon and description. */
const INSERT_ROWS = new Map(
  insertGroups.flatMap((group) => group.items.map((item) => [item.id, item] as const)),
);

/** The design system's look for each block type the editor draws so far (#6005 step 1). */
const KIND: Partial<Record<BlockRecord['type'], BlockKind>> = {
  paragraph: 'text',
  heading: 'heading',
  list: 'list-item',
  todo: 'todo',
  card: 'card',
  callout: 'callout',
  code: 'code',
  table: 'table',
};

/** What the page shows a block as, for assistive technology: its type and opening text. */
export function blockLabel(block: BlockRecord): string {
  const opening = (block.text ?? '').trim().slice(0, 40);
  return opening ? `${block.type}: ${opening}` : block.type;
}

export interface StructuredPageProps {
  tree: BlockTree;
  /** The focused text block's (or table cell's, by row and `column`) text while it is edited, and
   * where its caret goes on a page change. */
  editing?: { id: string; column?: string; text: string; caret: number; version: number };
  /** The person focused a text block. */
  onFocus?(id: string): void;
  /** Typing in the focused block. */
  onTyped?(id: string, text: string, caret: number): void;
  /** A key in the focused block (Enter, Backspace at its start, a format key); true when the page
   * took it. */
  onKey?(id: string, event: KeyboardEvent, text: string, caret: number, range: TextRange): boolean;
  /** The person focused a table's cell, by its row and column. */
  onFocusCell?(table: string, row: string, column: string): void;
  /** A key in the focused cell (Tab, Shift+Tab, Esc); true when the page took it. */
  onCellKey?(event: KeyboardEvent, text: string): boolean;
  /** An empty table's Add a row. */
  onAddRow?(table: string): void;
  /** A row menu's choice: a new row above or below, or the row removed. */
  onRowAction?(table: string, row: string, action: TableRowAction): void;
  /** A column menu's choice: a column added, renamed, moved or removed. */
  onColumnAction?(table: string, edit: TableColumnEdit): void;
  /** A work bundle's page metadata, gated on owner-only content; absent draws it unavailable. */
  workSource?: WorkBundleSource;
  /** A live page view's owner list, gated the same way; absent draws its unavailable state. */
  pageViewSource?: ParentPageViewSource;
  /** Renders a mockup's page source in the sandboxed render frame inside `host` (the router's
   * renderer, with HTML pages' admission); absent draws the mockup unavailable. */
  mountMockup?: MountMockup;
  /** The page's question registry and discussion, for question blocks to answer through. */
  questionPage?: QuestionPage;
  /** The page's attachment list and authorized read, for image blocks; absent draws each image in
   * its error state. */
  imageSource?: DocumentImageInput;
  /** A to-do's checkbox was ticked or cleared. */
  onChecked?(id: string, checked: boolean): void;
  /** The question block whose editor is open (#6194). */
  authoring?: string;
  /** An edit in the open question editor. */
  onQuestionEdit?(id: string, edit: QuestionEdit): void;
  /** A question's editor opens, or closes (`undefined`). */
  onAuthor?(id: string | undefined): void;
  /** A link in a block was activated (a click at rest, ⌘-click while typing): the page's trusted
   * open path decides, as for any page link. */
  onLink?(href: string, newTab: boolean): void;
  /** A URL pasted over a selected range of the focused block; true when the page linked it. */
  onPasteUrl?(id: string, url: string, text: string, range: TextRange): boolean;
  /** No editing at all: a reader, or a page this device may not change. */
  readonly?: boolean;
  /** The insert menu open under the focused block. */
  menu?: InsertMenu;
  /** An insert entry was chosen, or the pointer is over one. */
  onPick?(entry: string): void;
  onHover?(entry: string): void;
  /** The phone sheet's scrim was tapped: the menu closes and the typed text stays. */
  onCloseMenu?(): void;
  /** The selected blocks, and the one keyboard focus sits on. */
  selected?: readonly string[];
  selectionFocus?: string;
  /** A key on the page outside a block's editor (Delete, arrows, ⌘Z); true when taken. */
  onPageKey?(event: KeyboardEvent): boolean;
  /** The status line after a delete, and its Undo. */
  toast?: DeleteToast;
  onUndo?(): void;
  /** The block menu open on a block, its active action, and what it does. */
  blockMenu?: { id: string; active?: string };
  onAction?(action: BlockMenuAction, id: string): void;
  onHoverAction?(action: string): void;
  onCloseBlockMenu?(): void;
  /** The handle: ⋯ opens the block menu, ＋ the insert menu after the block, and the grip drags. */
  onOpenBlockMenu?(id: string): void;
  onInsertAfter?(id: string): void;
  onMove?(id: string, parent: string, index: number): void;
  /** The @ menu open in the focused block (#6203), and its choice and pointer. */
  mention?: MentionMenu;
  onPickMention?(entry: string): void;
  onHoverMention?(entry: string): void;
  /** Files dropped or pasted on the page, after the block they landed on (#6202). */
  onAttach?(files: File[], after?: string): void;
  /** The file blocks this tab is adding, drawn as their upload tile. */
  uploads?: ReadonlyMap<string, BlockUpload>;
  /** "Image or file" was chosen in the insert menu: the file picker opens once per `id`. */
  choosing?: { after: string; id: number };
  /** Download a file card's file through the page's confirmed download path (#6202). */
  onDownloadFile?(attachmentId: string): void;
}

/** The files a drop or paste carries; none when it carries only text. */
const carried = (data: DataTransfer | null): File[] => (data ? [...data.files] : []);
/** The innermost block an event landed on. */
const landedOn = (target: EventTarget | null) =>
  target instanceof Element
    ? target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId
    : undefined;

/** The page's pointer state that the blocks draw: the hovered block and a drag in progress. */
interface Pointer {
  hovered?: string;
  drag?: Drag;
  startDrag(id: string, event: React.PointerEvent<HTMLButtonElement>): void;
  wasDrag(): boolean;
}

/**
 * A structured page drawn from its block tree with the design system's block parts (#6005). Every
 * block draws as static content except the focused text block, which holds the one editor.
 */
export function StructuredPage(props: StructuredPageProps) {
  const root = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string>();
  const drop = useCallback(
    (id: string, parent: string, index: number) => props.onMove?.(id, parent, index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onMove],
  );
  const { drag, start, wasDrag } = useBlockDrag(props.tree, () => root.current, drop);
  // The insert menu's "Image or file" opens the device's file picker while the key or click that
  // chose it still counts as the person's gesture.
  const picker = useRef<HTMLInputElement>(null);
  const choosing = props.choosing;
  const chosenAfter = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!choosing || !picker.current) return;
    chosenAfter.current = choosing.after;
    picker.current.value = '';
    picker.current.click();
  }, [choosing]);
  const pointer: Pointer = { hovered, drag, startDrag: start, wasDrag };
  return (
    <>
      <BlockDocument
        ref={root}
        onKeyDown={(event) => {
          if (props.onPageKey?.(event)) event.preventDefault();
        }}
        // The handle follows the innermost block under the pointer.
        onPointerMove={(event) => {
          const block = (event.target as HTMLElement).closest<HTMLElement>('[data-block-id]');
          setHovered(block?.dataset.blockId);
        }}
        onPointerLeave={() => setHovered(undefined)}
        // Dropping files, or pasting them, inserts them after the block they landed on (spec 圖片:
        // 拖檔案或貼上圖片＝插入). Text and a block's own drag are not files and pass through.
        onDragOver={(event) => {
          if (props.onAttach && !props.readonly && event.dataTransfer.types.includes('Files'))
            event.preventDefault();
        }}
        onDrop={(event) => {
          const files = carried(event.dataTransfer);
          if (!props.onAttach || props.readonly || !files.length) return;
          event.preventDefault();
          props.onAttach(files, landedOn(event.target));
        }}
        onPasteCapture={(event) => {
          const files = carried(event.clipboardData);
          if (!props.onAttach || props.readonly || !files.length) return;
          event.preventDefault();
          event.stopPropagation();
          props.onAttach(files, landedOn(event.target));
        }}
      >
        <Blocks {...props} parent={PAGE_PARENT} pointer={pointer} />
        {drag?.target && drag.target.parent === PAGE_PARENT && !drag.target.lineBefore && (
          <BlockDropLine />
        )}
        {drag && <DragGhost drag={drag} tree={props.tree} root={root.current} />}
      </BlockDocument>
      {props.onAttach && (
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label={strings.blockFiles.pick}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            if (files.length) props.onAttach?.(files, chosenAfter.current);
          }}
        />
      )}
      {props.toast && (
        <div className="tmt-block-toast-place" key={props.toast.id}>
          {props.toast.notice ? (
            <BlockToast>{props.toast.notice}</BlockToast>
          ) : (
            <BlockToast onUndo={props.onUndo} undoLabel={strings.blockDelete.undo}>
              {strings.blockDelete.deleted(props.toast.count)}
            </BlockToast>
          )}
        </div>
      )}
    </>
  );
}

function Blocks({
  tree,
  parent,
  pointer,
  ...rest
}: StructuredPageProps & { parent: string; pointer: Pointer }): ReactNode {
  const drag = pointer.drag;
  return tree.children(parent).map((block) => [
    drag?.target?.lineBefore === block.id && <BlockDropLine key={`drop-${block.id}`} />,
    <Block
      key={block.id}
      data-block-id={block.id}
      label={blockLabel(block)}
      kind={KIND[block.type]}
      level={block.type === 'heading' ? headingLevel(block) : undefined}
      depth={parent === PAGE_PARENT ? 0 : 1}
      selected={
        rest.editing?.id === block.id ||
        rest.selected?.includes(block.id) ||
        // A card a drag would drop into takes the selection tint.
        drag?.target?.into === block.id
      }
      state={drag?.id === block.id ? 'dragging' : undefined}
      // A selected block takes keyboard focus, so Delete, the arrows and ⌘Z reach the page; focus
      // already inside it (a table's menu or column name field) stays where it is.
      tabIndex={rest.selected?.includes(block.id) ? -1 : undefined}
      ref={(node: HTMLDivElement | null) => {
        if (node && rest.selectionFocus === block.id && !node.contains(document.activeElement))
          node.focus();
      }}
      readonly={rest.readonly}
      onClick={(event) => {
        // A click on the handle or a menu inside the block is theirs, not a click on the block.
        const target = event.target as HTMLElement;
        // The handle, a menu and a control in the block (a to-do's checkbox) take their own click.
        if (
          target.closest(
            '[data-slot="block-handle"], [data-slot="block-menu"], input, button, a[href]',
          )
        )
          return;
        // The innermost block takes the click.
        if (target.closest('[data-block-id]') !== event.currentTarget) return;
        if (!rest.readonly && TEXT_TYPES.has(block.type)) rest.onFocus?.(block.id);
      }}
    >
      {!rest.readonly &&
        !drag &&
        (pointer.hovered === block.id || rest.selectionFocus === block.id) && (
          <BlockHandle
            menuOpen={rest.blockMenu?.id === block.id}
            onInsert={() => rest.onInsertAfter?.(block.id)}
            onMenu={() => {
              if (!pointer.wasDrag()) rest.onOpenBlockMenu?.(block.id);
            }}
            onGripPointerDown={(event) => pointer.startDrag(block.id, event)}
          />
        )}
      <Content block={block} {...rest} pointer={pointer} tree={tree} />
      {rest.blockMenu?.id === block.id && (
        <ActionsPopover
          block={block}
          active={rest.blockMenu.active}
          onAction={rest.onAction}
          onHoverAction={rest.onHoverAction}
          onClose={rest.onCloseBlockMenu}
        />
      )}
      {rest.mention?.id === block.id && (
        <MentionPopover
          mention={rest.mention}
          onPick={rest.onPickMention}
          onHover={rest.onHoverMention}
        />
      )}
      {rest.menu?.id === block.id && (
        <InsertPopover
          menu={rest.menu}
          onPick={rest.onPick}
          onHover={rest.onHover}
          onCloseMenu={rest.onCloseMenu}
        />
      )}
    </Block>,
  ]);
}

/** The dragged block under the pointer: its opening text (else its type), as the design system's
 * ghost.
 * It sits in the document body, which positions it. */
function DragGhost({
  drag,
  tree,
  root,
}: {
  drag: Drag;
  tree: BlockTree;
  root: HTMLElement | null;
}) {
  const block = tree.get(drag.id);
  const body = root?.querySelector<HTMLElement>('.tmt-block-doc-body');
  if (!block || !body) return null;
  const box = body.getBoundingClientRect();
  return (
    <BlockGhost style={{ left: drag.x - box.left + 12, top: drag.y - box.top + 12 }}>
      <span className="tmt-block-ghost-line">{(block.text ?? '').trim() || block.type}</span>
    </BlockGhost>
  );
}

/** The block menu from the handle's ⋯ or the menu key: the design system's block actions this
 * editor runs. A table is not duplicated here (its rows come with the table step). */
function ActionsPopover({
  block,
  active,
  onAction,
  onHoverAction,
  onClose,
}: {
  block: BlockRecord;
  active?: string;
  onAction?(action: BlockMenuAction, id: string): void;
  onHoverAction?(action: string): void;
  onClose?(): void;
}) {
  const sheet = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
  const actions = blockActions.filter((action) =>
    (BLOCK_MENU_ACTIONS as readonly string[]).includes(action.id),
  );
  return (
    <div
      className="tmt-block-insert tmt-block-actions"
      data-sheet={sheet ? '' : undefined}
      onMouseDown={(event) => {
        if (!sheet || event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose?.();
      }}
    >
      <BlockMenu
        kind="actions"
        label={strings.blockActions.label}
        placement={sheet ? 'sheet' : 'below'}
        activeId={active && `block-action-${active}`}
      >
        {actions.map((action) => (
          <BlockMenuItem
            key={action.id}
            id={`block-action-${action.id}`}
            shortcut={action.shortcut}
            danger={action.danger}
            active={action.id === active}
            onMouseEnter={() => onHoverAction?.(action.id)}
            onMouseDown={(event) => {
              event.preventDefault();
              onAction?.(action.id as BlockMenuAction, block.id);
            }}
          >
            {action.label}
          </BlockMenuItem>
        ))}
      </BlockMenu>
    </div>
  );
}

/** The insert menu under the block the slash was typed in: focus stays in the editor, and the
 * active row follows the keys and the pointer. A phone gets the bottom sheet. */
function InsertPopover({
  menu,
  onPick,
  onHover,
  onCloseMenu,
}: Pick<StructuredPageProps, 'onPick' | 'onHover' | 'onCloseMenu'> & { menu: InsertMenu }) {
  const sheet = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
  return (
    <div
      className="tmt-block-insert"
      data-sheet={sheet ? '' : undefined}
      onMouseDown={(event) => {
        // The scrim closes the sheet; focus stays in the editor.
        if (!sheet || event.target !== event.currentTarget) return;
        event.preventDefault();
        onCloseMenu?.();
      }}
    >
      <BlockMenu
        kind="insert"
        label={strings.blockInsert.label}
        placement={sheet ? 'sheet' : 'below'}
        activeId={menu.active && `block-insert-${menu.active}`}
      >
        {menu.entries.map((entry) => {
          const row = INSERT_ROWS.get(entry.id);
          return (
            <BlockMenuItem
              key={entry.id}
              id={`block-insert-${entry.id}`}
              icon={row?.icon}
              description={row?.description}
              shortcut={entry.shortcut}
              active={entry.id === menu.active}
              onMouseEnter={() => onHover?.(entry.id)}
              // Choosing never takes focus from the editor.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick?.(entry.id);
              }}
            >
              {entry.label}
            </BlockMenuItem>
          );
        })}
        {menu.entries.length === 0 && <BlockMenuEmpty>{strings.blockInsert.empty}</BlockMenuEmpty>}
        {!sheet && <MenuKeys />}
      </BlockMenu>
    </div>
  );
}

/** The @ menu under the block the @ was typed in (#6203, spec "@ 一個區塊"): the same floating
 * listbox as the insert menu, focus staying in the editor, under the text on a phone too. */
function MentionPopover({
  mention,
  onPick,
  onHover,
}: {
  mention: MentionMenu;
  onPick?(entry: string): void;
  onHover?(entry: string): void;
}) {
  const rowId = (entry: string) => `block-mention-${entry.replace(/[^A-Za-z0-9-]/g, '-')}`;
  return (
    <div className="tmt-block-insert">
      <BlockMenu
        kind="insert"
        label={strings.blockMention.label}
        placement="below"
        activeId={mention.active && rowId(mention.active)}
      >
        {mention.entries.map((entry) => (
          <BlockMenuItem
            key={entry.id}
            id={rowId(entry.id)}
            active={entry.id === mention.active}
            onMouseEnter={() => onHover?.(entry.id)}
            // Choosing never takes focus from the editor.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick?.(entry.id);
            }}
          >
            {entry.label}
          </BlockMenuItem>
        ))}
        {mention.entries.length === 0 && (
          <BlockMenuEmpty>{strings.blockMention.empty}</BlockMenuEmpty>
        )}
        <MenuKeys />
      </BlockMenu>
    </div>
  );
}

/** The key hints under the insert and @ menus, as the DS block-menu tag draws them: each key a
 * DS kbd chip, then what it does. */
function MenuKeys() {
  const { choose, insert, close } = strings.blockInsert.keys;
  return (
    <BlockMenuFooter>
      <span>
        <BlockKbd>↑↓</BlockKbd> {choose}
      </span>
      <span>
        <BlockKbd>Enter</BlockKbd> {insert}
      </span>
      <span>
        <BlockKbd>Esc</BlockKbd> {close}
      </span>
    </BlockMenuFooter>
  );
}

/** The router's sandboxed renderer for a mockup's source. */
export type MountMockup = (
  host: HTMLElement,
  source: string,
  signal: AbortSignal,
  /** The stage's Light or Dark; absent follows the viewer. */
  theme?: Theme,
) => Promise<{ destroy(): void; setTheme(theme?: Theme): void }>;

/**
 * A mockup block (#6005): DS `MockupBlock`'s stage around a sandboxed render frame. The markup is
 * untrusted page markup: it renders only in the frame, as an HTML page does, and never enters the
 * parent's DOM. A new source replaces the frame.
 */
function MockupFrame({ block, mount }: { block: BlockRecord; mount?: MountMockup }) {
  // The stage may draw its content again (a new size, a theme): the frame follows the node it is in.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const source = mockupSource(block);
  const [failed, setFailed] = useState(false);
  // The stage's theme control is this viewer's: the frame paints it, and Viewer follows the app.
  const [theme, setTheme] = useState<Theme>();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const frame = useRef<Awaited<ReturnType<MountMockup>>>(undefined);
  useEffect(() => frame.current?.setTheme(theme), [theme]);
  useEffect(() => {
    if (!node || !mount) return;
    const controller = new AbortController();
    setFailed(false);
    mount(node, source, controller.signal, themeRef.current).then(
      (handle) => {
        if (controller.signal.aborted) handle.destroy();
        else {
          frame.current = handle;
          handle.setTheme(themeRef.current);
        }
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => {
      controller.abort();
      frame.current?.destroy();
      frame.current = undefined;
      node.replaceChildren();
    };
  }, [node, mount, source]);
  const stage = mockupStage(block);
  return (
    <MockupBlock
      system={typeof block.props.system === 'string' ? block.props.system : 'tmt-gui'}
      width={stage.width}
      height={stage.height}
      unavailable={!mount || failed}
      onSettingsChange={(settings) =>
        setTheme(settings.theme === 'viewer' ? undefined : settings.theme)
      }
    >
      <div ref={setNode} className="tmt-block-mockup-frame" />
    </MockupBlock>
  );
}

/**
 * A table block: its cells are plain text, each edited in place as a block's text is (the one
 * editor moves to the focused cell), and a table with no rows offers Add a row. A click on a cell
 * focuses it; the row and column come from the cell's own marker, never from its text.
 */
const COLUMN_MENU = ['rename', 'move-left', 'move-right', 'add', 'remove'] as const;
type ColumnMenuKey = (typeof COLUMN_MENU)[number];
const ROW_MENU: readonly TableRowAction[] = ['above', 'below', 'remove'];
/** The longest cell, in characters, of a column that hugs its content. */
const SHORT_CELL = 16;

/** A table block: each cell edits in place, and the column and row menus (the design system's
 * menu) add, rename, move and remove columns and add or remove rows. */
function Table({
  block,
  tree,
  editing,
  onTyped,
  readonly,
  onFocusCell,
  onCellKey,
  onAddRow,
  onRowAction,
  onColumnAction,
}: StructuredPageProps & { block: BlockRecord }) {
  const columns = tableColumns(block.props);
  const rows = tree.rows(block.id);
  const editable = !readonly && onFocusCell !== undefined;
  // A column of short labels never breaks; the table shares the rest of its width as the
  // reference table does.
  const short = (column: TableColumn) =>
    [column.name, ...rows.map((row) => row.cells?.[column.id] ?? '')].every(
      (value) => [...value].length <= SHORT_CELL,
    );
  // The column whose name is being typed, after Rename or a new column.
  const [renaming, setRenaming] = useState<string>();
  const columnChoice = (column: TableColumn, index: number, key: ColumnMenuKey) => {
    const edit = (value: TableColumnEdit) => onColumnAction?.(block.id, value);
    switch (key) {
      case 'rename':
        return setRenaming(column.id);
      case 'move-left':
        // After the column two to the left, or first.
        return edit({
          action: 'move-column',
          column: column.id,
          after: index > 1 ? columns[index - 2]!.id : null,
        });
      case 'move-right':
        return edit({ action: 'move-column', column: column.id, after: columns[index + 1]!.id });
      case 'add': {
        const id = newColumnId();
        edit({
          action: 'add-column',
          column: { id, name: strings.blockTable.newColumn(columns.length + 1) },
          after: column.id,
        });
        return setRenaming(id);
      }
      case 'remove':
        return edit({ action: 'remove-column', column: column.id });
    }
  };
  const columnMenu = (column: TableColumn, index: number) => (
    <PageMenu<ColumnMenuKey>
      label={strings.blockTable.columnActions(column.name)}
      items={COLUMN_MENU.map((key) => {
        const t = strings.blockTable;
        switch (key) {
          case 'rename':
            return { key, label: t.rename };
          case 'move-left':
            return index === 0
              ? { key, label: t.moveLeft, disabled: true, disabledReason: t.firstColumn }
              : { key, label: t.moveLeft };
          case 'move-right':
            return index === columns.length - 1
              ? { key, label: t.moveRight, disabled: true, disabledReason: t.lastColumn }
              : { key, label: t.moveRight };
          case 'add':
            return { key, label: t.addColumn, separated: true };
          case 'remove':
            return columns.length === 1
              ? { key, label: t.removeColumn, disabled: true, disabledReason: t.lastOne }
              : { key, label: t.removeColumn };
        }
      })}
      onSelect={(key) => columnChoice(column, index, key)}
    />
  );
  const heading = (column: TableColumn) => {
    if (renaming !== column.id) return column.name;
    const done = (name?: string) => {
      setRenaming(undefined);
      const value = name?.trim();
      if (value && value !== column.name)
        onColumnAction?.(block.id, { action: 'rename-column', column: column.id, name: value });
    };
    // The field lies over the heading's own box, so the columns keep their widths.
    return (
      <span className="tmt-block-table-rename">
        <span aria-hidden="true">{column.name}</span>
        <Input
          className="tmt-block-table-rename-field"
          aria-label={strings.blockTable.columnName}
          defaultValue={column.name}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => done(event.currentTarget.value)}
          onKeyDown={(event) => {
            // The name field's keys are its own, never the page's block keys.
            event.stopPropagation();
            if (event.key === 'Enter') done(event.currentTarget.value);
            if (event.key === 'Escape') done();
          }}
        />
      </span>
    );
  };
  return (
    <div
      className="tmt-block-table-cells"
      onClick={(event) => {
        if (!editable) return;
        const marker = (event.target as HTMLElement)
          .closest('td, th')
          ?.querySelector<HTMLElement>('[data-cell-row]');
        const { cellRow, cellColumn } = marker?.dataset ?? {};
        if (cellRow && cellColumn) onFocusCell(block.id, cellRow, cellColumn);
      }}
    >
      <TableBlock
        label={typeof block.props.label === 'string' ? block.props.label : 'Table'}
        density={block.props.density === 'compact' ? 'compact' : 'roomy'}
        columns={columns.map((column, index) => ({
          key: column.id,
          name: column.name,
          ...(column.hideNarrow && { hideNarrow: true }),
          ...((column.width === 'narrow' || short(column)) && { nowrap: true }),
          ...(editable &&
            onColumnAction && {
              name: heading(column),
              action: columnMenu(column, index),
            }),
        }))}
        rowKeys={rows.map((row) => row.id)}
        {...(editable &&
          onRowAction && {
            rowActionsLabel: strings.blockTable.rowActionsHeading,
            rowActions: rows.map((row, index) => (
              <PageMenu<TableRowAction>
                key={row.id}
                label={strings.blockTable.rowActions(index + 1)}
                items={ROW_MENU.map((key) => ({
                  key,
                  label:
                    key === 'above'
                      ? strings.blockTable.insertAbove
                      : key === 'below'
                        ? strings.blockTable.insertBelow
                        : strings.blockTable.removeRow,
                  ...(key === 'remove' && { separated: true }),
                }))}
                onSelect={(key) => onRowAction(block.id, row.id, key)}
              />
            )),
          })}
        rows={rows.map((row, index) =>
          columns.map((column) => {
            const value = row.cells?.[column.id] ?? '';
            return editing?.id === row.id && editing.column === column.id ? (
              <BlockTextEditor
                key={column.id}
                label={strings.blockTable.cell(column.name, index + 1)}
                text={editing.text}
                caret={editing.caret}
                version={editing.version}
                onTyped={(text, caret) => onTyped?.(row.id, text, caret)}
                onKey={(event, text) => onCellKey?.(event, text) ?? false}
              />
            ) : (
              <span key={column.id} data-cell-row={row.id} data-cell-column={column.id}>
                {value}
              </span>
            );
          }),
        )}
        empty={
          editable && columns.length ? (
            <Button size="sm" variant="ghost" onClick={() => onAddRow?.(block.id)}>
              {strings.blockTable.addRow}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/** A question block where nothing can be answered: its question and choices only. */
function ReadOnlyQuestion({ block }: { block: BlockRecord }) {
  const question = blockQuestion(block);
  return (
    <QuestionBlock
      title={question.title}
      agent={question.agent}
      kind={question.kind === 'long' ? 'short' : question.kind}
      choices={question.choices.map(({ label }) => label)}
      other={question.other}
    />
  );
}

/** A callout's tone from its props: one the design system draws, else `working`. */
const calloutTone = (tone: unknown): CalloutTone =>
  typeof tone === 'string' && Object.hasOwn(calloutLabels, tone)
    ? (tone as CalloutTone)
    : 'working';

const headingLevel = (block: BlockRecord): 2 | 3 => (block.props.level === 3 ? 3 : 2);

function Content({
  block,
  tree,
  editing,
  onTyped,
  onKey,
  ...rest
}: StructuredPageProps & { block: BlockRecord; pointer: Pointer }): ReactNode {
  // Only the block being typed in shows its placeholder: an empty block at rest reads as space.
  const typing = editing?.id === block.id;
  const placeholder =
    block.type === 'paragraph'
      ? strings.blockText.paragraph
      : block.type === 'heading'
        ? strings.blockText.heading
        : undefined;
  const text = typing ? (
    <BlockTextEditor
      label={blockLabel(block)}
      text={editing.text}
      // Marks drawn for the text the page holds; for other text they wait until it does.
      marks={block.text === editing.text ? block.marks : undefined}
      caret={editing.caret}
      version={editing.version}
      placeholder={placeholder}
      onTyped={(value, caret) => onTyped?.(block.id, value, caret)}
      onKey={(event, value, caret, range) => onKey?.(block.id, event, value, caret, range) ?? false}
      onLink={(href) => rest.onLink?.(href, false)}
      onPasteUrl={(url, value, range) => rest.onPasteUrl?.(block.id, url, value, range) ?? false}
    />
  ) : // Empty text stays empty, so the part keeps its one-line height (`data-empty`).
  block.text ? (
    <MarkedText
      text={block.text}
      marks={block.marks}
      blockHref={(id) => `#block-${id}`}
      onLink={rest.onLink}
    />
  ) : (
    block.text
  );
  switch (block.type) {
    case 'heading':
      return (
        <HeadingBlock level={headingLevel(block)} placeholder="" editing={typing}>
          {text}
        </HeadingBlock>
      );
    case 'list': {
      const numbered = block.props.style === 'number';
      return (
        <ListItemBlock
          marker={numbered ? 'number' : 'bullet'}
          number={numbered ? listNumber(tree, block.id) : undefined}
          indent={indentOf(block)}
        >
          {text}
        </ListItemBlock>
      );
    }
    case 'todo':
      return (
        <TodoBlock
          checked={block.props.checked === true}
          indent={indentOf(block)}
          onCheckedChange={
            rest.readonly || !rest.onChecked
              ? undefined
              : (checked: boolean) => rest.onChecked?.(block.id, checked)
          }
          editing={typing}
        >
          {text}
        </TodoBlock>
      );
    case 'card':
      return (
        <CardBlock title={typeof block.props.title === 'string' ? block.props.title : undefined}>
          <Blocks
            tree={tree}
            parent={block.id}
            editing={editing}
            onTyped={onTyped}
            onKey={onKey}
            {...rest}
          />
          {rest.pointer.drag?.target?.parent === block.id &&
            !rest.pointer.drag.target.lineBefore && <BlockDropLine />}
        </CardBlock>
      );
    case 'table':
      return <Table block={block} tree={tree} editing={editing} onTyped={onTyped} {...rest} />;
    case 'callout':
      return (
        <Callout
          tone={calloutTone(block.props.tone)}
          label={typeof block.props.label === 'string' ? block.props.label : undefined}
          heading={typeof block.props.heading === 'string' ? block.props.heading : undefined}
        >
          {text}
        </Callout>
      );
    case 'paragraph':
    case 'code':
      return (
        <TextBlock placeholder="" editing={typing}>
          {text}
        </TextBlock>
      );
    case 'work-bundle': {
      // Page metadata is the owner's: only the gated source (owner-only content) gives it.
      const bundle = workBundleProps(block);
      const openTicket = (ticket: { href: string }) => rest.onLink?.(ticket.href, true);
      return rest.workSource && bundle.page ? (
        <ConnectedWorkBundle {...bundle} source={rest.workSource} onOpenTicket={openTicket} />
      ) : (
        <WorkBundle {...bundle} state="unavailable" onOpenTicket={openTicket} />
      );
    }
    case 'page-view': {
      const spec = pageViewSpec(block);
      // Authored rows draw as plain values; a live view is the parent's owner list, gated.
      if (Array.isArray(block.props.rows))
        return (
          <PageView
            title={spec.title}
            rows={authoredPageViewRows(block.props.rows, {
              filters: spec.filters,
              sort: spec.sort,
              limit: spec.limit,
            })}
            filters={spec.filters.map((filter, index) => ({
              id: String(index),
              label: `${filter.field}: ${filter.value}`,
            }))}
            state={spec.state === 'auto' ? 'ready' : spec.state}
            groupBy={spec.groupBy}
            columns={spec.columns.length ? spec.columns : undefined}
            density={spec.density}
            selectable={spec.selectable}
            selected={spec.selected}
          />
        );
      return <ParentPageView spec={spec} source={rest.pageViewSource} />;
    }
    case 'question':
      // A writer edits it in place; answers go through the page's answer path; without one (a
      // reader) it only shows.
      if (!rest.readonly && rest.onQuestionEdit && rest.authoring === block.id)
        return (
          <QuestionEditor
            block={block}
            page={rest.questionPage}
            onEdit={(edit) => rest.onQuestionEdit?.(block.id, edit)}
            onDone={() => rest.onAuthor?.(undefined)}
          />
        );
      return rest.questionPage ? (
        <StructuredQuestion
          block={block}
          page={rest.questionPage}
          onEdit={
            !rest.readonly && rest.onQuestionEdit ? () => rest.onAuthor?.(block.id) : undefined
          }
        />
      ) : (
        <ReadOnlyQuestion block={block} />
      );
    case 'mockup':
      return <MockupFrame block={block} mount={rest.mountMockup} />;
    case 'image':
      return (
        <StructuredImages
          block={block}
          source={rest.imageSource}
          upload={rest.uploads?.get(block.id)}
          onDownload={rest.onDownloadFile}
        />
      );
    default:
      // A type this editor does not draw (a newer one): its name, muted.
      return <TextBlock tone="muted">{block.type}</TextBlock>;
  }
}

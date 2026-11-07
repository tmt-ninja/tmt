import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
  BlockMenuItem,
  BlockToast,
  insertGroups,
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
import { type BlockRecord, PAGE_PARENT, tableColumns, TEXT_TYPES } from './block-model.js';
import { BlockTextEditor } from './block-text-editor.js';
import type { BlockTree } from './block-tree.js';
import { text as strings } from './strings.js';
import { type Drag, useBlockDrag } from './use-block-drag.js';
import {
  BLOCK_MENU_ACTIONS,
  type BlockMenuAction,
  type DeleteToast,
  type InsertMenu,
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
  /** The focused text block's text while it is edited, and where its caret goes on a page change. */
  editing?: { id: string; text: string; caret: number; version: number };
  /** The person focused a text block. */
  onFocus?(id: string): void;
  /** Typing in the focused block. */
  onTyped?(id: string, text: string, caret: number): void;
  /** A key in the focused block (Enter, Backspace at its start); true when the page took it. */
  onKey?(
    id: string,
    event: KeyboardEvent,
    text: string,
    caret: number,
    collapsed: boolean,
  ): boolean;
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
}

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
      >
        <Blocks {...props} parent={PAGE_PARENT} pointer={pointer} />
        {drag?.target && drag.target.parent === PAGE_PARENT && !drag.target.lineBefore && (
          <BlockDropLine />
        )}
        {drag && <DragGhost drag={drag} tree={props.tree} root={root.current} />}
      </BlockDocument>
      {props.toast && (
        <div className="tmt-block-toast-place" key={props.toast.id}>
          <BlockToast onUndo={props.onUndo} undoLabel={strings.blockDelete.undo}>
            {strings.blockDelete.deleted(props.toast.count)}
          </BlockToast>
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
      // A selected block takes keyboard focus, so Delete, the arrows and ⌘Z reach the page.
      tabIndex={rest.selected?.includes(block.id) ? -1 : undefined}
      ref={(node: HTMLDivElement | null) => {
        if (node && rest.selectionFocus === block.id && document.activeElement !== node)
          node.focus();
      }}
      readonly={rest.readonly}
      onClick={(event) => {
        // A click on the handle or a menu inside the block is theirs, not a click on the block.
        const target = event.target as HTMLElement;
        if (target.closest('[data-slot="block-handle"], [data-slot="block-menu"]')) return;
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
  const actions = blockActions.filter(
    (action) =>
      (BLOCK_MENU_ACTIONS as readonly string[]).includes(action.id) &&
      !(action.id === 'duplicate' && block.type === 'table'),
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
        {!sheet && <BlockMenuFooter>{strings.blockInsert.keys}</BlockMenuFooter>}
      </BlockMenu>
    </div>
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
      caret={editing.caret}
      version={editing.version}
      placeholder={placeholder}
      onTyped={(value, caret) => onTyped?.(block.id, value, caret)}
      onKey={(event, value, caret, collapsed) =>
        onKey?.(block.id, event, value, caret, collapsed) ?? false
      }
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
    case 'list':
      return <ListItemBlock>{text}</ListItemBlock>;
    case 'todo':
      return (
        <TodoBlock checked={block.props.checked === true} editing={typing}>
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
    case 'table': {
      const columns = tableColumns(block.props);
      return (
        <TableBlock
          label={typeof block.props.label === 'string' ? block.props.label : 'Table'}
          columns={columns.map(({ name }) => ({ name }))}
          rows={tree.rows(block.id).map((row) => columns.map(({ id }) => row.cells?.[id] ?? ''))}
        />
      );
    }
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
    default:
      // Drawn by a later step (question, image, mockup, work bundle, page view).
      return <TextBlock tone="muted">{block.type}</TextBlock>;
  }
}

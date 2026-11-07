import type { KeyboardEvent, ReactNode } from 'react';
import {
  Block,
  BlockDocument,
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
import type { DeleteToast, InsertMenu } from './use-block-editing.js';

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
}

/**
 * A structured page drawn from its block tree with the design system's block parts (#6005). Every
 * block draws as static content except the focused text block, which holds the one editor.
 */
export function StructuredPage(props: StructuredPageProps) {
  return (
    <>
      <BlockDocument
        onKeyDown={(event) => {
          if (props.onPageKey?.(event)) event.preventDefault();
        }}
      >
        <Blocks {...props} parent={PAGE_PARENT} />
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

function Blocks({ tree, parent, ...rest }: StructuredPageProps & { parent: string }): ReactNode {
  return tree.children(parent).map((block) => (
    <Block
      key={block.id}
      data-block-id={block.id}
      label={blockLabel(block)}
      kind={KIND[block.type]}
      level={block.type === 'heading' ? headingLevel(block) : undefined}
      depth={parent === PAGE_PARENT ? 0 : 1}
      selected={rest.editing?.id === block.id || rest.selected?.includes(block.id)}
      // A selected block takes keyboard focus, so Delete, the arrows and ⌘Z reach the page.
      tabIndex={rest.selected?.includes(block.id) ? -1 : undefined}
      ref={(node: HTMLDivElement | null) => {
        if (node && rest.selectionFocus === block.id && document.activeElement !== node)
          node.focus();
      }}
      readonly={rest.readonly}
      onClick={() => {
        if (!rest.readonly && TEXT_TYPES.has(block.type)) rest.onFocus?.(block.id);
      }}
    >
      <Content block={block} {...rest} tree={tree} />
      {rest.menu?.id === block.id && (
        <InsertPopover
          menu={rest.menu}
          onPick={rest.onPick}
          onHover={rest.onHover}
          onCloseMenu={rest.onCloseMenu}
        />
      )}
    </Block>
  ));
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
}: StructuredPageProps & { block: BlockRecord }): ReactNode {
  const text =
    editing?.id === block.id ? (
      <BlockTextEditor
        label={blockLabel(block)}
        text={editing.text}
        caret={editing.caret}
        version={editing.version}
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
      return <HeadingBlock level={headingLevel(block)}>{text}</HeadingBlock>;
    case 'list':
      return <ListItemBlock>{text}</ListItemBlock>;
    case 'todo':
      return <TodoBlock checked={block.props.checked === true}>{text}</TodoBlock>;
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
      return <TextBlock>{text}</TextBlock>;
    default:
      // Drawn by a later step (question, image, mockup, work bundle, page view).
      return <TextBlock tone="muted">{block.type}</TextBlock>;
  }
}

import { ticketLinks, type TicketLinks } from './ticket-links.js';
// The parts draw on the design system's UI layer (buttons, selects, chips), as the router's do.
import '@tmt/browser-ui/ui.css';
import type { SectionSummary } from './bootstrap.js';
import { sectionMark } from './section-view.js';
import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { BrowserAction, BrowserIconAction, BrowserNotice } from '@tmt/browser-ui/react';
import { MessageSquare, Plus, TriangleAlert } from 'lucide-react';
import {
  Block,
  blockActions,
  nextBlockMenuItem,
  BlockDocument,
  BlockDropLine,
  BlockGhost,
  BlockHandle,
  BlockMenu,
  BlockMenuEmpty,
  BlockMenuFooter,
  BlockMenuGroup,
  BlockMenuSeparator,
  BlockKbd,
  BlockMenuItem,
  BlockToast,
  insertGroups,
  MarkedText,
  authoredPageViewRows,
  ConnectedWorkBundle,
  ChartBlock,
  type ChartBlockProps,
  MockupBlock,
  PageView,
  QuestionBlock,
  WorkBundle,
  type WorkBundleSource,
  Callout,
  calloutLabels,
  CardBlock,
  CodeTextBlock,
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
import { blockAnswerChoices } from './question-form.js';
import { ParentPageView, type ParentPageViewSource } from './parent-page-view.js';
import { StructuredImages } from './block-images.js';
import type { DocumentImageInput } from './document-images.js';
import type { Theme } from './theme.js';
import { Button, Input } from '@tmt/browser-ui/ui';
import { BLOCK_CELL_BYTES } from './blocks.js';
import { BlockTextEditor, type TextRange } from './block-text-editor.js';
import type { BlockTree } from './block-tree.js';
import { text as strings } from './strings.js';
import { DiagramBlock } from './diagram-block.js';
import { type Drag, useBlockDrag } from './use-block-drag.js';
import {
  BLOCK_MENU_ACTIONS,
  blockMenuActions,
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
  question: 'question',
  code: 'code',
  table: 'table',
  mockup: 'mockup',
};

/** What the page shows a block as, for assistive technology: its type and opening text. */
export function blockLabel(block: BlockRecord): string {
  const opening = (block.text ?? '').trim().slice(0, 40);
  return opening ? `${block.type}: ${opening}` : block.type;
}

type RecoveryDraft = import('./block-drafts.js').BlockDraft;
function RecoveryNotice({
  draft,
  missing,
  props,
}: {
  draft: RecoveryDraft;
  missing: boolean;
  props: Pick<StructuredPageProps, 'onRestore' | 'onForget' | 'recoveryHeld'>;
}) {
  return (
    <div className="deleted-draft-notice">
      <BrowserNotice
        tone="waiting"
        variant="tinted"
        announcement="status"
        mark={<TriangleAlert size="1em" />}
        stateLabel={missing ? strings.blockDelete.draft : strings.blockEdit.restored}
        body={draft.value || '“”'}
        actions={
          <>
            <BrowserAction
              type="button"
              variant="primary"
              presentation="compact"
              label={missing ? strings.blockDelete.keep : strings.blockEdit.keepRestored}
              disabled={props.recoveryHeld}
              onActivate={() => props.onRestore?.(draft)}
            />
            <BrowserAction
              type="button"
              variant="text"
              presentation="compact"
              label={strings.blockDelete.discard}
              disabled={props.recoveryHeld}
              onActivate={() => props.onForget?.(draft)}
            />
          </>
        }
      />
    </div>
  );
}
export interface StructuredPageProps {
  restored?: readonly RecoveryDraft[];
  onRestore?(draft: RecoveryDraft): void;
  onForget?(draft: RecoveryDraft): void;
  recoveryError?: string;
  recoveryHeld?: boolean;
  recoveryProblems?: readonly (keyof typeof strings.blockDraftRecoveryProblems)[];
  onDismissRecoveryProblems?(): void;
  tree: BlockTree;
  drafts?: ReadonlyMap<string, { editing: NonNullable<StructuredPageProps['editing']> }>;
  onDraftChange?(id: string, text: string, caret: number): void;
  onKeepDraft?(id: string): void;
  onDiscardDraft?(id: string): void;
  todoNumbers?: Readonly<Record<string, string>>;
  /** Selection mode annotates the block instead of starting an edit. */
  annotationMode?: boolean;
  /** Counted sections by heading block ID (#6619): a mark before each heading and its count. */
  sections?: ReadonlyMap<string, SectionSummary>;
  /** `whole` when no text in the block was selected: the block itself is annotated. */
  onAnnotateBlock?(text: string | undefined, block: HTMLElement, whole: boolean): void;
  annotations?: ReadonlyMap<string, readonly { id: string; ordinal: number; open: boolean }[]>;
  onOpenAnnotation?(id: string): void;
  /** The focused text block's (or table cell's, by row and `column`) text while it is edited, and
   * where its caret goes on a page change. */
  editing?: {
    id: string;
    column?: string;
    text: string;
    caret: number;
    version: number;
    from?: string;
  };
  /** The person focused a text block. */
  /** A click starts editing a text block, with the caret at `at` (a scalar offset) when the click
   * landed on its text, else at its end. */
  onFocus?(id: string, at?: number): void;
  /** Typing in the focused block. */
  onTyped?(id: string, text: string, caret: number): void;
  /** A key in the focused block (Enter, Backspace at its start, a format key); true when the page
   * took it. */
  onKey?(id: string, event: KeyboardEvent, text: string, caret: number, range: TextRange): boolean;
  /** The person focused a table's cell, by its row and column. */
  onFocusCell?(table: string, row: string, column: string): void;
  /** A key in the focused cell (Tab, Shift+Tab, Esc); true when the page took it. */
  textFits?(value: string): boolean;
  onFull?(cell?: boolean): void;
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
  references?: TicketLinks;
  /** A URL pasted over a selected range of the focused block; true when the page linked it. */
  onPasteUrl?(id: string, url: string, text: string, range: TextRange): boolean;
  /** Text or HTML pasted into the focused block; true when the page made blocks of it (#6742). */
  onPasteStructure?(
    id: string,
    html: string,
    plain: string,
    text: string,
    range: TextRange,
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
  onSelectBlock?(id: string): void;
  /** Changes only when something selects a block on purpose (a menu action, a key, a click), not
   * on a render the page's other changes cause. */
  selectionRequest?: object;
  /** A key on the page outside a block's editor (Delete, arrows, ⌘Z); true when taken. */
  onPageKey?(event: KeyboardEvent): boolean;
  /** The status line after a delete, and its Undo. */
  toast?: DeleteToast;
  onUndo?(): void;
  /** The block menu open on a block, its active action, and what it does. */
  blockMenu?: { id: string; active?: string; list?: 'turn-into' };
  onAction?(action: BlockMenuAction, id: string): void;
  onHoverAction?(action: string): void;
  onCloseBlockMenu?(): void;
  /** The handle: ⋯ opens the block menu, ＋ the insert menu after the block, and the grip drags. */
  onOpenBlockMenu?(id: string): void;
  onInsertAfter?(id: string): void;
  /** The first typed text or insert gesture creates the first paragraph. */
  onInsertFirst?(text: string): Promise<boolean>;
  onOpenFirstPicker?(): void;
  /** Text from a refused first insert, kept so it can be retried. */
  failedFirstText?: string;
  onMove?(id: string, parent: string, index: number): void;
  /** The @ menu open in the focused block (#6203), and its choice and pointer. */
  mention?: MentionMenu;
  onPickMention?(entry: string): void;
  onHoverMention?(entry: string): void;
  /** Where a mark naming a block on another page points (#6208); it opens through `onLink`. */
  blockPageHref?(page: string, block: string): string;
  anchorBlock?: string;
  /** Files dropped or pasted on the page, after the block they landed on (#6202). */
  onAttach?(files: File[], after?: string): void;
  /** Files reached a page that cannot take them now (no file access, or read only): the page says
   * so instead of losing them silently (#6274). */
  onFilesRefused?(): void;
  /** The file blocks this tab is adding, drawn as their upload tile. */
  uploads?: ReadonlyMap<string, BlockUpload>;
  /** "Image or file" was chosen in the insert menu: the file picker opens once per `id`. */
  choosing?: { after?: string; id: number };
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

/** A key that types into a block, as opposed to a modifier held for a click (⌘-click a link). */
const typesInto = (event: React.KeyboardEvent) =>
  !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) &&
  event.target instanceof HTMLElement &&
  (event.target.isContentEditable || event.target.matches('input, textarea'));

/** The page's pointer state that the blocks draw: the hovered block and a drag in progress. */
interface Pointer {
  hovered?: string;
  drag?: Drag;
  startDrag(id: string, event: React.PointerEvent<HTMLButtonElement>): void;
  wasDrag(): boolean;
  observeComment(node: HTMLSpanElement | null): (() => void) | undefined;
  /** Whether a redraw may focus the selected block (#6611). */
  focus: FocusRestore;
}

/** A selected block focuses itself once, on the local selection, and again on a redraw only when
 * the person's focus was in the page's blocks just before it: a remounted block lost it under the
 * caret. Focus the person put anywhere else (Chat, a reply, the empty page) stays there. */
interface FocusRestore {
  /** The selected block that has already been focused. */
  applied?: string;
  /** The person's last focus or press was inside the page's blocks. */
  inBlocks: boolean;
}

/**
 * A structured page drawn from its block tree with the design system's block parts (#6005). Every
 * block draws as static content except the focused text block, which holds the one editor.
 */
export function StructuredPage(props: StructuredPageProps) {
  const root = useRef<HTMLDivElement>(null);
  const anchor = props.anchorBlock;
  const jumpedToAnchor = useRef(false);
  useEffect(() => {
    jumpedToAnchor.current = false;
  }, [anchor]);
  useEffect(() => {
    if (!anchor || jumpedToAnchor.current) return;
    const target = root.current?.querySelector<HTMLElement>(
      `[data-block-id="${CSS.escape(anchor)}"]`,
    );
    // During a same-tab navigation the anchor can arrive before the new page's blocks.
    if (!target) return;
    jumpedToAnchor.current = true;
    target.scrollIntoView({ block: 'start' });
  }, [anchor, props.tree]);
  const [hovered, setHovered] = useState<string>();
  // The last block the pointer entered: typing hides its handle, and the next move shows it again.
  const entered = useRef<string>(undefined);
  const drop = useCallback(
    (id: string, parent: string, index: number) => props.onMove?.(id, parent, index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onMove],
  );
  const { drag, start, wasDrag } = useBlockDrag(props.tree, () => root.current, drop);
  // A block selected on purpose from its own handle (the ⋯ menu's items keep focus on the handle)
  // takes keyboard focus. Only a new request does: a handle a person tabbed to keeps focus while
  // the page redraws (#6221).
  useEffect(() => {
    const id = props.selectionFocus;
    if (!props.selectionRequest || !id) return;
    const node = root.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
    const active = document.activeElement;
    if (node && active && node.contains(active) && active.closest('[data-slot="block-handle"]'))
      node.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectionRequest]);
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
  const focus = useRef<FocusRestore>({ inBlocks: false }).current;
  useEffect(() => {
    const note = (event: Event) => {
      const target = event.target;
      focus.inBlocks =
        target instanceof Element &&
        !!root.current?.contains(target) &&
        !!target.closest('[data-block-id]');
    };
    document.addEventListener('focusin', note, true);
    document.addEventListener('pointerdown', note, true);
    return () => {
      document.removeEventListener('focusin', note, true);
      document.removeEventListener('pointerdown', note, true);
    };
  }, [focus]);
  if (!props.selectionFocus) focus.applied = undefined;
  const commentSlots = useRef(
    new Map<HTMLSpanElement, { block: HTMLElement; markers: Element | null }>(),
  );
  const commentObserver = useRef<ResizeObserver>(undefined);
  const observeComment = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    const block = node.parentElement;
    const column = node.closest('.structured-page-stage');
    const canvas = node.closest('.canvas-structured');
    if (!block || !column || !canvas) return;
    const markers = block.querySelector(':scope > .structured-annotation-markers');
    const slots = commentSlots.current;
    slots.set(node, { block, markers });
    const observer = (commentObserver.current ??= new ResizeObserver(() => {
      const edge = column.getBoundingClientRect();
      const available = canvas.getBoundingClientRect();
      const rtl = getComputedStyle(column).direction === 'rtl';
      // The outer block box can extend 8px beyond the content column's negative margins.
      const start = rtl ? edge.left - 10 : edge.right + 10;
      const layout = [...slots].map(([slot, { block, markers }]) => {
        const box = block.getBoundingClientRect();
        const marker = markers?.getBoundingClientRect();
        const width = slot.getBoundingClientRect().width;
        const left = rtl ? start - width : start;
        const right = left + width;
        return {
          slot,
          offset: rtl ? box.right - start : start - box.left,
          fits:
            width > 0 &&
            left >= available.left &&
            right <= available.right &&
            (rtl ? right <= box.left : left >= box.right) &&
            (!marker || marker.width === 0 || right <= marker.left || left >= marker.right),
        };
      });
      for (const { slot, offset, fits } of layout) {
        slot.style.insetInlineStart = `${offset}px`;
        slot.toggleAttribute('data-fits', fits);
      }
    }));
    observer.observe(column);
    observer.observe(canvas);
    observer.observe(node);
    observer.observe(block);
    if (markers) observer.observe(markers);
    return () => {
      slots.delete(node);
      observer.unobserve(node);
      observer.unobserve(block);
      if (markers) observer.unobserve(markers);
      if (!slots.size) {
        observer.disconnect();
        commentObserver.current = undefined;
      }
    };
  }, []);
  const pointer: Pointer = { hovered, drag, startDrag: start, wasDrag, focus, observeComment };
  const act = (action: BlockMenuAction, id: string) => {
    if (action !== 'comment') {
      props.onAction?.(action, id);
      return;
    }
    const node = root.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
    const record = props.tree.get(id);
    if (!node || !record || props.drafts?.has(id) || !props.onAnnotateBlock) return;
    props.onCloseBlockMenu?.();
    props.onAnnotateBlock(record.text?.trim() || undefined, node, true);
  };
  const narrow = useNarrow();
  return (
    <>
      {!!props.recoveryProblems?.length && (
        <aside className="deleted-draft-notice">
          <BrowserNotice
            tone="waiting"
            variant="tinted"
            announcement="status"
            mark={<TriangleAlert size="1em" />}
            stateLabel={strings.blockDraftsRecoveryUnavailable}
            body={props.recoveryProblems.map((reason) => (
              <p key={reason}>{strings.blockDraftRecoveryProblems[reason]}</p>
            ))}
            actions={
              <BrowserAction
                type="button"
                variant="text"
                presentation="compact"
                label={strings.dismissDraftRecoveryNotice}
                onActivate={() => props.onDismissRecoveryProblems?.()}
              />
            }
          />
        </aside>
      )}
      <BlockDocument
        ref={root}
        // The page takes the gutter away at phone width: the design system then draws the handle
        // at the block's end (#6742).
        data-narrow={narrow ? '' : undefined}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-deleted-draft]')) return;
          if (typesInto(event)) setHovered(undefined);
          // Selection mode draws no block selection (#6675). Escape there still reaches the page's
          // ladder (close the window, then leave the mode), and the unseen selection becomes the
          // block the person is on, so leaving the mode keeps them there (#6725).
          if (props.annotationMode && event.key === 'Escape') {
            const on = (event.target as HTMLElement).closest<HTMLElement>('[data-block-id]');
            if (on?.dataset.blockId) props.onSelectBlock?.(on.dataset.blockId);
            else props.onPageKey?.(event);
            return;
          }
          if (event.key === 'Enter' && props.blockMenu?.active === 'comment') {
            event.preventDefault();
            act('comment', props.blockMenu.id);
            return;
          }
          if (props.onPageKey?.(event)) event.preventDefault();
        }}
        // The handle follows the last block the pointer entered and stays when the pointer leaves
        // it (toward the handle, or into the space between blocks); only entering another block
        // moves it (#6283). Going back out from a nested block to its parent enters nothing.
        onPointerOver={(event) => {
          const block = (event.target as Element).closest<HTMLElement>('[data-block-id]');
          const from = event.relatedTarget;
          if (!block || (from instanceof Node && block.contains(from))) return;
          entered.current = block.dataset.blockId;
          setHovered(entered.current);
        }}
        onPointerMove={() => setHovered((now) => now ?? entered.current)}
        // A finger leaves the page with every tap: the handle stays on the block it tapped, so a
        // phone reaches the block menu too.
        onPointerLeave={(event) => {
          if (event.pointerType === 'touch') return;
          entered.current = undefined;
          setHovered(undefined);
        }}
        // Dropping files, or pasting them, inserts them after the block they landed on (spec 圖片:
        // 拖檔案或貼上圖片＝插入). Text and a block's own drag are not files and pass through.
        // Files the page cannot take now are still caught, so the browser never opens them in
        // place of the page, and the status line says nothing was added.
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          const files = carried(event.dataTransfer);
          if (!files.length) return;
          event.preventDefault();
          if (!props.onAttach || props.readonly) props.onFilesRefused?.();
          else props.onAttach(files, landedOn(event.target));
        }}
        onPasteCapture={(event) => {
          const files = carried(event.clipboardData);
          if (!files.length) return;
          event.preventDefault();
          event.stopPropagation();
          if (!props.onAttach || props.readonly) props.onFilesRefused?.();
          else props.onAttach(files, landedOn(event.target));
        }}
      >
        {props.recoveryError && <p role="status">{props.recoveryError}</p>}
        {props.restored
          ?.filter((d) => !props.tree.visible(d.cell?.table ?? d.id))
          .map((d) => (
            <RecoveryNotice key={d.target} draft={d} missing props={props} />
          ))}
        {props.tree.children(PAGE_PARENT).length === 0 && (
          <EmptyDocument
            readonly={props.readonly}
            onInsert={props.onInsertFirst}
            onFull={props.onFull}
            onOpenPicker={props.onOpenFirstPicker}
            menu={props.menu?.id === 'empty' ? props.menu : undefined}
            onPick={props.onPick}
            onHover={props.onHover}
            onCloseMenu={props.onCloseMenu}
            failedText={props.failedFirstText}
          />
        )}
        <Blocks {...props} parent={PAGE_PARENT} pointer={pointer} onAction={act} />
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
            // A refused batch offers Retry in the toast's action place, without the Undo shortcut.
            <BlockToast onUndo={props.toast.retry} undoLabel={strings.blockEdit.retry} shortcut="">
              {props.toast.notice}
            </BlockToast>
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

function EmptyDocument({
  readonly,
  onInsert,
  onOpenPicker,
  onFull,
  menu,
  onPick,
  onHover,
  onCloseMenu,
  failedText,
}: {
  readonly?: boolean;
  onInsert?(text: string): Promise<boolean>;
  onOpenPicker?(): void;
  onFull?(): void;
  menu?: InsertMenu;
  onPick?(entry: string): void;
  onHover?(entry: string): void;
  onCloseMenu?(): void;
  failedText?: string;
}) {
  const [editing, setEditing] = useState(failedText !== undefined);
  const [draft, setDraft] = useState(failedText ?? '');
  const started = useRef(false);
  const insert = (text: string) => {
    if (!text || started.current) return;
    started.current = true;
    void onInsert?.(text).then((sent) => {
      if (sent) return;
      started.current = false;
      setEditing(true);
    });
  };
  if (readonly) return <p className="tmt-block-empty-reader">This page is empty.</p>;
  return (
    <Block className="tmt-block-empty" label="Empty paragraph" kind="text">
      <div data-slot="block-handle" className="tmt-block-handle">
        <button
          type="button"
          className="tmt-block-handle-button"
          aria-label="Insert block"
          onClick={onOpenPicker}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      {editing ? (
        <BlockTextEditor
          onFull={onFull}
          label="Empty paragraph"
          text={draft}
          caret={[...draft].length}
          version={0}
          placeholder={strings.blockText.paragraph}
          onTyped={(text) => {
            setDraft(text);
            if (failedText === undefined) insert(text);
          }}
        />
      ) : (
        <button type="button" className="tmt-block-empty-start" onClick={() => setEditing(true)}>
          {strings.blockText.paragraph}
        </button>
      )}
      {failedText !== undefined && (
        <p role="alert">
          The first block could not be saved.{' '}
          <button type="button" onClick={() => insert(draft)}>
            Retry
          </button>
        </p>
      )}
      {menu && (
        <InsertPopover menu={menu} onPick={onPick} onHover={onHover} onCloseMenu={onCloseMenu} />
      )}
    </Block>
  );
}

function Blocks({
  tree,
  parent,
  pointer,
  ...rest
}: StructuredPageProps & { parent: string; pointer: Pointer }): ReactNode {
  const drag = pointer.drag;
  // One flat list keyed by block: nested arrays are keyed by their index, so a block inserted above
  // would move every later block to another array and remount its text editor, losing the keys it
  // took (#6221).
  return tree.children(parent).flatMap((block) => [
    drag?.target?.lineBefore === block.id && <BlockDropLine key={`drop-${block.id}`} />,
    <Block
      key={block.id}
      data-block-id={block.id}
      data-deleted-draft={rest.drafts?.has(block.id) || undefined}
      label={blockLabel(block)}
      kind={KIND[block.type]}
      level={block.type === 'heading' ? headingLevel(block) : undefined}
      depth={parent === PAGE_PARENT ? 0 : 1}
      // Selection mode marks only what is being annotated: an earlier block selection (the outline,
      // the menu) is not drawn there (#6675).
      selected={
        (!rest.annotationMode &&
          (rest.editing?.id === block.id || rest.selected?.includes(block.id))) ||
        // A card a drag would drop into takes the selection tint.
        drag?.target?.into === block.id
      }
      state={drag?.id === block.id ? 'dragging' : undefined}
      // A selected block takes keyboard focus, so Delete, the arrows and ⌘Z reach the page; focus
      // already inside it (a table's menu or column name field) stays where it is. This runs on
      // every redraw, and an agent's edit must never move a person's focus into the page (#6611):
      // see `FocusRestore`.
      tabIndex={rest.annotationMode ? 0 : -1}
      onFocus={(event) => {
        if (
          event.target === event.currentTarget &&
          event.currentTarget.matches(':focus-visible') &&
          !rest.annotationMode &&
          !rest.selected?.includes(block.id)
        )
          rest.onSelectBlock?.(block.id);
      }}
      onKeyDown={(event) => {
        if (
          !rest.annotationMode &&
          block.type === 'question' &&
          event.key === 'Enter' &&
          event.target === event.currentTarget
        ) {
          const answer = event.currentTarget.querySelector<HTMLElement>(
            '.tmt-block-question input:not(:disabled), .tmt-block-question textarea:not(:disabled), .tmt-block-question-answered',
          );
          if (answer) {
            event.preventDefault();
            event.stopPropagation();
            answer.focus();
          }
          return;
        }
        if (
          !rest.annotationMode ||
          event.target !== event.currentTarget ||
          event.key !== 'Enter' ||
          !event.isTrusted
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        rest.onAnnotateBlock?.(block.text?.trim() || undefined, event.currentTarget, true);
      }}
      ref={(node: HTMLDivElement | null) => {
        if (
          !node ||
          rest.annotationMode ||
          rest.selectionFocus !== block.id ||
          node.contains(document.activeElement)
        )
          return;
        const active = document.activeElement;
        const lost = !active || active === document.body;
        if (pointer.focus.applied !== block.id || (lost && pointer.focus.inBlocks)) {
          pointer.focus.applied = block.id;
          node.focus();
        }
      }}
      readonly={rest.readonly}
      onClick={(event) => {
        if (rest.drafts?.has(block.id)) return;
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
        if (rest.annotationMode) {
          if (!event.isTrusted) return;
          const selection = window.getSelection();
          const selected =
            selection?.anchorNode &&
            selection.focusNode &&
            event.currentTarget.contains(selection.anchorNode) &&
            event.currentTarget.contains(selection.focusNode)
              ? selection.toString().trim()
              : '';
          const text = selected || block.text?.trim();
          rest.onAnnotateBlock?.(text || undefined, event.currentTarget, !selected);
          return;
        }
        // A pointer drag across the text ends in this click (#6636): the dragged text stays the
        // selection, offered for Annotate, instead of the block opening its editor over it.
        const dragged = window.getSelection();
        if (
          dragged &&
          !dragged.isCollapsed &&
          dragged.anchorNode &&
          dragged.focusNode &&
          event.currentTarget.contains(dragged.anchorNode) &&
          event.currentTarget.contains(dragged.focusNode) &&
          !(event.target as HTMLElement).closest('[contenteditable="true"]')
        )
          return;
        if (!rest.readonly && TEXT_TYPES.has(block.type))
          rest.onFocus?.(block.id, clickedAt(event, block.text));
      }}
    >
      {(rest.onAnnotateBlock || rest.annotations?.get(block.id)?.some((item) => item.open)) && (
        <div className="structured-annotation-markers">
          {rest.annotations
            ?.get(block.id)
            ?.filter((item) => item.open)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                className="annotation-number"
                data-colab-thread=""
                aria-label={`Open comment ${item.ordinal}`}
                onClick={(event) => {
                  if (event.isTrusted) rest.onOpenAnnotation?.(item.id);
                }}
              >
                {item.ordinal}
              </button>
            ))}
        </div>
      )}
      {rest.onAnnotateBlock && !rest.drafts?.has(block.id) && (
        <BlockCommentAction
          observe={pointer.observeComment}
          shown={!drag && pointer.hovered === block.id}
          activate={() => rest.onAction?.('comment', block.id)}
        />
      )}
      {!rest.readonly &&
        !rest.drafts?.has(block.id) &&
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
      <Content
        block={block}
        {...rest}
        pointer={pointer}
        tree={tree}
        {...(rest.drafts?.has(block.id) && {
          editing: rest.drafts.get(block.id)!.editing,
          onTyped: rest.onDraftChange,
          onKey: undefined,
          onPasteUrl: undefined,
          onPasteStructure: undefined,
        })}
      />
      {rest.restored
        ?.filter((d) => (d.cell?.table ?? d.id) === block.id)
        .map((d) => (
          <RecoveryNotice
            key={d.target}
            draft={d}
            missing={!tree.holds(d.id, d.cell?.table)}
            props={rest}
          />
        ))}
      {rest.drafts?.has(block.id) && (
        <div className="deleted-draft-notice">
          <BrowserNotice
            tone="waiting"
            variant="tinted"
            announcement="status"
            mark={<TriangleAlert size="1em" />}
            stateLabel={strings.blockDelete.draft}
            body={null}
            actions={
              <>
                <BrowserAction
                  type="button"
                  variant="primary"
                  presentation="compact"
                  label={strings.blockDelete.keep}
                  onActivate={() => rest.onKeepDraft?.(block.id)}
                />
                <BrowserAction
                  type="button"
                  variant="text"
                  presentation="compact"
                  label={strings.blockDelete.discard}
                  onActivate={() => rest.onDiscardDraft?.(block.id)}
                />
              </>
            }
          />
        </div>
      )}
      {!rest.readonly && rest.blockMenu?.id === block.id && (
        <ActionsPopover
          block={block}
          active={rest.blockMenu.active}
          list={rest.blockMenu.list}
          canComment={!!rest.onAnnotateBlock}
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

function BlockCommentAction({
  shown,
  activate,
  observe,
}: {
  shown: boolean;
  activate(): void;
  observe: Pointer['observeComment'];
}) {
  return (
    <span ref={observe} className="structured-comment-action" data-shown={shown || undefined}>
      <BrowserIconAction
        type="button"
        label={strings.blockActions.commentOnBlock}
        icon={<MessageSquare aria-hidden="true" />}
        variant="text"
        onActivate={(event) => {
          if (event.isTrusted) activate();
        }}
      />
    </span>
  );
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

/** The text `node` draws: its text, with a line break element as the line feed it stands for. */
const drawnText = (node: Node): string =>
  node.nodeType === Node.TEXT_NODE
    ? (node as Text).data
    : node.nodeName === 'BR'
      ? '\n'
      : [...node.childNodes].map(drawnText).join('');

/**
 * Where a click landed in a block's drawn text, as a scalar offset (#6742): the browser's caret at
 * the click point, counted from the start of the element that draws exactly the block's text. Marks
 * draw inside it, a soft break is one line break element and one position, and a checkbox or list
 * marker sits beside it. None when the click is not on that text: editing then starts at the end.
 */
function clickedAt(
  event: React.MouseEvent<HTMLElement>,
  text: string | undefined,
): number | undefined {
  if (!text) return undefined;
  const doc = event.currentTarget.ownerDocument;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = position ? undefined : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = position?.offsetNode ?? range?.startContainer;
  const offset = position?.offset ?? range?.startOffset;
  if (!node || offset === undefined || !event.currentTarget.contains(node)) return undefined;
  let drawn: Node | null = node;
  while (drawn && drawn !== event.currentTarget && drawnText(drawn) !== text)
    drawn = drawn.parentNode;
  if (!drawn || drawnText(drawn) !== text) return undefined;
  const before = doc.createRange();
  before.setStart(drawn, 0);
  before.setEnd(node, offset);
  return [...drawnText(before.cloneContents())].length;
}

/** The page's phone width, where its blocks have no gutter (the stage's 8px inset). */
const NARROW = '(max-width: 640px)';
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === 'function' && matchMedia(NARROW).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia(NARROW);
    const change = () => setNarrow(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return narrow;
}

/** Where the insert and @ menus open (#6742): under their block, or above it when the window has
 * no room for the menu below and more above, so a block at the window's bottom edge keeps its menu
 * in view. Chosen as the menu opens, before it is drawn, so it does not jump while the person
 * types. */
function useMenuSide(menu: { current: HTMLElement | null }): {
  side: 'below' | 'above';
  room?: number;
} {
  const [place, setPlace] = useState<{ side: 'below' | 'above'; room?: number }>({
    side: 'below',
  });
  useLayoutEffect(() => {
    const block = menu.current?.parentElement;
    if (!menu.current || !block) return;
    const { top, bottom } = block.getBoundingClientRect();
    // The menu's own 4px gap and 8px from the window's edge.
    const below = innerHeight - bottom - 12;
    const above = top - 12;
    if (menu.current.offsetHeight <= below + 4) return;
    setPlace(above > below ? { side: 'above', room: above } : { side: 'below', room: below });
  }, [menu]);
  return place;
}

/** The design system's cap for a floating menu's height: the room on the side it opens. */
const roomStyle = (room: number) =>
  ({ '--tmt-block-menu-room': `${Math.max(room, 120)}px` }) as React.CSSProperties;

/** A menu row takes the pointer only when the pointer moves over it (#6742). A menu that opens, or
 * whose rows change, under a resting pointer keeps the row the keys chose, so Enter never runs the
 * row the menu happened to open under (Delete, in the block menu). The block, insert and @ menus
 * all go through here. */
function movedOver(onHover: ((id: string) => void) | undefined, id: string) {
  return (event: React.MouseEvent) => {
    if (event.movementX || event.movementY) onHover?.(id);
  };
}

/** The block menu from the handle's ⋯ or the menu key: the design system's block actions this
 * editor runs. A table is not duplicated here (its rows come with the table step). */
function ActionsPopover({
  block,
  active,
  list,
  canComment,
  onAction,
  onHoverAction,
  onClose,
}: {
  block: BlockRecord;
  active?: string;
  /** Turn into's own list is open (#6742). */
  list?: 'turn-into';
  canComment: boolean;
  onAction?(action: BlockMenuAction, id: string): void;
  onHoverAction?(action: string): void;
  onClose?(): void;
}) {
  const sheet = typeof matchMedia === 'function' && matchMedia(NARROW).matches;
  const popup = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismiss = useCallback(() => {
    const handle = popup.current
      ?.closest('[data-block-id]')
      ?.querySelector<HTMLButtonElement>('[data-grip]');
    closeRef.current?.();
    requestAnimationFrame(() => handle?.focus());
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target)) dismiss();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [dismiss]);
  const actions = blockActions.filter((action) =>
    (BLOCK_MENU_ACTIONS as readonly string[]).includes(action.id),
  );
  return (
    <div
      ref={popup}
      className="tmt-block-insert tmt-block-actions"
      data-sheet={sheet ? '' : undefined}
      onMouseDown={(event) => {
        if (!sheet || event.target !== event.currentTarget) return;
        event.preventDefault();
        dismiss();
      }}
    >
      <BlockMenu
        kind="actions"
        label={strings.blockActions.label}
        placement={sheet ? 'sheet' : 'below'}
        activeId={active && `block-action-${active}`}
      >
        {list === 'turn-into' &&
          blockMenuActions(block, list).map((id) => {
            const turn = id.slice('turn-'.length) as keyof typeof strings.blockActions.turnTypes;
            return (
              <BlockMenuItem
                key={id}
                id={`block-action-${id}`}
                back={id === 'turn-back'}
                active={id === active}
                onMouseMove={movedOver(onHoverAction, id)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onAction?.(id, block.id);
                }}
              >
                {id === 'turn-back'
                  ? strings.blockActions.turnInto
                  : strings.blockActions.turnTypes[turn]}
              </BlockMenuItem>
            );
          })}
        {!list &&
          blockMenuActions(block, undefined, canComment)
            .filter((id) => !id.startsWith('progress-'))
            .map((id) => {
              // Turn into (#6742) opens its list in this menu; the rest are the catalog's actions.
              const action = actions.find((entry) => entry.id === id);
              const label =
                id === 'comment' || id === 'edit-question' || id === 'turn-into'
                  ? {
                      comment: strings.blockActions.comment,
                      'edit-question': strings.blockActions.editQuestion,
                      'turn-into': strings.blockActions.turnInto,
                    }[id]
                  : action?.label;
              if (!label) return null;
              return (
                <BlockMenuItem
                  key={id}
                  id={`block-action-${id}`}
                  // The touch sheet has no keyboard: no key hints there.
                  shortcut={sheet ? undefined : action?.shortcut}
                  danger={action?.danger}
                  submenu={id === 'turn-into'}
                  active={id === active}
                  onMouseMove={movedOver(onHoverAction, id)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onAction?.(id, block.id);
                  }}
                >
                  {label}
                </BlockMenuItem>
              );
            })}
        {/* A heading's section setting (#6619), after the block's own actions. */}
        {!list &&
          blockMenuActions(block)
            .filter((id) => id.startsWith('progress-'))
            .map((id) => (
              <BlockMenuItem
                key={id}
                id={`block-action-${id}`}
                active={id === active}
                onMouseMove={movedOver(onHoverAction, id)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onAction?.(id, block.id);
                }}
              >
                {id === 'progress-done'
                  ? strings.sections.markDone
                  : id === 'progress-off'
                    ? strings.sections.notProgress
                    : strings.sections.automatic}
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
  const sheet = typeof matchMedia === 'function' && matchMedia(NARROW).matches;
  const element = useRef<HTMLDivElement>(null);
  const { side, room } = useMenuSide(element);
  useEffect(() => {
    if (menu.direct) element.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  }, [menu.direct]);
  return (
    <div
      ref={element}
      className="tmt-block-insert"
      data-sheet={sheet ? '' : undefined}
      data-side={sheet ? undefined : side}
      style={sheet || room === undefined ? undefined : roomStyle(room)}
      onKeyDown={(event) => {
        if (!menu.direct) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCloseMenu?.();
          return;
        }
        if (event.key === 'Enter' && menu.active) {
          event.preventDefault();
          event.stopPropagation();
          onPick?.(menu.active);
          return;
        }
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const ids = menu.entries.map((entry) => entry.id);
          const next = nextBlockMenuItem(ids, menu.active, event.key);
          if (next) onHover?.(next);
        }
      }}
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
        placement={sheet ? 'sheet' : side}
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
              onMouseMove={movedOver(onHover, entry.id)}
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
  const element = useRef<HTMLDivElement>(null);
  const { side, room } = useMenuSide(element);
  const rowId = (entry: string) => `block-mention-${entry.replace(/[^A-Za-z0-9-]/g, '-')}`;
  const row = (entry: MentionMenu['entries'][number]) => (
    <BlockMenuItem
      key={entry.id}
      id={rowId(entry.id)}
      active={entry.id === mention.active}
      submenu={entry.mark === 'page'}
      back={entry.mark === 'back'}
      onMouseMove={movedOver(onHover, entry.id)}
      // Choosing never takes focus from the editor.
      onMouseDown={(event) => {
        event.preventDefault();
        onPick?.(entry.id);
      }}
    >
      {entry.label}
    </BlockMenuItem>
  );
  // This page's rows, then the other pages as their own group under a quiet heading (#6208).
  const here = mention.entries.filter((entry) => entry.mark !== 'page');
  const pages = mention.entries.filter((entry) => entry.mark === 'page');
  const active = mention.entries.find((entry) => entry.id === mention.active)?.mark;
  return (
    <div
      ref={element}
      className="tmt-block-insert"
      data-side={side}
      style={room === undefined ? undefined : roomStyle(room)}
    >
      <BlockMenu
        kind="insert"
        label={strings.blockMention.label}
        placement={side}
        activeId={mention.active && rowId(mention.active)}
      >
        {here.map(row)}
        {pages.length > 0 && (
          <>
            {here.length > 0 && <BlockMenuSeparator />}
            <div role="group" aria-label={strings.blockMention.otherPages}>
              <BlockMenuGroup>{strings.blockMention.otherPages}</BlockMenuGroup>
              {pages.map(row)}
            </div>
          </>
        )}
        {mention.reading ? (
          <BlockMenuEmpty>{strings.blockMention.reading}</BlockMenuEmpty>
        ) : (
          !mention.entries.some((entry) => entry.mark !== 'back') && (
            <BlockMenuEmpty>{strings.blockMention.empty}</BlockMenuEmpty>
          )
        )}
        <MenuKeys action={active === 'page' ? 'open' : active === 'back' ? 'back' : 'insert'} />
      </BlockMenu>
    </div>
  );
}

/** The key hints under the insert and @ menus, as the DS block-menu tag draws them: each key a
 * DS kbd chip, then what it does. */
function MenuKeys({ action = 'insert' }: { action?: 'insert' | 'open' | 'back' }) {
  const { choose, close } = strings.blockInsert.keys;
  const insert = strings.blockInsert.keys[action];
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
  /** Called when the frame settles: drawn (its components or the design system's notice) or not. */
  onReady?: () => void,
) => Promise<{ destroy(): void; setTheme(theme?: Theme): void }>;

/**
 * How a block page draws a mockup's toolbar: the choice Ben's answer on Colab page ce0e285f makes
 * (#6749). `collapsed` folds it behind Mockup settings and offers a full-size view when the preview
 * is scaled down past reading; `open` keeps it showing. Either way the preview lines up with the
 * text column.
 */
const MOCKUP_TOOLBAR: 'open' | 'collapsed' = 'collapsed';

/**
 * A mockup block (#6005): DS `MockupBlock`'s stage around a sandboxed render frame. The markup is
 * untrusted page markup: it renders only in the frame, as an HTML page does, and never enters the
 * parent's DOM. A new source replaces the frame; the full-size view draws a frame of its own.
 */
function MockupFrame({ block, mount }: { block: BlockRecord; mount?: MountMockup }) {
  const source = mockupSource(block);
  const [failed, setFailed] = useState(false);
  // A new source, or a frame host that has come back, tries again.
  useEffect(() => setFailed(false), [source, mount]);
  // The stage's theme control is this viewer's: the frame paints it, and Viewer follows the app.
  const [theme, setTheme] = useState<Theme>();
  const stage = mockupStage(block);
  return (
    <MockupBlock
      system={typeof block.props.system === 'string' ? block.props.system : 'tmt-gui'}
      width={stage.width}
      height={stage.height}
      unavailable={!mount || failed}
      toolbar={MOCKUP_TOOLBAR}
      onSettingsChange={(settings) =>
        setTheme(settings.theme === 'viewer' ? undefined : settings.theme)
      }
      fullSize={mount && <MockupCanvas source={source} mount={mount} theme={theme} />}
    >
      {mount && (
        <MockupCanvas
          source={source}
          mount={mount}
          theme={theme}
          onFailed={() => setFailed(true)}
        />
      )}
    </MockupBlock>
  );
}

/** One sandboxed frame drawing a mockup's markup, saying it is loading until the frame draws. */
function MockupCanvas({
  source,
  mount,
  theme,
  onFailed,
}: {
  source: string;
  mount: MountMockup;
  theme?: Theme;
  onFailed?: () => void;
}) {
  // The stage may draw its content again (a new size, a theme): the frame follows the node it is in.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  // A design system may take a while to read: the stage says it is loading until the frame draws.
  const [ready, setReady] = useState(false);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;
  const frame = useRef<Awaited<ReturnType<MountMockup>>>(undefined);
  useEffect(() => frame.current?.setTheme(theme), [theme]);
  useEffect(() => {
    if (!node) return;
    const controller = new AbortController();
    setReady(false);
    const drawn = () => {
      if (!controller.signal.aborted) setReady(true);
    };
    mount(node, source, controller.signal, themeRef.current, drawn).then(
      (handle) => {
        if (controller.signal.aborted) handle.destroy();
        else {
          frame.current = handle;
          handle.setTheme(themeRef.current);
        }
      },
      () => {
        if (!controller.signal.aborted) failedRef.current?.();
      },
    );
    return () => {
      controller.abort();
      frame.current?.destroy();
      frame.current = undefined;
      node.replaceChildren();
    };
  }, [node, mount, source]);
  return (
    <>
      {!ready && (
        <p className="tmt-block-mockup-loading" role="status">
          Loading…
        </p>
      )}
      <div ref={setNode} className="tmt-block-mockup-frame" aria-busy={!ready || undefined} />
    </>
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
  textFits,
  onFull,
  onCellKey,
  onAddRow,
  onRowAction,
  onColumnAction,
  references,
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
            return !readonly && editing?.id === row.id && editing.column === column.id ? (
              <BlockTextEditor
                key={column.id}
                textFits={textFits}
                references={references}
                maxBytes={BLOCK_CELL_BYTES}
                onFull={() => onFull?.(true)}
                label={strings.blockTable.cell(column.name, index + 1)}
                text={editing.text}
                caret={editing.caret}
                version={editing.version}
                from={editing.from}
                onTyped={(text, caret) => onTyped?.(row.id, text, caret)}
                onKey={(event, text) => onCellKey?.(event, text) ?? false}
              />
            ) : (
              // A line feed in a cell draws as a line break, as in a block's text and the export.
              <span key={column.id} data-cell-row={row.id} data-cell-column={column.id}>
                <MarkedText
                  text={value}
                  derivedLinks={references && ticketLinks(value, undefined, references.href)}
                  onDerivedLink={references?.open}
                />
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
      choices={blockAnswerChoices(question)}
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
  // Only the block being typed in shows its placeholder: an empty block at rest reads as space. A
  // page that takes no edits draws what it holds: typing that has not landed waits, kept, unshown
  // (#6820).
  const typing = !rest.readonly && editing?.id === block.id;
  const placeholder =
    block.type === 'paragraph'
      ? strings.blockText.paragraph
      : block.type === 'heading'
        ? strings.blockText.heading
        : undefined;
  const references = block.type === 'code' ? undefined : rest.references;
  const text = typing ? (
    <BlockTextEditor
      textFits={rest.textFits}
      onFull={() => rest.onFull?.()}
      label={blockLabel(block)}
      text={editing.text}
      references={references}
      // Marks drawn for the text the page holds; for other text they wait until it does.
      marks={block.text === editing.text ? block.marks : undefined}
      caret={editing.caret}
      version={editing.version}
      from={editing.from}
      placeholder={placeholder}
      onTyped={(value, caret) => onTyped?.(block.id, value, caret)}
      onKey={(event, value, caret, range) => onKey?.(block.id, event, value, caret, range) ?? false}
      onLink={(href) => rest.onLink?.(href, true)}
      onPasteUrl={(url, value, range) => rest.onPasteUrl?.(block.id, url, value, range) ?? false}
      onPasteStructure={(html, plain, value, range) =>
        rest.onPasteStructure?.(block.id, html, plain, value, range) ?? false
      }
    />
  ) : // Empty text stays empty, so the part keeps its one-line height (`data-empty`).
  block.text ? (
    <MarkedText
      text={block.text}
      marks={block.marks}
      derivedLinks={references && ticketLinks(block.text, block.marks, references.href)}
      onDerivedLink={references?.open}
      blockHref={(id, page) => (page ? rest.blockPageHref?.(page, id) : `#block-${id}`)}
      onLink={rest.onLink}
    />
  ) : (
    block.text
  );
  switch (block.type) {
    case 'heading': {
      const heading = (
        <HeadingBlock level={headingLevel(block)} placeholder="" editing={typing}>
          {text}
        </HeadingBlock>
      );
      const section = rest.sections?.get(block.id);
      if (!section) return heading;
      const view = sectionMark(section);
      // The mark and the count sit beside the heading, never in its text or its editor.
      return (
        <div className="structured-section-heading" data-level={headingLevel(block)}>
          <span
            className="tmt-ui-state-mark structured-section-mark"
            data-shape={view.shape}
            data-tone={view.tone}
            aria-hidden="true"
          />
          {heading}
          <span className={`structured-section-count ${ui.countChip}`} contentEditable={false}>
            {view.count}
          </span>
        </div>
      );
    }
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
          label={block.text || strings.blockText.todo}
          indent={indentOf(block)}
          onCheckedChange={
            rest.readonly || !rest.onChecked
              ? undefined
              : (checked: boolean) => rest.onChecked?.(block.id, checked)
          }
          editing={typing}
        >
          {rest.todoNumbers?.[block.id] && (
            <>
              <span className="tmt-block-todo-number">{rest.todoNumbers[block.id]}</span>{' '}
            </>
          )}
          {text}
        </TodoBlock>
      );
    case 'card':
      return (
        <CardBlock
          variant={block.props.variant === 'section' ? 'section' : 'card'}
          title={typeof block.props.title === 'string' ? block.props.title : undefined}
          meta={typeof block.props.meta === 'string' ? block.props.meta : undefined}
        >
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
      return (
        <TextBlock placeholder="" editing={typing}>
          {text}
        </TextBlock>
      );
    case 'code':
      // The design system's code box and body (#6749); a page's code block has no head yet.
      return <CodeTextBlock editing={typing}>{text}</CodeTextBlock>;
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
    case 'chart':
      // Data only, checked by the page's schema before it reaches here (#6746).
      return <ChartBlock {...(block.props as unknown as ChartBlockProps)} />;
    case 'diagram':
      return (
        <DiagramBlock
          id={block.id}
          title={typeof block.props.title === 'string' ? block.props.title : undefined}
          source={block.text ?? ''}
          editing={typing}
        >
          {text}
        </DiagramBlock>
      );
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
        <StructuredQuestion block={block} page={rest.questionPage} />
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

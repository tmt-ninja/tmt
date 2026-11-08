import { useCallback, useMemo } from 'react';
import type { DocumentImageInput } from './document-images.js';
import type { BlockOp } from './block-model.js';
import { blockRecords } from './block-projection.js';
import type { WorkBundleSource } from '@tmt/browser-ui/blocks';
import type { BlockEntry } from './blocks.js';
import type { ParentPageViewSource } from './parent-page-view.js';
import type { QuestionPage } from './structured-question.js';
import type { MountMockup } from './structured-page.js';
import { StructuredPage } from './structured-page.js';
import type { PageBinding } from './transport.js';
import { useBlockEditing } from './use-block-editing.js';

/**
 * A structured page (`pageType` `blocks`, #6005) over its live binding: the fold projection's
 * `blocks` root draws through `StructuredPage`, and typing goes out as block batches
 * (`binding.blocks`), which resolve once the page shows the commit. A binding without block
 * writes draws the page read-only.
 */
export function LiveStructuredPage({
  blocks,
  seq,
  binding,
  onLink,
  workSource,
  pageViewSource,
  questionPage,
  mountMockup,
  imageSource,
}: {
  blocks: Readonly<Record<string, BlockEntry>>;
  /** The view's local order (`PageView.seq`). */
  seq?: number;
  binding?: PageBinding;
  /** A link in a block was activated: the page's trusted open path (`usePageLinks`) takes it. */
  onLink?(href: string, newTab: boolean): void;
  /** The page's gated owner-data sources (`router`: owner-only content). */
  workSource?: WorkBundleSource;
  pageViewSource?: ParentPageViewSource;
  /** The page's question registry and discussion, for answering question blocks. */
  questionPage?: QuestionPage;
  /** The router's sandboxed renderer for mockup blocks. */
  mountMockup?: MountMockup;
  /** The page's attachment list and authorized read, for image blocks. */
  imageSource?: DocumentImageInput;
}) {
  const records = useMemo(() => blockRecords(blocks).records, [blocks]);
  const write = useMemo(() => binding?.blocks?.bind(binding), [binding]);
  const send = useCallback(
    async (ops: BlockOp[]) => {
      if (!write) throw new Error('Page editing unavailable');
      return (await write(ops)).seq;
    },
    [write],
  );
  const {
    tree,
    editing,
    focus,
    focusCell,
    cellKey,
    addRowTo,
    rowAction,
    columnAction,
    pasteUrl,
    check,
    authoring,
    author,
    questionEdit,
    typed,
    key,
    menu,
    pick,
    hover,
    closeMenu,
    selected,
    selectionFocus,
    pageKey,
    toast,
    undo,
    blockMenu,
    act,
    move,
    openBlockMenu,
    insertAfter,
    closeBlockMenu,
    hoverBlockMenu,
  } = useBlockEditing(records, send, seq);
  return (
    <StructuredPage
      tree={tree}
      editing={editing}
      onFocus={focus}
      onTyped={typed}
      onKey={key}
      onFocusCell={focusCell}
      onCellKey={cellKey}
      onAddRow={(table) => void addRowTo(table)}
      onRowAction={rowAction}
      onColumnAction={columnAction}
      onPasteUrl={pasteUrl}
      onChecked={check}
      authoring={authoring}
      onAuthor={author}
      onQuestionEdit={questionEdit}
      onLink={onLink}
      workSource={workSource}
      pageViewSource={pageViewSource}
      questionPage={questionPage}
      imageSource={imageSource}
      mountMockup={mountMockup}
      menu={menu}
      onPick={(entry) => void pick(entry)}
      onHover={hover}
      onCloseMenu={closeMenu}
      selected={selected}
      selectionFocus={selectionFocus}
      onPageKey={pageKey}
      toast={toast}
      onUndo={undo}
      blockMenu={blockMenu}
      onAction={act}
      onHoverAction={hoverBlockMenu}
      onCloseBlockMenu={closeBlockMenu}
      onOpenBlockMenu={openBlockMenu}
      onInsertAfter={insertAfter}
      onMove={move}
      readonly={!write}
    />
  );
}

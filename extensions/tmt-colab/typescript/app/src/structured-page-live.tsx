import { useBlocker, useRouterState } from '@tanstack/react-router';
import { BlockDraftSession, type BlockDraftStore, type BlockDraft } from './block-drafts.js';
import { text as strings } from './strings.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentInput, StoredAttachment } from './attachment-service.js';
import type { BlockFiles } from './block-uploads.js';
import type { DocumentImageInput } from './document-images.js';
import type { BlockOp, BlockRecord } from './block-model.js';
import { blockRecords } from './block-projection.js';
import type { WorkBundleSource } from '@tmt/browser-ui/blocks';
import type { BlockEntry } from './blocks.js';
import type { ParentPageViewSource } from './parent-page-view.js';
import type { QuestionPage } from './structured-question.js';
import type { MountMockup, StructuredPageProps } from './structured-page.js';
import { StructuredPage } from './structured-page.js';
import { resendStale } from './save.js';
import type { PageBinding } from './transport.js';
import { useBlockEditing } from './use-block-editing.js';
import { useAgentDirectory } from './agent-directory.js';
import type { MentionPages } from './mention-pages.js';

/**
 * A structured page (`pageType` `blocks`, #6005) over its live binding: the fold projection's
 * `blocks` root draws through `StructuredPage`, and typing goes out as block batches
 * (`binding.blocks`), which resolve once the page shows the commit. A binding without block
 * writes draws the page read-only.
 */
export function LiveStructuredPage({
  pageId,
  blockDrafts,
  blocks,
  todoNumbers,
  seq,
  binding,
  onLink,
  workSource,
  pageViewSource,
  questionPage,
  mountMockup,
  imageSource,
  onDownloadFile,
  onSettle,
  mentionPages,
  blockPageHref,
  annotationMode,
  sections,
  onAnnotateBlock,
  annotations,
  onOpenAnnotation,
  onDrawn,
}: {
  pageId?: string;
  blockDrafts?: BlockDraftStore;
  blocks: Readonly<Record<string, BlockEntry>>;
  todoNumbers?: Readonly<Record<string, string>>;
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
  /** A file card's Download: the page's confirmed download path. */
  onDownloadFile?(attachmentId: string): void;
  /** Give page actions the editor's flush-and-admit barrier. */
  onSettle?(settle: (() => Promise<void>) | undefined): void;
  /** Other pages an @ can name, under the page list's authority (#6208). */
  mentionPages?: MentionPages;
  /** Where a block on another page is, for its chip. */
  blockPageHref?(page: string, block: string): string;
  annotationMode?: boolean;
  sections?: StructuredPageProps['sections'];
  onAnnotateBlock?(text: string | undefined, block: HTMLElement, whole: boolean): void;
  annotations?: ReadonlyMap<string, readonly { id: string; ordinal: number; open: boolean }[]>;
  onOpenAnnotation?(id: string): void;
  /** The page as this tab draws it, its own changes on their way included (#6687): what the page
   * counts its sections from, so a checked to-do shows in the outline at once. */
  onDrawn?(blocks: readonly BlockRecord[] | undefined): void;
}) {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const records = useMemo(() => blockRecords(blocks).records, [blocks]);
  // The agents an @ names (#6203): the ones this page can ask, and its creator.
  const { directory } = useAgentDirectory(questionPage?.ask);
  const creator = questionPage?.creator?.agent.name;
  const agents = useMemo(
    () => [
      ...(creator ? [creator] : []),
      ...(directory.state === 'ready' ? directory.agents.map((agent) => agent.agentName) : []),
    ],
    [creator, directory],
  );
  const write = useMemo(() => binding?.blocks?.bind(binding), [binding]);
  const pageFiles = write ? binding?.files : undefined;
  const recovery = useMemo(
    () => (write && pageId && blockDrafts ? new BlockDraftSession(blockDrafts, pageId) : undefined),
    [write, pageId, blockDrafts],
  );
  const [restored, setRestored] = useState<BlockDraft[]>([]);
  const [clearFailed, setClearFailed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let active = true;
    if (recovery)
      void recovery.store.load(recovery.page).then(
        (entries) => {
          if (active) setRestored(entries);
        },
        () => {},
      );
    return () => {
      active = false;
    };
  }, [recovery]);
  const send = useCallback(
    async (ops: BlockOp[], stored?: readonly StoredAttachment[]) => {
      if (!write) throw new Error('Page editing unavailable');
      // A batch the page moved under is sent again as a new one (#6220); a batch that adds files
      // keeps its own recovery.
      if (!stored?.length) return (await resendStale(() => write(ops))).seq;
      // The files join the page's list in the same batch as the blocks that show them (#6202).
      if (!pageFiles?.addToBlocks) throw new Error('Files are not available on this page.');
      return (await pageFiles.addToBlocks(stored, ops)).seq;
    },
    [write, pageFiles],
  );
  const listed = useRef(0);
  listed.current = imageSource?.descriptors.length ?? 0;
  const files = useMemo<BlockFiles | undefined>(
    () =>
      pageFiles?.addToBlocks
        ? {
            count: () => listed.current,
            upload: (input: AttachmentInput) =>
              pageFiles.attachments.upload(input, pageFiles.target(), () => {}),
          }
        : undefined,
    [pageFiles],
  );
  const {
    tree,
    drafts,
    changeDraft,
    keepDraft,
    discardDraft,
    editing,
    focus,
    focusCell,
    cellKey,
    addRowTo,
    rowAction,
    columnAction,
    pasteUrl,
    pasteStructure,
    check,
    authoring,
    author,
    questionEdit,
    typed,
    flush,
    settle,
    key,
    menu,
    pick,
    hover,
    closeMenu,
    selected,
    selectionFocus,
    selectionRequest,
    selectForKeyboard,
    pageKey,
    toast,
    undo,
    blockMenu,
    act,
    move,
    openBlockMenu,
    insertAfter,
    insertFirst,
    openFirstPicker,
    failedFirstText,
    closeBlockMenu,
    hoverBlockMenu,
    attach,
    refuseFiles,
    uploads,
    choosing,
    mention,
    pickMention,
    hoverMention,
  } = useBlockEditing(records, send, seq, files, agents, mentionPages, recovery);
  useBlocker({
    disabled: !write,
    enableBeforeUnload: () => recovery?.unsafe() ?? false,
    shouldBlockFn: async () => {
      flush();
      if (!recovery?.unsafe()) return false;
      if (await recovery.waitForStorage()) return false;
      return recovery.unsafe() && !window.confirm(strings.blockEdit.leaveUnsaved);
    },
  });
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const blur = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.isContentEditable) flush();
    };
    document.addEventListener('focusout', blur);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('focusout', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);
  const dismiss = useCallback(
    async (draft: BlockDraft) => {
      if (await recovery?.store.clear(recovery.page, draft)) {
        setRestored((entries) => entries.filter((e) => e !== draft));
        setClearFailed((previous) => {
          const next = new Set(previous);
          next.delete(draft.target);
          return next;
        });
      } else {
        setClearFailed((previous) => new Set(previous).add(draft.target));
        setRecoveryError(strings.blockEdit.notApplied);
      }
    },
    [recovery],
  );
  const present = (draft: BlockDraft) => {
    if (!tree.visible(draft.id)) return undefined;
    const block = tree.get(draft.id);
    return draft.cell ? block?.cells?.[draft.cell.column] : block?.text;
  };
  const busy = useRef(new Set<string>());
  const keep = async (draft: BlockDraft) => {
    if (!write || busy.current.has(draft.target)) return;
    busy.current.add(draft.target);
    try {
      if (present(draft) !== draft.value) {
        if (present(draft) === undefined) {
          await send([
            {
              op: 'insert',
              id: crypto.randomUUID(),
              parent: 'root',
              after: null,
              type: 'paragraph',
              text: draft.value,
            },
          ]);
        } else {
          await send([
            draft.cell
              ? {
                  op: 'table',
                  id: draft.cell.table,
                  action: 'set-cell',
                  row: draft.id,
                  column: draft.cell.column,
                  base: draft.base,
                  text: draft.value,
                  overlap: 'both',
                }
              : { op: 'text', id: draft.id, base: draft.base, set: draft.value, overlap: 'both' },
          ]);
        }
      }
      await dismiss(draft);
    } catch {
      setRecoveryError(strings.blockEdit.notApplied);
    } finally {
      busy.current.delete(draft.target);
    }
  };
  const [recoveryError, setRecoveryError] = useState('');
  useEffect(() => {
    for (const draft of restored) {
      const block = records.find((b) => b.id === draft.id && !b.deleted);
      if (block && (draft.cell ? block.cells?.[draft.cell.column] : block.text) === draft.value)
        void dismiss(draft);
    }
  }, [records, restored, dismiss]);
  useEffect(() => {
    onDrawn?.(tree.flat());
  }, [tree, onDrawn]);
  useEffect(() => () => onDrawn?.(undefined), [onDrawn]);
  useEffect(() => {
    onSettle?.(settle);
    return () => onSettle?.(undefined);
  }, [onSettle, settle]);
  return (
    <StructuredPage
      anchorBlock={hash.startsWith('block-') ? hash.slice(6) : hash}
      tree={tree}
      recoveryError={recoveryError}
      restored={restored.filter((d) => clearFailed.has(d.target) || present(d) !== d.value)}
      onRestore={keep}
      onForget={dismiss}
      drafts={drafts}
      onDraftChange={changeDraft}
      onKeepDraft={keepDraft}
      onDiscardDraft={discardDraft}
      todoNumbers={todoNumbers}
      annotationMode={annotationMode}
      sections={sections}
      onAnnotateBlock={onAnnotateBlock}
      annotations={annotations}
      onOpenAnnotation={onOpenAnnotation}
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
      onPasteStructure={pasteStructure}
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
      selectionRequest={selectionRequest}
      onSelectBlock={write ? selectForKeyboard : undefined}
      onPageKey={pageKey}
      toast={toast}
      onUndo={undo}
      blockMenu={blockMenu}
      onAction={act}
      onHoverAction={hoverBlockMenu}
      onCloseBlockMenu={closeBlockMenu}
      onOpenBlockMenu={openBlockMenu}
      onInsertAfter={insertAfter}
      onInsertFirst={insertFirst}
      onOpenFirstPicker={openFirstPicker}
      failedFirstText={failedFirstText}
      onMove={move}
      onAttach={files && ((picked, after) => void attach(picked, after))}
      onFilesRefused={refuseFiles}
      uploads={uploads}
      choosing={choosing}
      onDownloadFile={onDownloadFile}
      blockPageHref={blockPageHref}
      mention={mention}
      onPickMention={pickMention}
      onHoverMention={hoverMention}
      readonly={!write}
    />
  );
}

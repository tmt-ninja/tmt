import { useBlocker, useRouterState } from '@tanstack/react-router';
import {
  BlockDraftSession,
  heldByPage,
  restorable,
  type BlockDraftStore,
  type BlockDraft,
  type DraftRecoveryIssue,
} from './block-drafts.js';
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
import { resendStale, SaveHeld, SaveKept } from './save.js';
import type { PageBinding } from './transport.js';
import { heldText, useBlockEditing } from './use-block-editing.js';
import { useAgentDirectory } from './agent-directory.js';
import type { MentionPages } from './mention-pages.js';

/** The live page's block write (`PageBinding.blocks`). */
type BlockWrite = NonNullable<PageBinding['blocks']>;

/**
 * A structured page (`pageType` `blocks`, #6005) over its live binding: the fold projection's
 * `blocks` root draws through `StructuredPage`, and typing goes out as block batches
 * (`binding.blocks`), which resolve once the page shows the commit. A binding without block
 * writes draws the page read-only, unless the page is only reconnecting (`held`, #6795): then text
 * is typed and kept as drafts, and goes out once the page is live again.
 */
export function LiveStructuredPage({
  pageId,
  blockDrafts,
  blocks,
  todoNumbers,
  seq,
  binding,
  held = false,
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
  /** The connection dropped and is being restored (#6795): the page stays editable, typed text
   * waits for it as drafts, and other changes are refused with a notice. Never set when archived
   * or ended. */
  held?: boolean;
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
  // A link from another page names its block as the route's anchor (#6749); one on this page, as
  // the fragment.
  const linked = useRouterState({
    select: (state) => (state.location.search as { anchor?: unknown }).anchor,
  });
  const anchor = hash || (typeof linked === 'string' ? linked : '');
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
  const write: BlockWrite | undefined = useMemo(() => binding?.blocks?.bind(binding), [binding]);
  const pageFiles = write ? binding?.files : undefined;
  const editable = !!write || held;
  // One draft session per page, across a reconnect and an archive (#6795, #6820): what was typed
  // stays one draft until the page admits it or the person chooses, so a restore never offers the
  // same text twice. It is used only while the page takes edits.
  const session = useMemo(
    () => (pageId && blockDrafts ? new BlockDraftSession(blockDrafts, pageId) : undefined),
    [pageId, blockDrafts],
  );
  const recovery = editable ? session : undefined;
  // Typed text sent while the page reconnects waits for the next live write, in this tab's order.
  const live = useRef(write);
  // Ended or archived instead of back: the waiting text fails, and stays in the device store.
  const waiting = useRef<{ resume(write: BlockWrite): void; fail(): void }[]>([]);
  useEffect(() => {
    live.current = write;
    if (write) for (const waiter of waiting.current.splice(0)) waiter.resume(write);
    else if (!held) for (const waiter of waiting.current.splice(0)) waiter.fail();
  }, [write, held]);
  const [restored, setRestored] = useState<BlockDraft[]>([]);
  const ownerRoot = recovery?.store.recoveryOwner?.();
  const [offerScope, setOfferScope] = useState<{
    recovery: BlockDraftSession;
    ownerRoot?: string;
    issues: DraftRecoveryIssue[];
  }>();
  const currentOffer =
    !!offerScope && offerScope.recovery === recovery && offerScope.ownerRoot === ownerRoot;
  const ownerRecoveryHeld = !!ownerRoot && !recovery?.store.canOpenOwnerDrafts?.();
  const offeredGenerations = useRef<{ recovery: BlockDraftSession; key: string } | undefined>(
    undefined,
  );
  const [clearFailed, setClearFailed] = useState<ReadonlySet<string>>(new Set());
  /** Waits for this tab's typing and batches on their way to land or fail (set once the editing
   * hook below exists). */
  const settled = useRef<() => Promise<void>>(async () => {});
  /** Offers the page's stored drafts, as a reload does, once this tab's own sends have settled:
   * a draft such a send lands is never offered and withdrawn a moment later (#6820). */
  const offer = useCallback(
    (active: () => boolean = () => true) => {
      if (!recovery) return;
      void settled
        .current()
        .catch(() => {})
        .then(async () => {
          if (!active() || (ownerRoot && !recovery.store.canOpenOwnerDrafts?.())) return undefined;
          return recovery.store.recover
            ? recovery.store.recover(recovery.page)
            : { drafts: await recovery.store.load(recovery.page), issues: [] };
        })
        .then(
          (result) => {
            if (!active() || !result || recovery.store.recoveryOwner?.() !== ownerRoot) return;
            if (ownerRoot && !recovery.store.canOpenOwnerDrafts?.()) return;
            const offered = restorable(recovery.page, result.drafts);
            setOfferScope((previous) => {
              if (previous?.recovery !== recovery || previous.ownerRoot !== ownerRoot)
                return { recovery, ownerRoot, issues: result.issues };
              const known = new Set(previous.issues.map(({ id }) => id));
              const added = result.issues.filter(({ id }) => !known.has(id));
              return added.length
                ? { ...previous, issues: [...previous.issues, ...added] }
                : previous;
            });
            setRestored(offered);
            const key = JSON.stringify(offered.map(({ generation }) => generation).sort());
            if (
              offeredGenerations.current?.recovery === recovery &&
              offeredGenerations.current.key === key
            )
              return;
            offeredGenerations.current = { recovery, key };
            // What a reload offers, for a check that nothing landed comes back (#6749).
            window.dispatchEvent(
              new CustomEvent('colab:block-drafts-offered', { detail: { count: offered.length } }),
            );
          },
          () => {},
        );
    },
    [ownerRoot, recovery],
  );
  useEffect(() => {
    let active = true;
    if (!recovery) offeredGenerations.current = undefined;
    if (!ownerRecoveryHeld) offer(() => active);
    return () => {
      active = false;
    };
  }, [offer, ownerRecoveryHeld, recovery]);
  useEffect(() => {
    if (!currentOffer || ownerRecoveryHeld || !recovery || !offerScope?.issues.length) return;
    void recovery.store.markRecoveryIssuesSeen?.(recovery.page, offerScope.issues).catch(() => {});
  }, [currentOffer, offerScope, ownerRecoveryHeld, recovery]);
  const send = useCallback(
    async (ops: BlockOp[], stored?: readonly StoredAttachment[]) => {
      if (!write && !held) throw new Error('Page editing unavailable');
      // A batch the page moved under is sent again as a new one (#6220); a batch that adds files
      // keeps its own recovery.
      if (!stored?.length) {
        // Only typed text waits for the page; anything else is refused while it reconnects.
        if (!live.current && !heldText(ops)) throw new SaveHeld();
        const waited = !live.current;
        const now =
          live.current ??
          (await new Promise<BlockWrite>((resume, reject) =>
            waiting.current.push({ resume, fail: () => reject(new SaveKept()) }),
          ));
        try {
          return (await resendStale(() => now(ops))).seq;
        } catch (error) {
          // Text kept while reconnecting that the page cannot take now (its block went meanwhile)
          // is offered back from the device store, never dropped.
          if (waited) offer();
          throw error;
        }
      }
      // The files join the page's list in the same batch as the blocks that show them (#6202).
      if (!pageFiles?.addToBlocks) throw new Error('Files are not available on this page.');
      return (await pageFiles.addToBlocks(stored, ops)).seq;
    },
    [write, held, pageFiles, offer],
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
    textFits,
    onFull,
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
  } = useBlockEditing(
    records,
    send,
    seq,
    files,
    agents,
    mentionPages,
    recovery,
    binding?.blocksFit?.bind(binding),
    !write && held,
    !editable,
  );
  settled.current = settle;
  useBlocker({
    disabled: !editable,
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
      if (
        !currentOffer ||
        recovery?.store.recoveryOwner?.() !== ownerRoot ||
        (ownerRoot && !recovery?.store.canOpenOwnerDrafts?.())
      )
        return;
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
    [currentOffer, ownerRoot, recovery],
  );
  const present = (draft: BlockDraft) => {
    if (!tree.holds(draft.id, draft.cell?.table)) return undefined;
    const block = tree.get(draft.id);
    return draft.cell ? block?.cells?.[draft.cell.column] : block?.text;
  };
  const busy = useRef(new Set<string>());
  const keep = async (draft: BlockDraft) => {
    if (
      !editable ||
      !currentOffer ||
      recovery?.store.recoveryOwner?.() !== ownerRoot ||
      (ownerRoot && !recovery?.store.canOpenOwnerDrafts?.()) ||
      busy.current.has(draft.target)
    )
      return;
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
    } catch (error) {
      setRecoveryError(
        error instanceof SaveHeld ? strings.blockEdit.held : strings.blockEdit.notApplied,
      );
    } finally {
      busy.current.delete(draft.target);
    }
  };
  const [recoveryError, setRecoveryError] = useState('');
  useEffect(() => {
    if (!currentOffer) return;
    for (const draft of restored) {
      const block = records.find((b) => b.id === draft.id && !b.deleted);
      const shown = draft.cell ? block?.cells?.[draft.cell.column] : block?.text;
      if (block && heldByPage(draft, shown ?? '')) void dismiss(draft);
    }
  }, [currentOffer, records, restored, dismiss]);
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
      anchorBlock={anchor.startsWith('block-') ? anchor.slice(6) : anchor}
      tree={tree}
      recoveryError={recoveryError}
      recoveryProblems={
        currentOffer ? [...new Set(offerScope?.issues.map(({ reason }) => reason))] : undefined
      }
      onDismissRecoveryProblems={() => {
        setOfferScope((previous) => previous && { ...previous, issues: [] });
      }}
      restored={
        currentOffer
          ? restored.filter((d) => {
              // The editor already offers it in its deleted block's place, or it has landed since.
              if (drafts.has(d.id) || (pageId && !restorable(pageId, [d]).length)) return false;
              const shown = present(d);
              return clearFailed.has(d.target) || shown === undefined || !heldByPage(d, shown);
            })
          : []
      }
      onRestore={keep}
      onForget={dismiss}
      recoveryHeld={ownerRecoveryHeld}
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
      textFits={textFits}
      onFull={onFull}
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
      readonly={!editable}
    />
  );
}

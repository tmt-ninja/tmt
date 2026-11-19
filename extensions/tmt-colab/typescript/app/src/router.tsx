import { useNeedsYouVersions } from './use-needs-you-versions.js';
import { previewTransport } from './local-pages.js';
import { PageMenu as BrowserMenu } from './page-menu.js';
import { useEditLockLayer } from './edit-lock-layer.js';
import { ShellPage } from './shell-page.js';
import { PageStateMenu, PageWorkBand, showsComputedStatus } from './work-band-live.js';
import { htmlOutlineSections, sectionTotals } from './section-view.js';
import { MobileWorkTitle } from './work-band.js';
import { useMedia } from './use-media.js';
import { Sheet, SheetContent, SheetTitle, UiTheme } from '@tmt/browser-ui/ui';
import { PageStatusDetails } from './page-status-details.js';
import { PageBarSummary } from './page-bar-summary.js';
import { PageOutline } from './page-outline.js';
import { AskTodoContext, askTodoProgress } from './ask-todo-line.js';
import { usePageWorkflow } from './use-page-workflow.js';
import { AddSubpageDialog } from './work-add-dialog.js';
import { pageLocation, parentRefusal } from './work-tree.js';
import { PageOperationDialog } from './page-operation-dialog.js';
import {
  StructuredConversionDialog,
  StructuredRevertDialog,
} from './structured-conversion-dialog.js';
import { pageDesignSystems, withoutDesignSystems } from './design-system-pages.js';
import { gatePageViewSource, watchPageView } from './page-view-source.js';
import { gateWorkBundleSource, workBundleSource } from './work-bundle-source.js';
import { mentionPages } from './mention-pages.js';
import { usePageAttachmentDownload } from './page-attachment-download.js';
import { usePageHierarchy } from './page-hierarchy.js';
import { usePageLinks } from './page-link-bar.js';
import { usePageLayers } from './page-layers.js';
import { blockTree } from './block-projection.js';
import { AgentActivityProvider } from './components/agent-activity.js';
import { RemoteAttention, RemotePresenceProvider } from './remote-header.js';
import { PagePinNotice, PageProjects } from './page-projects.js';
import type { PagePinRequest, PagePinState } from './pins.js';
import { OwnPublicationTimeout } from './own-publication.js';
import { designBase, entryMount, entryOpenTarget, inShell, publicEntry } from './entry.js';
import {
  BrowserAction,
  BrowserCommand,
  BrowserIconAction,
  BrowserNotice,
  BrowserNotifications,
  BusyMark,
  HostedShell,
} from '@tmt/browser-ui/react';
import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import { shortPageId, validPagePrefix } from './short-links.js';
import {
  hintFragment,
  hintSearch,
  ownerPageHint,
  ownerReadingHref,
  openSearch,
  pageSearch,
  splitPageHint,
  type PageHint,
} from './reading-link.js';
import {
  ArrowUpRight,
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CopyPlus,
  MessageCircle,
  MessageSquarePlus,
  MessagesSquare,
  MousePointer2,
  X,
} from 'lucide-react';
import { moreButtonRect, PageHeaderActions, type PageHeaderAction } from './page-header-actions.js';
import { AppHeader } from './app-header.js';
import { SharedTopBar } from './shared-top-bar.js';
import { ColabHeader } from './colab-header.js';
import { creatorName, PageAttribution } from './page-attribution.js';
import { PageLayoutSection } from './page-layout-section.js';
import { ErrorDetails, NoticeCard } from './notice-card.js';
import { openFailure } from './open-failure.js';
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react';
import {
  createHashHistory,
  createBrowserHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  redirect,
  Outlet,
  useParams,
  useRouterState,
  useRouter,
} from '@tanstack/react-router';
import type { PageView, PageSnapshot, PageTransport } from './transport.js';
import type { PageRouting } from './page-routing.js';
import {
  EmbeddedPageContext,
  ShownReleaseContext,
  type EmbeddedPageProps,
  type ShippedPage,
} from './embedded-page.js';
import { AnnotationInput } from './annotation-input.js';
import { rememberPages, SwitcherSourceStore } from './quick-switcher-source.js';
import { noteOpened } from './recently-opened.js';
import { QuickSwitcherHost, QuickSwitcherModalPresence } from './quick-switcher-dialog.js';
import { isListPath, keepListSearch, storedListSearch } from './list-history.js';
import { ColabShell, ShellHostSlot } from './colab-shell.js';
import {
  embeddedPageEnvironment,
  PageEnvironmentProvider,
  usePageEnvironment,
} from './page-environment.js';
import { ColabSettings } from './colab-settings.js';
import { TemplatesPage } from './templates-page.js';
import { TemplateDialogs, type TemplateDialogKind } from './template-dialogs.js';
import { Toast, useToast } from './template-toast.js';
import { NewPageDialog } from './new-page-dialog.js';
import { useQuickSwitcher } from './quick-switcher-context.js';
import { NeedsYouHeader } from './needs-you-header.js';
import { shareView } from './share-view.js';
import { pendingNeedsYou, type NeedsYouCandidate } from './needs-you.js';
import { needsYouTarget, readNeedsYouAcknowledgements } from './needs-you-acknowledgement.js';
import { useReplyNotifications } from './use-reply-notifications.js';
import { ReplyNotificationObserver } from './reply-notifications.js';
import { ReplyNotificationContext } from './reply-notification-context.js';
import { ThreadPanel, ThreadWindow } from './thread-panel.js';
import { ResolveAllThreads } from './resolve-all-threads.js';
import { presentationOf } from './thread-status-presentation.js';
import { isOpenThread, isStatusThread, openThreadCount } from './thread-status-view.js';
import { firstThread, listedThreads, threadKey, type ThreadFilter } from './comments-listing.js';
import { useThreadFilter } from './use-thread-filter.js';
import {
  anchorQuote,
  type DiscussionRef,
  type QuoteSelector,
  type ThreadAnchor,
} from './thread-records.js';
import { Home, validateHomeSearch } from './home.js';
import { WorkHome } from './work-home.js';
import { validateWorkSearch } from './work-home-model.js';
import { HomeReadFailure, isOrdinaryListReadFailure } from './home-load-error.js';
import { ColdPageList } from './home-cold.js';
import { PageListError, PageListLoading } from '@tmt/browser-ui/data-table';
import '@tmt/browser-ui/ui.css';
import { getTheme, subscribeTheme, type Theme } from './theme.js';
import { ManagePage } from './manage-page.js';
import './about-drawer.css';
import { mountRenderer, MAX_RENDER_SOURCE_BYTES } from './renderer.js';
import { framedLayout } from './page-layout.js';
import type { AnchorPosition, RenderState, SelectionRect } from './renderer.js';
import { text } from './strings.js';
import type { ConnectionState, EndedAction } from './connection-model.js';
import { useConnection } from './use-connection.js';
import { terminalFailure } from './terminal-failure.js';
import { buildWatch } from './app-build.js';
import { SessionEvictedError } from './ask-remote.js';
import { SessionLimitError } from './session-limit-error.js';
import { SessionLimitBody } from './session-limit.js';
import { ExportPanel } from './export-panel.js';
import { BrowserDrawer, BrowserPanel } from '@tmt/browser-ui/react';
import { AgentStatusPanel } from './agent-status-panel.js';
import { AgentPresentation, useAgentPresentation } from './agent-directory.js';
import { ChatPanel } from './chat-panel.js';
import { dockPanel, useDockMotion } from './dock-motion.js';
import { AttachmentDropPanel } from './attachment-drop.js';
import { FilesSurface } from './files-panel.js';
import { MetadataDialogs } from './metadata-dialogs.js';
import { verifiedQuestionStates } from './question-registry.js';
import { CreatorDefaultProvider, creatorTarget } from './creator-default.js';
import { CHAT_DRAFT, SavedDrafts, savedDrafts, unconfirmedDrafts } from './saved-drafts.js';
import { PendingMessageContext, pendingMessageStore } from './draft-store.js';
import type { ComposerRecovery } from './components/message-composer-edit.js';
import { isChatThread, threadNumbers } from './thread-records.js';
import { PageSizeSection, usePageSize } from './page-size.js';
import { SourceDraft } from './use-page-editor.js';
import { PageSource } from './page-source.js';
import { usePagePanels } from './use-page-panels.js';
import { usePanelMode } from './panel-mode.js';
import './panel-layout.css';
import { useAnnotations } from './use-annotations.js';
import { usePageRenderer } from './use-page-renderer.js';

/** Controls in the page and above it that the floating actions move above, never over: the cards'
 * footers, and the open work band's controls, which can fill a phone's viewport. */
const AVOIDED_CARDS = '.question-group-footer';
const AVOIDED_BAND =
  '.work-band :is(button, a[href], input, select, textarea, [role="button"], [role="combobox"], [role="menuitem"])';

/** The control belongs to trusted chrome; only mode is projected into author content. */
function PageFloatingActions({
  host,
  enabled,
  discussionOpen,
  panel,
  toggle,
  chatUnread,
  chatButton,
  toggleChat,
  comments,
  unseen,
  commentsButton,
  toggleComments,
  onPlacement,
  canSelect,
  selectPending,
  slots,
}: {
  slots: readonly AnchorPosition[];
  host: HTMLDivElement | null;
  enabled: boolean;
  discussionOpen: boolean;
  panel: PageHeaderAction | null;
  toggle(): void;
  chatUnread: boolean;
  chatButton: Ref<HTMLButtonElement>;
  toggleChat(): void;
  /** The open threads; absent while the page's threads are still being verified: a place held, not a false 0. */
  comments?: number;
  /** Some thread has news for the viewer. */
  unseen: boolean;
  commentsButton: Ref<HTMLButtonElement>;
  toggleComments(): void;
  onPlacement(value: { right: number; bottom: number; height: number }): void;
  canSelect: boolean;
  /** The button's place while the threads are unverified: fenced, not greyed. */
  selectPending: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const tooltipPlacement = useMemo(
    () => ({ anchor: () => dock.current, side: 'above' as const }),
    [],
  );
  const [placement, setPlacement] = useState<{
    right: number;
    bottom: number;
    visibility: 'visible' | 'hidden';
  }>({ right: 24, bottom: 24, visibility: 'hidden' });
  useEffect(() => {
    const workspace = host?.closest('.workspace');
    let measured: { right: number; bottom: number; height: number; visibility: string } | undefined;
    const place = () => {
      const box = host?.getBoundingClientRect();
      if (!box) return;
      const margin = innerWidth <= 640 ? 16 : 24;
      // These parent-owned overlays sit outside the renderer host's layout box.
      // Their actual bounds keep the control clear without altering author geometry.
      // A page hosted in a panel sits inside that panel's drawer; only another drawer is an overlay.
      const drawer = [
        ...document.querySelectorAll<HTMLDialogElement>(
          '.tmt-ui-drawer[open]:not([data-panel="chat"])',
        ),
      ]
        .find((candidate) => !candidate.contains(host))
        ?.getBoundingClientRect();
      // A card sits over the page's right edge and a sheet over its bottom; a column is a grid
      // track beside the page, so the host's own box already ends before it.
      const floating = document.querySelector<HTMLElement>(
        '.tmt-ui-panel:not([hidden]):not([data-floating-discussion])[data-mode="card"], .tmt-ui-panel:not([hidden]):not([data-floating-discussion])[data-mode="sheet"]',
      );
      const over = floating?.getBoundingClientRect();
      const right = Math.min(
        box.right,
        drawer?.left ?? innerWidth,
        over && floating?.dataset.mode === 'card' ? over.left : innerWidth,
      );
      let bottom = Math.min(
        innerHeight,
        box.bottom,
        over && floating?.dataset.mode === 'sheet' ? over.top : innerHeight,
      );
      const fab = element.current?.getBoundingClientRect();
      const left = right - margin - (fab?.width ?? 0);
      const avoided = [
        ...(workspace?.querySelectorAll<HTMLElement>(`${AVOIDED_CARDS}, ${AVOIDED_BAND}`) ?? []),
      ]
        .filter((footer) => !footer.closest('[data-detached],[hidden]'))
        .map((footer) =>
          (footer.closest('.question-compact-block') ?? footer).getBoundingClientRect(),
        )
        .filter(
          (footer) =>
            footer.width > 0 && footer.height > 0 && footer.bottom > 0 && footer.top < innerHeight,
        )
        .sort((a, b) => b.top - a.top);
      // Moving above one control can land on the next one up: settle in a few passes. With no room
      // left above them the group hides below, as for the cards.
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const footer of avoided) {
          if (
            left < footer.right &&
            right - margin > footer.left &&
            bottom - margin > footer.top &&
            bottom - margin - (fab?.height ?? 0) < footer.bottom
          ) {
            bottom = footer.top + margin - 8;
            moved = true;
          }
        }
        if (!moved) break;
      }
      // The work band is pinned right under the page bar: above its top there is only chrome.
      const ceiling = Math.max(
        0,
        workspace?.querySelector('.work-band')?.getBoundingClientRect().top ?? 0,
      );
      const next = {
        right: Math.max(margin, innerWidth - right + margin),
        bottom: innerHeight - bottom + margin,
        visibility:
          bottom - margin - (fab?.height ?? 0) >= ceiling + 8
            ? ('visible' as const)
            : ('hidden' as const),
      };
      const height = fab?.height ?? 0;
      if (
        measured?.right === next.right &&
        measured.bottom === next.bottom &&
        measured.visibility === next.visibility &&
        measured.height === height
      )
        return;
      measured = { ...next, height };
      setPlacement((previous) =>
        previous.right === next.right &&
        previous.bottom === next.bottom &&
        previous.visibility === next.visibility
          ? previous
          : next,
      );
      onPlacement({ right: next.right, bottom: next.bottom, height });
    };
    place();
    const observer = new ResizeObserver(place);
    if (host) observer.observe(host);
    if (element.current) observer.observe(element.current);
    // The band opens and closes above the host without resizing it: the workspace's own size follows.
    if (workspace) observer.observe(workspace);
    for (const card of workspace?.querySelectorAll(`${AVOIDED_CARDS}, ${AVOIDED_BAND}`) ?? [])
      observer.observe(card);
    // Native dialog show/close happens in its own effect. Follow its actual layout,
    // rather than depending on sibling effect order.
    for (const drawer of document.querySelectorAll('.tmt-ui-drawer, .tmt-ui-panel'))
      observer.observe(drawer);
    const composer = document.querySelector('.annotation-popover');
    if (composer) observer.observe(composer);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [host, enabled, panel, discussionOpen, slots, onPlacement]);
  return (
    <div ref={element} className="selection-mode" style={placement}>
      {enabled && !discussionOpen && (
        <p className="selection-mode-hint">{text.selectionModeHint}</p>
      )}
      <div className="page-floating-actions" ref={dock}>
        {(canSelect || selectPending) && (
          <BrowserIconAction
            type="button"
            variant="secondary"
            tooltipPlacement={tooltipPlacement}
            busy={selectPending}
            label={text.selectionMode}
            ariaKeyShortcuts={enabled ? 'c Escape' : 'c'}
            pressed={enabled}
            icon={
              <>
                <MousePointer2 />
                {enabled && (
                  <>
                    <span>{text.selecting}</span>
                    <kbd>Esc</kbd>
                  </>
                )}
              </>
            }
            onActivate={(event) => {
              if (event.isTrusted) toggle();
            }}
          />
        )}
        {!enabled && !discussionOpen && (
          <BrowserIconAction
            type="button"
            variant="secondary"
            tooltipPlacement={tooltipPlacement}
            label={chatUnread ? `${text.chat} · ${text.chatUnread}` : text.chat}
            buttonRef={chatButton}
            expanded={panel === 'chat'}
            icon={
              <>
                <MessageCircle />
                {chatUnread && (
                  <span
                    className="chat-unread tmt-ui-attention-dot"
                    data-placement="overlay"
                    aria-hidden="true"
                  />
                )}
              </>
            }
            onActivate={(event) => {
              if (event.isTrusted) toggleChat();
            }}
          />
        )}
        {!enabled && !discussionOpen && (
          <BrowserIconAction
            type="button"
            variant="secondary"
            tooltipPlacement={tooltipPlacement}
            label={`${text.comments}${comments === undefined ? '' : ` (${comments})`}${unseen ? ` · ${text.threadUnseen}` : ''}`}
            buttonRef={commentsButton}
            expanded={panel === 'comments'}
            icon={
              <>
                <MessagesSquare />
                {comments !== undefined ? (
                  <span className="dock-count" data-unseen={unseen || undefined}>
                    {comments}
                    {unseen && <span aria-hidden="true">•</span>}
                  </span>
                ) : (
                  <span className="dock-count" data-pending aria-hidden="true" />
                )}
              </>
            }
            onActivate={(event) => {
              if (event.isTrusted) toggleComments();
            }}
          />
        )}
      </div>
    </div>
  );
}

function SelectionAnnotation({
  element,
  host,
  structured,
  rectangle,
  inset,
  noticeVisible,
  toggleVisible,
  open,
  expanded,
  control,
  thread,
  arrivals,
  children,
}: {
  element: React.RefObject<HTMLDivElement | null>;
  host: HTMLDivElement | null;
  /** Structured pages are rendered in the parent rather than an author iframe. */
  structured?: boolean;
  rectangle: SelectionRect | null;
  inset: number;
  noticeVisible: boolean;
  toggleVisible: boolean;
  open(): void;
  /** An annotation window is shown; otherwise the Annotate control, when `control`. */
  expanded: boolean;
  control: boolean;
  /** The thread the window shows, so a different thread starts from its own place. */
  thread?: string;
  /** The records in the window's thread; an arrival after the first grows it upward, not downward. */
  arrivals: number;
  /** Every annotation window: the shown one, and hidden ones whose send still runs (#5816). */
  children?: React.ReactNode;
}) {
  // The lower edge a thread window keeps once a record arrives in it, relative to its anchor, and
  // the height and arrivals seen by the last placement.
  const rise = useRef<number | null>(null);
  const placed = useRef({ height: 0, arrivals });
  useLayoutEffect(() => {
    rise.current = null;
    placed.current.arrivals = arrivals;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a different thread resets
  }, [thread]);
  useLayoutEffect(() => {
    if (arrivals > placed.current.arrivals && placed.current.arrivals > 0)
      rise.current ??= placed.current.height;
    if (arrivals === 0) rise.current = null;
    placed.current.arrivals = arrivals;
  }, [arrivals]);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);
  useEffect(() => {
    const notice = noticeVisible
      ? host?.parentElement?.querySelector<HTMLElement>('.tmt-ui-notice')
      : null;
    const place = () => {
      const frame = (structured ? host : host?.querySelector('iframe'))?.getBoundingClientRect();
      const width = expanded ? Math.min(440, innerWidth - 24) : 34;
      // Parent chrome reserves the toggle's bottom strip only for overlapping windows.
      const margin = innerWidth <= 640 ? 16 : 24;
      const leftEdge =
        rectangle && frame
          ? Math.max(
              8,
              Math.min(
                innerWidth - width - 8,
                frame.right - width - 8,
                frame.left + Math.max(0, Math.min(frame.width, rectangle.x)),
              ),
            )
          : (element.current?.getBoundingClientRect().left ?? innerWidth - width - 8);
      const toggle = document.querySelector('.selection-mode')?.getBoundingClientRect();
      const overlaps =
        toggleVisible &&
        expanded &&
        toggle &&
        leftEdge + width > toggle.left &&
        leftEdge < toggle.right;
      const edge = overlaps
        ? Math.min(innerHeight, host?.getBoundingClientRect().bottom ?? innerHeight) -
          margin -
          40 -
          8
        : innerHeight - 8;
      const placementHeight = expanded ? Math.min(480, edge - inset - 4) : 34;
      if (expanded && innerWidth <= 640) {
        const noticeBox = notice?.getBoundingClientRect();
        const below = Math.max(0, edge - Math.max(inset, noticeBox?.bottom ?? inset) - 8);
        const above = Math.max(0, (noticeBox?.top ?? inset) - inset - 16);
        // A failure card can fill the room below the page chrome. Preserve a usable draft
        // above it instead of collapsing the retained window to zero height beneath it.
        setPosition(
          above > below
            ? {
                left: 12,
                top: inset + 8,
                maxHeight: above,
              }
            : {
                left: 12,
                bottom: Math.max(8, innerHeight - edge),
                maxHeight: below,
              },
        );
        return;
      }
      if (!frame || !rectangle) {
        // Keep the failure notice readable while retaining the mounted draft.
        const belowNotice = notice?.getBoundingClientRect().bottom;
        setPosition((previous) => {
          if (!expanded || !previous) return null;
          const top =
            belowNotice !== undefined
              ? Math.max(inset + 4, belowNotice + 8)
              : Math.max(
                  inset + 4,
                  Math.min(edge - placementHeight, element.current!.getBoundingClientRect().top),
                );
          return {
            left: Math.max(8, Math.min(innerWidth - width - 8, previous.left)),
            top,
            maxHeight: Math.max(0, edge - top),
          };
        });
        return;
      }
      const selectionTop = frame.top + Math.max(0, Math.min(frame.height, rectangle.y)),
        selectionBottom =
          frame.top + Math.max(0, Math.min(frame.height, rectangle.y + rectangle.height)),
        left = frame.left + Math.max(0, Math.min(frame.width, rectangle.x)),
        right = frame.left + Math.max(0, Math.min(frame.width, rectangle.x + rectangle.width));
      if (!expanded && (selectionBottom < inset || selectionTop > innerHeight)) {
        setPosition(null);
        return;
      }
      if (!expanded && innerWidth > 640) {
        // The Annotate control hangs from the selection's lower right corner, with no line to the
        // text; with no room under the selection it sits just above it. On a phone the system's own
        // selection handles and menu occupy that corner, so the control keeps its place beside or
        // under the selection below.
        const below = selectionBottom + 2 + placementHeight <= edge;
        setPosition({
          left: Math.max(
            8,
            frame.left,
            Math.min(innerWidth - width - 8, frame.right - width - 8, right - 6),
          ),
          ...(below
            ? { top: selectionBottom + 2, maxHeight: placementHeight }
            : { bottom: innerHeight - selectionTop + 2, maxHeight: placementHeight }),
        });
        return;
      }
      // A completed selection can end outside the viewport. Its open draft still
      // needs bounded history and a visible composer, including when opened by C.
      const clampAnchor = (value: number) => Math.max(inset + 4, Math.min(edge, value));
      const top = expanded ? clampAnchor(selectionTop) : selectionTop;
      const bottom = expanded ? clampAnchor(selectionBottom) : selectionBottom;
      const beside = right + width + 24 <= Math.min(frame.right, innerWidth - 8);
      const besideLeft = !beside && expanded && left - width - 24 >= Math.max(frame.left, 8);
      const below = bottom + placementHeight + 8 <= edge;
      // Choose the edge using stable placement clearance, not the changing content
      // height. CSS fits the shell; first Send grows away from the same anchor edge.
      const above =
        expanded && !beside && !besideLeft && !below && top - placementHeight - 6 >= inset + 4;
      const anchoredTop = Math.max(
        inset + 4,
        Math.min(
          edge - placementHeight,
          beside || besideLeft ? top : below ? bottom + 6 : top - placementHeight - 6,
        ),
      );
      // A reply arriving in a thread grows the window upward: the composer keeps its viewport
      // position and the new message appears above it. The window scrolls inside once it is tall.
      const height = element.current?.getBoundingClientRect().height ?? 0;
      placed.current.height = height;
      const settledBottom = rise.current === null || above ? null : anchoredTop + rise.current;
      const windowTop =
        settledBottom === null ? anchoredTop : Math.max(inset + 4, settledBottom - height);
      setPosition({
        left: Math.max(
          8,
          Math.min(
            innerWidth - width - 8,
            frame.right - width - 8,
            beside ? right + 24 : besideLeft ? left - width - 24 : left,
          ),
        ),
        ...(above
          ? { bottom: innerHeight - top + 6, maxHeight: top - 6 - inset - 4 }
          : {
              top: windowTop,
              // The window never reaches below where its thread first settled: longer history scrolls inside.
              maxHeight: Math.max(
                0,
                settledBottom === null ? edge - windowTop : settledBottom - (inset + 4),
              ),
            }),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (element.current) observer.observe(element.current);
    if (notice) observer.observe(notice);
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [
    element,
    host,
    structured,
    rectangle,
    inset,
    expanded,
    noticeVisible,
    toggleVisible,
    children,
  ]);
  return (
    <div
      ref={element}
      className={expanded ? 'annotation-popover' : 'selection-control'}
      data-testid={expanded || !control ? undefined : 'selection-ask'}
      // The control never takes the pointer from the selection it annotates.
      onPointerDown={expanded ? undefined : (event) => event.preventDefault()}
      style={
        {
          ...(position
            ? {
                left: position.left,
                top: position.top,
                bottom: position.bottom,
                maxHeight: position.maxHeight,
              }
            : {}),
          visibility: position && (expanded || control) ? 'visible' : 'hidden',
        } as React.CSSProperties
      }
    >
      {!expanded && control && (
        <BrowserIconAction
          type="button"
          variant="primary"
          label={text.annotationTitle}
          icon={<MessageSquarePlus aria-hidden />}
          ariaKeyShortcuts="c Alt+Enter"
          onActivate={(event) => {
            if (event.isTrusted) open();
          }}
        />
      )}
      {children}
    </div>
  );
}
const managementChanged = 'Management changed. Reopen the page to load its latest state.';

/** A terminal refusal as a sentence; its raw code stays as a small reference. */
function TerminalFailure({
  error,
  reference: showReference = true,
}: {
  error: Error;
  reference?: boolean;
}) {
  if (error.message === managementChanged) return <p>{managementChanged}</p>;
  const { sentence, reference, referenceLabel } = terminalFailure(error);
  return (
    <>
      <p>{sentence}</p>
      {showReference && reference && (
        <p>
          <small className="failure-reference">
            {text.failureCodeLabel}{' '}
            <code
              className="tmt-ui-code"
              data-failure-reference
              title={reference}
              data-own-publication={
                error instanceof OwnPublicationTimeout && error.diagnostic
                  ? JSON.stringify(error.diagnostic)
                  : undefined
              }
            >
              {referenceLabel}
            </code>
          </small>
        </p>
      )}
    </>
  );
}

/** The sentence and the one action of an ended connection, shared by the page card and the drawer row; the row leaves out the failure code. */
function EndedBody({
  error,
  action,
  compact,
}: {
  error: Error;
  action: EndedAction;
  compact?: boolean;
}) {
  if (error instanceof SessionEvictedError)
    return <SessionLimitBody limit={error.limit} settingsUrl={error.settingsUrl} />;
  if (error instanceof SessionLimitError)
    return <SessionLimitBody refused limit={error.limit} settingsUrl={error.settingsUrl} />;
  return (
    <>
      <TerminalFailure error={error} reference={!compact} />
      {action === 'pair' && (
        <>
          <p>{text.pairAgain}</p>
          <BrowserCommand text={text.pairCommand} />
        </>
      )}
    </>
  );
}

/** A quote short enough to name in one line: whitespace collapsed, at most 40 characters. */
function quoteExcerpt(quote: string) {
  const characters = [...quote.replace(/\s+/g, ' ').trim()];
  return characters.length > 40 ? `${characters.slice(0, 39).join('')}…` : characters.join('');
}

function EndedLink({ action, primary = false }: { action: EndedAction; primary?: boolean }) {
  return (
    <>
      {action === 'reload' && (
        <BrowserAction
          type="button"
          variant={primary ? 'primary' : 'text'}
          label={text.reload}
          onActivate={() => location.reload()}
        />
      )}
      <Link className={ui.action} data-variant="text" to="/">
        {text.retry}
      </Link>
    </>
  );
}

/** The page owner projects C1 once; composers do not classify transport errors. */
export type ComposerConnectionPresentation = {
  phase: 'reconnecting' | 'ended';
  body: ReactNode;
};
function composerConnection(state: ConnectionState): ComposerConnectionPresentation | undefined {
  if (state.phase === 'connected') return undefined;
  return {
    phase: state.phase,
    body:
      state.phase === 'reconnecting' ? (
        text.reconnecting
      ) : (
        <>
          <EndedBody error={state.error} action={state.action} compact />
          <EndedLink action={state.action} />
        </>
      ),
  };
}

type KnownPages = readonly { pageId: string; deleted: boolean }[];
type AppContext = {
  transport: PageTransport;
  space?: string;
  // The short-URL history resolves a prefix against the catalog the loaders last saw.
  rememberPages?: (pages: KnownPages) => void;
};
const pageOpenFailureTitle = (failure: { kind: 'retry' | 'large' }) =>
  failure.kind === 'retry' ? text.openFailed : text.openTooLarge;
/**
 * A page that could not open. A failure that reopening may cure is plain copy with a Retry that
 * runs the page's loader again (the router then shows the same opening frame as a first open), and
 * the raw token moves to a small reference; only a refusal keeps the red card (see `openFailure`).
 * Return to space is always there.
 */
function PageOpenFailure({
  failure,
}: {
  failure: Exclude<ReturnType<typeof openFailure>, { kind: 'refused' }>;
}) {
  const router = useRouter();
  const retry = failure.kind === 'retry';
  return (
    <NoticeCard
      state="inactive"
      stateLabel={text.openFailedLabel}
      eyebrow={text.product}
      title={pageOpenFailureTitle(failure)}
      testId="page-open-failure"
      actions={
        <>
          {retry && (
            <BrowserAction
              type="button"
              variant="primary"
              label={text.openRetry}
              onActivate={() => void router.invalidate()}
            />
          )}
          <Link className={ui.action} data-variant="text" to="/">
            {text.retry}
          </Link>
        </>
      }
    >
      <p>
        {retry ? (
          text.openFailedBody
        ) : (
          <>
            {text.openTooLargeBefore}
            <code className="tmt-ui-code">{text.openTooLargeCommand}</code>
            {text.openTooLargeAfter}
          </>
        )}
      </p>
      <p>
        <small className="failure-reference">
          {text.failureCodeLabel}{' '}
          <code className="tmt-ui-code" data-failure-reference>
            {retry ? failure.reference : text.openTooLargeLabel}
          </code>
        </small>
      </p>
    </NoticeCard>
  );
}
const root = createRootRouteWithContext<AppContext>()({
  component: Shell,
  errorComponent: function RootError({ error }) {
    const router = useRouter();
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const opening = pathname.startsWith('/pages/');
    const listFailure = pathname === '/' && error instanceof HomeReadFailure;
    const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
    const failure =
      error instanceof Error && (opening || error.message === text.reconnectFailed)
        ? openFailure(error)
        : undefined;
    // The heading takes focus once it is drawn: in the shared bar it mounts after this view.
    const header = useCallback((node: HTMLElement | null) => {
      const title = node?.matches('h1') ? node : node?.querySelector('h1');
      if (title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
      }
    }, []);
    const hostSlot = useContext(ShellHostSlot);
    // Inside the TMT web app the error view keeps the host's header slot, like every other view (#4373).
    const inHost = (view: ReactNode) =>
      hostSlot ? (
        <HostedShell slot={hostSlot} menu={undefined}>
          <SharedTopBar value={hostSlot.topBarReady()}>{view}</SharedTopBar>
        </HostedShell>
      ) : (
        view
      );
    return inHost(
      <>
        <AppHeader
          title={
            listFailure
              ? text.pageList.allPages
              : failure && failure.kind !== 'refused'
                ? pageOpenFailureTitle(failure)
                : text.error
          }
          headerRef={header}
        />
        <main>
          {listFailure ? (
            <section className="home tmt-ui-page" data-page-list>
              <ColdPageList theme={theme} canCreate>
                <PageListError onRetry={() => void router.invalidate()} />
              </ColdPageList>
            </section>
          ) : failure && failure.kind !== 'refused' ? (
            <PageOpenFailure failure={failure} />
          ) : (
            <NoticeCard
              state="blocked"
              eyebrow={text.product}
              title={text.error}
              actions={
                <>
                  <BrowserAction
                    type="button"
                    variant="text"
                    label={text.crashRetry}
                    onActivate={() => void router.invalidate()}
                  />
                  <Link className={ui.action} data-variant="text" to="/">
                    {text.retry}
                  </Link>
                </>
              }
            >
              {failure ? (
                <TerminalFailure error={error as Error} />
              ) : (
                <>
                  <p>{text.errorBody}</p>
                  <ErrorDetails error={error} />
                </>
              )}
            </NoticeCard>
          )}
        </main>
      </>,
    );
  },
  notFoundComponent: () => (
    <>
      <NoticeCard
        state="blocked"
        eyebrow={text.product}
        title={text.error}
        actions={
          <Link className={ui.action} data-variant="text" to="/">
            {text.retry}
          </Link>
        }
      />
    </>
  ),
});
async function loadSpaceHome({ context }: { context: AppContext }) {
  // Design-system pages belong to the Design tab, not the Colab list (#5866).
  let loaded;
  try {
    loaded = await context.transport.spaceHome();
  } catch (error) {
    if (isOrdinaryListReadFailure(error)) throw new HomeReadFailure(error);
    throw error;
  }
  const home = withoutDesignSystems(loaded);
  context.rememberPages?.(
    home.pageIds ?? home.pages.map((page) => ({ pageId: page.id, deleted: false })),
  );
  // A quick switcher opened later shows this list at once and refreshes it.
  rememberPages(context.transport, context.space, home.pages);
  return home;
}
function HomePending() {
  const opening = useContext(OpeningFrame);
  useLayoutEffect(() => {
    opening(true);
    return () => opening(false);
  }, [opening]);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  return (
    <section className="home tmt-ui-page" data-page-list>
      <AppHeader title={text.pageList.allPages} />
      <ColdPageList theme={theme}>
        <PageListLoading />
      </ColdPageList>
    </section>
  );
}

const home = createRoute({
  getParentRoute: () => root,
  path: '/',
  validateSearch: validateHomeSearch,
  loader: async (options) => {
    return loadSpaceHome(options);
  },
  component: Home,
  pendingComponent: HomePending,
  pendingMs: 150,
  pendingMinMs: 300,
});
// Work home (#6474): the same owner list read as the page list, drawn as the spec's Work page.
const work = createRoute({
  getParentRoute: () => root,
  path: '/work',
  validateSearch: validateWorkSearch,
  // Ages and periods are measured from when this list was read, so a render stays pure.
  loader: async (options) => ({ ...(await loadSpaceHome(options)), readAt: Date.now() }),
  component: WorkHome,
  pendingComponent: HomePending,
  pendingMs: 150,
  pendingMinMs: 300,
});
// The list was `/all` before it became the home; an old link or history entry still lands on it.
const allPages = createRoute({
  getParentRoute: () => root,
  path: '/all',
  validateSearch: validateHomeSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/', search, replace: true });
  },
});
/**
 * Timings of opening a page, for whoever profiles it: local performance entries only, no report.
 * The frame appears after `pendingMs` and stays `pendingMinMs`; a fast open never shows it.
 */
const openMarks = { start: 'colab:page-open', frame: 'colab:page-frame', page: 'colab:page-shown' };
function markOpen(name: string, from?: string) {
  performance.mark(name);
  if (from) performance.measure(`${name} (from ${from})`, from, name);
}
/**
 * What the reader sees while a page loads: the real header with the title the list already held (the
 * space home loaded; else the neutral word) and one spinner centred in the page area. It mounts no
 * renderer, frame or page action and fetches nothing. The open has no deadline: the spinner stays
 * while the open progresses and gives way only to the router's error state when it really fails.
 */
/** Set while the opening frame is drawn: the shell then names the page being opened (#5911). */
const OpeningFrame = createContext<(shown: boolean) => void>(() => {});
function PageFrame() {
  const { transport, space } = root.useRouteContext();
  const opening = useContext(OpeningFrame);
  useLayoutEffect(() => {
    opening(true);
    return () => opening(false);
  }, [opening]);
  const pageId = useParams({ strict: false }).pageId;
  // The list the space home last loaded, which the quick switcher also shows at once.
  const listed = new SwitcherSourceStore(transport, space).initial();
  const title =
    listed.state === 'ready' ? listed.pages.find((row) => row.id === pageId)?.title : undefined;
  useEffect(() => markOpen(openMarks.frame, openMarks.start), []);
  return (
    <div data-page-frame="" aria-busy="true">
      <ColabHeader
        page
        remoteMenu={false}
        title={title || text.loading}
        remote={{ deviceName: transport.backendName }}
        home={(brand, name) => (
          <Link to="/" aria-label={name} title={name}>
            {brand}
          </Link>
        )}
      />
      <div className="page-opening">
        <span role="status" aria-label={text.openingPage} className="page-opening-mark">
          <BusyMark />
        </span>
      </div>
    </div>
  );
}
const page = createRoute({
  getParentRoute: () => root,
  path: '/pages/$pageId',
  validateSearch: (search: Record<string, unknown>) => ({
    ...pageSearch(search),
    ...openSearch(search),
  }),
  beforeLoad: () => markOpen(openMarks.start),
  loader: ({ context, params, abortController }) =>
    context.transport.page(params.pageId, abortController.signal),
  // The router keeps the old screen until the load resolves; a slow one gets this frame instead.
  pendingComponent: PageFrame,
  pendingMs: 150,
  pendingMinMs: 300,
  onEnter: () => markOpen(openMarks.page, openMarks.start),
  // A loaded page owns a live connection that closes when the reader leaves it. The router must not
  // keep the match, or entering the page again shows that closed snapshot as Live while it reloads.
  gcTime: 0,
  // Staying on the page (a thread selection rewrites only the fragment) never reloads it: a reload
  // would replace the binding, closing the writer under any send in flight.
  staleTime: Infinity,
  component: Page,
});

const THREAD_FRAGMENT = /^#?t=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const shortPage = createRoute({
  getParentRoute: () => root,
  path: '/short/$prefix',
  // A short link keeps the page's open chapter panel (`?open=`) as well as its one hint.
  validateSearch: (search: Record<string, unknown>) => ({
    ...pageSearch(search),
    ...openSearch(search),
  }),
  loader: async ({ context, params, location }) => {
    if (!validPagePrefix(params.prefix)) throw new Error('Page unavailable');
    const home = await context.transport.spaceHome();
    const known = home.pageIds ?? home.pages.map((page) => ({ pageId: page.id, deleted: false }));
    context.rememberPages?.(known);
    const pages = known
      .filter((page) => page.pageId.startsWith(params.prefix))
      .map((row) => ({
        id: row.pageId,
        deleted: row.deleted,
        title: row.deleted
          ? ''
          : (home.pages.find((page) => page.id === row.pageId)?.title ?? text.unknownPageTitle),
        archived: row.deleted ? false : home.pages.find((page) => page.id === row.pageId)?.archived,
      }));
    if (pages.length === 0) throw new Error('Page unavailable');
    if (pages.length === 1 && !pages[0].deleted)
      throw redirect({
        to: '/pages/$pageId',
        params: { pageId: pages[0].id },
        search: { ...pageSearch(location.search), ...openSearch(location.search) },
        // Inside the app the address is real: a thread the short link names rides to the page.
        ...(THREAD_FRAGMENT.test(location.hash) ? { hash: location.hash.replace(/^#/, '') } : {}),
        replace: true,
      });
    return { pages, prefix: params.prefix };
  },
  component: ShortPageChoice,
});
function ShortPageChoice() {
  const { pages, prefix } = shortPage.useLoaderData();
  const search = shortPage.useSearch();
  const deleted = pages.length === 1 && pages[0].deleted;
  return (
    <NoticeCard
      state={deleted ? 'blocked' : 'waiting'}
      eyebrow={text.pages}
      title={deleted ? 'This page was deleted' : 'Choose a page'}
      testId="short-page-choice"
      actions={
        deleted ? (
          <Link className={ui.action} data-variant="text" to="/">
            Back to pages
          </Link>
        ) : undefined
      }
    >
      {deleted ? (
        <p>Its owner deleted it. Ask them for a new link if you still need it.</p>
      ) : (
        <p>More than one page matches {prefix}. Choose the page you want to open.</p>
      )}
      <ul className="short-page-options">
        {pages.map((page) => (
          <li key={page.id}>
            {page.deleted ? (
              <span aria-disabled="true">
                Deleted page
                <br />
                <code className="tmt-ui-code">{page.id}</code>
              </span>
            ) : (
              <Link to="/pages/$pageId" params={{ pageId: page.id }} search={search}>
                <span>
                  <span className="short-page-title">
                    {page.title}
                    {page.archived ? ' · Archived' : ''}
                  </span>
                  <br />
                  <code className="tmt-ui-code">{page.id}</code>
                </span>
                <ArrowUpRight aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </NoticeCard>
  );
}

// The Design pack is lazy: ordinary Colab pages do not load its catalog or styles. Its pages are
// Colab pages, so the route hands it the embedded page view.
const LazyDesign = lazyRouteComponent(() => import('./design-route.js'), 'DesignRoute');
// Structured pages (#6005) load their block parts and editor only when one opens.
const LazyStructuredPage = lazy(() =>
  import('./structured-page-live.js').then(({ LiveStructuredPage }) => ({
    default: LiveStructuredPage,
  })),
);
function Design() {
  return (
    <EmbeddedPageContext.Provider value={EmbeddedPage}>
      <LazyDesign />
    </EmbeddedPageContext.Provider>
  );
}
const design = createRoute({ getParentRoute: () => root, path: '/design', component: Design });
const designPage = createRoute({
  getParentRoute: () => root,
  path: '/design/$',
  component: Design,
});
const colabSettings = createRoute({
  getParentRoute: () => root,
  path: '/settings',
  component: function ColabSettingsRoute() {
    const { transport } = root.useRouteContext();
    return <ColabSettings management={transport.management} />;
  },
});
const templates = createRoute({
  getParentRoute: () => root,
  path: '/templates',
  component: TemplatesPage,
});
const blocked = createRoute({
  getParentRoute: () => root,
  path: '/blocked',
  loader: () => {
    throw new Error(text.pinMismatch);
  },
});

function Shell() {
  const { transport, space } = root.useRouteContext();
  const router = useRouter();
  // The header, main and footer follow the screen that is drawn, not the location the router is
  // loading: they switch with the new content, never over the old one (#5911). While a slow page
  // draws its opening frame, that frame is the screen.
  const [opening, setOpening] = useState(false);
  const pathname = useRouterState({
    select: (state) =>
      opening ? state.location.pathname : (state.resolvedLocation ?? state.location).pathname,
  });
  const isPage = pathname.startsWith('/pages/');
  const isHome = pathname === '/';
  // Work home (#6474) names itself, as the list does.
  const isWork = pathname === '/work';
  // Colab's own shell has the shared bar's Search on every route, and the bar owns the one shortcut.
  const hostSlot = useContext(ShellHostSlot);
  const ownShell = hostSlot === null;
  const sharedSearch = ownShell || hostSlot.topBarReady();
  // Design owns its docs navigation and header rather than the Colab page/list chrome.
  if (pathname === '/design' || pathname.startsWith('/design/')) return <Outlet />;
  return (
    <RemotePresenceProvider owner={transport.remotePresence}>
      <QuickSwitcherHost
        transport={transport}
        space={space}
        pageId={isPage ? pathname.slice('/pages/'.length) : undefined}
        routeKey={pathname}
        allowed={ownShell || isPage || isHome || isWork}
        shortcut={!sharedSearch}
        navigate={(pageId) => router.navigate({ to: '/pages/$pageId', params: { pageId } })}
        pageHref={(pageId) =>
          router.history.createHref(
            router.buildLocation({ to: '/pages/$pageId', params: { pageId } }).publicHref,
          )
        }
      >
        <ColabShell transport={transport} space={space}>
          {/* The list names its own scope; a page draws its own header. */}
          {!isPage && !isHome && !isWork && (
            <AppHeader
              title={
                pathname.startsWith('/short/')
                  ? text.openAPage
                  : pathname === '/settings'
                    ? text.colabSettings.section
                    : pathname === '/templates'
                      ? text.templates.title
                      : text.error
              }
            />
          )}
          <main className={isPage ? 'page-main' : undefined}>
            <OpeningFrame.Provider value={setOpening}>
              <Outlet />
            </OpeningFrame.Provider>
          </main>
          {/* The sample notice belongs to the local preview's sample pages only, never to a
              paired owner's real list (#6636). */}
          {!isPage && location.pathname.startsWith('/r/') && <footer>{text.mountedNote}</footer>}
          {!isPage && !location.pathname.startsWith('/r/') && transport === previewTransport && (
            <footer>{text.adapter}</footer>
          )}
        </ColabShell>
      </QuickSwitcherHost>
    </RemotePresenceProvider>
  );
}
/** The page route: what only a route can know (its loader data, its search, where the reader came
 * from and the router), handed to the page as props and a `PageRouting`. */
function Page() {
  const router = useRouter();
  const { transport, space } = root.useRouteContext();
  const loaded = page.useLoaderData();
  const search = page.useSearch();
  // The list the reader came from, when it was scoped to a project: history state, not the address.
  const fromScope = useRouterState({
    select: (state) => (state.location.state as { scope?: unknown }).scope,
  });
  const scope = typeof fromScope === 'string' ? fromScope : undefined;
  const routing = useMemo(() => routePageRouting(router), [router]);
  return (
    <OpenPage
      transport={transport}
      space={space}
      loaded={loaded}
      search={search}
      scope={scope}
      routing={routing}
    />
  );
}

/** The page route's own routing: links go to page routes of this router, and the brand and the
 * project crumb link back to the space list. */
function routePageRouting(router: ReturnType<typeof useRouter>): PageRouting {
  return {
    open(route, anchor) {
      void router.navigate({ to: route, search: anchor ? { anchor } : {} });
    },
    pageHref: (pageId, hint) =>
      router.history.createHref(
        router.buildLocation({ to: '/pages/$pageId', params: { pageId }, search: hint }).publicHref,
      ),
    home: (brand, name) => (
      <Link to="/" aria-label={name} title={name}>
        {brand}
      </Link>
    ),
    scopeCrumb: (scope) => (
      <Link to="/" search={{ project: [scope] }} className="colab-scope-crumb" title={scope}>
        {scope}
      </Link>
    ),
  };
}

/** A page hosted inside another view: a chapter in the shell's panel, or a Design page (#5866). It
 * opens the page through the transport as the route would, and gives its live connection up when the
 * host leaves it (back to the summary, the full page, Esc), so one page never holds two. The host may
 * route the page's own links (Design keeps its tree's pages in Design). */
/** A shipped page as the page view draws it before it has a discussion page: its source only. */
const shippedSnapshot = (shipped: ShippedPage): PageSnapshot => ({
  id: `shipped:${shipped.title}`,
  title: shipped.title,
  source: shipped.source,
  sharing: 'private',
  layout: 'column',
});
/** A shipped page's discussion page, drawn with the shipped source: the page's stored copy (and
 * every later version of it) is never shown, only its threads and Chat. */
function withShippedSource(snapshot: PageSnapshot, source: string): PageSnapshot {
  const binding = snapshot.binding;
  return {
    ...snapshot,
    source,
    ...(binding && {
      binding: new Proxy(binding, {
        get(target, key) {
          if (key === 'subscribe')
            return (publish: (view: PageView) => void, failed: (error: Error) => void) =>
              target.subscribe((view) => publish({ ...view, source }), failed);
          const value = Reflect.get(target, key) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    }),
  };
}

function EmbeddedPage({
  pageId,
  shipped,
  anchor,
  routing: hostRouting,
  design,
}: EmbeddedPageProps) {
  const router = useRouter();
  const { transport, space } = root.useRouteContext();
  const host = usePageEnvironment();
  // A shipped page opens its discussion page once found (or made); until then, only its source.
  const [discussion, setDiscussion] = useState<{ for: ShippedPage; id: string | undefined }>();
  const [starting, setStarting] = useState<string>();
  useEffect(() => {
    if (!shipped) return;
    let live = true;
    shipped.find().then(
      (id) => {
        if (live) setDiscussion({ for: shipped, id });
      },
      () => {
        if (live) setDiscussion({ for: shipped, id: undefined });
      },
    );
    return () => {
      live = false;
    };
  }, [shipped]);
  const looked = shipped ? discussion?.for === shipped : true;
  const opened = shipped ? (looked ? discussion!.id : undefined) : pageId;
  const [loaded, setLoaded] = useState<PageSnapshot | 'failed'>();
  useEffect(() => {
    setLoaded(undefined);
    if (!looked) return;
    if (!opened) {
      setLoaded(shipped ? shippedSnapshot(shipped) : 'failed');
      return;
    }
    const abort = new AbortController();
    let held: PageSnapshot | undefined;
    transport.page(opened, abort.signal).then(
      (snapshot) => {
        if (abort.signal.aborted) snapshot.binding?.close();
        else {
          held = snapshot;
          setLoaded(shipped ? withShippedSource(snapshot, shipped.source) : snapshot);
        }
      },
      () => {
        if (!abort.signal.aborted) setLoaded('failed');
      },
    );
    return () => {
      abort.abort();
      held?.binding?.close();
    };
  }, [transport, opened, looked, shipped]);
  // The first Comment or Chat on a shipped page makes its discussion page, then opens it.
  const create = shipped?.create;
  const ensureDiscussion = useMemo(
    () =>
      shipped && create && looked && !opened
        ? async () => {
            setStarting(undefined);
            try {
              const id = await create();
              setDiscussion({ for: shipped, id });
            } catch (failure) {
              setStarting(failure instanceof Error ? failure.message : String(failure));
            }
          }
        : undefined,
    [shipped, create, looked, opened],
  );
  const routing = useMemo<PageRouting>(() => {
    const base: PageRouting = {
      ...routePageRouting(router),
      home: (brand) => brand,
      scopeCrumb: () => null,
    };
    return hostRouting ? hostRouting(base) : base;
  }, [router, hostRouting]);
  const wrap = useRef<HTMLDivElement>(null);
  const environment = useMemo(() => embeddedPageEnvironment(host, () => wrap.current), [host]);
  return (
    <div className="shell-embedded" ref={wrap}>
      {starting && (
        <p className="shell-state" role="alert">
          {starting}
        </p>
      )}
      {loaded === undefined ? (
        <p className="shell-state" role="status">
          <BusyMark /> {text.loading}
        </p>
      ) : loaded === 'failed' ? (
        <p className="shell-state" role="status">
          {text.blocked}
        </p>
      ) : (
        <PageEnvironmentProvider value={environment}>
          <OpenPage
            key={loaded.id}
            embedded
            design={design}
            ensureDiscussion={ensureDiscussion}
            transport={transport}
            space={space}
            loaded={loaded}
            search={anchor ? { anchor } : {}}
            scope={undefined}
            routing={routing}
          />
        </PageEnvironmentProvider>
      )}
    </div>
  );
}

function OpenPage({
  transport,
  space,
  loaded,
  search,
  scope,
  routing,
  embedded = false,
  design = false,
  ensureDiscussion,
}: {
  transport: PageTransport;
  space: string | undefined;
  loaded: PageSnapshot;
  /** The reading or element a link or a shell item opened the page at. */
  search: { read?: string; anchor?: string };
  scope: string | undefined;
  routing: PageRouting;
  /** The page is hosted in a panel of another page: its drawers and menus stay the app's, but the
   * panel already names it, so it keeps only its actions and status. */
  embedded?: boolean;
  /** A Design page (#6060): only the renderer, annotations, discussion and the Chat FAB. The Design
   * header is the page's only header, so there is no page header, `...` row, link bar or work band. */
  design?: boolean;
  /** A Design page with no discussion page yet: the first Comment or Chat makes it, and the page
   * then opens again with it (#6060). */
  ensureDiscussion?: () => Promise<void>;
}) {
  const environment = usePageEnvironment();
  // The renderer's thread handler outlives a render, so it reads the environment through a ref.
  const environmentRef = useRef(environment);
  environmentRef.current = environment;
  const quickSwitcher = useQuickSwitcher();
  const quickSwitcherOwner = useRef(quickSwitcher);
  quickSwitcherOwner.current = quickSwitcher;
  // A reopened binding replaces the loaded snapshot until the route loads a newer one.
  const [reopened, setReopened] = useState<{
    from: typeof loaded;
    next: typeof loaded;
  } | null>(null);
  const snapshot = reopened?.from === loaded ? reopened.next : loaded;
  const replyObserver = useMemo(() => new ReplyNotificationObserver(snapshot), [snapshot]);
  const toolbar = useRef<HTMLElement>(null);
  const [workBandSize, setWorkBandSize] = useState(0);
  const [barLabels, setBarLabels] = useState<readonly string[]>([]);
  const [addingSubpage, setAddingSubpage] = useState(false);
  // A phone viewer's sub-pages, opened from the page menu (#6652).
  const [viewerSheet, setViewerSheet] = useState(false);
  const compactBar = useMedia('(max-width: 900px)');
  const uiTheme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  const [manualStateOpen, setManualStateOpen] = useState(false);
  const addSubpageDraft = useRef<import('./page-list-search.js').SearchEdit | undefined>(undefined);
  const {
    reset: resetPageLinks,
    request: requestPageLink,
    bar: pageLinkBar,
  } = usePageLinks({
    base: () => (publicEntry() ? entryMount().href : location.href),
    space,
    inset: () => toolbar.current?.getBoundingClientRect().bottom ?? 0,
    navigate: routing.open,
  });
  const needsYouMenuFocus = useRef(false);
  const panels = usePagePanels(snapshot.id, snapshot.binding);
  const panelMode = usePanelMode();
  // Handlers the renderer and the keys keep across renders reach the panels through a ref.
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const {
    panel,
    chatOpened,
    chatActivation,
    activeThread,
    toggle,
    show,
    close,
    closeIf,
    clear,
    showThread,
    openChat,
    settleChatActivation,
    setActiveThread,
  } = panels;
  const floatingChat = useRef<HTMLButtonElement>(null);
  const chatOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (panel !== 'chat') chatOpener.current = null;
  }, [panel]);
  const floatingComments = useRef<HTMLButtonElement>(null);
  const discussionMarkerOpener = useRef<string | null>(null);
  useEffect(() => {
    if (panel !== 'comments') discussionMarkerOpener.current = null;
  }, [panel]);
  const [dockPlacement, setDockPlacement] = useState({ right: 24, bottom: 24, height: 44 });
  const updateDockPlacement = useCallback(
    (next: { right: number; bottom: number; height: number }) => {
      setDockPlacement((previous) =>
        previous.right === next.right &&
        previous.bottom === next.bottom &&
        previous.height === next.height
          ? previous
          : next,
      );
    },
    [],
  );
  const closeChat = () => {
    const opener = chatOpener.current;
    (opener?.isConnected ? opener : floatingChat.current)?.focus({ preventScroll: true });
    chatOpener.current = null;
    close();
  };
  const closeComments = () => {
    const marker = discussionMarkerOpener.current;
    const currentRenderer = renderer.current;
    discussionMarkerOpener.current = null;
    floatingComments.current?.focus({ preventScroll: true });
    close();
    if (marker)
      requestAnimationFrame(() => {
        if (panelsRef.current.panel === null) currentRenderer?.focusThread(marker);
      });
  };
  useDockMotion(dockPanel(panel));
  const activateChat = useRef<() => boolean>(() => false);

  // The page's own projects: the picker opens from its chips and from Projects… in the More menu.
  const [projects, setProjects] = useState<{ request: number; from?: DOMRect }>({ request: 0 });
  const openProjects = (from?: DOMRect) =>
    setProjects((previous) => ({ request: previous.request + 1, from }));
  const [metadataDialog, setMetadataDialog] = useState<'creator' | 'questions' | null>(null);
  // Save as template, Template settings and Remove template, and Use template (#5077).
  const [templateDialog, setTemplateDialog] = useState<TemplateDialogKind | null>(null);
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [templateToast, showTemplateToast] = useToast();
  const [conversion, setConversion] = useState<{
    kind: 'convert' | 'revert';
    revision: string;
    count: number;
  } | null>(null);
  const [conversionError, setConversionError] = useState<string>();
  const [conversionBusy, setConversionBusy] = useState(false);
  const conversionLock = useRef(false);
  const conversionPage = useRef(snapshot.id);
  const settleBlocks = useRef<(() => Promise<void>) | undefined>(undefined);
  const setBlockSettler = useCallback((settle: (() => Promise<void>) | undefined) => {
    settleBlocks.current = settle;
  }, []);
  conversionPage.current = snapshot.id;
  useEffect(() => {
    setConversion(null);
    setConversionError(undefined);
  }, [snapshot.id]);
  const [pin, setPin] = useState<PagePinState>();
  const [pinRequest, setPinRequest] = useState<PagePinRequest>();
  const requestPin = (action: PagePinRequest['action']) =>
    setPinRequest((previous) => ({ id: (previous?.id ?? 0) + 1, action }));
  const [view, setView] = useState<PageView>({
    discussionPending: snapshot.discussionPending,
    pageType: snapshot.pageType,
    blocks: snapshot.blocks,
    todoNumbers: snapshot.todoNumbers,
    convertedAt: snapshot.convertedAt,
    shell: snapshot.shell,
    work: snapshot.work,
    owner: snapshot.owner,
    priority: snapshot.priority,
    next: snapshot.next,
    blocked: snapshot.blocked,
    archived: snapshot.archived,
    source: snapshot.source,
    title: snapshot.title,
    originalAuthor: snapshot.originalAuthor,
    creator: snapshot.creator,
    questions: snapshot.questions,
    creationRecipient: snapshot.creationRecipient,
    layout: snapshot.layout,
    layoutReason: snapshot.layoutReason,
    publisherAgent: snapshot.publisherAgent,
    ownData: snapshot.ownData ?? false,
    own: snapshot.own,
    asks: snapshot.asks,
    threads: snapshot.threads,
  });
  async function openConversion(kind: 'convert' | 'revert') {
    const binding = snapshot.binding;
    if (conversionLock.current || !binding?.metadataRevision || !binding.metadata) return;
    const pageId = snapshot.id;
    conversionLock.current = true;
    setConversionError(undefined);
    try {
      if (kind === 'revert') {
        if (!settleBlocks.current) throw new Error('The block editor is still opening.');
        await settleBlocks.current();
      }
      const shown = latest.current;
      const revision = await binding.metadataRevision(shown, 'conversion');
      if (conversionPage.current === pageId)
        setConversion({ kind, revision, count: Object.keys(shown.blocks ?? {}).length });
    } catch (error) {
      if (conversionPage.current === pageId)
        setConversionError(
          error instanceof Error && 'code' in error && error.code === 'COLAB_STALE_BASE'
            ? text.conversion.changed
            : error instanceof Error
              ? error.message
              : text.conversion.readFailed,
        );
    } finally {
      conversionLock.current = false;
    }
  }
  async function submitConversion() {
    if (conversionLock.current || !conversion || !snapshot.binding?.metadata) return;
    const pageId = snapshot.id;
    conversionLock.current = true;
    setConversionBusy(true);
    setConversionError(undefined);
    try {
      await snapshot.binding.metadata(
        conversion.kind === 'convert' ? 'page.convert' : 'page.revert',
        {},
        conversion.revision,
      );
      if (conversionPage.current === pageId) setConversion(null);
    } catch (error) {
      if (conversionPage.current === pageId) {
        setConversion(null);
        setConversionError(
          error instanceof Error && 'code' in error && error.code === 'COLAB_STALE_BASE'
            ? text.conversion.changed
            : error instanceof Error
              ? error.message
              : text.conversion.changeFailed,
        );
      }
    } finally {
      conversionLock.current = false;
      setConversionBusy(false);
    }
  }
  const attachmentDownload = usePageAttachmentDownload(
    snapshot.binding?.files?.attachments,
    view.attachments ?? [],
    () => toolbar.current?.getBoundingClientRect().bottom ?? 0,
  );
  const resetAttachmentDownload = attachmentDownload.reset;
  useEffect(() => {
    resetAttachmentDownload();
  }, [snapshot.id, view.source, resetAttachmentDownload]);
  // The document shows before its threads and asks are verified; until they follow, nothing that
  // reads them speaks (#3894): no count, no band, no Needs you, and the discussion stays shut.
  const discussionPending = !!view.discussionPending;
  useEffect(() => {
    return environment.setTitle(`${view.title || snapshot.title} · ${text.product}`);
  }, [environment, view.title, snapshot.title]);
  // This device remembers which pages it opened, for a quick switcher to offer first; local only.
  useEffect(() => {
    void noteOpened(space, snapshot.id);
  }, [space, snapshot.id]);
  const latest = useRef(view);
  const size = usePageSize(snapshot.binding);
  // The Source draft lives outside the route's state: only the Source drawer renders as it changes.
  const [sourceDraft] = useState(() => new SourceDraft(snapshot));
  const { state: connection, controller: connectionOwner } = useConnection({
    loaded,
    binding: () => snapshot.binding,
    reopen: (signal) => transport.page(loaded.id, signal),
    // A reopened binding replaces the loaded snapshot until the route loads a newer one.
    opened: (next) => setReopened({ from: loaded, next }),
    failed: () => void buildWatch.check(),
  });
  // Anything not connected holds writes; only an ended connection replaces the page with a card.
  const liveError = connection.phase === 'connected' ? null : connection.error;
  const endedError = connection.phase === 'ended' ? connection.error : null;
  const endedPresentation = endedError ? terminalFailure(endedError) : undefined;
  const recoveryRequired = connection.phase === 'reconnecting';
  const connectionPresentation = composerConnection(connection);
  const endedAction = connection.phase === 'ended' ? connection.action : 'none';
  const agents = useAgentPresentation(
    snapshot.binding?.ask,
    snapshot.id,
    !!snapshot.binding && !liveError,
    JSON.stringify({
      asks: (view.asks ?? []).map(({ writer, operationId }) => [writer, operationId]).sort(),
      locks: (view.editLocks ?? [])
        .map((lock) => [lock.holder.id, lock.lockId, lock.revision])
        .sort(),
    }),
  );
  const {
    archived,
    archiveAnnouncement,
    pageOperation,
    setPageOperation,
    pageOperationBusy,
    pageOperationNotice,
    choosingParent,
    setChoosingParent,
    parentPages,
    moveFailure,
    moveUncertain,
    moveBusy,
    movePage,
    retryMove,
    runLifecycle,
  } = usePageWorkflow(transport, snapshot, view, space);
  useEffect(() => {
    sourceDraft.adoptSnapshot(snapshot);
    setView({
      discussionPending: snapshot.discussionPending,
      pageType: snapshot.pageType,
      blocks: snapshot.blocks,
      convertedAt: snapshot.convertedAt,
      shell: snapshot.shell,
      work: snapshot.work,
      archived: snapshot.archived,
      source: snapshot.source,
      title: snapshot.title,
      originalAuthor: snapshot.originalAuthor,
      creator: snapshot.creator,
      questions: snapshot.questions,
      creationRecipient: snapshot.creationRecipient,
      layout: snapshot.layout,
      layoutReason: snapshot.layoutReason,
      publisherAgent: snapshot.publisherAgent,
      ownData: snapshot.ownData ?? false,
      own: snapshot.own,
      asks: snapshot.asks,
      threads: snapshot.threads,
    });
    connectionOwner.reset();
    let firstView = true;
    const unsubscribe = snapshot.binding?.subscribe(
      (value) => {
        // Every update arrives as a fresh copy of the whole page's state; what did not change keeps
        // the identity it had, so only the sections keyed on what changed run again. The view
        // itself is always a new object: a publication with the same data still renders the page,
        // because the binding (its Ask facade, its files) can change without the data changing.
        const next = {
          ...shareView(latest.current, { ...value, ownData: value.ownData ?? false }),
        };
        if (firstView) {
          firstView = false;
          replyObserver.baselineFirstView(next);
        }
        latest.current = next;
        setView(next);
        sourceDraft.adoptUpdate(value.source);
      },
      (error) => connectionOwner.report(error),
    );
    return () => {
      unsubscribe?.();
    };
  }, [snapshot, loaded, transport, connectionOwner, replyObserver, sourceDraft]);
  const refreshSize = size.refresh;
  useEffect(() => {
    if (panel === 'about' || panel === 'source') void refreshSize();
  }, [panel, refreshSize]);
  const toggleSelectionMode = useRef<() => void>(() => {});
  const escapeAnnotation = useRef<() => void>(() => {});
  const chatBusy = useRef(false);
  // Chat's composer holds a send that failed before it was recorded (#5870).
  const [chatUnsent, setChatUnsent] = useState(false);
  const [chatRecovery, setChatRecovery] = useState<ComposerRecovery>();
  const binding = useRef(snapshot.binding);
  const renderer = useRef<Awaited<ReturnType<typeof mountRenderer>> | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const structuredStage = useRef<HTMLDivElement>(null);
  const selectionLayer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!design) return;
    const bar = host.current
      ?.closest('.tmt-ui-shell')
      ?.querySelector<HTMLElement>('.tmt-ui-shell-bar');
    toolbar.current = bar ?? null;
    return () => {
      if (toolbar.current === bar) toolbar.current = null;
    };
  }, [design]);
  binding.current = snapshot.binding;
  const {
    selectionMode,
    setSelectionMode,
    selector,
    currentSelector,
    rectangle,
    currentRectangle,
    annotation,
    annotations,
    unsentAnnotations,
    unsentHighlights,
    openUnsent,
    discardDraft,
    annotationRef,
    popover,
    drafts,
    draftsReady,
    draftsUnsaved,
    keepDraft,
    annotationDraft,
    annotationSending,
    annotationRecorded,
    statusBusy,
    changingStatus,
    setChangingStatus,
    annotate,
    annotationKey,
    closeAnnotation,
    closeRef,
    onSelection,
    openThread,
    continueAnnotation,
  } = useAnnotations({
    snapshot,
    transport,
    binding,
    renderer,
    host,
    structuredStage,
    panels: {
      clear,
      showThread,
    },
  });
  useEffect(() => {
    if (!archived) return;
    setSelectionMode(false);
    closeIf('agents', 'export');
  }, [archived, closeIf, setSelectionMode]);
  const threadOf = (value: { thread?: DiscussionRef } | undefined) =>
    value?.thread
      ? view.threads?.find(
          (thread) =>
            thread.ref.writer === value.thread!.writer && thread.ref.id === value.thread!.id,
        )
      : undefined;
  const annotationThread = threadOf(annotation);
  const numbers = useMemo(() => threadNumbers(view.threads ?? []), [view.threads]);
  // The Comments drawer shows one thread's Discussion view while a thread of this page is selected.
  const discussedThread =
    panel === 'comments' &&
    activeThread !== null &&
    (view.threads ?? []).some(
      (thread) =>
        !isChatThread(thread) && `${thread.ref.writer}:${thread.threadId}` === activeThread,
    );
  // The Discussion header's arrows walk the threads in the order of their numbers, the order of the
  // position it shows.
  const [resolveSlot, setResolveSlot] = useState<HTMLElement | null>(null);
  const [resolveAllSlot, setResolveAllSlot] = useState<HTMLElement | null>(null);
  const [batchStatus, setBatchStatus] = useState<{ generation: number; content: ReactNode } | null>(
    null,
  );
  const [batchGeneration, setBatchGeneration] = useState(0);
  const [threadFilter, setThreadFilter] = useThreadFilter();
  const [agentResolutionNotice, setAgentResolutionNotice] = useState<string>();
  const viewedStatus = useRef<{ id: string; resolved: boolean } | undefined>(undefined);
  useEffect(() => {
    if (panel !== 'comments' || threadFilter !== 'open' || !activeThread) {
      viewedStatus.current = undefined;
      return;
    }
    const thread = (view.threads ?? []).find((item) => threadKey(item) === activeThread);
    if (!thread) return;
    if (
      viewedStatus.current?.id === activeThread &&
      !viewedStatus.current.resolved &&
      thread.resolved &&
      thread.status?.actor === 'agent'
    )
      setAgentResolutionNotice(text.threadResolvedBy(thread.status.agentName ?? 'Agent'));
    viewedStatus.current = { id: activeThread, resolved: thread.resolved };
  }, [panel, threadFilter, activeThread, view.threads]);
  useEffect(() => {
    setAgentResolutionNotice(undefined);
  }, [panel, threadFilter]);
  useEffect(() => {
    setBatchStatus(null);
    setBatchGeneration((generation) => generation + 1);
  }, [panel, activeThread, threadFilter]);
  const listed = useMemo(
    () =>
      listedThreads(
        view.threads ?? [],
        numbers,
        threadFilter,
        activeThread,
        view.threadPresentations,
      ),
    [view.threads, numbers, threadFilter, activeThread, view.threadPresentations],
  );
  useEffect(() => {
    if (panel !== 'comments' || discussionPending || changingStatus) return;
    if (activeThread && listed.some((thread) => threadKey(thread) === activeThread)) return;
    const first = firstThread(listed, view.threadPresentations);
    // Passive projection changes select cosmetically; only a trusted open acknowledges status.
    if (first) setActiveThread(threadKey(first));
    else if (activeThread) setActiveThread(null);
  }, [
    panel,
    discussionPending,
    changingStatus,
    activeThread,
    listed,
    view.threadPresentations,
    setActiveThread,
  ]);
  const position =
    activeThread === null ? -1 : listed.findIndex((t) => threadKey(t) === activeThread);
  const neighbour = (offset: -1 | 1) => (position < 0 ? undefined : listed[position + offset]);
  const openNeighbour = (offset: -1 | 1) => {
    const thread = neighbour(offset);
    if (thread) openThread(thread.ref);
  };
  const openThreads = discussionPending ? undefined : openThreadCount(view.threads ?? []);
  const fileCount = view.attachments?.length ?? 0;
  const unseenThreads = (view.threadPresentations ?? []).some((value) => value.status.unseen);
  const statusCoordinator =
    archived || liveError?.message === managementChanged ? undefined : snapshot.binding?.status;
  const [state, setState] = useState<RenderState | 'loading'>('loading');
  // Read once, so the annotation windows below keep its narrowing.
  const pageBinding = snapshot.binding;
  // The Annotate control shows for a selection when no window is open.
  const annotationControl =
    !annotation && !!snapshot.binding?.ask && !selectionMode && !liveError && state === 'ready';
  // Counts sources the open frame applied in place (#5022): what the page draws over the frame is
  // placed again for each, as it is when a fresh frame becomes ready.
  const [contentRevision, setContentRevision] = useState(0);
  const accessLabel = archived
    ? text.archiveReadOnly
    : recoveryRequired
      ? text.reconnecting
      : state === 'ready'
        ? text.live
        : state === 'loading'
          ? text.loading
          : text.blocked;
  // The thread the address names when the page opens (a link with `#t=`), shown once it exists.
  // Opening a thread later writes the address too, but that is not a link: a change to the threads
  // afterwards must never open Comments again, close Chat or move focus (#6266).
  const deepThread = useRef<{ page: string; thread: string } | null>(null);
  useEffect(() => {
    const target = environment.threadFragment()?.read();
    deepThread.current = target ? { page: snapshot.id, thread: target } : null;
  }, [environment, snapshot.id]);
  useEffect(() => {
    const target = deepThread.current;
    if (state !== 'ready' || target?.page !== snapshot.id) return;
    const thread = view.threads?.find(
      (value) => value.threadId === target.thread && !value.deleted,
    );
    if (!thread) return;
    deepThread.current = null;
    showThread(`${thread.ref.writer}:${thread.ref.id}`);
    renderer.current?.scrollAnchor(`${thread.ref.writer}:${thread.ref.id}`);
  }, [showThread, state, snapshot.id, view.threads]);

  // Author loading does not block discussion: sends use the captured quote.
  const discussionBlocked =
    archived || !!liveError || state === 'failed' || state === 'navigation' || discussionPending;
  const selectable =
    view.pageType !== 'shell' &&
    (!!snapshot.binding?.discussion || !!ensureDiscussion) &&
    state === 'ready';
  const canSelect = selectable && !discussionBlocked;
  // Selecting is offered once the threads are verified; until then its button holds its place.
  const selectPending = selectable && discussionPending && !archived && !liveError;
  activateChat.current = () => {
    if (archived || (panel !== null && panel !== 'chat') || environment.overlayOpen('chat'))
      return false;
    if (ensureDiscussion && !snapshot.binding?.discussion) {
      void ensureDiscussion();
      return true;
    }
    const insertMention = panel !== 'chat';
    if (insertMention)
      chatOpener.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
    openChat(
      !discussionBlocked && !recoveryRequired && !chatBusy.current
        ? { id: crypto.randomUUID(), insertMention }
        : undefined,
    );
    return true;
  };
  escapeAnnotation.current = () => {
    // Chat closes during a send like an anchored window: its composer stays mounted and keeps the
    // send (#5870).
    if (panel === 'chat') closeChat();
    else if (panel === 'comments') {
      if (!statusBusy.current) closeComments();
    } else if (annotationRef.current) closeRef.current(true);
    else if (canSelect) setSelectionMode(false);
  };
  toggleSelectionMode.current = () => {
    if (!canSelect) return;
    // A Design page with no discussion page yet makes it first; select again once it opens.
    if (ensureDiscussion && !snapshot.binding?.discussion) void ensureDiscussion();
    else setSelectionMode((enabled) => !enabled);
  };
  useEffect(() => {
    renderer.current?.selectionMode(canSelect && selectionMode);
  }, [canSelect, selectionMode]);
  /** Reports a block, or text in it, as the selection, placed at `rect` (#6449, #6611). */
  const selectBlock = (value: string | undefined, block: HTMLElement, rect: DOMRect) => {
    const surface = host.current?.parentElement;
    const id = block.dataset.blockId;
    const exact = [...(value ?? '').replace(/\s+/gu, ' ').trim()].slice(0, 512).join('');
    if (!surface || !id) return false;
    const bounds = surface.getBoundingClientRect();
    onSelection(
      { block: id, ...(exact ? { quote: { exact, prefix: '', suffix: '' } } : {}) },
      {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      },
    );
    return true;
  };
  const selectBlockRef = useRef(selectBlock);
  selectBlockRef.current = selectBlock;
  // The text a block selection quotes, and the whole-block annotations from Selection mode, which
  // title their window "Annotate the block"; a text selection's says "Annotate the selection".
  const blockQuote = useRef<Range | null>(null);
  const wholeBlocks = useRef(new Set<string>());
  // A block page's text is its editor, in the parent document: a text selection in one block
  // offers the same Annotate control an HTML page's selection does, without Selection mode (#6611).
  const blockPage = view.pageType === 'blocks';
  useEffect(() => {
    if (!blockPage || !canSelect || selectionMode) return;
    let reported = false;
    blockQuote.current = null;
    const change = () => {
      // An open window moves focus to its composer; that is not a new selection.
      if (annotationRef.current || document.activeElement?.closest('.selection-control')) return;
      const selection = document.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const stage = structuredStage.current;
      const start = range?.startContainer;
      const element = start instanceof Element ? start : start?.parentElement;
      const block = element?.closest<HTMLElement>('[data-block-id]');
      // A selection across blocks anchors to its first block, its quote cut to that block.
      const own = range && block ? range.cloneRange() : null;
      if (own && block && !block.contains(own.endContainer))
        own.setEnd(block, block.childNodes.length);
      const value = own?.toString().trim();
      if (own && !own.collapsed && value && block && stage?.contains(block)) {
        reported = selectBlockRef.current(value, block, own.getBoundingClientRect());
        if (reported) blockQuote.current = own;
      } else if (reported) {
        reported = false;
        onSelection(null, null);
      }
    };
    document.addEventListener('selectionchange', change);
    return () => {
      document.removeEventListener('selectionchange', change);
      if (reported) onSelection(null, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelection only sets state
  }, [blockPage, canSelect, selectionMode, annotationRef]);
  // A block page's window closing (sent, or dismissed) leaves no text selected: the Annotate control
  // leaves with it instead of staying over the page where the selection was (#6636).
  const annotating = !!annotation;
  useEffect(() => {
    if (!blockPage || annotating || !currentSelector.current) return;
    const selection = document.getSelection();
    const anchor = selection?.anchorNode;
    if (selection && !selection.isCollapsed && anchor && structuredStage.current?.contains(anchor))
      return;
    onSelection(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelection only sets state
  }, [blockPage, annotating]);
  // The composer takes focus from the editor, which drops the selection; a decoration keeps the
  // quoted text marked while its window is open, as an HTML page's frame keeps its selection.
  const quoting = !!annotation && !annotation.thread && blockPage;
  useEffect(() => {
    const range = blockQuote.current;
    if (!quoting || !range || range.collapsed || typeof Highlight === 'undefined') return;
    CSS.highlights.set('colab-annotating', new Highlight(range));
    return () => {
      CSS.highlights.delete('colab-annotating');
    };
  }, [quoting, annotation?.key]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable || !!target.closest('input,textarea,select,[role="textbox"]'));
      if (
        !event.isTrusted ||
        quickSwitcherOwner.current?.open ||
        event.defaultPrevented ||
        editing ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        (event.code !== 'KeyC' && event.key !== 'Escape' && event.key !== '@') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.shiftKey && event.key !== '@') ||
        (event.code === 'KeyC' && !canSelect)
      )
        return;
      if (event.key === '@') {
        if (activateChat.current()) event.preventDefault();
        return;
      }
      if (
        event.key === 'Escape' &&
        !panelsRef.current.panel &&
        !annotationRef.current &&
        !selectionMode
      )
        return;
      event.preventDefault();
      if (event.key === 'Escape') escapeAnnotation.current();
      else if (!selectionMode && currentSelector.current && currentRectangle.current) annotate();
      else toggleSelectionMode.current();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [canSelect, selectionMode, annotate, annotationRef, currentSelector, currentRectangle]);
  const { read: readingHint, anchor } = search;
  const {
    readings,
    inlineSlots,
    reviewLayer,
    readingLayer,
    questionLayer,
    onQuestionAnchors,
    onReadingAnchors,
  } = usePageLayers({
    snapshot,
    view,
    binding,
    renderer,
    host,
    state,
    contentRevision,
    discussionBlocked,
    statusCoordinator,
    connectionPresentation,
    readingHint: space ? readingHint : undefined,
  });
  const editLockLayer = useEditLockLayer({
    page: snapshot.id,
    view,
    agents,
    renderer,
    host,
    toolbar,
    state,
    contentRevision,
    admitted: !discussionPending && !liveError && !archived,
  });
  const shownRelease = useContext(ShownReleaseContext);
  const designSystems = useMemo(
    () => pageDesignSystems(transport, shownRelease),
    [transport, shownRelease],
  );
  // An image block reads its attachments as an HTML page's images do: this page's verified list and
  // its attachment binding (#6005 image step).
  const imageBinding = snapshot.binding?.files?.attachments;
  const blockImageSource = useMemo(
    () => ({ binding: imageBinding, descriptors: view.attachments ?? [] }),
    [imageBinding, view.attachments],
  );
  // A mockup block's markup renders in the same sandboxed frame and runtime admission as an HTML
  // page (#6005): never in the parent's DOM.
  const mountMockup = useCallback(
    (
      frameHost: HTMLElement,
      source: string,
      signal: AbortSignal,
      theme?: Theme,
      onReady?: () => void,
    ) =>
      mountRenderer(frameHost, source, {
        signal,
        fitContent: true,
        theme,
        onState: () => onReady?.(),
        onLink: requestPageLink,
        designSystem: {
          release: async (system, lock) => designSystems?.release(system, lock),
          draft: async (system) => {
            if (!designSystems) throw new Error('No design systems here.');
            return designSystems.draft(system);
          },
          watch: (system, changed) => designSystems?.watch(system, changed) ?? (() => {}),
        },
      }),
    [designSystems, requestPageLink],
  );
  const pageViewSource = useMemo(() => {
    if (!transport.management || view.ownerOnlyContent !== true) return undefined;
    const admitted = () => binding.current?.ownerOnlyContent?.() === true;
    return gatePageViewSource(
      (publish, failed) =>
        watchPageView(transport, space, publish, failed, (id) => routing.pageHref(id)),
      admitted,
    );
  }, [transport, space, routing, view.ownerOnlyContent]);
  // The @ picker's other pages (#6208): the same gated page list, and one page opened on choice.
  const atPages = useMemo(() => {
    if (!pageViewSource) return undefined;
    const admitted = () => binding.current?.ownerOnlyContent?.() === true;
    return mentionPages(pageViewSource, (id, signal) => transport.page(id, signal), admitted);
  }, [pageViewSource, transport]);
  const workSource = useMemo(() => {
    if (!transport.management || view.ownerOnlyWorkBundle !== true) return undefined;
    const admitted = () => binding.current?.ownerOnlyWorkBundle?.() === true;
    const source = workBundleSource(transport, space, (id) => routing.pageHref(id));
    return gateWorkBundleSource(source, admitted);
  }, [transport, space, routing, view.ownerOnlyWorkBundle]);
  const {
    resolved: frameResolved,
    anchorsChecked: frameAnchorsChecked,
    pageScheme,
    missingAnchor,
    outline: frameOutline,
  } = usePageRenderer({
    snapshot,
    view,
    endedError,
    host,
    renderer,
    setState,
    toolbar,
    workBandSize,
    // The FAB group and its margin, measured from the window's bottom.
    dockReserve: dockPlacement.bottom + dockPlacement.height,
    anchor,
    layers: {
      onEditLocks: editLockLayer.onEditLocks,
      onSlots: inlineSlots.onSlots,
      onQuestions: onQuestionAnchors,
      onReadings: onReadingAnchors,
    },
    resetPageLinks,
    requestPageLink,
    onContentApplied: () => setContentRevision((count) => count + 1),
    designSystem: designSystems,
    pageView: pageViewSource,
    workBundle: workSource,
    handlers: {
      onSelection,
      onAnnotate: annotate,
      onToggleSelectionMode: () => toggleSelectionMode.current(),
      onKey: (key) => {
        if (quickSwitcherOwner.current?.open) return;
        if (key === 'Escape') escapeAnnotation.current();
        else if (key === '@') activateChat.current();
        else quickSwitcherOwner.current?.activate();
      },
      onOpenThread: (id) => {
        const thread = latest.current.threads?.find(
          (value) => `${value.ref.writer}:${value.threadId}` === id && !value.deleted,
        );
        if (thread) {
          // A direct reference can name a resolved thread or one outside the current filter.
          if (!listed.some((item) => threadKey(item) === id)) setThreadFilter('all');
          if (panelsRef.current.panel !== 'comments') discussionMarkerOpener.current = id;
          openThread(thread.ref);
        }
      },
      onOpenList: (id) => {
        if (panelsRef.current.panel !== 'comments') discussionMarkerOpener.current = id;
        if (annotationRef.current) closeRef.current(false);
        panelsRef.current.show('comments');
      },
      onAttachmentDownload: (id) => attachmentDownload.request(id),
      onImageDownload: (image) => attachmentDownload.requestImage(image),
    },
  });
  const htmlHeadings = useMemo(
    () =>
      (frameOutline?.entries ?? []).map((entry, index) => ({
        id: String(index),
        title: entry.text,
        level: entry.level,
      })),
    [frameOutline],
  );
  const hasHtmlOutline = htmlHeadings.length >= 3;
  const htmlSections = useMemo(
    () => htmlOutlineSections(view.workFacts?.sections ?? [], htmlHeadings),
    [view.workFacts?.sections, htmlHeadings],
  );
  // Each comment thread's to-do (#6474): the line under an Ask's comment.
  const askTodos = useMemo(
    () => askTodoProgress(view.blocks, view.todoNumbers, view.asks ?? []),
    [view.blocks, view.todoNumbers, view.asks],
  );
  const htmlOutline = useRef<HTMLDivElement>(null);
  const [htmlOutlineHeight, setHtmlOutlineHeight] = useState(0);
  useEffect(() => {
    const node = htmlOutline.current;
    if (!node) {
      setHtmlOutlineHeight(0);
      return;
    }
    const measure = () => setHtmlOutlineHeight(node.offsetHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [hasHtmlOutline, view.pageType, design]);
  const locateHtmlHeading = useCallback(
    (id: string) => {
      const index = Number(id);
      const entry = frameOutline?.entries[index];
      const frame = host.current?.querySelector('iframe');
      if (!entry || !frame || !frameOutline) return undefined;
      const version = frameOutline.snapshot;
      return {
        top: () => {
          const frameTop = frame.getBoundingClientRect().top;
          const barBottom = toolbar.current?.getBoundingClientRect().bottom ?? 0;
          // In the bounded inner-scroll mode the frame can begin below the bar. Its own top,
          // rather than the bar, is then the first position an internally scrolled heading reaches.
          const lead = frame.dataset.scrollMode === 'frame' ? Math.max(0, frameTop - barBottom) : 0;
          return frameTop + entry.top - lead;
        },
        scrollTo: () => renderer.current?.scrollOutline(version, index),
      };
    },
    [frameOutline, host, renderer],
  );
  const locateStructuredHeading = useCallback((id: string) => {
    const node = structuredStage.current?.querySelector<HTMLElement>(
      `[data-block-id="${CSS.escape(id)}"]`,
    );
    if (!node) return undefined;
    return {
      top: () => node.getBoundingClientRect().top,
      scrollTo: (keyboard: boolean) => {
        node.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (keyboard) node.focus({ preventScroll: true });
      },
    };
  }, []);
  const [htmlGutter, setHtmlGutter] = useState(false);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const markerLane = 28;
    const authorColumn = 1280;
    const outlineAndGap = 228;
    const measure = () =>
      setHtmlGutter(
        view.layout === 'column' &&
          (node.clientWidth - markerLane - authorColumn) / 2 >= outlineAndGap,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [host, view.layout]);
  // Resolving hides the margin marker; Reopen restores it. Resolved history stays in Comments.
  // A reply or a status change elsewhere leaves this list as it was, so the document is not told
  // to highlight again.
  const highlights = useRef<readonly { id: string; selector: QuoteSelector; ordinal: number }[]>(
    [],
  );
  highlights.current = shareView(
    highlights.current,
    (view.threads ?? []).flatMap((thread) =>
      isStatusThread(thread) && !thread.resolved && thread.anchor && !('block' in thread.anchor)
        ? [
            {
              id: `${thread.ref.writer}:${thread.threadId}`,
              selector: thread.anchor,
              ordinal: numbers.get(`${thread.ref.writer}:${thread.threadId}`)!,
            },
          ]
        : [],
    ),
  );
  const anchoredThreads = highlights.current,
    threadTotal = numbers.size;
  // Structured pages do not have an author frame. Resolve only unambiguous quotes against their
  // visible block text, so a repeated passage never points to the wrong block.
  const structuredBlocks = useMemo(
    () => (view.pageType === 'blocks' && view.blocks ? blockTree(view.blocks).tree.flat() : []),
    [view.pageType, view.blocks],
  );
  const sectionsById = useMemo(
    () => new Map((view.workFacts?.sections ?? []).map((section) => [section.id, section])),
    [view.workFacts?.sections],
  );
  const outlineHeadings = useMemo(
    () =>
      structuredBlocks.flatMap((block) =>
        block.type === 'heading' && block.text?.trim()
          ? [{ id: block.id, title: block.text.trim(), level: block.props.level === 3 ? 3 : 2 }]
          : [],
      ),
    [structuredBlocks],
  );
  const locateBlockQuote = (quote: QuoteSelector) => {
    const candidates = structuredBlocks.filter((block) => {
      const value = block.text?.replace(/\s+/gu, ' ').trim() ?? '';
      const at = value.indexOf(quote.exact);
      return (
        at >= 0 &&
        value.indexOf(quote.exact, at + 1) < 0 &&
        (!quote.prefix || value.slice(0, at).endsWith(quote.prefix)) &&
        (!quote.suffix || value.slice(at + quote.exact.length).startsWith(quote.suffix))
      );
    });
    return candidates.length === 1 ? candidates[0]!.id : undefined;
  };
  const locateBlockAnchor = (anchor: ThreadAnchor) => {
    if (!('block' in anchor)) return locateBlockQuote(anchor);
    const block = structuredBlocks.find((candidate) => candidate.id === anchor.block);
    return block?.id;
  };
  const blockAnchors = (() => {
    const found = new Map<string, { id: string; ordinal: number; open: boolean }[]>();
    if (view.pageType !== 'blocks' || !view.blocks) return found;
    for (const thread of view.threads ?? []) {
      if (thread.deleted || isChatThread(thread) || !thread.anchor) continue;
      const blockId = locateBlockAnchor(thread.anchor);
      if (!blockId) continue;
      const id = `${thread.ref.writer}:${thread.threadId}`;
      const ordinal = numbers.get(id);
      if (ordinal === undefined) continue;
      const list = found.get(blockId) ?? [];
      list.push({ id, ordinal, open: !thread.resolved });
      found.set(blockId, list);
    }
    return found;
  })();
  const resolved =
    view.pageType === 'blocks'
      ? [...blockAnchors.values()].flatMap((items) => items.map((item) => item.id))
      : frameResolved;
  const anchorsChecked = view.pageType === 'blocks' ? !!view.blocks : frameAnchorsChecked;
  const referenceEntries = useRef<readonly { id: string; number: number; excerpt: string }[]>([]);
  referenceEntries.current = shareView(
    referenceEntries.current,
    (view.threads ?? []).flatMap((thread) => {
      if (thread.deleted || isChatThread(thread) || !thread.anchor) return [];
      const id = `${thread.ref.writer}:${thread.ref.id}`;
      const number = numbers.get(id);
      return number === undefined
        ? []
        : [
            {
              id,
              number,
              excerpt: [
                ...(anchorQuote(thread.anchor)?.exact ?? text.block).replace(/\s+/gu, ' ').trim(),
              ]
                .slice(0, 80)
                .join(''),
            },
          ];
    }),
  );
  const admittedReferences = referenceEntries.current;
  useEffect(() => {
    if (state !== 'ready') return;
    renderer.current?.threadReferences([...admittedReferences]);
  }, [state, contentRevision, admittedReferences]);
  // A template's rules show above its blocks only to someone who may edit the page (#6333).
  const showRules = !!view.template && !!snapshot.binding?.canMetadata?.() && !archived;
  useEffect(() => {
    if (state !== 'ready') return;
    renderer.current?.templateRules(showRules);
  }, [state, contentRevision, showRules]);
  // A resolved thread leaves the marker set, but while its Discussion view is open the page keeps a
  // quiet mark on its passage, so the person can see and scroll to what it was about.
  const quietCandidate =
    discussedThread && activeThread !== null
      ? (view.threads ?? []).find(
          (thread) =>
            !isChatThread(thread) &&
            `${thread.ref.writer}:${thread.threadId}` === activeThread &&
            thread.resolved &&
            !thread.deleted &&
            thread.anchor,
        )
      : undefined;
  const quietRef = useRef<{ id: string; selector: QuoteSelector } | undefined>(undefined);
  quietRef.current = shareView(
    quietRef.current,
    quietCandidate?.anchor && !('block' in quietCandidate.anchor)
      ? { id: activeThread!, selector: quietCandidate.anchor }
      : undefined,
  );
  const quietThread = quietRef.current;
  useEffect(() => {
    if (state !== 'ready') return;
    renderer.current?.highlight(
      anchoredThreads as { id: string; selector: QuoteSelector; ordinal: number }[],
      anchorQuote(annotation?.selector),
      threadTotal,
      quietThread,
      unsentHighlights,
    );
  }, [
    state,
    contentRevision,
    anchoredThreads,
    annotation,
    threadTotal,
    quietThread,
    unsentHighlights,
  ]);
  // The passage of the thread whose window or Discussion view is open takes the page's selected look; a window for a new
  // quote or none leaves every passage at rest. The anchors are a dependency so that a thread opened
  // as it is created is selected once the frame holds its passage.
  const openThreadId = annotation?.thread
    ? `${annotation.thread.writer}:${annotation.thread.id}`
    : discussedThread
      ? activeThread
      : null;
  useEffect(() => {
    if (state !== 'ready') return;
    renderer.current?.select(openThreadId);
  }, [state, contentRevision, anchoredThreads, openThreadId]);
  // A modal drawer makes the page-level card inert, so an ended connection also speaks in the
  // drawer: the same sentence and action under its header. A reconnecting page shows nothing.
  const endedNotice = endedError && (
    <div className="drawer-recovery" role="status" data-tone={endedPresentation?.state}>
      <span className="drawer-recovery-state">
        <span aria-hidden="true">{endedPresentation?.state === 'inactive' ? '○ ' : '✗ '}</span>
        {text.blocked}
      </span>
      <EndedBody error={endedError} action={endedAction} compact />
      <EndedLink action={endedAction} />
    </div>
  );
  const notificationScope = JSON.stringify([
    space ?? '',
    snapshot.id,
    snapshot.binding?.discussion?.deviceId ?? '',
  ]);
  const notificationClassification = { questionThreads: questionLayer.notificationThreads };
  const chatScope = snapshot.binding?.discussion?.scope;
  const notifications = useReplyNotifications({
    pageKey: notificationScope,
    observer: replyObserver,
    sources: view,
    deviceId: snapshot.binding?.discussion?.deviceId,
    classification: notificationClassification,
    blocked: archived || !!endedError,
    chatReadingAllowed: panel === 'chat' && !quickSwitcher?.open && !recoveryRequired,
    chatScope: chatScope
      ? JSON.stringify([
          chatScope.spaceId,
          chatScope.pageId,
          chatScope.epoch,
          snapshot.binding?.discussion?.deviceId,
        ])
      : undefined,
    activate: (event) => {
      if (panel || annotationRef.current?.thread || statusBusy.current) return false;
      if (event.destination === 'Chat') {
        if (annotationRef.current) closeRef.current(false);
        openChat();
      } else if (event.destination === 'Answer') {
        return questionLayer.activateNotification(event);
      } else if (event.thread) openThread(event.thread);
      else return false;
      return true;
    },
  });
  const filterLabels: Record<ThreadFilter, string> = {
    open: text.commentsViewOpen,
    needs: text.needsYouWord,
    all: text.commentsViewAll,
  };
  const threadFilterMenu = (
    <BrowserMenu
      label={text.commentsFilter}
      triggerText={filterLabels[threadFilter]}
      disabled={changingStatus}
      items={(['open', 'needs', 'all'] as const).map((key) => ({
        key,
        label: filterLabels[key],
        role: 'menuitemradio' as const,
        checked: key === threadFilter,
      }))}
      onSelect={(filter) => {
        setThreadFilter(filter);
        const first = firstThread(
          listedThreads(view.threads ?? [], numbers, filter, null, view.threadPresentations),
          view.threadPresentations,
        );
        if (first) openThread(first.ref, { revealInPage: false });
        else setActiveThread(null);
      }}
    />
  );
  const attentionBinding = snapshot.binding?.discussion;
  const attentionScope = attentionBinding?.scope;
  const attentionVersions = useNeedsYouVersions(view.source, [
    ...readingLayer.items
      .filter((item) => inlineSlots.readingIds.has(item.id))
      .map((item) => ({
        ...item,
        kind: 'reading' as const,
        agents: [readings.find((reading) => reading.id === item.id)?.agent ?? ''].filter(Boolean),
      })),
    ...(view.questions === undefined
      ? questionLayer.navigation
      : (verifiedQuestionStates(view) ?? [])
          .filter((question) => question.state === 'open' && questionLayer.attached(question.id))
          .map((question) => ({
            kind: 'answer' as const,
            version: JSON.stringify([question, questionLayer.version(question.id)]),
            state: 'unanswered' as const,
            id: question.id,
            title: question.title ?? question.id,
            agents: [question.agent?.name ?? view.creator?.agent.name ?? ''].filter(Boolean),
          }))),
    ...reviewLayer.navigation,
  ]);
  const needsYouItems: NeedsYouCandidate[] = pendingNeedsYou(
    attentionVersions.items,
    view.questions !== undefined,
    attentionScope && attentionBinding
      ? readNeedsYouAcknowledgements(view.own ?? {}, attentionScope, attentionBinding.deviceId)
      : new Set(),
  );
  const hierarchy = usePageHierarchy({
    transport,
    space,
    pageId: snapshot.id,
    work: view.work,
    pageHref: (pageId) => routing.pageHref(pageId),
  });
  // The parent link and sub-pages toggle, drawn in the bar's status details (#6652); the same
  // owner draws the Add window outside them, so the page menu's Add sub-page works while closed.
  const workBand = (dialogOnly: boolean, close?: () => void, viewer?: { defaultOpen: boolean }) => (
    <PageWorkBand
      dialogOnly={dialogOnly}
      defaultOpen={viewer?.defaultOpen}
      work={view.work}
      priority={view.priority}
      owner={view.owner}
      // A viewer's sub-pages stand alone; its parent is in the page menu.
      beforeSubpages={viewer ? undefined : hierarchy.parent}
      workFacts={view.workFacts}
      blockedReason={view.blocked}
      pageState={view.state === undefined ? (view.pageState ?? 'todo') : view.state}
      binding={archived || liveError ? undefined : snapshot.binding}
      transport={transport}
      space={space}
      pageId={snapshot.id}
      title={view.title}
      pageHref={routing.pageHref}
      openPage={(id) => routing.open(`/pages/${id}`)}
      adding={dialogOnly && addingSubpage}
      addDraft={addSubpageDraft}
      onAddingChange={(open) => {
        if (!open) addSubpageDraft.current = undefined;
        // The Add window replaces the status details it was opened from.
        if (open) close?.();
        setAddingSubpage(open);
      }}
    />
  );
  const workControls = !design;
  const barStatus =
    !design && showsComputedStatus(archived || liveError ? undefined : snapshot.binding);
  // Without a status chip to open, the bar offers the sub-pages alone (#6652): a chip up to the
  // phone width, then the page menu's Sub-pages (N), which opens them as a sheet.
  const viewerSubpages = workControls && !barStatus && hierarchy.hasSubpages;
  // The page's section progress beside its status (#6619): done sections over counted ones.
  const pageSections = view.workFacts?.sections;
  const pageSectionTotals = pageSections?.length ? sectionTotals(pageSections) : undefined;
  const projectControls = (
    <PageProjects
      transport={transport}
      space={space}
      pageId={snapshot.id}
      title={view.title || snapshot.title}
      request={projects.request}
      from={projects.from}
      pinRequest={pinRequest}
      onPinState={setPin}
      onProjects={setBarLabels}
    />
  );
  // What the row under the title showed, now opened from the bar's status chip (#6652).
  const barDetails = (sheet: boolean, close: () => void) => (
    <PageStatusDetails
      facts={view.workFacts}
      blocked={view.blocked}
      owner={view.owner}
      priority={view.priority}
      next={view.next}
      sections={pageSectionTotals}
      links={workBand(false, close)}
      change={
        archived || liveError
          ? undefined
          : snapshot.binding?.changeTitleMatch?.bind(snapshot.binding)
      }
      projects={sheet ? barLabels : undefined}
      onProjects={
        sheet
          ? (from) => {
              close();
              openProjects(from);
            }
          : undefined
      }
    />
  );
  const content = (
    <section
      className="page"
      style={{ '--colab-work-band-size': `${workBandSize}px` } as React.CSSProperties}
    >
      <BrowserNotifications
        pageKey={notificationScope}
        events={notifications.events}
        suspended={
          notifications.activating ||
          panel !== null ||
          !!annotation?.thread ||
          notifications.modalCount > 0 ||
          recoveryRequired ||
          quickSwitcher?.open === true
        }
        isEligible={notifications.isEligible}
      />
      {!design && (
        <ColabHeader
          embedded={embedded}
          remoteMenu={false}
          remoteChip={false}
          headingSuffix={
            <>
              {view.template && (
                <span className="template-badge" data-kind="template">
                  {text.templates.templateChip}
                </span>
              )}
              {/* The page's number, title, status and labels stay in the bar while it scrolls
                  (#6611); #6520 had left only the product and the author there. */}
              <PageBarSummary
                facts={view.workFacts}
                status={barStatus}
                subpages={
                  viewerSubpages ? workBand(false, undefined, { defaultOpen: false }) : undefined
                }
                labels={barLabels}
                details={workControls ? barDetails : undefined}
                onLabels={openProjects}
              />
            </>
          }
          crumb={scope === undefined ? undefined : routing.scopeCrumb(scope)}
          barRef={toolbar}
          page
          title={view.title || snapshot.title || text.unknownPageTitle}
          // The page's heading is its own title below; the bar repeats it without a second h1.
          accessibleTitle={view.title || snapshot.title || text.unknownPageTitle}
          workNumber={snapshot.workNumber}
          remote={{ deviceName: transport.backendName }}
          home={routing.home}
          status={
            <div className="page-header-meta">
              {attentionVersions.failed && <span role="status">{text.needsYouUnavailable}</span>}
              <NeedsYouHeader
                ready={
                  !discussionPending &&
                  questionLayer.ready &&
                  reviewLayer.ready &&
                  readingLayer.ready &&
                  attentionVersions.ready
                }
                menuFocus={needsYouMenuFocus}
                href={(item) =>
                  routing.pageHref(
                    snapshot.id,
                    item.kind === 'reading' ? { read: item.id } : undefined,
                  )
                }
                items={needsYouItems}
                onClear={
                  !discussionBlocked && attentionBinding?.acknowledgeNeedsYou
                    ? async (items) => {
                        const heldBinding = attentionBinding;
                        for (const item of items.filter((item) => item.kind === 'reading')) {
                          const reading = readings.find((reading) => reading.id === item.id);
                          if (!reading || !(await readingLayer.actions.mark(reading, false)))
                            throw new Error(text.needsYouClearFailed);
                        }
                        if (binding.current?.discussion !== heldBinding)
                          throw new Error(text.needsYouClearFailed);
                        await heldBinding.acknowledgeNeedsYou!(
                          items.filter((item) => item.kind !== 'reading').map(needsYouTarget),
                        );
                      }
                    : undefined
                }
                onPick={(item) => {
                  if (item.kind === 'reading') readingLayer.jump(item.id, true);
                  else if (item.kind === 'answer') {
                    if (!questionLayer.open(item.targetId ?? item.id))
                      setMetadataDialog('questions');
                  } else if (item.kind === 'review') reviewLayer.jump(item.id);
                }}
              />
              {/* The connection state is not shown (a notice below the header carries trouble); its words
                stay in the document for assistive technology and as the page's readiness signal. */}
              <span
                className={`status page-connection tmt-ui-visually-hidden ${state === 'ready' ? 'live' : ''}`}
              >
                {archived ? '○ ' : `${text[snapshot.sharing]} · `}
                <span className="status-label">{accessLabel}</span>
              </span>
              <RemoteAttention />
              {archived ? (
                <span
                  className="page-attention"
                  data-attention="archived"
                  title={text.archiveReadOnlyHint}
                >
                  <span aria-hidden="true">○</span>
                  <span className="page-attention-word">{text.archived}</span>
                </span>
              ) : (
                snapshot.sharing !== 'private' && (
                  <span className="page-attention" data-attention="shared">
                    <span aria-hidden="true">◉</span>
                    <span className="page-attention-word">{text.shared}</span>
                  </span>
                )
              )}
            </div>
          }
          actions={
            <>
              {view.template && transport.management && !archived && (
                <span className="page-use-template">
                  <BrowserAction
                    type="button"
                    variant="primary"
                    presentation="compact"
                    label={text.templates.useTemplate}
                    leadingIcon={<CopyPlus aria-hidden="true" />}
                    onActivate={() => setUsingTemplate(true)}
                  />
                </span>
              )}
              <PageHeaderActions
                template={
                  transport.management &&
                  snapshot.binding?.canMetadata?.() &&
                  state === 'ready' &&
                  !archived &&
                  !liveError &&
                  !view.pageType
                    ? view.template
                      ? 'template'
                      : 'save'
                    : undefined
                }
                files={fileCount}
                readOnly={archived}
                access={`${archived ? '○ ' : `${text[snapshot.sharing]} · `}${accessLabel}`}
                canExport={!!snapshot.binding && !liveError && !archived}
                canManage={!!transport.management}
                canFiles={!!snapshot.binding?.files}
                canProjects={!!transport.management}
                canArchive={!!transport.management && !archived && !liveError}
                canMove={
                  !!snapshot.binding?.work &&
                  !!snapshot.binding.canWork?.() &&
                  !archived &&
                  !liveError
                }
                canAddSubpage={
                  !design &&
                  !hierarchy.hasSubpages &&
                  !!snapshot.binding?.work &&
                  !!snapshot.binding.canWork?.() &&
                  !archived &&
                  !liveError
                }
                canSetPageState={
                  !design &&
                  !!snapshot.binding?.canWork?.() &&
                  !!snapshot.binding?.canMetadata?.() &&
                  !!snapshot.binding?.metadata &&
                  !!snapshot.binding?.metadataRevision &&
                  (view.state === undefined ? view.pageState : view.state) != null &&
                  state === 'ready' &&
                  !archived &&
                  !liveError
                }
                parentTitle={hierarchy.parentPage?.title}
                subpageCount={viewerSubpages && compactBar ? hierarchy.subpageCount : undefined}
                pin={pin}
                creatorLabel={creatorName(view)}
                showSource={view.pageType !== 'blocks'}
                onConvert={
                  snapshot.binding?.canMetadata?.() &&
                  state === 'ready' &&
                  !archived &&
                  !liveError &&
                  !view.pageType &&
                  !view.template
                    ? () => void openConversion('convert')
                    : undefined
                }
                onRevert={
                  snapshot.binding?.canMetadata?.() &&
                  state === 'ready' &&
                  !archived &&
                  !liveError &&
                  view.pageType === 'blocks' &&
                  view.convertedAt !== undefined
                    ? () => void openConversion('revert')
                    : undefined
                }
                onSelect={(action) => {
                  if (action === 'subpages') {
                    setViewerSheet(true);
                  } else if (action === 'open-parent' && hierarchy.parentPage) {
                    routing.open(`/pages/${hierarchy.parentPage.id}`);
                  } else if (action === 'add-subpage') {
                    setAddingSubpage(true);
                  } else if (action === 'page-state') {
                    setManualStateOpen(true);
                  } else if (action === 'put-under') {
                    setChoosingParent(true);
                  } else if (action === 'archive') {
                    setPageOperation('page.archive');
                  } else if (action === 'creator' || action === 'questions') {
                    close();
                    setMetadataDialog(action);
                  } else if (action === 'projects') openProjects(moreButtonRect());
                  else if (action === 'pin') requestPin('toggle');
                  else if (action === 'template-save') setTemplateDialog('save');
                  else if (action === 'template-settings') setTemplateDialog('settings');
                  else if (action === 'template-remove') setTemplateDialog('remove');
                  else toggle(action);
                }}
              />
            </>
          }
        />
      )}
      <BrowserDrawer
        open={manualStateOpen}
        title={text.workBand.pageState}
        panel="page-state"
        onDismiss={() => setManualStateOpen(false)}
      >
        <PageStateMenu
          binding={snapshot.binding}
          state={view.state === undefined ? view.pageState : view.state}
        />
      </BrowserDrawer>
      <TemplateDialogs
        key={`template:${snapshot.id}`}
        kind={templateDialog}
        pageId={snapshot.id}
        view={view}
        binding={snapshot.binding}
        management={transport.management}
        onDismiss={() => setTemplateDialog(null)}
        onDone={(message) => {
          setTemplateDialog(null);
          showTemplateToast(message);
        }}
      />
      <NewPageDialog
        open={usingTemplate}
        onClose={() => setUsingTemplate(false)}
        focusFallback={() => null}
        management={transport.management}
        initialTemplate={snapshot.id}
        onCreated={(pageId) => routing.open(`/pages/${pageId}`)}
      />
      <Toast message={templateToast} />
      <MetadataDialogs
        key={snapshot.id}
        kind={metadataDialog}
        view={view}
        binding={snapshot.binding}
        onDismiss={() => setMetadataDialog(null)}
      />
      {conversion &&
        (conversion.kind === 'convert' ? (
          <StructuredConversionDialog
            busy={conversionBusy}
            onCancel={() => setConversion(null)}
            onConfirm={() => void submitConversion()}
          />
        ) : (
          <StructuredRevertDialog
            blockCount={conversion.count}
            busy={conversionBusy}
            onCancel={() => setConversion(null)}
            onConfirm={() => void submitConversion()}
          />
        ))}
      {conversionError && (
        <div className="page-lifecycle-notice">
          <BrowserNotice
            tone="blocked"
            announcement="alert"
            stateLabel={text.conversion.failed}
            mark={<X aria-hidden="true" />}
            body={conversionError}
          />
        </div>
      )}
      <PagePinNotice failure={pin?.failure} close={() => requestPin('dismiss')} />
      {choosingParent && (
        <AddSubpageDialog
          mode="parent"
          title={view.title || snapshot.title}
          pages={parentPages}
          nowUnder={
            parentPages
              ? pageLocation(
                  parentPages.find((page) => page.id === snapshot.id) ?? snapshot,
                  parentPages,
                )
              : undefined
          }
          refusal={(candidate) =>
            parentPages ? parentRefusal(snapshot.id, candidate, parentPages) : { kind: 'self' }
          }
          onClose={() => setChoosingParent(false)}
          onChoose={(choice) =>
            choice.kind === 'attach'
              ? movePage(choice.pageId, choice.title)
              : Promise.resolve(text.workBand.moveUnknown)
          }
        />
      )}
      {moveFailure && (
        <div className="page-lifecycle-notice">
          <BrowserNotice
            tone="blocked"
            announcement="alert"
            stateLabel={text.workBand.moveNotMoved}
            mark={<X aria-hidden="true" />}
            body={text.workBand.moveFailed(moveFailure.title)}
            actions={
              <BrowserAction
                type="button"
                variant="secondary"
                label={text.workBand.retry}
                disabled={moveBusy}
                onActivate={() => void retryMove()}
              />
            }
          />
        </div>
      )}
      {moveUncertain && (
        <div className="page-lifecycle-notice">
          <BrowserNotice
            tone="waiting"
            announcement="status"
            stateLabel={text.workBand.moveUnconfirmed}
            mark={<CircleHelp aria-hidden="true" />}
            body={text.workBand.moveUnknown}
          />
        </div>
      )}
      <PageOperationDialog
        operation={pageOperation}
        titles={[view.title || snapshot.title]}
        busy={pageOperationBusy}
        onConfirm={() => void runLifecycle()}
        onCancel={() => setPageOperation(undefined)}
      />
      {(archived || pageOperationNotice) && (
        <div className="page-lifecycle-notice">
          <BrowserNotice
            tone={pageOperationNotice?.failed ? 'blocked' : 'muted'}
            announcement={pageOperationNotice?.failed ? 'alert' : 'status'}
            stateLabel={
              pageOperationNotice?.failed
                ? text.pageList.operationFailed
                : archived
                  ? text.pageList.archiveState
                  : text.pageList.operationState
            }
            mark={
              pageOperationNotice?.failed ? (
                <X aria-hidden="true" />
              ) : (
                <Archive aria-hidden="true" />
              )
            }
            body={pageOperationNotice?.text ?? text.archiveAnnouncement}
            actions={
              archived && transport.management ? (
                <BrowserAction
                  type="button"
                  variant="secondary"
                  label={text.pageList.restoreButton}
                  onActivate={() => setPageOperation('page.unarchive')}
                />
              ) : undefined
            }
          />
        </div>
      )}
      <p role="status" className="archive-announcement tmt-ui-visually-hidden">
        {archiveAnnouncement}
      </p>
      <ExportPanel
        key={`export:${snapshot.id}`}
        binding={snapshot.binding}
        designSystems={designSystems}
        blocked={!!liveError}
        drawer
        notice={endedNotice}
        opened={panel === 'export'}
        changeOpen={(open) => (open ? show('export') : close())}
      />
      <ManagePage
        pageId={snapshot.id}
        title={view.title || snapshot.title}
        open={panel === 'manage'}
        close={() => close()}
        changed={(operation) => {
          // Archive commits invalidate sync; verified read catch-up keeps this draft owner mounted.
          if (operation === 'page.archive') return;
          snapshot.binding?.close();
          connectionOwner.report(new Error(managementChanged));
        }}
      />
      <BrowserDrawer
        notice={endedNotice}
        focusFallback={environment.focusFallback}
        open={panel === 'about'}
        title={text.aboutPage}
        panel="about"
        onDismiss={() => close()}
      >
        <section aria-labelledby="about-author-heading">
          <h3 id="about-author-heading">{text.aboutAuthor}</h3>
          <PageAttribution
            creator={view.creator}
            creationRecipient={view.creationRecipient}
            originalAuthor={view.originalAuthor}
            publisherAgent={view.publisherAgent}
          />
        </section>
        <PageLayoutSection layout={view.layout} reason={view.layoutReason} />
        <PageSizeSection size={size} exportPage={() => show('export')} />
        <section aria-labelledby="about-scripts-heading">
          <h3 id="about-scripts-heading">{text.aboutScripts}</h3>
          <p>{text.warning}</p>
        </section>
      </BrowserDrawer>
      <div className="workspace">
        {workControls && (
          <>
            <MobileWorkTitle
              title={view.title || snapshot.title}
              workNumber={snapshot.workNumber}
              onSize={setWorkBandSize}
            />
            {/* The project picker and the Add sub-page window, opened from the bar, its sheet and
                the page menu (#6652); neither draws anything until asked. */}
            {projectControls}
            {workBand(true)}
            {viewerSubpages && compactBar && (
              <UiTheme theme={uiTheme}>
                <Sheet open={viewerSheet} onOpenChange={setViewerSheet}>
                  <SheetContent side="bottom" className="page-bar-sheet">
                    <SheetTitle>{text.pageBar.subpagesItem(hierarchy.subpageCount)}</SheetTitle>
                    <div className="page-status-links">
                      {workBand(false, undefined, { defaultOpen: true })}
                    </div>
                  </SheetContent>
                </Sheet>
              </UiTheme>
            )}
          </>
        )}
        {!design && pageLinkBar}
        {attachmentDownload.bar}
        <div
          className={view.pageType === 'blocks' ? 'canvas canvas-structured' : 'canvas'}
          data-layout={framedLayout(view.layout) ? view.layout : undefined}
          style={{ '--html-outline-height': `${htmlOutlineHeight}px` } as React.CSSProperties}
        >
          {missingAnchor && (
            <p className="page-anchor-missing" role="status">
              {text.anchorMissing}
            </p>
          )}
          {/* A first comment that failed after its window closed is said here, never only on the
              quote: Open shows that window with the failed row, its draft and Retry (#5816). */}
          {(unsentAnnotations.length > 0 ||
            (chatUnsent && panel !== 'chat') ||
            (draftsReady &&
              ((panel !== 'chat' && unconfirmedDrafts(drafts.current, 'chat').length > 0) ||
                (panel !== 'comments' &&
                  unconfirmedDrafts(drafts.current, 'comment').length > 0)))) && (
            <ul className="page-unsent" role="alert">
              {(['chat', 'comment'] as const).flatMap((kind) =>
                panel === (kind === 'chat' ? 'chat' : 'comments')
                  ? []
                  : unconfirmedDrafts(drafts.current, kind).map((item) => (
                      <li key={item.key}>
                        <X aria-hidden="true" className="page-unsent-mark" />
                        <span>
                          {text.messageInterrupted} {quoteExcerpt(item.text)}
                        </span>
                        <BrowserAction
                          type="button"
                          variant="text"
                          label={text.annotationUnsentOpen}
                          onActivate={(event) => {
                            if (!event.isTrusted) return;
                            if (kind === 'chat') openChat();
                            else show('comments');
                          }}
                        />
                      </li>
                    )),
              )}
              {/* A Chat message that failed after Chat closed is said the same way (#5870). */}
              {chatUnsent && panel !== 'chat' && (
                <li key="chat">
                  <X aria-hidden="true" className="page-unsent-mark" />
                  <span>{text.chatUnsent}</span>
                  <BrowserAction
                    type="button"
                    variant="text"
                    label={text.annotationUnsentOpen}
                    onActivate={(event) => {
                      if (event.isTrusted) openChat();
                    }}
                  />
                </li>
              )}
              {unsentAnnotations.map((item) => (
                <li key={item.key}>
                  <X aria-hidden="true" className="page-unsent-mark" />
                  <span>
                    {text.annotationUnsent(
                      quoteExcerpt(anchorQuote(item.selector)?.exact ?? text.block),
                    )}
                  </span>
                  <BrowserAction
                    type="button"
                    variant="text"
                    label={text.annotationUnsentOpen}
                    onActivate={(event) => {
                      if (event.isTrusted) openUnsent(item.key);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {!design && view.pageType !== 'blocks' && hasHtmlOutline && (
            <div ref={htmlOutline} className="html-outline" data-compact={!htmlGutter || undefined}>
              <PageOutline
                headings={htmlHeadings}
                locate={locateHtmlHeading}
                compact={!htmlGutter}
                sections={htmlSections}
              />
            </div>
          )}
          <div className="frame-host" ref={host} hidden={view.pageType === 'blocks'} />
          {view.pageType === 'blocks' && view.blocks && (
            <div
              className="structured-layout"
              data-outline={outlineHeadings.length >= 3 || undefined}
            >
              <Suspense fallback={null}>
                <PageOutline
                  headings={outlineHeadings}
                  locate={locateStructuredHeading}
                  sections={view.workFacts?.sections}
                />
                <div
                  className="structured-page-stage"
                  ref={structuredStage}
                  onKeyDownCapture={(event) => {
                    if (
                      event.key !== 'Tab' ||
                      event.shiftKey ||
                      !annotationControl ||
                      !blockQuote.current
                    )
                      return;
                    const button =
                      selectionLayer.current?.querySelector<HTMLButtonElement>('button');
                    if (button) {
                      event.preventDefault();
                      event.stopPropagation();
                      button.focus();
                    }
                  }}
                  data-annotation-mode={(canSelect && selectionMode) || undefined}
                >
                  <LazyStructuredPage
                    onSettle={setBlockSettler}
                    blocks={view.blocks}
                    todoNumbers={view.todoNumbers}
                    seq={view.seq}
                    annotationMode={canSelect && selectionMode}
                    sections={sectionsById}
                    annotations={blockAnchors}
                    onOpenAnnotation={(id) => {
                      const thread = latest.current.threads?.find(
                        (value) => `${value.ref.writer}:${value.threadId}` === id && !value.deleted,
                      );
                      if (thread) openThread(thread.ref, { revealInPage: false });
                    }}
                    onAnnotateBlock={(value, block, whole) => {
                      blockQuote.current = null;
                      if (!selectBlock(value, block, block.getBoundingClientRect())) return;
                      if (whole && currentSelector.current)
                        wholeBlocks.current.add(JSON.stringify(currentSelector.current));
                      annotate();
                    }}
                    binding={liveError || archived ? undefined : snapshot.binding}
                    workSource={workSource}
                    mentionPages={atPages}
                    blockPageHref={(page, block) =>
                      `${new URL(routing.pageHref(page), window.location.href).href}#block-${block}`
                    }
                    pageViewSource={pageViewSource}
                    mountMockup={mountMockup}
                    imageSource={blockImageSource}
                    onDownloadFile={(id) => attachmentDownload.request(id)}
                    questionPage={{
                      title: view.title || snapshot.title,
                      questions: view.questions,
                      threads: view.threads,
                      discussionPending: view.discussionPending,
                      creator: view.creator,
                      creationRecipient: view.creationRecipient,
                      originalAuthor: view.originalAuthor,
                      asks: view.asks,
                      discussion: snapshot.binding?.discussion,
                      ask: snapshot.binding?.ask,
                      blocked: !!(liveError || archived),
                      metadata:
                        snapshot.binding && !liveError && !archived
                          ? { view, binding: snapshot.binding }
                          : undefined,
                    }}
                    onLink={(href, newTab) =>
                      requestPageLink(
                        { type: 'colab.render.link', renderId: crypto.randomUUID(), href, newTab },
                        true,
                      )
                    }
                  />
                </div>
              </Suspense>
            </div>
          )}
          {editLockLayer.layer}
          {!discussionPending && (
            <>
              {reviewLayer.inline}
              {readingLayer.inline}
              <div className="page-cards" data-theme={pageScheme}>
                {questionLayer.inline}
              </div>
            </>
          )}
          {(state === 'navigation' || state === 'failed') && (
            <NoticeCard
              state={endedPresentation?.state ?? 'blocked'}
              stateLabel={endedPresentation?.state === 'inactive' ? text.notConnected : undefined}
              eyebrow={text.product}
              title={text.blocked}
              actions={
                <EndedLink action={endedAction} primary={endedPresentation?.state === 'inactive'} />
              }
            >
              {endedError ? (
                <EndedBody error={endedError} action={endedAction} />
              ) : (
                <>
                  <p>{state === 'navigation' ? text.navigation : text.failed}</p>
                  {state === 'failed' &&
                    new TextEncoder().encode(view.source).length > MAX_RENDER_SOURCE_BYTES && (
                      <p>{text.limit}</p>
                    )}
                </>
              )}
            </NoticeCard>
          )}
        </div>
        <BrowserPanel
          keepMounted
          focusFallback={environment.focusFallback}
          open={panel === 'comments'}
          mode={panelMode}
          data-floating-discussion=""
          style={
            {
              '--discussion-right': `${dockPlacement.right}px`,
              '--discussion-bottom': `calc(${dockPlacement.bottom + dockPlacement.height}px + var(--tmt-ui-space-l))`,
            } as React.CSSProperties
          }
          closeLabel={text.discussionClose}
          closeTooltipLabel={text.discussionClose}
          title={text.discussion}
          caption={
            <>
              {discussedThread && position >= 0 && (
                <span className="discussion-position">
                  {text.discussionPosition(position + 1, listed.length)}
                </span>
              )}
              {threadFilterMenu}
            </>
          }
          headerActions={
            discussedThread && numbers.get(activeThread!) !== undefined ? (
              <>
                <BrowserIconAction
                  type="button"
                  variant="text"
                  label={text.discussionPrevious}
                  icon={<ChevronLeft />}
                  disabled={!neighbour(-1)}
                  onActivate={(event) => {
                    if (event.isTrusted) openNeighbour(-1);
                  }}
                />
                <BrowserIconAction
                  type="button"
                  variant="text"
                  label={text.discussionNext}
                  icon={<ChevronRight />}
                  disabled={!neighbour(1)}
                  onActivate={(event) => {
                    if (event.isTrusted) openNeighbour(1);
                  }}
                />
                <span className="discussion-separator" aria-hidden="true" />
                <span className="discussion-header-slot" ref={setResolveSlot} />
                <span className="discussion-header-slot" ref={setResolveAllSlot} />
                <span className="discussion-separator" aria-hidden="true" />
              </>
            ) : undefined
          }
          data-panel="comments"
          data-discussion={discussedThread || undefined}
          onDismiss={(reason) => {
            if (reason === 'close') closeComments();
            else escapeAnnotation.current();
          }}
        >
          {endedNotice && <div className="panel-notice">{endedNotice}</div>}
          {discussionPending && !liveError && (
            <p role="status" className="discussion-pending">
              {text.discussionPending}
            </p>
          )}
          <SavedDrafts
            archived={archived}
            drafts={
              discussionPending
                ? []
                : [
                    ...savedDrafts(drafts.current, view.threads),
                    ...unconfirmedDrafts(drafts.current, 'comment'),
                  ]
            }
            discard={discardDraft}
          />
          {draftsUnsaved && (
            <p role="status" className="annotation-hint saved-drafts-notice">
              {text.draftsNotSaved}
            </p>
          )}
          {!discussionPending && (
            <>
              {agentResolutionNotice && <p role="status">{agentResolutionNotice}</p>}
              <AskTodoContext.Provider value={askTodos}>
                <ThreadPanel
                  connectionPresentation={connectionPresentation}
                  archived={archived}
                  creationRecipient={creatorTarget(view)}
                  hideHeader
                  numbers={numbers}
                  key={`discussion:${snapshot.id}:${draftsReady}`}
                  threads={(view.threads ?? []).filter((thread) => !isChatThread(thread))}
                  resolved={resolved}
                  anchorsChecked={anchorsChecked}
                  selection={anchorQuote(selector) ?? null}
                  binding={
                    liveError?.message === managementChanged
                      ? undefined
                      : snapshot.binding?.discussion
                  }
                  ask={liveError?.message === managementChanged ? undefined : snapshot.binding?.ask}
                  title={view.title || snapshot.title}
                  asks={view.asks ?? []}
                  active={activeThread}
                  close={closeComments}
                  headerSlot={resolveSlot}
                  batchStatus={
                    batchStatus?.generation === batchGeneration ? batchStatus.content : null
                  }
                  showInPage={(ref) => {
                    // The panel stays: it is beside or over the page, not a modal that hides it.
                    const thread = view.threads?.find(
                      (item) => item.ref.writer === ref.writer && item.ref.id === ref.id,
                    );
                    const block = thread?.anchor && locateBlockAnchor(thread.anchor);
                    if (block)
                      structuredStage.current
                        ?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(block)}"]`)
                        ?.scrollIntoView({ block: 'start' });
                    else renderer.current?.scrollAnchor(`${ref.writer}:${ref.id}`);
                  }}
                  presentations={view.threadPresentations}
                  onStatusChange={
                    statusCoordinator
                      ? (thread, resolved) => statusCoordinator.change(thread, resolved)
                      : undefined
                  }
                  onBusy={(busy) => {
                    statusBusy.current = busy;
                    setChangingStatus(busy);
                  }}
                  draft={(ref) => drafts.current.get(`${ref.writer}:${ref.id}`)}
                  onDraft={(ref, edit) => keepDraft(`${ref.writer}:${ref.id}`, edit)}
                  blocked={discussionBlocked}
                />
              </AskTodoContext.Provider>
              <ResolveAllThreads
                headerSlot={resolveAllSlot}
                threads={(view.threads ?? []).filter(isOpenThread)}
                coordinator={
                  (view.threadPresentations ?? []).some((value) => value.status.controllable)
                    ? statusCoordinator
                    : undefined
                }
                blocked={discussionBlocked || changingStatus}
                onReport={(content) =>
                  setBatchStatus(content === null ? null : { generation: batchGeneration, content })
                }
              />
            </>
          )}
        </BrowserPanel>
      </div>
      {(canSelect || (state === 'ready' && !liveError)) && (
        <PageFloatingActions
          host={
            view.pageType === 'blocks'
              ? ((host.current?.parentElement as HTMLDivElement | null | undefined) ?? null)
              : host.current
          }
          slots={inlineSlots.positions}
          enabled={selectionMode}
          discussionOpen={!!annotation}
          panel={panel}
          toggle={() => toggleSelectionMode.current()}
          chatUnread={notifications.chatUnread}
          chatButton={floatingChat}
          toggleChat={() => {
            if (ensureDiscussion && !snapshot.binding?.discussion) {
              void ensureDiscussion();
              return;
            }
            if (panel !== 'chat') chatOpener.current = floatingChat.current;
            toggle('chat');
          }}
          comments={openThreads}
          unseen={unseenThreads}
          commentsButton={floatingComments}
          toggleComments={() => {
            discussionMarkerOpener.current = null;
            const selected = (view.threads ?? []).find(
              (thread) =>
                !thread.deleted && !isChatThread(thread) && threadKey(thread) === activeThread,
            );
            const target = selected ?? firstThread(listed, view.threadPresentations);
            if (panel !== 'comments' && target) openThread(target.ref, { revealInPage: false });
            else toggle('comments');
          }}
          onPlacement={updateDockPlacement}
          canSelect={canSelect}
          selectPending={selectPending}
        />
      )}
      {pageBinding?.discussion && (annotations.length > 0 || annotationControl) && (
        <SelectionAnnotation
          element={selectionLayer}
          host={
            view.pageType === 'blocks'
              ? (host.current?.parentElement as HTMLDivElement | null)
              : host.current
          }
          structured={view.pageType === 'blocks'}
          rectangle={annotation?.rectangle ?? rectangle}
          inset={toolbar.current?.offsetHeight ?? 0}
          noticeVisible={state === 'navigation' || state === 'failed'}
          toggleVisible={canSelect}
          open={annotate}
          expanded={!!annotation}
          control={annotationControl}
          thread={annotationThread?.threadId}
          arrivals={
            annotationThread
              ? annotationThread.comments.length +
                (view.asks ?? []).filter(
                  (ask) => ask.thread === annotationThread.threadId && ask.reply !== undefined,
                ).length
              : 0
          }
        >
          {annotations.map((item) => {
            const shown = item.key === annotation?.key;
            const itemThread = shown ? annotationThread : threadOf(item);
            return (
              <section
                key={item.key}
                className="annotation-new"
                role="dialog"
                aria-label="Annotate selection"
                hidden={!shown}
                ref={shown ? popover : undefined}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Escape' &&
                    event.isTrusted &&
                    !event.defaultPrevented &&
                    !event.repeat &&
                    !event.nativeEvent.isComposing &&
                    event.keyCode !== 229 &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    escapeAnnotation.current();
                  }
                }}
              >
                <ThreadWindow
                  connectionPresentation={connectionPresentation}
                  archived={archived}
                  thread={itemThread}
                  number={
                    itemThread
                      ? numbers.get(`${itemThread.ref.writer}:${itemThread.threadId}`)
                      : undefined
                  }
                  anchor={item.selector ?? undefined}
                  wholeBlock={
                    !!item.selector && wholeBlocks.current.has(JSON.stringify(item.selector))
                  }
                  layout="anchored"
                  attached={
                    view.pageType === 'blocks' && !item.thread
                      ? !!item.selector && !!locateBlockAnchor(item.selector)
                      : resolved.includes(
                          item.thread ? `${item.thread.writer}:${item.thread.id}` : '',
                        )
                  }
                  anchorsChecked={anchorsChecked}
                  selection={anchorQuote(selector) ?? null}
                  binding={pageBinding.discussion}
                  ask={pageBinding.ask}
                  asks={view.asks ?? []}
                  title={view.title || snapshot.title}
                  close={() => {
                    if (annotationRef.current?.key === item.key) closeAnnotation(true);
                  }}
                  blocked={discussionBlocked}
                  observationUnavailable={view.askUnavailable}
                  status={
                    itemThread
                      ? presentationOf(view.threadPresentations, itemThread.ref)?.status
                      : undefined
                  }
                  onStatusChange={
                    itemThread && statusCoordinator
                      ? (resolved) => statusCoordinator.change(itemThread, resolved)
                      : undefined
                  }
                  onBusy={(busy) => {
                    if (annotationRef.current?.key !== item.key) return;
                    statusBusy.current = busy;
                    setChangingStatus(busy);
                  }}
                  composer={
                    <>
                      {item.restored !== undefined && <p className="annotation-hint">Draft kept</p>}
                      {draftsUnsaved && <p className="annotation-hint">{text.draftsNotSaved}</p>}
                      {itemThread && <p className="annotation-reply-label">Reply</p>}
                      <AnnotationInput
                        connectionPresentation={connectionPresentation}
                        archived={archived}
                        creationRecipient={creatorTarget(view)}
                        binding={pageBinding.ask}
                        discussion={pageBinding.discussion}
                        anchor={itemThread ? itemThread.anchor : item.selector}
                        thread={itemThread}
                        asks={view.asks ?? []}
                        title={view.title || snapshot.title}
                        blocked={discussionBlocked || changingStatus || !!itemThread?.deleted}
                        recoveryRequired={
                          recoveryRequired && !changingStatus && !itemThread?.deleted
                        }
                        initialEdit={item.restored}
                        onDraft={(_value, edit) => {
                          // A hidden window's composer still owns its draft (a failed row's text).
                          if (annotationRef.current?.key === item.key)
                            annotationDraft.current = edit;
                          keepDraft(annotationKey(item), edit);
                        }}
                        onBusy={(busy) => annotationSending(item.key, busy)}
                        onRecorded={() => annotationRecorded(item.key)}
                        cancel={() => closeAnnotation(true)}
                        committed={(ref) => continueAnnotation(item.key, ref)}
                      />
                    </>
                  }
                />
              </section>
            );
          })}
        </SelectionAnnotation>
      )}
      {snapshot.binding?.files && (
        <FilesSurface
          notice={endedNotice}
          focusFallback={environment.focusFallback}
          open={panel === 'files'}
          onDismiss={() => close()}
          descriptors={view.attachments ?? []}
          files={snapshot.binding.files}
          readOnly={archived}
          disabled={!!liveError}
          afterSave={() => sourceDraft.saveSettled ?? Promise.resolve(true)}
        />
      )}
      <PageSource
        draft={sourceDraft}
        binding={snapshot.binding}
        latest={latest}
        size={size}
        open={panel === 'source'}
        notice={endedNotice}
        focusFallback={environment.focusFallback}
        archived={archived}
        disabled={!!liveError}
        onDismiss={() => close()}
        exportPage={() => show('export')}
      />
      <BrowserDrawer
        notice={endedNotice}
        focusFallback={environment.focusFallback}
        open={panel === 'agents'}
        title={text.agentStatus}
        panel="agents"
        onDismiss={() => close()}
      >
        <AgentStatusPanel
          open={panel === 'agents'}
          binding={snapshot.binding?.ask}
          page={snapshot.id}
          admitted={!!snapshot.binding && !liveError}
        />
      </BrowserDrawer>
      <AttachmentDropPanel key={`chat-drop:${snapshot.id}`} target="chat" active={panel === 'chat'}>
        <BrowserPanel
          keepMounted
          focusFallback={() => floatingChat.current ?? environment.focusFallback()}
          open={panel === 'chat'}
          mode={panelMode}
          data-floating-discussion=""
          data-panel="chat"
          style={
            {
              '--discussion-right': `${dockPlacement.right}px`,
              '--discussion-bottom': `calc(${dockPlacement.bottom + dockPlacement.height}px + var(--tmt-ui-space-l))`,
            } as React.CSSProperties
          }
          title="Chat"
          caption={text.chatVisible}
          onDismiss={(reason) => {
            if (reason === 'close') closeChat();
            else escapeAnnotation.current();
          }}
        >
          {archived && endedNotice && <div className="panel-notice">{endedNotice}</div>}
          {chatOpened && discussionPending && !liveError && (
            <p role="status" className="discussion-pending">
              {text.discussionPending}
            </p>
          )}
          {chatOpened && !discussionPending && (
            <ChatPanel
              connectionPresentation={connectionPresentation}
              archived={archived}
              creationRecipient={creatorTarget(view)}
              key={`chat:${snapshot.id}:${draftsReady}`}
              initialEdit={drafts.current.get(CHAT_DRAFT)}
              activation={
                panel === 'chat' &&
                draftsReady &&
                chatActivation &&
                !discussionBlocked &&
                !chatBusy.current
                  ? {
                      ...chatActivation,
                      consumed: () => settleChatActivation(chatActivation.id),
                    }
                  : undefined
              }
              onBusy={(busy) => {
                chatBusy.current = busy;
              }}
              onUnsent={setChatUnsent}
              recovered={chatRecovery}
              onDraft={(edit) => keepDraft(CHAT_DRAFT, edit)}
              unsaved={draftsUnsaved}
              recovery={
                unconfirmedDrafts(drafts.current, 'chat').length ? (
                  <SavedDrafts
                    drafts={unconfirmedDrafts(drafts.current, 'chat')}
                    discard={discardDraft}
                    archived={archived}
                    restore={
                      archived
                        ? undefined
                        : (key) => {
                            const edit = drafts.current.get(key);
                            if (!edit) return;
                            setChatRecovery({
                              id: key,
                              edit: structuredClone(edit),
                              consumed: () => {
                                discardDraft(key);
                                setChatRecovery(undefined);
                              },
                            });
                          }
                    }
                    restoreDisabled={chatUnsent}
                  />
                ) : undefined
              }
              observationUnavailable={view.askUnavailable}
              threads={view.threads ?? []}
              asks={view.asks ?? []}
              binding={liveError?.message === managementChanged ? undefined : snapshot.binding?.ask}
              discussion={
                liveError?.message === managementChanged ? undefined : snapshot.binding?.discussion
              }
              title={view.title || snapshot.title}
              blocked={discussionBlocked}
              recoveryRequired={recoveryRequired}
              close={closeChat}
              escape={() => escapeAnnotation.current()}
            />
          )}
        </BrowserPanel>
      </AttachmentDropPanel>
    </section>
  );
  const creatorScope = JSON.stringify([
    space ?? '',
    snapshot.id,
    loaded.binding?.discussion?.deviceId ?? '',
  ]);
  return (
    <CreatorDefaultProvider key={creatorScope} scope={creatorScope}>
      <ReplyNotificationContext
        value={{
          ...notifications.context,
          headerBottom: () => toolbar.current?.getBoundingClientRect().bottom ?? 0,
          blockSurface:
            notifications.modalCount ||
            annotation?.thread ||
            recoveryRequired ||
            quickSwitcher?.open
              ? 'covered'
              : panel === 'comments'
                ? 'comments'
                : panel
                  ? 'covered'
                  : 'page',
        }}
      >
        <QuickSwitcherModalPresence />
        <AgentPresentation value={agents}>
          <AgentActivityProvider
            observation={liveError || archived ? undefined : view.agentActivity}
            messages={liveError || archived ? undefined : view.messageStates}
          >
            {view.pageType === 'shell' ? (
              <section className="page">
                <AppHeader
                  page
                  title={view.title || snapshot.title}
                  remote={{ deviceName: transport.backendName }}
                />
                <main className="canvas">
                  {(view.shell || !endedError) && (
                    <ShellPage
                      shell={view.shell}
                      embed={embedded ? undefined : (pageId) => <EmbeddedPage pageId={pageId} />}
                    />
                  )}
                  {endedError && <EndedBody error={endedError} action={endedAction} />}
                </main>
              </section>
            ) : (
              <PendingMessageContext
                value={
                  transport.drafts ? pendingMessageStore(transport.drafts, snapshot.id) : undefined
                }
              >
                {content}
              </PendingMessageContext>
            )}
          </AgentActivityProvider>
        </AgentPresentation>
      </ReplyNotificationContext>
    </CreatorDefaultProvider>
  );
}
/**
 * Colab's history inside the TMT web app. Another route's address (`/ops`, Home) is never Colab's
 * location: the router keeps the last Colab one, so a module kept while another route shows never
 * loads, unloads or rewrites a page for that address (#5954).
 */
function shellHistory() {
  let last: ReturnType<typeof createBrowserHistory>['location'] | undefined;
  const history = createBrowserHistory({
    parseLocation: () => {
      const own = location.pathname === '/colab' || location.pathname.startsWith('/colab/');
      if (last && !own) return last;
      const state = window.history.state;
      last = {
        href: location.pathname + location.search + location.hash,
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
        state: { ...state, __TSR_index: state?.__TSR_index ?? 0 },
      };
      return last;
    },
  });
  // Router pushes update its in-memory location before the browser URL is flushed. Keep that
  // location too, so leaving immediately after an in-app navigation cannot restore a stale page.
  history.subscribe(({ location: next }) => {
    if (next.pathname === '/colab' || next.pathname.startsWith('/colab/')) last = next;
  });
  return history;
}

/** The `space` an owner link named, kept by `shellLocation` until the router knows its space. */
let linkSpace: string | undefined;
/**
 * Inside the TMT app Colab's routes are paths under `/colab/`. Links printed or saved before keep
 * working: the preview's `#/pages/<id>` and an owner fragment's `path=` become the same path, with
 * its reading or anchor hint as search keys. The module runs it before anything reads the location
 * (the paired bootstrap keeps only a canonical fragment).
 */
export function shellLocation() {
  const hash = location.hash.slice(1);
  const fragment = new URLSearchParams(hash);
  // An owner link names its space; the router checks it once it knows this space.
  linkSpace = fragment.get('space') ?? undefined;
  const short = /^\/colab\/p\/([A-Za-z0-9_-]{4,64})$/.exec(location.pathname)?.[1];
  let path: string | undefined;
  let keep = '';
  if (hash.startsWith('/')) path = hash;
  else if (fragment.get('path')) path = fragment.get('path')!;
  else if (short) {
    // The short link `/p/<id>` lands here; a thread (`#t=`) stays a fragment for the page.
    path = `/short/${short}`;
    if (fragment.has('t')) keep = location.hash;
  }
  if (!path) return;
  const keys = new URLSearchParams(location.search);
  for (const key of ['read', 'anchor', 'open'])
    if (fragment.has(key)) keys.set(key, fragment.get(key)!);
  const search = keys.size ? `?${keys}` : '';
  if (/^\/(?:all|settings|templates|pages\/[0-9a-f-]+|short\/[A-Za-z0-9_-]{4,64})?$/.test(path))
    history.replaceState(history.state, '', `/colab${path}${search}${keep}`);
}
export function createAppRouter(
  transport: PageTransport,
  space?: string,
  pageIds: readonly { pageId: string; deleted: boolean }[] = [],
) {
  let knownPages = pageIds;
  // An owner link to another space opens the blocked view, never a page of this one.
  if (inShell() && space && linkSpace !== undefined && linkSpace !== space)
    window.history.replaceState(window.history.state, '', '/colab/blocked');
  linkSpace = undefined;
  const history = inShell()
    ? shellHistory()
    : space
      ? createBrowserHistory({
          parseLocation: () => {
            const fragment = new URLSearchParams(location.hash.slice(1));
            const prefix = location.pathname.startsWith('/p/') ? location.pathname.slice(3) : '';
            let path: string;
            let hint: PageHint | undefined;
            if (publicEntry()) {
              try {
                const target = entryOpenTarget();
                const matches = knownPages.filter((row) => row.pageId.startsWith(prefix));
                path = !prefix
                  ? '/'
                  : matches.length === 1 && !matches[0].deleted
                    ? `/pages/${matches[0].pageId}`
                    : `/short/${prefix}`;
                // A thread names a place inside the page; a reading or shell anchor is a page hint.
                if (target && !('thread' in target) && path !== '/') hint = target;
                if (hint && !('read' in hint) && path === '/') hint = undefined;
              } catch {
                path = '/blocked';
              }
            } else {
              path = fragment.get('space') === space ? (fragment.get('path') ?? '/') : '/blocked';
              hint = ownerPageHint(new URL(location.href), space);
            }
            if (!/^\/(?:all|pages\/[0-9a-f-]+|short\/[0-9a-f-]{8,36})?$/.test(path))
              path = '/blocked';
            const search = hint
              ? hintSearch(hint)
              : path === '/'
                ? storedListSearch(window.history.state)
                : '';
            return {
              href: path + search,
              pathname: path,
              search,
              hash: '',
              state: {
                ...window.history.state,
                __TSR_index: window.history.state?.__TSR_index ?? 0,
              },
            };
          },
          createHref: (routerPath) => {
            // The list's search is never part of the address (see `keepListSearch`).
            const path = isListPath(routerPath) ? '/' : routerPath;
            if (!publicEntry()) return ownerReadingHref(path, location.pathname, space);
            const { route, hint } = splitPageHint(path);
            const id = route.replace(/^\/(?:pages|short)\//, '');
            if (route === '/' || !validPagePrefix(id)) return '/colab/';
            const current = location.pathname.startsWith('/p/') ? location.pathname.slice(3) : '';
            const matches = knownPages.filter((row) => row.pageId.startsWith(current));
            const target = route.startsWith('/pages/')
              ? validPagePrefix(current) && matches.length === 1 && matches[0].pageId === id
                ? current
                : shortPageId(
                    id,
                    knownPages.map((row) => row.pageId),
                  )
              : id;
            const tail = hint
              ? hintFragment(hint)
              : target === current && location.hash.startsWith('#t=')
                ? location.hash
                : '';
            return `/p/${target}${tail}`;
          },
        })
      : createHashHistory();
  if (space) keepListSearch(history);
  const router = createRouter({
    routeTree: root.addChildren([
      home,
      work,
      allPages,
      page,
      shortPage,
      colabSettings,
      templates,
      blocked,
      design,
      designPage,
    ]),
    history,
    // Back and Forward return to where a list was scrolled (#6612). Each history entry has its own
    // place, so a new visit to the same address starts at the top as before.
    scrollRestoration: inShell(),
    getScrollRestorationKey: (location) => location.state.__TSR_key ?? location.href,
    // In the TMT app the router's paths sit under /colab/, or at the root when the shell mounted
    // this module for Design at /design/ (#5873), where its /design routes match as they are.
    ...(inShell() ? { basepath: designBase() === '/design' ? '/' : '/colab' } : {}),
    context: { transport, space, rememberPages: (pages) => (knownPages = pages) },
  });
  router.subscribe('onResolved', () => void buildWatch.check());
  return router;
}
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

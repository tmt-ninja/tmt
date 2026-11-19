import { MobileWorkTitle, WorkBand } from './work-band.js';
import { PageBarSummary } from './page-bar-summary.js';
import { PageStatusDetails } from './page-status-details.js';
import { useMedia } from './use-media.js';
import { subpageTree } from './work-tree.js';
import { useEditLockLayer } from './edit-lock-layer.js';
import { renderBlocks } from './blocks-html.js';
import { ShellNotice } from './shell-notice.js';
import { usePageLinks } from './page-link-bar.js';
import { usePageAttachmentDownload } from './page-attachment-download.js';
import { Circle, Info, X, Code2, Paperclip } from 'lucide-react';
import type { AttachmentBinding } from './attachment-service.js';
import { FilesSurface } from './files-panel.js';
import { BrowserDialog, BrowserMenu, BusyMark } from '@tmt/browser-ui/react';
import { ColabHeader } from './colab-header.js';
import { ReaderMetadataInfo } from './reader-metadata.js';
import type { ReaderMetadata } from './link-metadata.js';
import { ReaderSource, type ReaderEdit } from './reader-source.js';
import { NoticeCard } from './notice-card.js';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { mountRenderer, type OutlineSnapshot, type RenderState } from './renderer.js';
import { PageOutline } from './page-outline.js';
import { text } from './strings.js';
import { toolbarInset } from './toolbar-inset.js';
import type { PageView } from './transport.js';
import './reader-app.css';

export type ReaderState =
  | { kind: 'opening' }
  | { kind: 'ready'; view: PageView; pageId?: string }
  | { kind: 'ended' }
  | { kind: 'invalid' }
  | { kind: 'older' }
  | { kind: 'failed' };

/** The shared page has no Ask, export or share controls. Editor links can request source and
 * metadata changes through the owner; they never receive the owner metadata publisher. */
export function ReaderApp({
  state,
  attachments,
  notice,
  canEdit = false,
  accessNote,
  edit,
  metadata,
}: {
  state: ReaderState;
  /** Authorized reads of the page's files; absent until the session is open. */
  attachments?: AttachmentBinding;
  notice?: ReactNode;
  /** The link says it may edit. The serve decides; this only changes what the page offers. */
  canEdit?: boolean;
  accessNote?: string;
  /** Saves page text; absent until the session is open. */
  edit?: ReaderEdit;
  /** A verified link-own request writer, never the owner metadata publisher. */
  metadata?: ReaderMetadata;
}) {
  const [information, setInformation] = useState(false);
  const moreButton = () =>
    document.querySelector<HTMLButtonElement>('.tmt-ui-header button[aria-label="More"]');
  const [files, setFiles] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const shell = state.kind === 'ready' && state.view.pageType === 'shell';
  const structured = state.kind === 'ready' && state.view.pageType === 'blocks';
  const blocks = structured ? state.view.blocks : undefined;
  const blockSource = useMemo(
    () => (structured ? renderBlocks(blocks, 'reader') : null),
    [structured, blocks],
  );
  const sourceEditable = !structured && !shell;
  const phone = useMedia('(max-width: 640px)');
  const mode = canEdit && sourceEditable ? text.readerCanEdit : text.readerOnly;
  const descriptors = state.kind === 'ready' ? (state.view.attachments ?? []) : [];
  const source = state.kind === 'ready' && !shell ? (blockSource ?? state.view.source) : null;
  const title = state.kind === 'ready' ? state.view.title : '';
  const layout = state.kind === 'ready' ? state.view.layout : undefined;
  const [render, setRender] = useState<RenderState | 'loading'>('loading');
  // The rendered page's headings (#6470): the shared reader shows the same outline as the page view.
  const [outline, setOutline] = useState<OutlineSnapshot>();
  const host = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const noteBox = useRef<HTMLElement>(null);
  const statusRow = useRef<HTMLDivElement>(null);
  /** Trusted content above the frame takes room from its viewport-sized minimum. */
  const [noteSize, setNoteSize] = useState(0);
  const [workBandSize, setWorkBandSize] = useState(0);
  const bandSize = useRef(workBandSize);
  bandSize.current = workBandSize;
  useEffect(() => {
    renderer.current?.resize();
  }, [workBandSize]);
  const noteHeight = () => {
    const box = noteBox.current;
    if (!box) return 0;
    const style = getComputedStyle(box);
    return (
      box.getBoundingClientRect().height +
      Number.parseFloat(style.marginTop) +
      Number.parseFloat(style.marginBottom) +
      (statusRow.current?.getBoundingClientRect().height ?? 0)
    );
  };
  const ready = state.kind === 'ready';
  useEffect(() => {
    const box = noteBox.current;
    if (!box) {
      setNoteSize(0);
      return;
    }
    const measure = () => setNoteSize(noteHeight());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (statusRow.current) observer.observe(statusRow.current);
    return () => observer.disconnect();
    // `noteHeight` only reads the note's box, which `ready` decides is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const {
    reset: resetPageLinks,
    request: requestPageLink,
    bar: pageLinkBar,
  } = usePageLinks({
    base: () => location.href,
    inset: () => bar.current?.getBoundingClientRect().bottom ?? 0,
  });
  const attachmentDownload = usePageAttachmentDownload(
    attachments,
    descriptors,
    () => bar.current?.getBoundingClientRect().bottom ?? 0,
  );
  const downloadRequest = useRef(attachmentDownload.request);
  downloadRequest.current = attachmentDownload.request;
  const imageRequest = useRef(attachmentDownload.requestImage);
  imageRequest.current = attachmentDownload.requestImage;
  const resetAttachmentDownload = attachmentDownload.reset;
  useEffect(() => {
    resetAttachmentDownload();
  }, [source, resetAttachmentDownload]);
  const renderer = useRef<Awaited<ReturnType<typeof mountRenderer>> | null>(null);
  const editLockLayer = useEditLockLayer({
    page: state.kind === 'ready' ? (state.pageId ?? 'reader') : 'reader',
    view: state.kind === 'ready' ? state.view : undefined,
    agents: [],
    renderer,
    host,
    toolbar: bar,
    state: render,
    contentRevision: 0,
    admitted: state.kind === 'ready' && !shell,
  });
  const imageInput = useRef({ binding: attachments, descriptors });
  imageInput.current = { binding: attachments, descriptors };
  const imageScope = attachments?.scope?.();
  const imageDescriptors = JSON.stringify(descriptors);
  useEffect(() => {
    renderer.current?.images(imageInput.current);
  }, [attachments, imageDescriptors, imageScope]);
  useEffect(() => {
    if (shell) {
      setRender('ready');
      return;
    }
    if (source === null) return;
    const controller = new AbortController();
    setRender('loading');
    setOutline(undefined);
    resetPageLinks();
    void mountRenderer(host.current!, source, {
      signal: controller.signal,
      layout,
      onState: (next) => {
        if (next !== 'ready') resetPageLinks();
        setRender(next);
      },
      onOutline: setOutline,
      onLink: requestPageLink,
      onAttachmentDownload: (id) => downloadRequest.current(id),
      onImageDownload: (image) => imageRequest.current(image),
      onEditLocks: editLockLayer.onEditLocks,
      // The phone title and reader note scroll away; only the bar is fixed.
      viewportInset: () => toolbarInset(bar.current),
      frameLead: () => noteHeight() + bandSize.current,
    })
      .then((handle) => {
        if (controller.signal.aborted) handle.destroy();
        else {
          renderer.current = handle;
          handle.images(imageInput.current);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setRender('failed');
      });
    return () => {
      controller.abort();
      resetPageLinks();
      renderer.current = null;
    };
  }, [source, shell, layout, resetPageLinks, requestPageLink, editLockLayer.onEditLocks]);
  // The rendered page's outline (#6470): on a phone a bar above the page; otherwise a compact menu
  // button beside the title in the top bar, never over the page's own text.
  const outlineNode =
    state.kind === 'ready' && !shell && (outline?.entries.length ?? 0) >= 3 ? (
      <PageOutline
        headings={outline!.entries.map((entry, index) => ({
          id: String(index),
          title: entry.text,
          level: entry.level,
        }))}
        locate={(id) => {
          const index = Number(id);
          const entry = outline?.entries[index];
          const frame = host.current?.querySelector('iframe');
          if (!entry || !frame || !outline) return undefined;
          return {
            top: () => frame.getBoundingClientRect().top + entry.top,
            scrollTo: () => renderer.current?.scrollOutline(outline.snapshot, index),
          };
        }}
        compact
      />
    ) : undefined;
  // The page's status as its owner's bar shows it (#6679), from what the share carries: the manual
  // state and the owner's own fields. The computed status is owner-local and never reaches a link
  // reader. No stored state and no field: no mark.
  const view = state.kind === 'ready' && !shell ? state.view : undefined;
  const subpages = view
    ? subpageTree((state.kind === 'ready' && state.pageId) || 'reader', view.work, undefined).top
    : [];
  const hasStatus =
    !!view &&
    (view.pageState !== undefined ||
      !!view.owner ||
      (!!view.priority && view.priority !== 'normal') ||
      !!view.next ||
      !!view.blocked ||
      subpages.length > 0);
  const barSummary = view && (
    <PageBarSummary
      status={hasStatus}
      manual={{ state: view.pageState ?? 'todo', blocked: view.blocked || undefined }}
      labels={[]}
      details={() => (
        <PageStatusDetails
          manual={{ state: view.pageState ?? 'todo', blocked: view.blocked || undefined }}
          owner={view.owner}
          priority={view.priority}
          next={view.next}
          links={
            subpages.length > 0 ? (
              <WorkBand
                owner={view.owner}
                priority={view.priority}
                subpages={subpages}
                pageState={view.pageState ?? 'todo'}
              />
            ) : undefined
          }
        />
      )}
    />
  );
  return (
    <>
      {pageLinkBar}
      {attachmentDownload.bar}
      <ColabHeader
        reader
        headingSuffix={
          view ? (
            <>
              {!phone && outlineNode && <span className="reader-outline-bar">{outlineNode}</span>}
              {barSummary}
            </>
          ) : undefined
        }
        brandOnly={state.kind !== 'ready'}
        headerRef={bar}
        caption={
          state.kind === 'ready' && state.view.originalAuthor !== undefined
            ? text.byAuthor(state.view.originalAuthor)
            : undefined
        }
        title={
          state.kind === 'ready'
            ? title || text.unknownPageTitle
            : state.kind === 'opening'
              ? 'Opening page'
              : state.kind === 'ended'
                ? text.readerEnded
                : text.error
        }
        actions={
          <BrowserMenu
            label={text.more}
            popupLayout="grouped"
            items={[
              ...(descriptors.length > 0
                ? [
                    {
                      key: 'files',
                      label: text.files,
                      meta: String(descriptors.length),
                      leadingIcon: <Paperclip />,
                      heading: text.moreGroups.content,
                    },
                  ]
                : []),
              ...(state.kind === 'ready' && edit && sourceEditable
                ? [
                    {
                      key: 'source',
                      label: text.source,
                      leadingIcon: <Code2 />,
                      ...(descriptors.length === 0 ? { heading: text.moreGroups.content } : {}),
                    },
                  ]
                : []),
              {
                key: 'info',
                label: text.readerInfo,
                leadingIcon: <Info />,
                heading: text.moreGroups.page,
                separated:
                  descriptors.length > 0 || (state.kind === 'ready' && !!edit && sourceEditable),
              },
            ]}
            onSelect={(key) => {
              if (key === 'source') setSourceOpen(true);
              else if (key === 'files') setFiles(true);
              else setInformation(true);
            }}
          />
        }
      />
      <main
        style={
          {
            '--reader-note-size': `${noteSize}px`,
            '--colab-work-band-size': `${workBandSize}px`,
          } as CSSProperties
        }
      >
        {state.kind === 'ready' && (
          <div className="reader-status-row" ref={statusRow}>
            <span className="chip" data-mode={canEdit && sourceEditable ? 'edit' : 'read'}>
              {mode}
            </span>
            <span
              className={`status ${render === 'ready' ? 'live' : render === 'loading' ? 'waiting' : 'blocked'}`}
              role="status"
            >
              {render === 'ready' ? (
                <Circle className="status-dot" fill="currentColor" aria-hidden />
              ) : render === 'loading' ? (
                <BusyMark />
              ) : (
                <X aria-hidden />
              )}{' '}
              {render === 'ready'
                ? text.readerLive
                : render === 'loading'
                  ? text.readerLoading
                  : text.readerStopped}
            </span>
          </div>
        )}
        {notice}
        {state.kind === 'ready' && (
          <aside ref={noteBox} className="reader-note" aria-labelledby="reader-note-title">
            <Info aria-hidden />
            <div>
              <p id="reader-note-title" className="reader-note-title">
                {canEdit && sourceEditable ? text.readerNoteTitleEditor : text.readerNoteTitle}
              </p>
              <p className="reader-note-text">
                {accessNote ??
                  (canEdit && sourceEditable ? text.readerNoteEditor : text.readerNote)}
              </p>
            </div>
          </aside>
        )}
        {state.kind === 'ready' && shell ? (
          <ShellNotice pageId={state.pageId} />
        ) : state.kind === 'ready' ? (
          <section className="page">
            <div className="workspace">
              {phone && (
                <MobileWorkTitle title={title || text.unknownPageTitle} onSize={setWorkBandSize} />
              )}
              <div className="canvas">
                {phone && outlineNode && <div className="reader-outline">{outlineNode}</div>}
                <div className="frame-host" ref={host} />
                {editLockLayer.layer}
                {(render === 'navigation' || render === 'failed') && (
                  <NoticeCard state="blocked" eyebrow={mode} title={text.blocked}>
                    <p>{render === 'navigation' ? text.navigation : text.failed}</p>
                    <p>{text.limit}</p>
                  </NoticeCard>
                )}
              </div>
            </div>
          </section>
        ) : (
          <NoticeCard
            state={
              state.kind === 'opening' ? 'opening' : state.kind === 'ended' ? 'ended' : 'blocked'
            }
            eyebrow={mode}
            title={
              state.kind === 'opening'
                ? text.readerOpening
                : state.kind === 'ended'
                  ? text.readerEnded
                  : state.kind === 'older'
                    ? text.readerOlderTitle
                    : text.error
            }
          >
            {state.kind === 'ended' && <p>{text.readerEndedNote}</p>}
            {state.kind === 'invalid' && <p>{text.readerInvalid}</p>}
            {state.kind === 'older' && <p>{text.readerOlder}</p>}
            {state.kind === 'failed' && <p>{text.readerFailed}</p>}
          </NoticeCard>
        )}
      </main>
      <BrowserDialog
        keepMounted
        open={information}
        title={text.readerInfo}
        onDismiss={() => setInformation(false)}
        focusFallback={moreButton}
      >
        <div className="reader-information-panel">
          {state.kind === 'ready' && (
            <ReaderMetadataInfo
              key={metadata?.scope ?? state.pageId ?? 'reader'}
              view={state.view}
              metadata={canEdit ? metadata : undefined}
              onOpen={() => {
                setInformation(false);
                setSourceOpen(false);
                setFiles(false);
              }}
              focusFallback={moreButton}
            />
          )}
          <section>
            <h3>{text.aboutScripts}</h3>
            <p>{text.warning}</p>
          </section>
        </div>
      </BrowserDialog>
      {state.kind === 'ready' && sourceEditable && edit && (
        <ReaderSource
          source={state.view.source}
          edit={edit}
          open={sourceOpen && !shell}
          onDismiss={() => setSourceOpen(false)}
        />
      )}
      {state.kind === 'ready' && (
        <FilesSurface
          focusFallback={moreButton}
          open={files && descriptors.length > 0}
          onDismiss={() => setFiles(false)}
          descriptors={descriptors}
          binding={attachments}
        />
      )}
    </>
  );
}

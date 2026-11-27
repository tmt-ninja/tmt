import './ticket-drawer.css';
import { BrowserDrawer, BrowserIconAction } from '@tmt/browser-ui/react';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { renderBlocks } from './blocks-html.js';
import type { DesignSystemSource } from './design-system.js';
import { mountRenderer } from './renderer.js';
import type { PageSnapshot, PageTransport } from './transport.js';
import { ticketPageByPrefix, type TicketTarget } from './use-ticket-links.js';

export function TicketDrawer({
  target,
  transport,
  current,
  designSystem,
  onDismiss,
  focusFallback,
}: {
  target: TicketTarget;
  transport: PageTransport;
  current: PageSnapshot;
  designSystem?: DesignSystemSource;
  onDismiss(): void;
  focusFallback(): HTMLElement | null;
}) {
  const [loaded, setLoaded] = useState<PageSnapshot | 'unavailable'>();
  const page = target.kind === 'colab' ? target.page : undefined;
  const prefix = target.kind === 'colab' ? target.prefix : undefined;
  const [matched, setMatched] = useState<string>();
  const self = (page ?? matched) === current.id;
  const currentId = current.id;
  useEffect(() => {
    if ((!page && !prefix) || page === currentId) return;
    const controller = new AbortController();
    let held: PageSnapshot | undefined;
    let unsubscribe: (() => void) | undefined;
    const read = async () => {
      const id = page ?? ticketPageByPrefix(await transport.spaceHome(controller.signal), prefix!);
      controller.signal.throwIfAborted();
      if (!id) throw new Error('Page unavailable');
      setMatched(id);
      return id === currentId ? undefined : transport.page(id, controller.signal);
    };
    void read().then(
      (snapshot) => {
        if (!snapshot) return;
        if (controller.signal.aborted) {
          snapshot.binding?.close();
          return;
        }
        held = snapshot;
        setLoaded(snapshot);
        unsubscribe = snapshot.binding?.subscribe(
          (view) => {
            if (!controller.signal.aborted) setLoaded({ ...snapshot, ...view });
          },
          () => {
            if (!controller.signal.aborted) setLoaded('unavailable');
          },
        );
      },
      () => {
        if (!controller.signal.aborted) setLoaded('unavailable');
      },
    );
    return () => {
      controller.abort();
      unsubscribe?.();
      held?.binding?.close();
    };
  }, [page, prefix, currentId, transport]);

  const view = self ? current : loaded;
  let title = 'Colab page';
  if (target.kind === 'github') title = '#' + target.number;
  else if (view && view !== 'unavailable')
    title = target.workNumber ? target.workNumber + ' · ' + view.title : view.title;
  else if (target.workNumber) title = target.workNumber;
  const newTab = target.kind === 'github' ? 'Open on GitHub' : 'Open in new tab';
  return (
    <BrowserDrawer
      open
      title={title}
      panel="ticket-reference"
      focusFallback={focusFallback}
      onDismiss={onDismiss}
      headerActions={
        <BrowserIconAction
          type="button"
          label={newTab}
          variant="text"
          icon={<ExternalLink aria-hidden="true" />}
          onActivate={() => window.open(target.href, '_blank', 'noopener,noreferrer')}
        />
      }
    >
      {target.kind === 'github' ? (
        <p>{target.repository}</p>
      ) : (!page && !prefix) || view === 'unavailable' ? (
        <p role="status">This page could not be opened.</p>
      ) : !view ? (
        <p role="status">Loading page…</p>
      ) : (
        <TicketPageContent snapshot={view} designSystem={designSystem} />
      )}
    </BrowserDrawer>
  );
}

function TicketPageContent({
  snapshot,
  designSystem,
}: {
  snapshot: PageSnapshot;
  designSystem?: DesignSystemSource;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const structured = snapshot.pageType === 'blocks';
  // Paint the drawer's surface in the frame so its scheme measurement follows the viewer.
  const source = structured
    ? renderBlocks(snapshot.blocks, 'reader') +
      '<style>:root{background:var(--tmt-ui-surface-sheet)}body{background:transparent;width:auto;margin-inline:16px}</style>'
    : snapshot.source;
  const images = snapshot.binding?.files?.attachments;
  const descriptors = snapshot.attachments;
  const layout = snapshot.layout;
  const shell = snapshot.pageType === 'shell';
  useEffect(() => {
    if (shell) return;
    const controller = new AbortController();
    setState('loading');
    void mountRenderer(host.current!, source, {
      signal: controller.signal,
      fitContent: true,
      layout,
      designSystem,
      images: { binding: images, descriptors: descriptors ?? [] },
      onState: (state) => {
        if (!controller.signal.aborted) setState(state === 'ready' ? 'ready' : 'failed');
      },
    }).then(
      (handle) => {
        if (controller.signal.aborted) handle.destroy();
      },
      () => {
        if (!controller.signal.aborted) setState('failed');
      },
    );
    return () => controller.abort();
  }, [source, shell, layout, designSystem, images, descriptors]);

  return (
    <>
      {shell || state === 'failed' ? <p role="status">This page could not be previewed.</p> : null}
      {!shell && state === 'loading' ? <p role="status">Loading page…</p> : null}
      <div
        className="colab-ticket-frame"
        data-structured={structured && state === 'ready' ? '' : undefined}
        ref={host}
        hidden={shell || state === 'failed'}
      />
    </>
  );
}

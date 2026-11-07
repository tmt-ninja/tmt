import { useEffect, useState } from 'react';
import { Button, UiTheme } from '../ui/index.js';
import { PageListProjectChip, PageListStageChip } from '../data-table/index.js';

export interface WorkBundlePage {
  title: string;
  href: string;
  summary?: string;
  projects?: readonly string[];
  stage?: string;
  owner?: string;
  needsYou?: boolean;
  updated?: string;
}
export interface WorkBundleTicket {
  label: string;
  href: string;
}
export interface WorkBundleProps {
  page: string;
  number?: number;
  work?: string;
  tickets?: readonly WorkBundleTicket[];
  data?: WorkBundlePage;
  state?: 'loading' | 'ready' | 'unavailable';
  onWorkChange?(value: string): void;
  /** Without it a ticket is a plain link; the host's own link handling decides what it opens. */
  onOpenTicket?(ticket: WorkBundleTicket): void;
}

/** Read-only admission and its single live subscription stay with the host. */
export interface WorkBundleSource {
  subscribe(
    page: string,
    signal: AbortSignal,
    publish: (data: WorkBundlePage | undefined) => void,
    failed: () => void,
  ): () => void;
}

export function ConnectedWorkBundle({
  source,
  ...props
}: Omit<WorkBundleProps, 'data' | 'state'> & { source: WorkBundleSource }) {
  const [view, setView] = useState<{
    page: string;
    state: 'loading' | 'ready' | 'unavailable';
    data?: WorkBundlePage;
  }>({ page: props.page, state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setView({ page: props.page, state: 'loading' });
    let stop: () => void;
    try {
      stop = source.subscribe(
        props.page,
        controller.signal,
        (data) => {
          if (!controller.signal.aborted)
            setView({ page: props.page, state: data ? 'ready' : 'unavailable', data });
        },
        () => {
          if (!controller.signal.aborted) setView({ page: props.page, state: 'unavailable' });
        },
      );
    } catch {
      controller.abort();
      setView({ page: props.page, state: 'unavailable' });
      return;
    }
    return () => {
      controller.abort();
      stop();
    };
  }, [props.page, source]);
  return (
    <WorkBundle
      {...props}
      state={view.page === props.page ? view.state : 'loading'}
      data={view.page === props.page ? view.data : undefined}
    />
  );
}

/** The host resolves page metadata with its existing read admission and updates these props. */
export function WorkBundle({
  page,
  number,
  work = '',
  tickets = [],
  data,
  state = 'ready',
  onWorkChange,
  onOpenTicket,
}: WorkBundleProps) {
  const available = state === 'ready' && data !== undefined;
  return (
    <div className="tmt-block-work-host">
      <UiTheme>
        <article className="tmt-block-work" data-page={page}>
          <header>
            {number !== undefined && <span className="tmt-block-work-number">{number}</span>}
            <div>
              {state === 'loading' ? (
                <span role="status">Loading page…</span>
              ) : available ? (
                <a href={data.href}>{data.title}</a>
              ) : (
                <span>Page not found</span>
              )}
              {available && (
                <div className="tmt-block-work-meta">
                  {data.projects?.map((project) => (
                    <PageListProjectChip key={project} name={project} />
                  ))}
                  {data.stage && <PageListStageChip stage={data.stage} label={data.stage} />}
                  {data.owner && <span>{data.owner}</span>}
                  {data.needsYou && (
                    <span>
                      <span className="tmt-block-work-attention" aria-hidden="true">
                        ◆
                      </span>{' '}
                      Needs you
                    </span>
                  )}
                  {data.updated && <span>{data.updated}</span>}
                </div>
              )}
            </div>
          </header>
          {available && data.summary && <p>{data.summary}</p>}
          {(work || onWorkChange) && (
            <div className="tmt-block-work-field">
              <span>Work</span>
              {onWorkChange ? (
                <textarea
                  aria-label="Work"
                  value={work}
                  onChange={(event) => onWorkChange(event.target.value)}
                />
              ) : (
                <p>{work}</p>
              )}
            </div>
          )}
          {tickets.length > 0 && (
            <div className="tmt-block-work-tickets">
              <span>GitHub</span>
              {tickets.map((ticket) => (
                <Button variant="outline" size="xs" asChild key={ticket.href}>
                  <a
                    href={ticket.href}
                    onClick={(event) => {
                      // A host that confirms or routes the open takes the click over.
                      if (!onOpenTicket) return;
                      event.preventDefault();
                      onOpenTicket(ticket);
                    }}
                  >
                    {ticket.label}
                  </a>
                </Button>
              ))}
            </div>
          )}
        </article>
      </UiTheme>
    </div>
  );
}

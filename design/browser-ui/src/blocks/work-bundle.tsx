import { useEffect, useState } from 'react';

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
  onOpenTicket?(ticket: WorkBundleTicket): void;
}

/** Read-only admission stays with the host. Subscriptions only invalidate this page's data. */
export interface WorkBundleSource {
  read(page: string, signal: AbortSignal): Promise<WorkBundlePage | undefined>;
  watch(page: string, changed: () => void): () => void;
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
    let current: AbortController | undefined;
    let alive = true;
    const refresh = () => {
      current?.abort();
      const request = new AbortController();
      current = request;
      void Promise.resolve()
        .then(() => source.read(props.page, request.signal))
        .then(
          (data) => {
            if (alive && !request.signal.aborted)
              setView({ page: props.page, state: data ? 'ready' : 'unavailable', data });
          },
          () => {
            if (alive && !request.signal.aborted)
              setView({ page: props.page, state: 'unavailable' });
          },
        );
    };
    setView({ page: props.page, state: 'loading' });
    const stop = source.watch(props.page, refresh);
    refresh();
    return () => {
      alive = false;
      current?.abort();
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
                <span key={project}>{project}</span>
              ))}
              {data.stage && <span>{data.stage}</span>}
              {data.owner && <span>{data.owner}</span>}
              {data.needsYou && <span>◆ Needs you</span>}
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
            <button
              type="button"
              key={ticket.href}
              disabled={!onOpenTicket}
              onClick={() => onOpenTicket?.(ticket)}
            >
              {ticket.label}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

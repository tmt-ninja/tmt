import { useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, FileText, Plus } from 'lucide-react';
import { Badge, Button, Surface } from '../ui/index.js';
import { BusyMark } from '../spinner.js';

/** A page row shared by the list pattern and composed list controls. */
export function BrowserPageRow({
  title,
  tags,
  updated,
  unread = false,
  state,
  href,
  onFollow,
}: {
  title: string;
  tags: readonly string[];
  updated: string;
  unread?: boolean;
  state?: 'waiting' | 'blocked';
  href: string;
  onFollow?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a className="pattern-row" href={href} onClick={onFollow} data-unread={unread || undefined}>
      <span className="pattern-row-title">
        {state && (
          <span className="pattern-state" data-tone={state}>
            {state === 'waiting' ? '◆' : '✕'}
          </span>
        )}
        {title}
        {unread && <span className="tmt-ui-visually-hidden"> unread</span>}
      </span>
      <span className="pattern-row-tags">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
      </span>
      <span className="pattern-row-time">{updated}</span>
    </a>
  );
}

export interface WorkBandPage {
  title: string;
  stage: string;
  done: number;
  total: number;
}
/** A page's stage and progress with its expandable sub-page list. */
export function BrowserWorkBand({
  stage,
  done,
  total,
  pages,
  initialOpen = false,
  onAdd,
}: {
  stage: string;
  done: number;
  total: number;
  pages: readonly WorkBandPage[];
  initialOpen?: boolean;
  onAdd?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const percent = total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  return (
    <Surface level="sheet" className="pattern-band">
      <button
        type="button"
        className="pattern-band-bar"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Badge variant="outline">{stage}</Badge>
        <span
          className="pattern-meter"
          role="meter"
          aria-label="Sub-page progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span style={{ width: `${percent}%` }} />
        </span>
        <span className="pattern-muted">
          {done} of {total} done · {pages.length} sub-pages
        </span>
        <ChevronDown aria-hidden="true" data-open={open || undefined} className="pattern-chevron" />
      </button>
      {open && (
        <ul className="pattern-band-pages">
          {pages.map((page) => (
            <li key={page.title}>
              <FileText aria-hidden="true" />
              <span>{page.title}</span>
              <span className="pattern-muted">{page.stage}</span>
              <span className="pattern-muted">
                {page.done}/{page.total}
              </span>
            </li>
          ))}
          <li>
            <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
              <Plus aria-hidden="true" /> Add a sub-page
            </Button>
          </li>
        </ul>
      )}
    </Surface>
  );
}

/** One message's delivery state and optional recovery action. */
export function BrowserMessageRow({
  author,
  children,
  state = 'delivered',
  detail,
  action,
  onAction,
}: {
  author: string;
  children: ReactNode;
  state?: 'delivered' | 'sending' | 'failed' | 'unsent';
  detail: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="pattern-turn" data-state={state === 'delivered' ? undefined : state}>
      <b>{author}</b>
      <p>{children}</p>
      <span
        className={
          state === 'failed'
            ? 'pattern-failed'
            : `pattern-muted${state === 'sending' ? ' pattern-inline' : ''}`
        }
      >
        {state === 'sending' && <BusyMark />}
        {detail}
        {action && (
          <>
            {' '}
            ·{' '}
            <Button type="button" variant="link" size="xs" onClick={onAction}>
              {action}
            </Button>
          </>
        )}
      </span>
    </div>
  );
}

/** State marks and labels retain their semantic tone on every surface. */
export function BrowserStatusLine({
  items,
}: {
  items: readonly { tone: 'working' | 'waiting' | 'review' | 'blocked'; label: string }[];
}) {
  const marks = { working: '●', waiting: '◆', review: '◐', blocked: '✕' };
  return (
    <ul className="docs-status">
      {items.map(({ tone, label }) => (
        <li key={tone} data-tone={tone}>
          {marks[tone]} {label}
        </li>
      ))}
    </ul>
  );
}

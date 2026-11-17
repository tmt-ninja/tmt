import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import { BrowserAvatar } from '@tmt/browser-ui/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { text } from './strings.js';
import type { PageState } from './bootstrap.js';
import type { SubpageCounts, SubpageRow } from './work-tree.js';
import type { PageActivity } from './bootstrap.js';
import type { WorkFactView } from './reading-details.js';
import { relativeTime } from './display-time.js';
import './work-band.css';

const PR_STALE_MS = 10 * 60 * 1000;

/** Owner-local list details, rendered as text rather than authority. */
export function WorkFieldDetails({ fields }: { fields?: PageActivity['fields'] }) {
  if (!fields) return null;
  return (
    <span className="work-field-details">
      {fields.priority && fields.priority !== 'normal' && (
        <span
          aria-label={
            fields.priority === 'high' ? text.workBand.priorityHigh : text.workBand.priorityLow
          }
        >
          {fields.priority === 'high'
            ? text.workBand.priorityHighChip
            : text.workBand.priorityLowChip}
        </span>
      )}
      {fields.owner && <span>{fields.owner.name}</span>}
      {fields.blocked && <span>{text.workBand.blockedNote(fields.blocked)}</span>}
      {fields.next && <span>{text.workBand.nextNote(fields.next)}</span>}
    </span>
  );
}

type RowSlots = Pick<
  WorkBandProps,
  'childrenOf' | 'counts' | 'pageHref' | 'rowState' | 'rowActions'
>;
export interface WorkBandProps {
  onSize?(height: number): void;
  priority?: 'high' | 'normal' | 'low';
  owner?: { id: string; name: string };
  pageState?: PageState | null;
  /** This page's state control, independent of the sub-page list. */
  stateControl?: ReactNode;
  beforeSubpages?: ReactNode;
  /** Direct sub-pages, in order. */
  subpages: readonly SubpageRow[];
  /** The next level under a sub-page, from what the viewer already has; empty when unknown. */
  childrenOf?(id: string): readonly SubpageRow[];
  /** Direct sub-page progress; absent where states are unknown (a share reader). */
  counts?(rows: readonly SubpageRow[]): SubpageCounts;
  /** The address of a page. */
  pageHref?(pageId: string): string;
  /** A sub-page's state chip; the owner's changes that page's state. */
  rowState?(row: SubpageRow): ReactNode;
  /** The ⋯ menu of a row (Open, Detach); absent for a viewer that cannot change links. */
  rowActions?(row: SubpageRow): ReactNode;
  /** Opens the one Add window; absent where this viewer cannot add. */
  onAdd?(): void;
}

/** The page title and work controls scroll together as one content block. */
export function MobileWorkTitle({
  title,
  workNumber,
  onSize,
  children,
  next,
  blocked,
  facts,
}: {
  title: string;
  workNumber?: string;
  onSize(height: number): void;
  children: ReactNode;
  next?: string;
  blocked?: string;
  facts?: WorkFactView;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => onSize(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => {
      observer.disconnect();
      onSize(0);
    };
  }, [onSize]);
  return (
    <div className="page-mobile-title" ref={element}>
      <h1>
        {workNumber && (
          <>
            <span className="colab-work-number">{workNumber}</span>{' '}
          </>
        )}
        {title}
      </h1>
      <div className="page-mobile-title-chips">{children}</div>
      {(next || blocked || facts?.lastActivityAtMs != null) && (
        <div className="page-work-notes">
          {blocked && <span>{blocked}</span>}
          {next && <span>{text.workBand.nextNote(next)}</span>}
          {facts?.lastActivityAtMs != null && (
            <span>
              {text.workBand.lastActivity(relativeTime(facts.lastActivityAtMs, facts.asOfMs))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkPullChips({ facts }: { facts?: WorkFactView }) {
  return facts?.pulls.map(({ url, fact }) => (
    <a className={ui.countChip} href={url} key={url} target="_blank" rel="noreferrer">
      PR #{url.split('/').at(-1)} ·{' '}
      {fact?.tag
        ? text.workBand.releasedIn(fact.tag)
        : fact
          ? text.workBand.pullState[fact.state]
          : text.workBand.unknown}
      {fact && !fact.tag && facts.asOfMs - fact.observedAtMs >= PR_STALE_MS && (
        <> · {text.workBand.factAge(relativeTime(fact.observedAtMs, facts.asOfMs))}</>
      )}
    </a>
  ));
}

function StateChip({ state }: { state?: PageState | null }) {
  const t = text.workBand;
  return (
    <span className={`work-page-state ${ui.countChip}`} data-state={state ?? 'unknown'}>
      {state ? t.taskState[state] : t.unknown}
    </span>
  );
}

/** Title-row state and sub-page count; the count opens the editable sub-page tree. */
export function WorkBand({
  onSize,
  priority,
  owner,
  pageState,
  stateControl,
  beforeSubpages,
  subpages,
  onAdd,
  ...slots
}: WorkBandProps): ReactNode {
  const t = text.workBand;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    onSize?.(0);
  }, [onSize]);
  useLayoutEffect(() => {
    if (!open) return;
    const node = section.current;
    if (!node) return;
    const measure = () => {
      const root = getComputedStyle(document.documentElement);
      const gap = Number.parseFloat(root.getPropertyValue('--tmt-ui-space-m')) || 0;
      const maxWidth = Math.min(36 * Number.parseFloat(root.fontSize), innerWidth - 2 * gap);
      const shift = Math.min(0, innerWidth - gap - node.getBoundingClientRect().left - maxWidth);
      node.style.setProperty('--work-popover-shift', `${shift}px`);
      const verticalGap = Number.parseFloat(root.getPropertyValue('--tmt-ui-space-s')) || 0;
      const room = Math.max(0, innerHeight - node.getBoundingClientRect().bottom - 2 * verticalGap);
      node.style.setProperty('--work-popover-height', `${room}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !section.current?.contains(event.target) &&
        !(event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"]'))
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !(event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"]'))
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const empty = subpages.length === 0;
  return (
    <section ref={section} className="work-band" aria-label={t.label}>
      <div className="work-head" data-empty={empty}>
        <span className="work-head-chip">{stateControl ?? <StateChip state={pageState} />}</span>
        {priority && priority !== 'normal' && (
          <span
            className={`${ui.countChip} work-field-chip`}
            aria-label={priority === 'high' ? t.priorityHigh : t.priorityLow}
          >
            {priority === 'high' ? t.priorityHighChip : t.priorityLowChip}
          </span>
        )}
        {owner && (
          <span
            className={`${ui.countChip} work-field-chip work-owner-chip`}
            aria-label={owner.name}
            title={owner.name}
          >
            <BrowserAvatar name={owner.name} kind="agent" size="s" decorative />
            <span className="work-owner-name" title={owner.name}>
              {owner.name}
            </span>
          </span>
        )}
        {beforeSubpages}
        {!empty && (
          <button
            type="button"
            className={`work-toggle ${ui.countChip}`}
            aria-label={text.pageHierarchy.subpages(subpages.length)}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((now) => !now)}
          >
            <span className="work-count-wide">{text.pageHierarchy.subpages(subpages.length)}</span>
            <span className="work-count-compact" aria-hidden="true">
              {subpages.length}
            </span>
            <ChevronDown className="work-chevron" data-open={open} aria-hidden="true" />
          </button>
        )}
      </div>
      {!empty && (
        <div className="work-body-transition" data-open={open} inert={!open}>
          <div className="work-body" id={listId}>
            <div className="work-body-content">
              <ul className="work-tree" aria-label={t.subpages}>
                <Rows rows={subpages} depth={0} trail={[]} {...slots} />
              </ul>
              {onAdd && (
                <div className="work-add-row">
                  <button type="button" className="work-add-text" onClick={onAdd}>
                    <Plus aria-hidden="true" />
                    {t.add}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Rows({
  rows,
  depth,
  trail,
  ...slots
}: RowSlots & {
  rows: readonly SubpageRow[];
  depth: number;
  /** Pages already drawn above this level: a legacy loop is never drawn twice. */
  trail: readonly string[];
}) {
  return rows.map((row) => (
    <Row key={`${row.parent}/${row.id}`} row={row} depth={depth} trail={trail} {...slots} />
  ));
}

function Row({
  row,
  depth,
  trail,
  ...slots
}: RowSlots & { row: SubpageRow; depth: number; trail: readonly string[] }) {
  const t = text.workBand;
  const { childrenOf, counts, pageHref, rowState, rowActions } = slots;
  const [open, setOpen] = useState(false);
  const below = trail.includes(row.id) ? [] : (childrenOf?.(row.id) ?? []);
  const title = row.title ?? t.unknownPage;
  const own = below.length > 0 ? counts?.(below) : undefined;
  return (
    <li className="work-row">
      <div className="work-row-line">
        <span className="work-row-name" style={{ '--work-depth': depth } as CSSProperties}>
          {below.length > 0 ? (
            <button
              type="button"
              className="work-twisty"
              aria-expanded={open}
              aria-label={open ? t.collapseRow(title) : t.expandRow(title)}
              onClick={() => setOpen(!open)}
            >
              {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>
          ) : (
            <span className="work-twisty" />
          )}
          <FileText className="work-row-icon" aria-hidden="true" />
          {row.workNumber && <span className="colab-work-number">{row.workNumber}</span>}
          {pageHref ? (
            <a className="work-row-title" href={pageHref(row.id)}>
              {title}
            </a>
          ) : (
            <span className="work-row-title">{title}</span>
          )}
        </span>
        <span className="work-row-progress">
          {own ? t.rowProgress(own.done, own.total) : t.noProgress}
        </span>
        <span className="work-row-state">{rowState?.(row) ?? <StateChip state={row.state} />}</span>
        <span className="work-row-more">{rowActions?.(row)}</span>
        <WorkFieldDetails fields={row.fields} />
      </div>
      {open && below.length > 0 && (
        <ul className="work-tree">
          <Rows rows={below} depth={depth + 1} trail={[...trail, row.id]} {...slots} />
        </ul>
      )}
    </li>
  );
}

import { WorkChipOwner } from '@tmt/browser-ui/work-display';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import { browserUiClasses as ui } from '@tmt/browser-ui/static';
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
  /** The list starts open: a phone viewer's sheet opened from More is the list (#6652). */
  defaultOpen?: boolean;
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

/** The page the list's Rename… opened, whose title starts in edit once the page can be renamed. */
export const renameOnOpen: { page?: string } = {};

/** The owner's rename of a page in its title row (#6709). */
export interface TitleRename {
  editing: boolean;
  onEditing(editing: boolean): void;
  /** Saves the title; resolves to the reason it was not saved, or nothing once it was. */
  onSave(title: string): Promise<string | undefined>;
}

/** The title row's title, or its editor: Enter or leaving saves, Escape restores. */
function TitleRow({
  title,
  workNumber,
  rename,
}: {
  title: string;
  workNumber?: string;
  rename?: TitleRename;
}) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const editing = rename?.editing ?? false;
  // Each edit starts from the title shown, however it was opened (the title or More's Rename…),
  // with the row in view.
  useLayoutEffect(() => {
    if (!editing) return;
    setDraft(title);
    setError(undefined);
    done.current = false;
    const node = input.current;
    if (node?.checkVisibility()) {
      node.scrollIntoView({ block: 'nearest' });
      node.focus();
      node.select();
    }
    // The title shown while editing is not the draft's starting point again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const number = workNumber && (
    <>
      <span className="colab-work-number">{workNumber}</span>{' '}
    </>
  );
  if (!rename)
    return (
      <h1>
        {number}
        {/* One box as the rename button is, so the heading keeps its lines when the page stops
            taking edits for a moment (#6795). */}
        <span className="page-title-text">{title}</span>
      </h1>
    );
  if (!editing)
    return (
      <h1>
        {number}
        <button
          type="button"
          className="page-title-rename"
          // The heading keeps the title as its name; the button says what it does beside it.
          aria-description={text.rename.hint}
          title={text.rename.hint}
          onClick={() => rename.onEditing(true)}
        >
          {title}
        </button>
      </h1>
    );
  const finish = async (save: boolean) => {
    if (done.current || busy) return;
    if (!save || draft === title) {
      done.current = true;
      setError(undefined);
      rename.onEditing(false);
      return;
    }
    setBusy(true);
    const reason = await rename.onSave(draft);
    setBusy(false);
    if (reason === undefined) {
      done.current = true;
      setError(undefined);
      rename.onEditing(false);
    } else setError(reason);
  };
  return (
    <div className="page-title-edit">
      <input
        ref={input}
        className="page-title-input"
        aria-label={text.rename.field}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        value={draft}
        readOnly={busy}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            void finish(false);
          }
        }}
        onBlur={() => void finish(true)}
      />
      {error !== undefined && (
        <p className="page-title-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The page title and work controls scroll together as one content block. */
export function MobileWorkTitle({
  title,
  workNumber,
  onSize,
  rename,
  children,
}: {
  title: string;
  workNumber?: string;
  onSize(height: number): void;
  /** The owner renames the page here (#6709). */
  rename?: TitleRename;
  /** The reader's work band; the owner's page has its details in the top bar (#6652). */
  children?: ReactNode;
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
      <TitleRow title={title} workNumber={workNumber} rename={rename} />
      {children && <div className="page-mobile-title-chips">{children}</div>}
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
  defaultOpen = false,
  ...slots
}: WorkBandProps): ReactNode {
  const t = text.workBand;
  const [open, setOpen] = useState(defaultOpen);
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
            <WorkChipOwner name={owner.name} labelClass="work-owner-name" />
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

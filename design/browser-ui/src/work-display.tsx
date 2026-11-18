import type { ReactNode } from 'react';
import { BrowserAvatar } from './avatar.js';

export interface WorkCount {
  state: string;
  label: string;
  count: number;
}
export interface DoneCell {
  label: string;
  count: number;
  current?: boolean;
}
function Dot({ state }: { state: string }) {
  return <span className="tmt-ui-work-dot" data-state={state} aria-hidden="true" />;
}
export function WorkRow({
  className,
  statusControl,
  ownerControl,
  sections,
  state = 'discussing',
  number,
  title,
  next,
  owner,
  time,
  priority,
}: {
  className?: string;
  statusControl?: ReactNode;
  ownerControl?: ReactNode;
  sections?: ReactNode;
  state?: string;
  number?: string;
  title?: ReactNode;
  next?: string;
  owner?: string;
  time?: string;
  priority?: 'normal' | 'high';
}) {
  return (
    <div className={['tmt-ui-work-row', className].filter(Boolean).join(' ')}>
      {statusControl ?? <Dot state={state} />}
      <span className="tmt-ui-work-number">{number}</span>
      <span className="tmt-ui-work-title">
        {priority === 'high' && <span className="tmt-ui-work-priority">High</span>}
        {title}
      </span>
      <span className="tmt-ui-work-next">{next}</span>
      {sections}
      {ownerControl ?? (
        <span className="tmt-ui-work-owner">
          {owner && (
            <>
              <BrowserAvatar name={owner} kind="agent" size="s" decorative />
              <span>{owner}</span>
            </>
          )}
        </span>
      )}
      <span className="tmt-ui-work-time">{time}</span>
    </div>
  );
}
export function WorkOverview({ counts }: { counts: readonly WorkCount[] }) {
  return (
    <ul className="tmt-ui-work-overview" aria-label="Open work by status">
      {counts.map(({ state, count, label }) => (
        <li key={state}>
          <span className="tmt-ui-work-count" data-zero={count === 0 ? '' : undefined}>
            <span className="tmt-ui-work-count-number">{count}</span>
            <span className="tmt-ui-work-count-label">
              <Dot state={state} />
              {label}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
export function WorkRatio({ counts, label }: { counts: readonly WorkCount[]; label?: string }) {
  return (
    <div
      className="tmt-ui-work-ratio"
      role="img"
      aria-label={label ?? counts.map((c) => c.count + ' ' + c.label).join(', ')}
    >
      {counts
        .filter((c) => c.count > 0)
        .map((c) => (
          <span key={c.state} data-state={c.state} style={{ flexGrow: c.count }} />
        ))}
    </div>
  );
}
export function WorkDoneChart({
  cells,
  period = 'week',
}: {
  cells: readonly DoneCell[];
  period?: 'today' | 'week' | 'month';
}) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <ul className="tmt-ui-work-done" aria-label="Completed work" data-period={period}>
      {cells.map((c, index) => (
        <li key={index}>
          <span
            className="tmt-ui-work-done-cell"
            data-current={c.current ? '' : undefined}
            aria-label={c.label + ': ' + c.count + ' done'}
          >
            <span className="tmt-ui-work-done-track">
              <span>{c.count || ''}</span>
              <span
                className="tmt-ui-work-done-bar"
                style={{ height: (c.count / max) * 80 + '%' }}
              />
            </span>
            <span>{c.label}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
export function WorkFieldChips({
  state,
  statusLabel,
  pull,
  parent,
  subpages,
  owner,
  priority,
  next,
  blocked,
}: {
  state?: string;
  statusLabel?: string;
  pull?: string;
  parent?: string;
  subpages?: string;
  owner?: string;
  priority?: 'normal' | 'high';
  next?: string;
  blocked?: string;
}) {
  return (
    <div className="tmt-ui-field-chips">
      {statusLabel && (
        <span className="tmt-ui-field-chip" data-status="">
          <Dot state={state ?? 'discussing'} />
          {statusLabel}
        </span>
      )}
      {owner && (
        <span className="tmt-ui-field-chip">
          <BrowserAvatar name={owner} kind="agent" size="s" decorative />
          {owner}
        </span>
      )}
      {Object.entries({
        Priority: priority === 'high' ? 'High' : undefined,
        Next: next,
        Blocked: blocked,
        PR: pull,
        Parent: parent,
        Subpages: subpages,
      }).map(
        ([key, value]) =>
          value && (
            <span className="tmt-ui-field-chip" key={key}>
              <span className="tmt-ui-field-chip-key">{key}</span>
              {value}
            </span>
          ),
      )}
    </div>
  );
}
export function WorkNextLine({ titles }: { titles: readonly string[] }) {
  return (
    <p className="tmt-ui-work-next-line">
      <strong>Next</strong> <span>{titles.length ? titles.join(' → ') : 'No ranked items'}</span>
    </p>
  );
}

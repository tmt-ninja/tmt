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
function readWords(words: string | undefined, defaults: string[]) {
  const given = words?.split(',').map((word) => word.trim());
  return given?.length === defaults.length && given.every(Boolean) ? given : defaults;
}
function Dot({ state }: { state: string }) {
  return <span className="tmt-ui-work-dot" data-state={state} aria-hidden="true" />;
}
export function WorkRow({
  words,
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
  words?: string;
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
        {priority === 'high' && (
          <span className="tmt-ui-work-priority">{readWords(words, ['High'])[0]}</span>
        )}
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
export function WorkCountContent({ state, count, label }: WorkCount) {
  return (
    <>
      <span className="tmt-ui-work-count-number">{count}</span>
      <span className="tmt-ui-work-count-label">
        <Dot state={state} />
        {label}
      </span>
    </>
  );
}
export function WorkOverview({ words, counts }: { words?: string; counts: readonly WorkCount[] }) {
  return (
    <ul className="tmt-ui-work-overview" aria-label={readWords(words, ['Open work by status'])[0]}>
      {counts.map(({ state, count, label }) => (
        <li key={state}>
          <span className="tmt-ui-work-count" data-zero={count === 0 ? '' : undefined}>
            <WorkCountContent state={state} count={count} label={label} />
          </span>
        </li>
      ))}
    </ul>
  );
}
export function WorkRatio({
  counts,
  label,
  words,
}: {
  words?: string;
  counts: readonly WorkCount[];
  label?: string;
}) {
  return (
    <div
      className="tmt-ui-work-ratio"
      role="img"
      aria-label={
        label ?? readWords(words, [counts.map((c) => c.count + ' ' + c.label).join(', ')])[0]
      }
    >
      {counts
        .filter((c) => c.count > 0)
        .map((c) => (
          <span key={c.state} data-state={c.state} style={{ flexGrow: c.count }} />
        ))}
    </div>
  );
}
export function WorkDoneCellContent({ count, max, label }: DoneCell & { max: number }) {
  return (
    <>
      <span className="tmt-ui-work-done-track">
        <span aria-hidden="true">{count || ''}</span>
        <span className="tmt-ui-work-done-bar" style={{ height: (count / max) * 80 + '%' }} />
      </span>
      <span aria-hidden="true">{label}</span>
    </>
  );
}
export function WorkDoneChart({
  cells,
  words,
  period = 'week',
}: {
  words?: string;
  cells: readonly DoneCell[];
  period?: 'today' | 'week' | 'month';
}) {
  const [chart, done] = readWords(words, ['Completed work', 'done']);
  const max = Math.max(1, ...cells.map((c) => c.count));
  return (
    <ul className="tmt-ui-work-done" aria-label={chart} data-period={period}>
      {cells.map((c, index) => (
        <li key={index}>
          <span
            className="tmt-ui-work-done-cell"
            data-current={c.current ? '' : undefined}
            aria-label={c.label + ': ' + c.count + ' ' + done}
          >
            <WorkDoneCellContent count={c.count} max={max} label={c.label} />
          </span>
        </li>
      ))}
    </ul>
  );
}
export function WorkChipOwner({ name, labelClass }: { name: string; labelClass?: string }) {
  return (
    <>
      <BrowserAvatar name={name} kind="agent" size="s" decorative />
      <span className={labelClass} title={name}>
        {name}
      </span>
    </>
  );
}
export function WorkFieldChips({
  state,
  words,
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
  words?: string;
  statusLabel?: string;
  pull?: string;
  parent?: string;
  subpages?: string;
  owner?: string;
  priority?: 'normal' | 'high';
  next?: string;
  blocked?: string;
}) {
  const [priorityWord, high, nextWord, blockedWord, pr, parentWord, subpagesWord] = readWords(
    words,
    ['Priority', 'High', 'Next', 'Blocked', 'PR', 'Parent', 'Subpages'],
  );
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
          <WorkChipOwner name={owner} />
        </span>
      )}
      {[
        [priorityWord, priority === 'high' ? high : undefined],
        [nextWord, next],
        [blockedWord, blocked],
        [pr, pull],
        [parentWord, parent],
        [subpagesWord, subpages],
      ].map(
        ([key, value], index) =>
          value && (
            <span className="tmt-ui-field-chip" key={index}>
              <span className="tmt-ui-field-chip-key">{key}</span>
              {value}
            </span>
          ),
      )}
    </div>
  );
}
export function WorkNextLine({ titles, words }: { titles: readonly string[]; words?: string }) {
  const [next, empty] = readWords(words, ['Next', 'No ranked items']);
  return (
    <p className="tmt-ui-work-next-line">
      <strong>{next}</strong> <span>{titles.length ? titles.join(' → ') : empty}</span>
    </p>
  );
}

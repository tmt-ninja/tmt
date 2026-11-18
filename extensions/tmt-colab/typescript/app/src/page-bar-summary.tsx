import { browserUiClasses as ui } from '@tmt/browser-ui/static';
import type { WorkFactView } from './reading-details.js';
import { text } from './strings.js';
import { computedTone } from './work-band-live.js';
import { projectTone } from './projects.js';
import './page-projects.css';
import './page-bar-summary.css';

/** The labels the bar names before a count; the page header's picker names them all. */
const LABELS = 3;

/**
 * The opened page's summary in the top bar, after its number and title (#6611): its computed status,
 * in the list's and Work home's words, and its projects as labels. It stays in view while the page
 * scrolls; the page's own title and fields row stay the place to change them. A narrow bar drops the
 * labels first, then keeps only the status dot.
 */
export function PageBarSummary({
  facts,
  labels,
}: {
  facts?: WorkFactView;
  labels: readonly string[];
}) {
  const state = facts?.state ?? 'unknown';
  // A status no page view has computed yet reads as the list says it.
  const label =
    state === 'unknown' ? text.pageList.notCheckedYet : text.workBand.computedState[state];
  const shown = labels.slice(0, LABELS);
  return (
    <span className="page-bar-summary">
      <span className={`page-bar-status ${ui.countChip}`} title={label} data-state={state}>
        <span
          className={ui.stateMark}
          data-shape="dot"
          data-tone={computedTone(state)}
          aria-hidden="true"
        />
        <span className="page-bar-status-label">{label}</span>
      </span>
      {shown.length > 0 && (
        <span className="page-bar-labels" title={labels.join(', ')}>
          {/* The same chips as the page's own projects, in the same tones. */}
          {shown.map((name) => (
            <span key={name} className="page-bar-label" data-project-tone={projectTone(name)}>
              <span>{name}</span>
            </span>
          ))}
          {labels.length > shown.length && (
            <span
              className="page-bar-label"
              data-overflow=""
              aria-label={text.pageBar.moreLabels(labels.length - shown.length)}
            >
              +{labels.length - shown.length}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

import { relativeTime } from './display-time.js';
import type { WorkFactView } from './reading-details.js';
import { text } from './strings.js';

export function WorkPullDetails({
  url,
  fact,
  asOfMs,
  provenance,
  action,
  disabled,
  onAction,
}: {
  url: string;
  fact?: WorkFactView['pulls'][number]['fact'];
  asOfMs: number;
  provenance?: string;
  action: string;
  disabled: boolean;
  onAction?: () => void;
}) {
  const t = text.workBand;
  return (
    <div className="work-pull-details">
      <p>
        {/* The only way to the PR from the page since the chip under the title left (#6652). */}
        <a href={url} target="_blank" rel="noreferrer">
          PR #{url.split('/').at(-1)}
        </a>
        {fact !== undefined && (
          <> · {fact?.tag ? t.releasedIn(fact.tag) : fact ? t.pullState[fact.state] : t.unknown}</>
        )}
        {fact?.checks && <> · {t.checks[fact.checks]}</>}
        {fact?.state === 'open' && !fact.checks && <> · {t.checksUnavailable}</>}
        {fact && (
          <>
            {' '}
            · {/* The observed age wraps as one piece, never leaving "ago" alone (#6652). */}
            <span className="work-pull-age">
              {t.factAge(relativeTime(fact.observedAtMs, asOfMs))}
            </span>
          </>
        )}
      </p>
      {provenance && (
        <small>
          {provenance}
          {onAction && (
            <>
              {' '}
              ·{' '}
              <button type="button" disabled={disabled} onClick={onAction}>
                {action}
              </button>
            </>
          )}
        </small>
      )}
    </div>
  );
}

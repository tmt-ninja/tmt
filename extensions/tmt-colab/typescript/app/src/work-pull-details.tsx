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
        PR #{url.split('/').at(-1)}
        {fact !== undefined && (
          <> · {fact?.tag ? t.releasedIn(fact.tag) : fact ? t.pullState[fact.state] : t.unknown}</>
        )}
        {fact?.checks && <> · {t.checks[fact.checks]}</>}
        {fact?.state === 'open' && !fact.checks && <> · {t.checksUnavailable}</>}
        {fact && <> · {t.factAge(relativeTime(fact.observedAtMs, asOfMs))}</>}
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

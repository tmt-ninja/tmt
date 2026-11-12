import { ArchivedDraft } from './annotation-input.js';
import { BrowserAction } from '@tmt/browser-ui/react';
import type { ComposerEdit } from './components/message-composer-edit.js';
import { persistable } from './draft-store.js';
import { text } from './strings.js';
import { validateSelector, type ThreadView } from './thread-records.js';
import { useState } from 'react';

/** The reserved draft key of the page Chat composer. */
export const CHAT_DRAFT = 'chat';

export interface SavedDraft {
  key: string;
  /** The quote of an unsent selection draft; absent for a thread whose record is gone. */
  quote?: string;
  text: string;
  unconfirmed?: boolean;
}

export function unconfirmedDrafts(
  drafts: ReadonlyMap<string, ComposerEdit>,
  kind: 'chat' | 'comment',
): SavedDraft[] {
  const prefix = `unconfirmed:${kind}:`;
  return [...drafts]
    .filter(([key, edit]) => key.startsWith(prefix) && persistable(edit))
    .map(([key, edit]) => ({ key, text: edit.value, unconfirmed: true }));
}

/**
 * Drafts the page cannot show in place: an unsent selection (the quote must be selected
 * again) and a reply to a thread that no longer exists. A draft for a live thread is shown
 * by that thread, and Chat shows its own. Nothing here sends, re-anchors or deletes.
 */
export function savedDrafts(
  drafts: ReadonlyMap<string, ComposerEdit>,
  threads: readonly ThreadView[] | undefined,
): SavedDraft[] {
  const live = new Set(
    (threads ?? []).filter((t) => !t.deleted).map((t) => `${t.ref.writer}:${t.ref.id}`),
  );
  const result: SavedDraft[] = [];
  for (const [key, edit] of drafts) {
    if (key.startsWith('unconfirmed:')) continue;
    if (key === CHAT_DRAFT || !persistable(edit)) continue;
    if (key.startsWith('{')) {
      try {
        const selector: unknown = JSON.parse(key);
        validateSelector(selector);
        result.push({ key, quote: selector.exact, text: edit.value });
      } catch {
        // A key that is not a selector is not listed as one.
      }
    } else if (!live.has(key)) result.push({ key, text: edit.value });
  }
  return result;
}

export function SavedDrafts({
  drafts,
  discard,
  archived = false,
  restore,
  restoreDisabled = false,
}: {
  drafts: readonly SavedDraft[];
  discard(key: string): void;
  archived?: boolean;
  restore?(key: string): void;
  restoreDisabled?: boolean;
}) {
  const [copyFailed, setCopyFailed] = useState<string>();
  if (!drafts.length) return null;
  const unconfirmed = drafts.some((draft) => draft.unconfirmed);
  const heading = unconfirmed
    ? drafts.every((draft) => draft.unconfirmed)
      ? text.unconfirmedMessages
      : text.draftsAndUnconfirmed
    : text.savedDrafts;
  return (
    <section className="saved-drafts" data-testid="saved-drafts" aria-label={heading}>
      <h3>{heading}</h3>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.key} data-testid="saved-draft">
            {draft.quote !== undefined && <blockquote>{draft.quote}</blockquote>}
            {archived && !draft.unconfirmed ? (
              <ArchivedDraft value={draft.text} />
            ) : (
              <>
                <p className="saved-draft-text">{draft.text}</p>
                <p className="annotation-hint">
                  {draft.unconfirmed
                    ? text.messageInterrupted
                    : draft.quote !== undefined
                      ? text.savedDraftQuote
                      : text.savedDraftThreadGone}
                </p>
                {draft.unconfirmed && (
                  <>
                    <BrowserAction
                      type="button"
                      label={restore ? text.messageInterruptedRestore : text.messageInterruptedCopy}
                      variant="text"
                      disabled={!!restore && restoreDisabled}
                      onActivate={(event) => {
                        if (!event.isTrusted) return;
                        if (restore) restore(draft.key);
                        else {
                          setCopyFailed(undefined);
                          void (async () => {
                            try {
                              await navigator.clipboard.writeText(draft.text);
                            } catch {
                              setCopyFailed(draft.key);
                            }
                          })();
                        }
                      }}
                    />
                    {copyFailed === draft.key && <p role="alert">{text.copyDraftFailed}</p>}
                  </>
                )}
                <BrowserAction
                  type="button"
                  label={
                    draft.unconfirmed ? text.messageInterruptedDismiss : text.savedDraftDiscard
                  }
                  variant="text"
                  onActivate={(event) => {
                    if (event.isTrusted) discard(draft.key);
                  }}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

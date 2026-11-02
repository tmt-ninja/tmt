import { BrowserAction } from '@tmt/browser-ui/react';
import { useRef, useState } from 'react';
import { QuestionDismissal } from './question-dismiss.js';
import { removeQuestion } from './question-source.js';
import type { PageBinding, PageView } from './transport.js';
import './question-dismiss.css';

/** Owns the page-level Undo lifetime after the removed block unmounts. */
export function useQuestionDismissal(view: PageView, binding?: PageBinding) {
  const latest = useRef(view);
  latest.current = view;
  const operation = useRef<QuestionDismissal | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = () => setRevision((value) => value + 1);
  const unresolved =
    operation.current?.state === 'handle-failed' || operation.current?.state === 'reopen-failed';
  const canDismiss =
    !!binding && binding.canMetadata?.() === true && !view.archived && !busy && !unresolved;
  async function dismiss(id: string) {
    if (!canDismiss || !binding?.metadata || !binding.metadataRevision) return;
    const entry = latest.current.questions?.find((question) => question.id === id);
    if (!entry) return;
    setBusy(true);
    setError(undefined);
    try {
      const before = latest.current.source;
      const after = removeQuestion(before, id);
      const metadata = async (action: 'question.handle' | 'question.reopen') => {
        const version = await binding.metadataRevision!(latest.current);
        await binding.metadata!(action, { id }, version);
      };
      const next = new QuestionDismissal({
        edit: (source, base) => binding.edit(source, base),
        handle: () => metadata('question.handle'),
        reopen: () => metadata('question.reopen'),
        readHandled: async () => {
          const question = latest.current.questions?.find((entry) => entry.id === id);
          if (!question) throw new Error('Question state unavailable');
          return question.state === 'handled';
        },
      });
      operation.current = next;
      await next.dismiss(before, after, entry.state === 'open');
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not remove the question.');
    } finally {
      setBusy(false);
    }
  }
  async function act(action: 'undo' | 'retry') {
    if (busy || !operation.current) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation.current[action]();
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not restore the question.');
    } finally {
      setBusy(false);
    }
  }
  void revision;
  const state = operation.current?.state;
  const removed = state === 'removed' || state === 'handle-failed';
  const failed = state === 'handle-failed' || state === 'reopen-failed';
  return {
    canDismiss,
    dismiss,
    notice:
      (state && state !== 'idle') || error ? (
        <div className="question-dismiss-notice" role="status">
          <span>
            {error ??
              (state === 'handle-failed'
                ? 'Removed from page, but could not mark handled.'
                : state === 'reopen-failed'
                  ? 'Restored to page, but could not reopen.'
                  : removed
                    ? 'Removed from page'
                    : 'Restored to page')}
          </span>
          {removed && (
            <BrowserAction
              type="button"
              variant="text"
              label="Undo"
              disabled={busy}
              onActivate={(event) => {
                if (event.isTrusted) void act('undo');
              }}
            />
          )}
          {failed && (
            <BrowserAction
              type="button"
              variant="text"
              label="Retry"
              disabled={busy}
              onActivate={(event) => {
                if (event.isTrusted) void act('retry');
              }}
            />
          )}
        </div>
      ) : null,
  };
}

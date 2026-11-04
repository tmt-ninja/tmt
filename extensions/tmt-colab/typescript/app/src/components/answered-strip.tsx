import { BrowserIconAction, BusyMark, useBusyMark } from '@tmt/browser-ui/react';
import { Check, ChevronDown, ChevronUp, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { forwardRef } from 'react';
import { questionText, type Question } from '../questions.js';
import './answered-strip.css';

/** The compact, viewer-only summary of a recorded answer. */
export const AnsweredStrip = forwardRef<
  HTMLButtonElement,
  {
    question: Question;
    answer: string;
    pending?: boolean;
    expanded: boolean;
    panelId: string;
    onToggle(): void;
    onChangeAnswer?(): void;
    onFollowUp?(): void;
    onDismiss?(): void;
  }
>(function AnsweredStrip(
  {
    question,
    answer,
    pending = false,
    expanded,
    panelId,
    onToggle,
    onChangeAnswer,
    onFollowUp,
    onDismiss,
  },
  ref,
) {
  const marked = useBusyMark(pending);
  const summary = questionText(answer);
  return (
    <div className="answered-strip-row">
      <button
        type="button"
        ref={ref}
        className="question-line answered-strip"
        data-state="answered"
        aria-label={`${question.title}, Answered: ${summary}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (event.isTrusted && !pending) onToggle();
        }}
      >
        <span className="answered-strip-mark" aria-hidden="true">
          {pending && marked ? <BusyMark /> : <Check size={13} />}
        </span>
        <span className="answered-strip-title">{question.title}</span>
        {!expanded && <span className="question-line-answer">{summary}</span>}
        {!expanded && (
          <span className="answered-strip-chevron" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        )}
      </button>
      {expanded && (
        <span className="answered-strip-actions">
          {onChangeAnswer && (
            <BrowserIconAction
              type="button"
              variant="text"
              label="Change answer"
              icon={<Pencil />}
              onActivate={(event) => {
                if (event.isTrusted) onChangeAnswer();
              }}
            />
          )}
          {onFollowUp && (
            <BrowserIconAction
              type="button"
              variant="text"
              label="Follow up"
              icon={<MessageCircle />}
              onActivate={(event) => {
                if (event.isTrusted) onFollowUp();
              }}
            />
          )}
          {onDismiss && (
            <BrowserIconAction
              type="button"
              variant="text"
              label="Remove from page"
              icon={<Trash2 />}
              onActivate={(event) => {
                if (event.isTrusted) onDismiss();
              }}
            />
          )}
          <BrowserIconAction
            type="button"
            variant="text"
            label="Collapse"
            icon={<ChevronUp />}
            onActivate={(event) => {
              if (event.isTrusted) onToggle();
            }}
          />
        </span>
      )}
    </div>
  );
});

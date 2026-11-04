import type { ComposerConnectionPresentation } from '../router.js';
import { BrowserAction, BrowserChoice, BrowserChoiceGroup } from '@tmt/browser-ui/react';
import { browserUiClasses as c } from '@tmt/browser-ui/static';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  canonicalQuestionThread,
  currentAnswer,
  QUESTION_SHORT_POINTS,
  QUESTION_LONG_BYTES,
  type Question,
} from '../questions.js';
import { CommentExchange } from '../thread-panel.js';
import type { PageAsk, AskBinding, AskRetryInput } from '../ask-panel.js';
import type { ThreadBinding } from '../thread-store.js';
import type { ThreadView } from '../thread-records.js';
import { AnnotationInput, ArchivedDraft } from '../annotation-input.js';
import type { CreatorTarget } from '../creator-default.js';
import { attachmentInputHandlers } from '../attachment-drop.js';
import type { AttachmentDraft } from '../attachment-draft.js';
import { PendingAttachments } from '../attachment-tray.js';
import { text } from '../strings.js';
import { useNotificationBlock } from '../use-notification-block.js';
import { answerNotificationDestination } from '../reply-notification-context.js';

export interface QuestionDraft {
  choices: string[];
  other: boolean;
  value: string;
  changing: boolean;
}

/** Controlled answer/conversation presentation. The admitted group owns drafts and all effects. */
export function QuestionCard({
  question,
  draft,
  onDraft,
  threads,
  discussion,
  ask,
  asks,
  title,
  blocked,
  connectionPresentation,
  readOnly = false,
  busy = false,
  recorded = false,
  error,
  body,
  sharedAsk,
  replyLabel,
  onOpenReply,
  onSend,
  onRetry,
  retryInput,
  files,
  followUpRecipient,
}: {
  question: Question;
  draft: QuestionDraft;
  onDraft(patch: Partial<QuestionDraft>): void;
  threads: readonly ThreadView[];
  discussion?: ThreadBinding;
  ask?: AskBinding;
  asks: readonly PageAsk[];
  title: string;
  blocked: boolean;
  connectionPresentation?: ComposerConnectionPresentation;
  readOnly?: boolean;
  busy?: boolean;
  recorded?: boolean;
  error?: string;
  body?: string;
  sharedAsk?: ReactNode;
  replyLabel?: string;
  onOpenReply?(): void;
  onSend?(): void;
  /** Sends the kept draft again after a failed send. */
  onRetry?(): void;
  retryInput?: AskRetryInput;
  /** The answer's attachment draft, owned by the group like the text draft. Absent where this
   * binding cannot upload files. */
  files?: AttachmentDraft;
  followUpRecipient?: CreatorTarget & { label?: string };
}) {
  const heading = useId();
  const { choices, other, value, changing } = draft;
  const section = useRef<HTMLElement>(null);
  useNotificationBlock(answerNotificationDestination(question.id), section, true);
  const thread = canonicalQuestionThread(question, threads);
  const answer = currentAnswer(question, thread?.comments ?? []);
  const answerText = answer?.body.slice(`Answer to “${question.title}”: `.length);
  const pageLine = answerText?.lastIndexOf('\nPage: ') ?? -1;
  const disabled = blocked || busy || recorded || !discussion;
  const attachable = !!files && !disabled;
  const compose = !answer || changing;
  // Change answer replaces the focused strip action; keep keyboard focus in the reopened card.
  useEffect(() => {
    if (!changing) return;
    section.current?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus();
  }, [changing]);
  // A failed send re-opens the card on its error row; the reader must act on it, so Retry has focus.
  const retryable = !!error && !!onRetry;
  useEffect(() => {
    if (!retryable || section.current?.closest('[hidden]')) return;
    const active = document.activeElement;
    if (active?.closest('input,textarea,[contenteditable]') && !section.current?.contains(active))
      return;
    section.current?.querySelector<HTMLElement>('.question-status button')?.focus();
  }, [retryable]);
  return (
    <section
      className="question-card"
      aria-label={question.title}
      ref={section}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (
          !event.isTrusted ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        const target = event.target as HTMLElement;
        if (
          onSend &&
          !event.nativeEvent.isComposing &&
          event.key === 'Enter' &&
          question.kind === 'short' &&
          target.id === `${heading}-answer`
        ) {
          event.preventDefault();
          onSend();
        }
      }}
    >
      <div className="question-controls">
        {readOnly && compose && body && <ArchivedDraft value={body} />}
        {!readOnly && compose && (
          <>
            <p className="question-kind">{text.questionKind(question.kind, question.other)}</p>
            {(question.kind === 'single' || question.kind === 'multiple') && (
              <BrowserChoiceGroup
                layout={question.choices.some((choice) => choice.description) ? 'stack' : 'inline'}
                legend={text.questionInstruction(question.kind, question.other)}
              >
                {question.choices.map((choice, index) => (
                  <span key={choice.label} className={`${c.chip} question-choice-chip`}>
                    <BrowserChoice
                      type={question.kind === 'single' ? 'radio' : 'checkbox'}
                      name={heading}
                      label={choice.label}
                      description={choice.description}
                      aria-label={choice.label}
                      data-choice-index={index + 1}
                      aria-keyshortcuts={String(index + 1)}
                      title={text.questionKey(index + 1)}
                      disabled={disabled}
                      checked={choices.includes(choice.label)}
                      onChange={(event) => {
                        if (question.kind === 'single') {
                          onDraft({ choices: [choice.label], other: false });
                        } else
                          onDraft({
                            choices: event.target.checked
                              ? [...choices, choice.label]
                              : choices.filter((item) => item !== choice.label),
                          });
                      }}
                    />
                  </span>
                ))}
                {question.other && (
                  <span className={`${c.chip} question-choice-chip`}>
                    <BrowserChoice
                      type={question.kind === 'single' ? 'radio' : 'checkbox'}
                      name={heading}
                      label="Other"
                      data-choice-index={question.choices.length + 1}
                      aria-keyshortcuts={String(question.choices.length + 1)}
                      title={text.questionKey(question.choices.length + 1)}
                      disabled={disabled}
                      checked={other}
                      onChange={(event) => {
                        onDraft({
                          other: event.target.checked,
                          ...(question.kind === 'single' ? { choices: [] } : {}),
                        });
                      }}
                    />
                  </span>
                )}
              </BrowserChoiceGroup>
            )}
            {(question.kind === 'short' ||
              question.kind === 'long' ||
              (question.other && other)) && (
              // The answer field: the whole answer for a short or long question, and under the
              // choices once Other is picked.
              <div
                className="question-text"
                {...(files ? attachmentInputHandlers(files, attachable, false) : {})}
              >
                <label htmlFor={`${heading}-answer`}>
                  {question.kind === 'short' || question.kind === 'long'
                    ? 'Your answer'
                    : text.questionOtherLabel}
                </label>
                {question.kind === 'short' ? (
                  <input
                    id={`${heading}-answer`}
                    className={c.fieldControl}
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onDraft({ value: event.target.value })}
                    maxLength={QUESTION_SHORT_POINTS * 2}
                  />
                ) : (
                  <textarea
                    id={`${heading}-answer`}
                    className={c.fieldControl}
                    placeholder={
                      question.kind === 'long' ? undefined : text.questionOtherPlaceholder
                    }
                    value={value}
                    disabled={disabled}
                    onChange={(event) => onDraft({ value: event.target.value })}
                    maxLength={QUESTION_LONG_BYTES}
                    rows={question.kind === 'long' ? 4 : 1}
                  />
                )}
              </div>
            )}
          </>
        )}
        {files && compose && (
          <PendingAttachments
            draft={files}
            disabled={!attachable}
            onRemoved={() => section.current?.focus({ preventScroll: true })}
          />
        )}
        {!readOnly && error && (!connectionPresentation || recorded) && (
          // Only a failure takes a line: the alert and its Retry stand on one row.
          <div className="question-status">
            <p role="alert">{error}</p>
            {onRetry && (
              <BrowserAction
                label="Retry"
                type="button"
                variant="text"
                disabled={disabled}
                onActivate={(event) => {
                  if (event.isTrusted) onRetry();
                }}
              />
            )}
          </div>
        )}
        {sharedAsk && <p className="question-shared-ask">{sharedAsk}</p>}
        {onOpenReply && (
          <BrowserAction
            label={`Open reply · ${replyLabel}`}
            visibleLabel="Open reply"
            type="button"
            variant="text"
            onActivate={(event) => {
              if (event.isTrusted) onOpenReply();
            }}
          />
        )}
        {threads.some((thread) => thread.comments.length) && (
          <div className="question-history">
            <h3 className={c.visuallyHidden}>
              Conversation
              {asks.some(
                (record) =>
                  record.reply && threads.some((thread) => thread.threadId === record.thread),
              )
                ? ' · Agent replied'
                : ''}
            </h3>
            {threads.map((thread) => (
              <div key={`${thread.ref.writer}:${thread.ref.id}`} className="question-history">
                {thread.comments.map((comment) => (
                  <CommentExchange
                    readOnly={readOnly}
                    answerText={
                      comment.ref.writer === answer?.ref.writer && comment.ref.id === answer?.ref.id
                        ? pageLine >= 0
                          ? answerText?.slice(0, pageLine)
                          : answerText
                        : undefined
                    }
                    key={`${comment.ref.writer}:${comment.ref.id}`}
                    comment={comment}
                    thread={thread}
                    binding={discussion}
                    ask={ask}
                    asks={asks}
                    blocked={blocked}
                    title={title}
                    retryInput={retryInput}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {answer && !changing && thread && discussion && !readOnly && (
          <AnnotationInput
            binding={ask}
            discussion={discussion}
            anchor={thread.anchor}
            thread={thread}
            asks={asks}
            title={title}
            creationRecipient={followUpRecipient}
            initialEdit={
              followUpRecipient?.label
                ? {
                    value: `@${followUpRecipient.label} `,
                    mentions: [
                      {
                        key: {
                          agent: followUpRecipient.agentId,
                          machine: followUpRecipient.machineId,
                        },
                        range: { start: 0, end: followUpRecipient.label.length + 1 },
                      },
                    ],
                    edited: false,
                  }
                : undefined
            }
            blocked={blocked}
            connectionPresentation={connectionPresentation}
            cancel={() => {}}
            committed={() => {}}
          />
        )}
      </div>
    </section>
  );
}

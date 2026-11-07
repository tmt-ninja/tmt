import { QuestionBlock } from '@tmt/browser-ui/blocks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AskBinding, PageAsk } from './ask-panel.js';
import type { BlockRecord } from './block-model.js';
import {
  questionCreator,
  type RegisteredQuestion,
  verifiedQuestionStates,
} from './question-registry.js';
import { answerOf, type Question, type QuestionGroup } from './questions.js';
import { text } from './strings.js';
import type { ThreadBinding } from './thread-store.js';
import type { ThreadView } from './thread-records.js';
import { emptyDraft, useQuestionAnswers } from './use-question-answers.js';
import type { PageCreator } from './question-registry.js';

/** What a page of blocks gives its question blocks to answer through: the page's registry and
 * discussion, as the HTML page's question layer has them. */
export interface QuestionPage {
  title: string;
  questions?: readonly RegisteredQuestion[];
  threads?: readonly ThreadView[];
  discussionPending?: boolean;
  creator?: PageCreator;
  creationRecipient?: { agentId: string };
  originalAuthor?: string;
  asks?: readonly PageAsk[];
  discussion?: ThreadBinding;
  ask?: AskBinding;
  /** No answer can be sent now (the page is not live, or this device may not write). */
  blocked: boolean;
}

const KINDS = ['single', 'multiple', 'short'] as const;

/** A question block's question, read from its untrusted props as plain values. */
export function blockQuestion(block: BlockRecord): Question {
  const kind = KINDS.find((value) => value === block.props.kind) ?? 'single';
  const choices = Array.isArray(block.props.choices)
    ? block.props.choices.filter((choice): choice is string => typeof choice === 'string')
    : [];
  return {
    id: block.id,
    title: block.text ?? '',
    kind,
    choices: kind === 'short' ? [] : choices.slice(0, 20).map((label) => ({ label })),
    other: kind !== 'short' && block.props.other === true,
    agent: typeof block.props.agent === 'string' ? block.props.agent : '',
    group: null,
    label: null,
  };
}

/**
 * A question block on a page of blocks (#6005): DS `QuestionBlock` drawn over the same answer path
 * as an HTML page's question card (`useQuestionAnswers`). The serve registered the question when
 * the block was inserted (`meta.questions`, keyed by the block ID), so the registry's agent, else
 * the page's creator, is the default recipient, and the answer is an ordinary discussion record
 * bound to the question.
 */
export function StructuredQuestion({ block, page }: { block: BlockRecord; page: QuestionPage }) {
  const question = useMemo(() => blockQuestion(block), [block]);
  const group = useMemo<QuestionGroup>(
    () => ({ id: question.id, title: null, questions: [question.id] }),
    [question.id],
  );
  const members = useMemo(() => [question], [question]);
  const threads = page.threads;
  const associated = useCallback(
    (id: string) =>
      (threads ?? []).filter(
        (thread) =>
          !thread.deleted &&
          thread.comments.some(
            (comment) =>
              !comment.deleted && comment.deviceAuthor === true && comment.questionId === id,
          ),
      ),
    [threads],
  );
  // A new answer thread is anchored on the question's own text.
  const selectors = useMemo(
    () => new Map([[question.id, { exact: question.title, prefix: '', suffix: '' }]]),
    [question.id, question.title],
  );
  const creator = questionCreator(page, text.unknownAuthor);
  const states = verifiedQuestionStates(page);
  const answers = useQuestionAnswers({
    group,
    members,
    selected: question.id,
    registry: page.questions,
    states,
    creator,
    associated,
    selectors,
    attached: true,
    discussion: page.discussion,
    ask: page.ask,
    asks: page.asks ?? [],
    title: page.title,
    blocked: page.blocked,
    readOnly: !page.discussion,
  });
  const row = answers.rows[0]!;
  // The part owns its selection until Send; the draft takes it, and the Send goes once the hook's
  // rows show that draft.
  const [sendNext, setSendNext] = useState(false);
  const { send } = answers;
  useEffect(() => {
    if (!sendNext || !row.eligible) return;
    setSendNext(false);
    void send();
  }, [sendNext, row.eligible, send]);
  const entry = page.questions?.find((value) => value.id === question.id);
  const state = states?.find((value) => value.id === question.id)?.state;
  const answered =
    row.echo ?? (row.answer ? (answerOf(question, row.answer.body) ?? row.answer.body) : undefined);
  // The answer goes to the registry's agent, else the page's creator (the serve registered the
  // block with no agent of its own). With neither, nothing can be asked: an error, never a blank.
  const recipient = answers.recipients[0]?.agentName ?? entry?.agent?.name ?? creator?.name;
  return (
    <QuestionBlock
      title={question.title}
      agent={recipient ?? text.questionNoAgent}
      kind={question.kind === 'long' ? 'short' : question.kind}
      choices={question.choices.map(({ label }) => label)}
      other={question.other}
      state={
        state === 'handled'
          ? 'dismissed'
          : answered !== undefined && !row.draft.changing
            ? 'answered'
            : 'waiting'
      }
      answer={answered}
      busy={answers.sending.includes(question.id) || answers.resolvingDefaults}
      error={
        recipient === undefined
          ? text.questionNoRecipient
          : row.draft.failed
            ? 'Could not confirm this answer. Your draft is kept for the next Send.'
            : answers.error
      }
      onSend={
        recipient === undefined || answers.disabled || !answers.decision.allowed
          ? undefined
          : (answer) => {
              answers.setDrafts((previous) => ({
                ...previous,
                [question.id]: {
                  ...(previous[question.id] ?? emptyDraft()),
                  choices: answer.choices,
                  other: answer.other !== undefined,
                  value: answer.other ?? answer.text ?? '',
                  failed: false,
                },
              }));
              setSendNext(true);
            }
      }
      onRetry={row.draft.failed ? () => void send() : undefined}
      onFollowUp={
        answered !== undefined
          ? () =>
              answers.setDrafts((previous) => ({
                ...previous,
                [question.id]: { ...(previous[question.id] ?? emptyDraft()), changing: true },
              }))
          : undefined
      }
    />
  );
}

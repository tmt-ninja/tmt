import { type SetStateAction, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnswerFiles } from './answer-files.js';
import { sendAnswers, type BatchAnswer } from './answer-batch.js';
import type { AskAgainInput } from './ask-again.js';
import type { AskBinding, PageAsk } from './ask-panel.js';
import { sameMessageIds } from './ask-records.js';
import { useAgentDirectory } from './agent-directory.js';
import type { MessageSendFailure } from './comment-send.js';
import type { AgentDestination } from './live-ask.js';
import {
  messageRecipient,
  recipientEdit,
  recipientId,
  MESSAGE_RECIPIENT_LIMIT,
} from './message-recipient.js';
import {
  answerComment,
  answerOf,
  canonicalQuestionThread,
  currentAnswer,
  type Question,
  type QuestionGroup,
} from './questions.js';
import type { QuestionState, RegisteredAgent, RegisteredQuestion } from './question-registry.js';
import type { QuestionDraft } from './components/question-card.js';
import type { CommentContext, ThreadBinding } from './thread-store.js';
import type { QuoteSelector, ThreadView } from './thread-records.js';

export interface Draft extends QuestionDraft {
  pending?: CommentContext;
  failed?: boolean;
}
export const emptyDraft = (): Draft => ({ choices: [], other: false, value: '', changing: false });
interface RecipientState {
  recipients: AgentDestination[];
  initialized: boolean;
  defaults?: string;
  manual?: boolean;
}
interface BlockState {
  recipients: RecipientState;
  error?: string;
  failures: MessageSendFailure[];
}
const emptyBlock = (): BlockState => ({
  recipients: { recipients: [], initialized: false },
  failures: [],
});

/** What the caller does around a Send: before it goes, when answers are recorded, after it. */
export interface SendHooks {
  before?(): void;
  recorded?(questionIds: readonly string[]): void;
  done?(): void;
}

export interface QuestionAnswersInput {
  group: QuestionGroup;
  members: readonly Question[];
  /** The member whose physical block owns the Send (a split group sends one at a time). */
  selected: string;
  registry?: readonly RegisteredQuestion[];
  states?: readonly QuestionState[];
  creator?: RegisteredAgent;
  associated(id: string): readonly ThreadView[];
  /** Where each question's answer thread is anchored when it has none yet. */
  selectors: ReadonlyMap<string, QuoteSelector>;
  attached: boolean;
  discussion?: ThreadBinding;
  ask?: AskBinding;
  asks: readonly PageAsk[];
  title: string;
  blocked: boolean;
  readOnly?: boolean;
  /** Called after an explicit Send recorded answers, with the recorded comments. */
  onRecorded?(questionIds: readonly string[], contexts: readonly CommentContext[]): void;
}

/**
 * The parent's answer path for one question group (#6005): its drafts and answer files, its
 * visible recipients and their defaults (the registry's agent, else the page's creator), the
 * Send that records the answers and asks the recipients (`sendAnswers`), its failures and the
 * retry of a frozen batch. The HTML page's question card and a page of blocks' question block
 * both answer through this one hook; each draws its own look around it.
 */
export function useQuestionAnswers({
  group,
  members,
  selected,
  registry,
  states,
  creator,
  associated,
  selectors,
  attached,
  discussion,
  ask,
  asks,
  title,
  blocked,
  readOnly = false,
  onRecorded,
}: QuestionAnswersInput) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // The attachment drafts live beside the text drafts and leave with the group.
  const attachments = useRef(discussion?.attachments);
  useEffect(() => {
    attachments.current = discussion?.attachments;
  }, [discussion?.attachments]);
  const [answerFiles] = useState(() => new AnswerFiles(() => attachments.current));
  useSyncExternalStore(answerFiles.subscribe, answerFiles.getSnapshot, answerFiles.getSnapshot);
  useEffect(() => () => answerFiles.dispose(), [answerFiles]);
  const filesOf = (question: string) =>
    discussion?.attachments ? answerFiles.draft(question) : undefined;
  const scopeMembers = group.split
    ? members.filter((question) => question.id === selected)
    : members;
  const blockId = group.split ? selected : group.id;
  const [blocks, setBlocks] = useState<Record<string, BlockState>>({});
  const block = blocks[blockId] ?? emptyBlock();
  function updateBlock<K extends keyof BlockState>(
    field: K,
    action: SetStateAction<BlockState[K]>,
  ) {
    setBlocks((previous) => {
      const old = previous[blockId] ?? emptyBlock();
      const value =
        typeof action === 'function'
          ? (action as (old: BlockState[K]) => BlockState[K])(old[field])
          : action;
      return { ...previous, [blockId]: { ...old, [field]: value } };
    });
  }
  const recipientState = block.recipients;
  const setRecipientState = (value: SetStateAction<RecipientState>) =>
    updateBlock('recipients', value);
  const recipients = recipientState.recipients;
  const error = block.error;
  const setError = (value: SetStateAction<string | undefined>) => updateBlock('error', value);
  const failures = block.failures;
  const setFailures = (value: SetStateAction<MessageSendFailure[]>) =>
    updateBlock('failures', value);
  const [sending, setSending] = useState<readonly string[]>([]);
  const busy = useRef(false);
  const { directory, retry } = useAgentDirectory(ask);
  const agents = directory.state === 'ready' ? directory.agents : undefined;
  // Commit the defaults in the same render as the resolved directory: an effect
  // would briefly expose an enabled comment-only Send before its chips appear.
  const defaultKey = JSON.stringify(
    scopeMembers.map((question) => {
      const entry = registry?.find((entry) => entry.id === question.id);
      return [question.id, registry === undefined ? question.agent : (entry?.agent ?? creator)?.id];
    }),
  );
  const hasDraft = scopeMembers.some((question) => {
    const draft = drafts[question.id];
    return (
      !!draft &&
      (!!draft.value ||
        draft.choices.length > 0 ||
        draft.other ||
        !!draft.pending ||
        !!draft.changing)
    );
  });
  // Only untouched empty draft defaults may refresh. Sent recipients belong to immutable
  // comments/Ask records, not this convenience state for a future Send.
  const defaultsReady = registry === undefined || states !== undefined;
  if (
    agents &&
    defaultsReady &&
    (!recipientState.initialized ||
      (!recipientState.manual &&
        recipientState.defaults !== defaultKey &&
        !hasDraft &&
        !busy.current))
  ) {
    const defaults: AgentDestination[] = [];
    for (const question of scopeMembers) {
      const entry = registry?.find((entry) => entry.id === question.id);
      const target = entry?.agent ?? creator;
      const matches = agents.filter((agent) =>
        registry === undefined
          ? agent.agentName === question.agent
          : target !== undefined && agent.agent === target.id,
      );
      if (matches.length !== 1) continue;
      const agent = matches[0];
      if (!defaults.some((other) => recipientId(other) === recipientId(agent)))
        defaults.push(agent);
      if (defaults.length === MESSAGE_RECIPIENT_LIMIT) break;
    }
    setRecipientState({ recipients: defaults, initialized: true, defaults: defaultKey });
  }
  const resolvingDefaults =
    !!ask && (!defaultsReady || (!recipientState.initialized && directory.state === 'loading'));
  // A recorded answer is released once its verified comment is in the discussion. The comment can
  // arrive before `pending` is set (the Ask is still being prepared when the record lands), so
  // the check follows the drafts as well as the discussion.
  useEffect(() => {
    setDrafts((previous) => {
      const verified = members.filter((question) => {
        const context = previous[question.id]?.pending;
        return (
          context &&
          associated(question.id).some((thread) =>
            thread.comments.some(
              (comment) =>
                !comment.deleted &&
                comment.deviceAuthor === true &&
                comment.ref.writer === context.message.writer &&
                comment.ref.id === context.message.id,
            ),
          )
        );
      });
      if (!verified.length) return previous;
      const next = { ...previous };
      for (const question of verified) next[question.id] = emptyDraft();
      return next;
    });
  }, [members, associated, drafts, setDrafts]);
  const edit = recipientEdit(recipients);
  const decision = messageRecipient({
    writable: !readOnly && !blocked && !!discussion,
    edit,
    destinations: agents,
  });
  const audience = recipients.map((agent) => `@${agent.agentName}`).join(', ');
  const rows = members.map((question) => {
    const draft = drafts[question.id] ?? emptyDraft();
    const threads = associated(question.id);
    const thread = canonicalQuestionThread(question, threads);
    const answer = currentAnswer(question, thread?.comments ?? []);
    const body = answerComment(
      question,
      draft.choices,
      draft.value,
      draft.other,
      title,
      edit.value,
    );
    // A file still uploading holds back this answer alone.
    const eligible =
      !!body &&
      (!answer || draft.changing || draft.failed) &&
      !draft.pending &&
      !answerFiles.uploading(question.id);
    // From Send until the verified record arrives, the answer being sent stands on its line and
    // the card is folded: the page moves once, at Send, and the record and the Ask move nothing.
    // Display only: nothing here is a record, and a failure drops it, re-opening the card.
    const echo =
      !readOnly && (sending.includes(question.id) || !!draft.pending) && body !== undefined
        ? answerOf(question, body)
        : undefined;
    return { question, draft, threads, thread, answer, body, eligible, echo };
  });
  const pending = rows.filter(
    (row) => row.eligible && scopeMembers.some((question) => question.id === row.question.id),
  );
  const sendingCount = sending.length || pending.length;
  const sendLabel =
    scopeMembers.length === 1
      ? 'Send answer'
      : sendingCount === 0
        ? 'Send answers'
        : `Send ${sendingCount} ${sendingCount === 1 ? 'answer' : 'answers'}`;
  const disabled = blocked || readOnly || !!sending.length || !discussion;
  async function send(ui: SendHooks = {}) {
    if (
      busy.current ||
      disabled ||
      resolvingDefaults ||
      !decision.allowed ||
      !pending.length ||
      !attached
    )
      return;
    const answers: BatchAnswer[] = [];
    for (const row of pending) {
      const selector = selectors.get(row.question.id);
      if (!selector) return;
      answers.push({
        question: structuredClone(row.question),
        body: row.body!,
        selector: structuredClone(selector),
        ...(row.thread ? { thread: structuredClone(row.thread) } : {}),
        files: filesOf(row.question.id),
      });
    }
    ui.before?.();
    busy.current = true;
    setSending(answers.map((answer) => answer.question.id));
    setError(undefined);
    try {
      const result = await sendAnswers(
        { discussion: discussion!, ask },
        {
          group: structuredClone(group),
          answers,
          recipients: structuredClone(decision.agents),
          title,
          url: location.href,
        },
        asks,
      );
      if ('refused' in result) {
        setError('These answers are too long to send together. Send fewer answers.');
        return;
      }
      setDrafts((previous) => {
        const next = { ...previous };
        for (const outcome of result.answers)
          next[outcome.question] = {
            ...(previous[outcome.question] ?? emptyDraft()),
            pending: outcome.state === 'recorded' ? outcome.context : undefined,
            failed: outcome.state === 'failed',
            ...(outcome.state === 'failed' ? { changing: true } : {}),
          };
        return next;
      });
      setFailures((previous) => [...previous, ...result.failures]);
      const recorded = result.answers.filter((outcome) => outcome.state === 'recorded');
      if (recorded.length)
        onRecorded?.(
          recorded.map((outcome) => outcome.question),
          recorded.map((outcome) => outcome.context!),
        );
      if (recorded.length) ui.recorded?.(recorded.map((outcome) => outcome.question));
      ui.done?.();
    } catch {
      setError('Could not confirm these answers. Your drafts are kept.');
    } finally {
      busy.current = false;
      setSending([]);
    }
  }
  /** Reload derives the same batch from admitted records and verified own answer comments. */
  function retryInput(record: PageAsk): AskAgainInput | undefined {
    if (!record.messageIds || record.messageIds.length < 2) return;
    const answers = rows.flatMap(({ question, threads }) =>
      threads.flatMap((thread) =>
        thread.comments
          .filter(
            (comment) =>
              !comment.deleted &&
              comment.deviceAuthor === true &&
              comment.ref.writer === record.writer &&
              record.messageIds!.includes(comment.messageId) &&
              (comment.questionId === question.id ||
                (comment.questionId === undefined &&
                  answerOf(question, comment.body) !== undefined)),
          )
          .map((comment) => ({
            question: question.id,
            thread,
            comment,
            context: {
              thread: thread.ref,
              threadRevision: thread.revision,
              message: comment.ref,
              messageRevision: comment.revision,
            },
          })),
      ),
    );
    if (answers.length !== record.messageIds.length) return;
    const canonical = answers.find((answer) => answer.thread.threadId === record.thread);
    if (
      !canonical ||
      canonical !== answers[0] ||
      !sameMessageIds(record.messageIds, answers.map((answer) => answer.context.message.id).sort())
    )
      return;
    return {
      context: canonical.context,
      quote: canonical.thread.anchor?.exact ?? '',
      comment: canonical.comment.body,
      title,
      url: location.href,
      batch: {
        group: group.id,
        answers: answers.map(({ question, context }) => ({ question, context })),
      },
    };
  }
  return {
    drafts,
    setDrafts,
    filesOf,
    answerFiles,
    scopeMembers,
    recipients,
    setRecipientState,
    error,
    failures,
    setFailures,
    sending,
    directory,
    retryDirectory: retry,
    agents,
    resolvingDefaults,
    edit,
    decision,
    audience,
    rows,
    pending,
    sendLabel,
    disabled,
    send,
    retryInput,
  };
}

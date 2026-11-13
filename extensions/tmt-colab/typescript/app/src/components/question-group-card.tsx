import { BrowserAction, BrowserChips } from '@tmt/browser-ui/react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { QuestionState, RegisteredAgent, RegisteredQuestion } from '../question-registry.js';
import { QuestionLine } from './question-line.js';
import { AnsweredStrip } from './answered-strip.js';
import { QuestionAnswerCard } from './question-answer-card.js';
import { AgentChip, AgentList, agentSentence } from './agent-chip.js';
import type { AnchorPosition } from '../renderer.js';
import type { ComposerConnectionPresentation } from '../router.js';
import { AttachButton } from '../attachment-tray.js';
import { askedMessageIds } from '../answer-batch.js';
import type { AskBinding, PageAsk } from '../ask-panel.js';
import { sameMessageIds } from '../ask-records.js';
import { CommentSendFailures } from '../comment-send-failures.js';
import { recipientId, MESSAGE_RECIPIENT_LIMIT } from '../message-recipient.js';
import { answerOf, draftOf, type Question, type QuestionGroup } from '../questions.js';
import type { CommentContext, ThreadBinding } from '../thread-store.js';
import { conversationAsks } from '../thread-store.js';
import type { QuoteSelector, ThreadView } from '../thread-records.js';
import { text } from '../strings.js';
import { useNotificationModalPresence } from '../reply-notification-context.js';
import { QuestionCard } from './question-card.js';
import { emptyDraft, useQuestionAnswers } from '../use-question-answers.js';

/** One admitted group owns all drafts, visible recipients, publication outcomes and its footer. */
export function QuestionGroupCard({
  group,
  registry,
  states,
  creator,
  members,
  selected,
  onSelect,
  associated,
  selectors,
  attached,
  placement,
  discussion,
  ask,
  asks,
  title,
  blocked,
  readOnly = false,
  expanded,
  onToggle,
  onCollapse,
  renderBlock,
  connectionPresentation,
  onRecorded,
  onDismiss,
}: {
  group: QuestionGroup;
  registry?: readonly RegisteredQuestion[];
  states?: readonly QuestionState[];
  creator?: RegisteredAgent;
  members: readonly Question[];
  selected: string;
  onSelect(id: string): void;
  associated(id: string): readonly ThreadView[];
  selectors: ReadonlyMap<string, QuoteSelector>;
  attached: boolean;
  placement?: AnchorPosition;
  discussion?: ThreadBinding;
  ask?: AskBinding;
  asks: readonly PageAsk[];
  title: string;
  blocked: boolean;
  readOnly?: boolean;
  expanded: boolean;
  onToggle(id: string): void;
  onCollapse(): void;
  renderBlock(id: string, content: ReactNode): ReactNode;
  connectionPresentation?: ComposerConnectionPresentation;
  /** Called after an explicit Send recorded answers, with the recorded comments. */
  onRecorded?(questionIds: readonly string[], contexts: readonly CommentContext[]): void;
  onDismiss?(id: string): void;
}) {
  const {
    setDrafts,
    filesOf,
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
    decision,
    audience,
    rows,
    pending,
    sendLabel,
    disabled,
    send: sendAnswersOf,
    retryInput,
  } = useQuestionAnswers({
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
    readOnly,
    onRecorded,
  });
  const [query, setQuery] = useState('');
  const lines = useRef(new Map<string, HTMLElement>());
  const focusAfterSend = useRef<string | undefined>(undefined);
  const [focusReply, setFocusReply] = useState<{ id: string; placement?: AnchorPosition }>();
  const disclosure = useRef({ selected, expanded, version: 0 });
  if (disclosure.current.selected !== selected || disclosure.current.expanded !== expanded)
    disclosure.current = { selected, expanded, version: disclosure.current.version + 1 };
  const [focusChange, setFocusChange] = useState<{
    version: number;
    questions: readonly string[];
  }>();
  const section = useRef<HTMLDivElement>(null);
  const modalPresence = useNotificationModalPresence();
  useEffect(() => {
    if (!focusReply || focusReply.id !== selected || !attached || !selectors.has(selected)) return;
    // Changing the open question retires its previous controls. Focus after the slot owner
    // admits the destination's placement, rather than on the old visible geometry.
    if (!placement || placement === focusReply.placement) return;
    const node = section.current
      ?.querySelector<HTMLElement>(`[id="question-panel-${selected}"] [data-testid="ask-reply"]`)
      ?.closest<HTMLElement>('[data-operation-id]');
    if (!node || section.current?.closest('[data-detached="true"]')) return;
    node.focus({ preventScroll: true });
    if (node.ownerDocument.activeElement === node) setFocusReply(undefined);
  }, [focusReply, selected, attached, placement, selectors, associated, asks]);
  // The Send row belongs to its physical answer block. A folded answered line
  // never shows it; Change answer restores it. A wrapper can still submit drafts
  // from its other questions through this same footer.
  const active = rows.find(
    (row) => row.question.id === (members.length > 1 ? selected : members[0].id),
  );
  const composing = !!active && (!active.answer || active.draft.changing);
  const activeAnswered = !!active && !composing;
  const sendable =
    composing || (members.length > 1 && rows.some((row) => !row.answer || row.draft.changing));

  // Only an admitted answer closes the disclosure. Recording or layout alone cannot do it.
  useEffect(() => {
    if (!focusChange) return;
    if (focusChange.version !== disclosure.current.version) {
      setFocusChange(undefined);
      return;
    }
    if (!expanded || !focusChange.questions.includes(selected) || !activeAnswered) return;
    setFocusChange(undefined);
    onCollapse();
    const index = members.findIndex((question) => question.id === selected);
    const next = [...rows.slice(index + 1), ...rows.slice(0, index)].find((row) => !row.answer);
    lines.current.get(next?.question.id ?? selected)?.focus({ preventScroll: true });
  }, [focusChange, activeAnswered, selected, expanded, members, rows, onCollapse]);
  async function send() {
    const disclosureVersion = disclosure.current.version;
    await sendAnswersOf({
      before() {
        setFocusReply(undefined);
        setFocusChange(undefined);
        // The panel folds with this Send; focus stays on its line instead of falling to the page.
        if (section.current?.contains(document.activeElement)) {
          focusAfterSend.current = selected;
          lines.current.get(selected)?.focus({ preventScroll: true });
        }
        // Keep the chosen disclosure until its recorded answers are verified.
        onSelect(selected);
      },
      recorded(questions) {
        setFocusChange({ version: disclosureVersion, questions });
      },
      done() {
        // Focus the group only when it fell to the page; a line that took it at Send keeps it.
        if (!section.current?.contains(document.activeElement))
          section.current?.focus({ preventScroll: true });
      },
    });
  }
  function card(question: Question) {
    const row = rows.find((value) => value.question.id === question.id)!;
    const records = conversationAsks(row.thread, asks).filter(
      (record) => row.answer && record.messageIds?.includes(row.answer.messageId),
    );
    const batch = records.filter((record) => (record.messageIds?.length ?? 0) > 1);
    const canonical = rows.find((value) =>
      value.threads.some((thread) => thread.threadId === batch[0]?.thread),
    );
    const names = [
      ...new Map(records.map((record) => [recipientId(record), record.agentName])).values(),
    ];
    const sharedAsk = records.length ? (
      <>
        Asked <AgentList names={names} />
        {batch.length ? ` with ${batch[0].messageIds!.length} answers.` : ''}
      </>
    ) : undefined;
    const hasOtherReply =
      canonical &&
      canonical.question.id !== question.id &&
      batch.some((record) => record.reply !== undefined);
    return (
      <QuestionCard
        key={question.id}
        question={question}
        followUpRecipient={(() => {
          const agent = registry?.find((entry) => entry.id === question.id)?.agent ?? creator;
          return agent ? { agentId: agent.id, label: agent.name } : undefined;
        })()}
        draft={row.draft}
        onDraft={(patch) =>
          setDrafts((previous) => ({
            ...previous,
            [question.id]: { ...(previous[question.id] ?? emptyDraft()), ...patch, failed: false },
          }))
        }
        threads={row.threads}
        discussion={discussion}
        ask={ask}
        asks={asks.filter(
          (record) =>
            (record.messageIds?.length ?? 0) < 2 ||
            row.threads.some((thread) => thread.threadId === record.thread),
        )}
        title={title}
        blocked={blocked}
        readOnly={readOnly}
        connectionPresentation={connectionPresentation}
        busy={sending.includes(question.id)}
        recorded={!!row.draft.pending}
        body={row.body}
        error={
          row.draft.failed
            ? 'Could not confirm this answer. Your draft is kept for the next Send.'
            : undefined
        }
        sharedAsk={sharedAsk}
        replyLabel={canonical?.question.label ?? `Q${canonical ? rows.indexOf(canonical) + 1 : 1}`}
        onOpenReply={
          hasOtherReply
            ? () => {
                onSelect(canonical.question.id);
                setFocusReply({ id: canonical.question.id, placement });
              }
            : undefined
        }
        onSend={
          scopeMembers.length === 1
            ? () => {
                void send();
              }
            : undefined
        }
        onRetry={
          row.draft.failed
            ? () => {
                void send();
              }
            : undefined
        }
        retryInput={retryInput}
        files={filesOf(question.id)}
      />
    );
  }
  const options = (agents ?? [])
    .filter((agent) => agent.agentName.toLowerCase().includes(query.toLowerCase()))
    .map((agent) => ({
      id: recipientId(agent),
      label: `@${agent.agentName}`,
      content: <AgentChip name={agent.agentName} />,
      description: agent.machineName,
      disabled: agent.online !== 'online',
    }));
  const footer = !readOnly && (
    <div className="question-group-footer">
      {sendable && (
        <>
          <div className="question-group-send">
            <div className="question-recipients">
              <span className="question-goes-to">{text.questionGoesTo}</span>
              <BrowserChips
                onOpenChange={modalPresence}
                label="Answer recipients"
                items={recipients.map((agent) => ({
                  id: recipientId(agent),
                  label: `@${agent.agentName}`,
                  content: <AgentChip name={agent.agentName} />,
                  removeLabel: `Remove @${agent.agentName}`,
                }))}
                options={options}
                query={query}
                onQueryChange={setQuery}
                addLabel="Add recipient"
                searchLabel="Find an agent"
                emptyText={resolvingDefaults ? '' : 'No agents match.'}
                maxItems={MESSAGE_RECIPIENT_LIMIT}
                limitText="At most 8"
                statusText={
                  directory.state === 'failed'
                    ? text.messageAgentsUnavailable
                    : directory.state === 'loading' && ask && !resolvingDefaults
                      ? text.messageAgentsChecking
                      : undefined
                }
                disabled={disabled}
                addDisabled={directory.state !== 'ready'}
                focusFallback={() => section.current}
                onAdd={(id, event) => {
                  if (!event.isTrusted || disabled || recipients.length >= MESSAGE_RECIPIENT_LIMIT)
                    return;
                  const matches =
                    agents?.filter(
                      (agent) => recipientId(agent) === id && agent.online === 'online',
                    ) ?? [];
                  if (matches.length !== 1 || recipients.some((agent) => recipientId(agent) === id))
                    return;
                  setRecipientState((previous) => ({
                    recipients: [...previous.recipients, matches[0]],
                    initialized: true,
                    manual: true,
                  }));
                  setQuery('');
                }}
                onRemove={(id, event) => {
                  if (!event.isTrusted || disabled) return;
                  setRecipientState((previous) => ({
                    recipients: previous.recipients.filter((agent) => recipientId(agent) !== id),
                    initialized: true,
                    manual: true,
                  }));
                }}
              />
            </div>
            <div className="question-footer-actions">
              {filesOf(selected) && (
                <AttachButton
                  draft={filesOf(selected)!}
                  disabled={
                    disabled ||
                    !active ||
                    !(
                      active.question.kind === 'short' ||
                      active.question.kind === 'long' ||
                      active.draft.other
                    )
                  }
                />
              )}
              <BrowserAction
                label={`${sendLabel} · to ${audience || 'thread only'}`}
                visibleLabel="Send"
                type="button"
                variant="primary"
                busy={resolvingDefaults}
                disabled={
                  disabled ||
                  resolvingDefaults ||
                  !attached ||
                  !pending.length ||
                  !decision.allowed ||
                  pending.some((row) => !selectors.has(row.question.id))
                }
                onActivate={(event) => {
                  if (event.isTrusted) void send();
                }}
              />
            </div>
          </div>
          {connectionPresentation ? (
            <p className="annotation-hint" role="status">
              {connectionPresentation.body}
            </p>
          ) : (
            <p className="annotation-hint" role="status">
              {resolvingDefaults
                ? text.messageAgentsChecking
                : decision.unavailable.length
                  ? agentSentence(text.messageRecipientUnavailable, decision.unavailable[0])
                  : !recipients.length
                    ? 'Stays on the page, no one is asked'
                    : undefined}
            </p>
          )}
          {!connectionPresentation && directory.state === 'failed' && (
            <BrowserAction
              label={text.messageAgentsRetry}
              variant="text"
              type="button"
              disabled={!!sending.length}
              onActivate={(event) => {
                if (event.isTrusted) retry();
              }}
            />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <CommentSendFailures
        failures={failures.filter(
          (failure) =>
            !asks.some(
              (record) =>
                record.agent === failure.recipient.agent &&
                record.machine === failure.recipient.machine &&
                sameMessageIds(record.messageIds ?? [], askedMessageIds(failure.input)),
            ),
        )}
        binding={ask}
        blocked={disabled}
        settled={(failure, outcome) =>
          setFailures((previous) =>
            outcome.adopted === true
              ? previous.filter((item) => item !== failure)
              : outcome.adopted === false
                ? previous
                : previous.map((item) => (item === failure ? { ...item, uncertain: true } : item)),
          )
        }
      />
    </div>
  );
  const physical = group.split ? rows.map((row) => [row]) : [rows];
  return (
    <div
      className="question-group-card"
      data-split={group.split || undefined}
      data-question-group={group.id}
      data-detached={!attached || undefined}
      ref={section}
      tabIndex={-1}
    >
      {physical.map((blockRows) => {
        const id = group.split ? blockRows[0].question.id : group.id;
        // Answered strips keep their original order; remaining questions stay together in one card.
        const isAnswered = (row: (typeof blockRows)[number]) =>
          !!row.echo || (!row.draft.changing && !!row.answer);
        const orderedRows = [
          ...blockRows.filter(isAnswered),
          ...blockRows.filter((row) => !isAnswered(row)),
        ];
        return (
          <Fragment key={id}>
            {renderBlock(
              id,
              <QuestionAnswerCard
                label={group.title ?? blockRows[0].question.title}
                multiple={blockRows.length > 1}
              >
                {orderedRows.map((row) => {
                  const answered =
                    row.echo ??
                    (row.draft.changing
                      ? undefined
                      : row.answer
                        ? (answerOf(row.question, row.answer.body) ?? row.answer.body)
                        : undefined);
                  const open =
                    answered === undefined ||
                    (expanded && selected === row.question.id && row.echo === undefined);
                  const panelId = `question-panel-${row.question.id}`;
                  return (
                    <div
                      key={row.question.id}
                      className="question-group-row"
                      data-answered={answered !== undefined || undefined}
                      onFocusCapture={(event) => {
                        // The shared footer belongs to the group, not the last rendered question.
                        if ((event.target as HTMLElement).closest('.question-group-footer')) return;
                        if (selected !== row.question.id) onSelect(row.question.id);
                      }}
                    >
                      {answered !== undefined ? (
                        <AnsweredStrip
                          ref={(node) => {
                            if (node) {
                              lines.current.set(row.question.id, node);
                              if (focusAfterSend.current === row.question.id) {
                                focusAfterSend.current = undefined;
                                if (document.activeElement === document.body)
                                  node.focus({ preventScroll: true });
                              }
                            } else lines.current.delete(row.question.id);
                          }}
                          question={row.question}
                          answer={answered}
                          pending={row.echo !== undefined}
                          expanded={open}
                          panelId={panelId}
                          onToggle={() => onToggle(row.question.id)}
                          onChangeAnswer={
                            !readOnly
                              ? () =>
                                  setDrafts((previous) => ({
                                    ...previous,
                                    [row.question.id]: {
                                      ...(previous[row.question.id] ?? emptyDraft()),
                                      // Change answer starts from the answer it changes.
                                      ...draftOf(row.question, answered),
                                      changing: true,
                                    },
                                  }))
                              : undefined
                          }
                          onDismiss={onDismiss ? () => onDismiss(row.question.id) : undefined}
                          onFollowUp={() =>
                            section.current
                              ?.querySelector<HTMLElement>(
                                `[id="${panelId}"] textarea, [id="${panelId}"] [contenteditable]`,
                              )
                              ?.focus()
                          }
                        />
                      ) : (
                        <QuestionLine
                          ref={(node) => {
                            if (node) lines.current.set(row.question.id, node);
                            else lines.current.delete(row.question.id);
                          }}
                          question={row.question}
                          agent={
                            registry?.find((entry) => entry.id === row.question.id)?.agent?.name ??
                            creator?.name
                          }
                        />
                      )}
                      <div
                        id={panelId}
                        className="question-compact-controls"
                        hidden={!open}
                        tabIndex={-1}
                        onKeyDown={(event) => {
                          if (
                            event.isTrusted &&
                            !event.defaultPrevented &&
                            event.key === 'Escape' &&
                            !event.repeat &&
                            !event.nativeEvent.isComposing &&
                            event.keyCode !== 229 &&
                            !event.altKey &&
                            !event.ctrlKey &&
                            !event.metaKey &&
                            !event.shiftKey
                          ) {
                            event.preventDefault();
                            onCollapse();
                            lines.current.get(row.question.id)?.focus();
                            return;
                          }
                          if (
                            !event.isTrusted ||
                            event.defaultPrevented ||
                            event.nativeEvent.isComposing ||
                            event.altKey ||
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey ||
                            !/^[1-9]$/.test(event.key)
                          )
                            return;
                          // A digit picks a row from anywhere in the card except a text field; on a
                          // choice itself it moves the pick and the focus together.
                          const target = event.target as HTMLElement;
                          if (
                            target.closest(
                              'input:not([type="radio"],[type="checkbox"]),textarea,[contenteditable],[role="combobox"],[role="listbox"]',
                            )
                          )
                            return;
                          const option = [
                            ...event.currentTarget.querySelectorAll<HTMLInputElement>(
                              `input[data-choice-index="${event.key}"]`,
                            ),
                          ].find((input) => !input.disabled && !input.closest('[hidden]'));
                          if (option) {
                            event.preventDefault();
                            option.click();
                            if (target instanceof HTMLInputElement) option.focus();
                          }
                        }}
                      >
                        {card(row.question)}
                        {row.question.id ===
                          (group.split
                            ? selected
                            : [...orderedRows]
                                .reverse()
                                .find((candidate) => !candidate.answer || candidate.draft.changing)
                                ?.question.id) && footer}
                      </div>
                    </div>
                  );
                })}
                {!sendable && (error || failures.length > 0) && footer}
              </QuestionAnswerCard>,
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

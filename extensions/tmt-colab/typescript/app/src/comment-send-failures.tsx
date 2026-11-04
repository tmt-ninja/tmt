import { useContext } from 'react';
import { AgentChip } from './components/agent-chip.js';
import { ConversationPresentation } from './components/conversation-presentation.js';
import { AskAgainAction } from './ask-again.js';
import type { AskBinding } from './ask-panel.js';
import type { MessageSendFailure } from './comment-send.js';
import { NoticeLine } from './components/notice-line.js';
import { text } from './strings.js';

/** Retained pre-adoption/uncertain outcomes use the same explicit retry as annotations. */
export function CommentSendFailures({
  failures,
  binding,
  blocked,
  settled,
}: {
  failures: readonly MessageSendFailure[];
  binding?: AskBinding;
  blocked: boolean;
  settled(failure: MessageSendFailure, result: { adopted?: boolean }): void;
}) {
  const chat = useContext(ConversationPresentation) === 'chat';
  return (
    <>
      {failures.map((failure) => (
        <div
          role="status"
          data-testid="recipient-failure"
          data-message-id={failure.message}
          // One row per recipient of a message: a settled row leaves without renaming the rest.
          key={`${failure.message}:${failure.recipient.machine}:${failure.recipient.agent}`}
        >
          <NoticeLine more={failure.uncertain ? text.askUncertain : undefined}>
            {chat && !failure.uncertain && <span aria-hidden="true">✗ </span>}
            <AgentChip name={failure.agent} /> ·{' '}
            {failure.uncertain ? text.askUnconfirmed : text.askNotDelivered}
          </NoticeLine>
          {/* Beside the words, so a long agent name ends in an ellipsis and Ask again stays. */}
          {!failure.uncertain && (
            <AskAgainAction
              binding={binding}
              blocked={blocked}
              input={failure.input}
              recipient={failure.recipient}
              retryOf={null}
              settled={(outcome) => settled(failure, outcome)}
            />
          )}
        </div>
      ))}
    </>
  );
}

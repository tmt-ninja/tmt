import { BrowserIconAction } from '@tmt/browser-ui/react';
import type { RichInputChipViewProps } from '@tmt/browser-ui/rich-input';
import { X } from 'lucide-react';
import { AgentChip } from './agent-chip.js';
import { createContext, useContext } from 'react';
import type { AgentDestination } from '../live-ask.js';
import { text } from '../strings.js';
import type { RecipientKey } from './message-composer-edit.js';
import { recipientMatches } from '../message-recipient.js';

/** Presentation follows this composer's current directory; node identity keeps routing UUIDs. */
export const MessageMentionContext = createContext<{
  candidates?: readonly AgentDestination[];
  disabled: boolean;
}>({ disabled: false });

/** The composer's chip look: a mention chip renders as the agent it routes to. */
export function MessageMentionView(chip: RichInputChipViewProps) {
  const data = chip.data as { recipient: RecipientKey; defaultCreator?: true };
  return (
    <MessageMentionChip
      token={chip.text}
      recipient={data.recipient}
      defaultCreator={data.defaultCreator === true}
      remove={chip.remove}
    />
  );
}

function MessageMentionChip({
  token,
  recipient,
  defaultCreator,
  remove,
}: {
  token: string;
  recipient: RecipientKey;
  defaultCreator: boolean;
  remove(): void;
}) {
  const { candidates, disabled } = useContext(MessageMentionContext);
  const matches = candidates?.filter((agent) => recipientMatches(recipient, agent));
  const agent = matches?.length === 1 ? matches[0] : undefined;
  const state = !candidates
    ? 'checking'
    : !agent
      ? defaultCreator || recipient.machine === undefined
        ? 'unknown'
        : 'not-found'
      : agent.online !== 'online' || agent.presence === 'offline'
        ? 'offline'
        : agent.presence === 'active'
          ? 'online'
          : 'unknown';
  const sameName =
    agent && candidates!.filter((other) => other.agentName === agent.agentName).length > 1;
  const description = text.messageMentionDescription(
    agent ? `@${agent.agentName}` : token,
    agent?.machineName,
    text.messageMentionState[state],
  );
  return (
    <AgentChip
      name={token}
      machine={sameName ? agent.machineName : undefined}
      state={state}
      variant="chip"
      mark={false}
      title={description}
    >
      <BrowserIconAction
        type="button"
        variant="text"
        label={text.messageMentionRemove(description)}
        icon={<X />}
        disabled={disabled}
        onActivate={(event) => {
          if (event.isTrusted) remove();
        }}
      />
    </AgentChip>
  );
}

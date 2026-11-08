import { useRef, useState } from 'react';
import { useAgentDirectory } from './agent-directory.js';
import type { ReaderMetadata } from './link-metadata.js';
import {
  RecipientRefused,
  canChooseRecipient,
  chooseRecipient,
  recipientAgents,
  type RecipientSender,
} from './question-recipient.js';
import type { RegisteredQuestion } from './question-registry.js';
import { text } from './strings.js';
import type { PageBinding, PageView } from './transport.js';

/** Choosing the agent that receives each question's answers, from the seam this browser holds: the
 * owner device's `metadata` frame, or an editor link's request. A reader or a commenter has
 * neither, so `enabled` is false and nothing is offered. One choice at a time: the next waits for
 * the first to settle, and a refusal keeps the question's current recipient and says why. */
export function useQuestionRecipient(
  view: PageView,
  binding?: PageBinding,
  reader?: ReaderMetadata,
) {
  const latest = useRef(view);
  latest.current = view;
  const open = !view.archived && view.pageType !== 'shell';
  const owner = open && binding?.canMetadata?.() === true;
  const link = open && !owner && reader !== undefined;
  const sender: RecipientSender = owner
    ? {
        owner: async (body) => {
          const version = await binding!.metadataRevision!(latest.current);
          await binding!.metadata!('question.agent', body, version);
        },
      }
    : link
      ? { link: (input) => reader!.send(input) }
      : {};
  const enabled = canChooseRecipient(sender);
  const { directory, retry } = useAgentDirectory(enabled ? binding?.ask : undefined);
  const [pending, setPending] = useState<string>();
  const [failure, setFailure] = useState<{ question: string; message: string }>();
  const busy = useRef(false);
  async function choose(question: RegisteredQuestion, agent: string | null) {
    if (!enabled || busy.current) return;
    busy.current = true;
    setPending(question.id);
    setFailure(undefined);
    try {
      await chooseRecipient(question, agent, sender);
    } catch (error) {
      setFailure({
        question: question.id,
        message: error instanceof RecipientRefused ? error.message : text.metadata.unavailable,
      });
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  }
  return {
    enabled,
    directory,
    hasDirectory: binding?.ask !== undefined,
    retry,
    agents: directory.state === 'ready' ? recipientAgents(directory.agents) : [],
    pending,
    /** The refusal to show on `question`, until its next choice. */
    error: (question: string) => (failure?.question === question ? failure.message : undefined),
    choose,
  };
}

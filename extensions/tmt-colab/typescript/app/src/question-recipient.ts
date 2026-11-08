/** Choosing the agent that receives a question's answers (#6197). Pure: the owner's `metadata`
 * frame and an editor link's request are injected, so both seams share one rule. The browser sends
 * the identity it picked and never a label; the owner's serve resolves it, or refuses with an
 * identity code that reads here as `RecipientRefused`. */
import type { MetadataInput, MetadataOutcome } from './link-metadata.js';
import type { RegisteredQuestion } from './question-registry.js';
import { text } from './strings.js';

const t = text.metadata;

/** One choice in the picker: an identity of the directory, once. */
export interface RecipientAgent {
  id: string;
  name: string;
}
/** The directory's agents, each identity once, in the directory's order. */
export function recipientAgents(
  directory: readonly { agent: string; agentName: string }[],
): RecipientAgent[] {
  const seen = new Map<string, RecipientAgent>();
  for (const { agent, agentName } of directory)
    if (!seen.has(agent)) seen.set(agent, { id: agent, name: agentName });
  return [...seen.values()];
}
/** The agent that receives a question's answers by its own registration; `null` follows the page's
 * creator. */
export const currentRecipient = (entry: RegisteredQuestion): string | null =>
  entry.agent?.id ?? null;

type AgentInput = Extract<MetadataInput, { action: 'question.agent' }>;
/** The body of the request: the question and, to choose one, the identity (no label). */
export function recipientBody(entry: RegisteredQuestion, agent: string | null): AgentInput['body'] {
  return agent === null ? { id: entry.id } : { id: entry.id, selector: agent };
}
/** An editor link's request: the same body, with the observed entry as its target. */
export function recipientRequest(entry: RegisteredQuestion, agent: string | null): AgentInput {
  return {
    action: 'question.agent',
    body: recipientBody(entry, agent),
    target: structuredClone(entry) as unknown as Record<string, unknown>,
  };
}

/** The owner declined or could not settle the choice; nothing changed unless `unconfirmed`. */
export class RecipientRefused extends Error {
  constructor(
    message: string,
    /** The owner's refusal code, when it gave one (an identity code or `COLAB_STALE_BASE`). */
    readonly code?: string,
    /** The request may still apply: check it, never send it again. */
    readonly unconfirmed = false,
  ) {
    super(message);
  }
}

/** The two ways a browser may write a question's registry entry, whichever it holds. */
export interface RecipientSender {
  /** The owner device: reads the page's revision and sends the `metadata` frame. */
  owner?(body: AgentInput['body']): Promise<void>;
  /** An editor link: sends the request and observes the owner's receipt. */
  link?(input: AgentInput): Promise<MetadataOutcome | undefined>;
}
/** Whether this browser can choose a recipient at all. */
export const canChooseRecipient = (send: RecipientSender) =>
  send.owner !== undefined || send.link !== undefined;

/** Sets (or, with `null`, clears) the recipient of `entry` through the seam the browser holds. A
 * refusal, an unsettled request or a failed send is a `RecipientRefused` with a sentence for the
 * person; resolves when the choice applied. */
export async function chooseRecipient(
  entry: RegisteredQuestion,
  agent: string | null,
  send: RecipientSender,
): Promise<void> {
  if (agent === currentRecipient(entry)) return;
  if (send.owner) {
    try {
      await send.owner(recipientBody(entry, agent));
    } catch (failure) {
      throw new RecipientRefused(
        failure instanceof Error ? failure.message : t.unavailable,
        (failure as { code?: unknown } | null)?.code as string | undefined,
      );
    }
    return;
  }
  if (!send.link) throw new RecipientRefused(t.recipientOwnerOnly);
  const outcome = await send.link(recipientRequest(entry, agent)).catch(() => {
    throw new RecipientRefused(t.requestInvalid);
  });
  switch (outcome?.state) {
    case 'applied':
      return;
    case 'refused':
      throw new RecipientRefused(outcome.message, outcome.code);
    case 'unconfirmed':
      throw new RecipientRefused(t.requestUnconfirmed, undefined, true);
    case 'ended':
      throw new RecipientRefused(text.readerEnded);
    case 'not-sent':
      throw new RecipientRefused(t.notSent);
    default:
      throw new RecipientRefused(t.requestInvalid);
  }
}

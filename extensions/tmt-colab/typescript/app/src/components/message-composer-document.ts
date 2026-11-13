import {
  $isRichInputChip,
  $replaceRichInput,
  RichInputChipNode,
  $richInputText as $messageText,
  $richInputTokens,
  $selectRichInputRange as $selectMessageRange,
  $richInputCaret as $messageCaret,
  $richInputSelection as $messageSelection,
} from '@tmt/browser-ui/rich-input';
import {
  $createParagraphNode,
  $getSelection,
  $getNodeByKey,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  $createTextNode,
  $getRoot,
  type LexicalNode,
} from 'lexical';
import { resolveMessageMentions } from '../message-recipient.js';
import type { AgentDestination } from '../live-ask.js';
import type { ComposerEdit, RecipientKey } from './message-composer-edit.js';

/** What a mention chip keeps: the recipient it routes to, and whether it is the creator default. */
type MentionData = { recipient: RecipientKey; defaultCreator?: true };

/**
 * A mention is the design system's chip (kind `mention`) holding its recipient key. Editing tokens
 * only; the parent revalidates their UUID keys before every Send.
 */
export function $createMention(token: string, recipient: RecipientKey, defaultCreator = false) {
  const data: MentionData = { recipient, ...(defaultCreator ? { defaultCreator: true } : {}) };
  return new RichInputChipNode('mention', token, data);
}
const isMention = (node: LexicalNode | null | undefined): node is RichInputChipNode =>
  $isRichInputChip(node) && node.getKind() === 'mention';
const mention = (node: RichInputChipNode) => node.getData() as MentionData;

export { $richInputText as $messageText } from '@tmt/browser-ui/rich-input';

export function $replaceMessage(value: string, mentions: ComposerEdit['mentions'] = []) {
  $replaceRichInput(
    value,
    mentions.map((mention) => ({
      range: mention.range,
      create: (token) => $createMention(token, mention.key, mention.defaultCreator === true),
    })),
  );
}

/** Node identity/history retains every intact token through surrounding edits. */
export function $messageMentions(): NonNullable<ComposerEdit['mentions']> {
  return $richInputTokens(isMention).map(({ node, range }) => ({
    key: mention(node).recipient,
    ...(mention(node).defaultCreator ? { defaultCreator: true as const } : {}),
    range,
  }));
}

/** A preference transition edits only its own atomic token, preserving all surrounding text. */
export function $setDefaultCreator(key: RecipientKey, label: string, enabled: boolean) {
  const root = $getRoot();
  const selection = $getSelection()?.clone();
  const nodes: RichInputChipNode[] = [];
  function visit(node: LexicalNode) {
    if (
      isMention(node) &&
      mention(node).recipient.agent === key.agent &&
      (key.machine === undefined ||
        mention(node).recipient.machine === undefined ||
        mention(node).recipient.machine === key.machine)
    )
      nodes.push(node);
    else if ($isElementNode(node)) node.getChildren().forEach(visit);
  }
  visit(root);
  if (enabled && !nodes.length) {
    prependMention(key, label, true);
  } else if (!enabled) {
    for (const node of nodes) if (mention(node).defaultCreator) node.remove();
  }
  if (
    $isRangeSelection(selection) &&
    $getNodeByKey(selection.anchor.key)?.isAttached() &&
    $getNodeByKey(selection.focus.key)?.isAttached()
  )
    $setSelection(selection);
}

function prependMention(key: RecipientKey, label: string, defaultCreator = false) {
  const root = $getRoot();
  const first = root.getFirstChild();
  const paragraph = $isElementNode(first) ? first : $createParagraphNode();
  if (!first) root.append(paragraph);
  const chip = $createMention(`@${label}`, key, defaultCreator);
  const space = $createTextNode(' ');
  const head = paragraph.getFirstChild();
  if (head) {
    head.insertBefore(chip);
    head.insertBefore(space);
  } else paragraph.append(chip, space);
}

/** An explicit recipient choice inserts a manual token without replacing text or selection. */
export function $prependMessageMention(key: RecipientKey, label: string) {
  if (
    $messageMentions().some(
      (mention) => mention.key.machine === key.machine && mention.key.agent === key.agent,
    )
  )
    return;
  const selection = $messageSelection();
  prependMention(key, label);
  const length = label.length + 2;
  $selectMessageRange((selection?.anchor ?? 0) + length, (selection?.focus ?? 0) + length);
}

/** The same recipient key, however many tokens name it. */
const sameRecipient = (a: RecipientKey, b: RecipientKey) =>
  a.machine === b.machine && a.agent === b.agent;

/** Type the `@` that opens the agent list at the caret (the end of the text without a caret). */
export function $insertMentionTrigger() {
  let selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    $selectMessageRange($messageText().length, $messageText().length);
    selection = $getSelection();
  }
  if ($isRangeSelection(selection)) selection.insertText('@');
}

/** Remove every token naming this agent, with the one space that separated it from what follows. */
export function $removeMessageMentions(key: RecipientKey) {
  const found: RichInputChipNode[] = [];
  const visit = (node: LexicalNode) => {
    if (isMention(node) && sameRecipient(mention(node).recipient, key)) found.push(node);
    else if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  visit($getRoot());
  for (const node of found) {
    const next = node.getNextSibling();
    if ($isTextNode(next) && next.getTextContent().startsWith(' ')) {
      const rest = next.getTextContent().slice(1);
      if (rest) next.setTextContent(rest);
      else next.remove();
    }
    node.remove();
  }
  return found.length;
}

/** The pill's choice: a token for this agent when none names it, otherwise every token goes. */
export function $toggleMessageMention(key: RecipientKey, label: string) {
  if (!$removeMessageMentions(key)) $prependMessageMention(key, label);
}

/** Resolve identity-only references without changing text, node identity or selection. */
export function $resolvePendingMessageMentions(agents: readonly AgentDestination[]) {
  for (const { node } of $richInputTokens(isMention)) {
    const data = mention(node);
    if (data.recipient.machine !== undefined) continue;
    const matches = agents.filter((agent) => agent.agent === data.recipient.agent);
    if (matches.length === 1)
      node.getWritable().__data = {
        ...data,
        recipient: { machine: matches[0].machine, agent: matches[0].agent },
      };
  }
}

/** Replace only newly completed tokens, keeping the caret, surrounding nodes and history. */
export function $bindMessageMentions(agents: readonly AgentDestination[], includeEnd = false) {
  $resolvePendingMessageMentions(agents);
  const value = $messageText(),
    existing = $messageMentions(),
    caret = $messageCaret();
  const result = resolveMessageMentions({ value, mentions: existing }, agents, includeEnd);
  if (caret !== undefined) {
    for (const token of [...result.mentions].reverse()) {
      if (existing.some((old) => old.range.start === token.range.start)) continue;
      $selectMessageRange(token.range.start, token.range.end).insertNodes([
        $createMention(value.slice(token.range.start, token.range.end), token.key),
      ]);
    }
    $selectMessageRange(caret, caret);
  }
  return { value, mentions: $messageMentions() };
}

/**
 * The @ query at the caret. The trigger is `@` or the full-width `＠` an IME may type, one UTF16
 * unit either way. It must start the text or follow whitespace or any character that is not
 * address-like ASCII: Chinese and Japanese are written without spaces, so "請@bot" asks for a
 * recipient while "email@bot" stays plain text.
 */
export function mentionQuery(value: string, caret: number) {
  const before = value.slice(0, caret);
  const match = /(?:^|[^A-Za-z0-9_.+\-@＠])[@＠]([^\s@＠]*)$/.exec(before);
  return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : undefined;
}

/** Fuzzy subsequence, ranked by contiguous prefix then gaps; source order is a stable tie-breaker. */
export function fuzzyMessageCandidates<T extends { agentName: string; machineName: string }>(
  candidates: readonly T[],
  query: string,
): T[] {
  const needle = query.toLowerCase();
  return candidates
    .map((candidate, index) => {
      const haystack = `${candidate.agentName} ${candidate.machineName}`.toLowerCase();
      let cursor = 0;
      let gaps = 0;
      for (const letter of needle) {
        const found = haystack.indexOf(letter, cursor);
        if (found < 0) return { candidate, index, score: Infinity };
        gaps += found - cursor;
        cursor = found + 1;
      }
      return { candidate, index, score: haystack.startsWith(needle) ? 0 : gaps + 1 };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ candidate }) => candidate);
}

export {
  $richInputCaret as $messageCaret,
  $richInputSelection as $messageSelection,
  $selectRichInputRange as $selectMessageRange,
} from '@tmt/browser-ui/rich-input';

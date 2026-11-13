/** The DM (#5704; spec 8d17ce7c screen 3): the conversation as a chat anchored at the bottom, with
 * day separators, each message's delivery under it and the member's reply as its own row, and
 * the message box under it that sends through Talk (contracts/remote-channel-v1.md). One bounded
 * read at a time; positions and seen state never leave their owners. */
import { el } from './ops-parts.js';
import { exchangeRows, outbox, pendingRow, shortenedReply, talkList } from './talk-stream.js';
import { composerSlot } from './ops-composer-slot.js';
import { whileVisible } from './owner-reads.js';
import type { RemoteShell } from './remote-shell.js';
import type { Session } from './device.js';
import {
  ClientError,
  RefusalError,
  operations,
  type ResultState,
  type SendInput,
  type SendState,
} from './operations.js';
import {
  conversations,
  type ConversationInput,
  type ConversationPage,
  type ConversationItem,
  type ConversationCursor,
} from './conversations.js';
import {
  conversationSeen,
  conversationUnread,
  type ConversationScope,
  type ConversationUnread,
} from './conversation-seen.js';

export type ConversationRead = (
  memberId: string,
  input: ConversationInput,
) => Promise<{ machineId: string; page: ConversationPage }>;
/** Talk: send once with a frozen operation id, and observe an operation already sent. */
export interface ConversationTalk {
  send(input: SendInput): Promise<SendState>;
  operation(operationId: string): Promise<SendState>;
  /** A request's outcome; a replied one carries the reply's full text. */
  result(requestId: string): Promise<ResultState>;
}
export interface ConversationObservation {
  scope?: ConversationScope;
  unread: ConversationUnread;
}
/** Runs one read on the owner's signed Session, retiring that Session when the read shows it is
 * gone, so the next read opens a fresh one. Shared by the DM and the channel. */
export async function onSession<T>(
  shell: RemoteShell,
  run: (session: Session) => Promise<T>,
): Promise<T> {
  if (!shell.session) throw new Error('No signed browser session.');
  const session = await shell.session();
  shell.signal.throwIfAborted();
  try {
    return await run(session);
  } catch (error) {
    if (
      (error instanceof ClientError &&
        ['transport_failure', 'timeout', 'sequence_unavailable'].includes(error.code)) ||
      (error instanceof RefusalError &&
        [
          'REMOTE_SESSION_ENDED',
          'REMOTE_SESSION_EVICTED',
          'REMOTE_SERVE_STOPPED',
          'REMOTE_GRANT_CHANGED',
        ].includes(error.code))
    )
      shell.forgetSession?.(session);
    throw error;
  }
}
function sessionRead(shell: RemoteShell): ConversationRead {
  return (memberId, input) =>
    onSession(shell, async (session) => {
      const client = conversations(session);
      return { machineId: client.machineId, page: await client.read(memberId, input) };
    });
}
function sessionTalk(shell: RemoteShell): ConversationTalk {
  const client = async () => {
    if (!shell.session) throw new Error('No signed browser session.');
    return operations(await shell.session());
  };
  return {
    send: async (input) => (await client()).send(input),
    operation: async (operationId) => (await client()).operation(operationId),
    result: async (requestId) => (await client()).result(requestId),
  };
}
function storage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
const UNKNOWN: ConversationUnread = { state: 'unknown' };
/** How many shortened replies one opened conversation reads in full. */
const FULL_REPLIES = 10;

export function conversationHistory(
  shell: RemoteShell,
  observed: (value: ConversationObservation) => void,
  read: ConversationRead = sessionRead(shell),
  talk: ConversationTalk = sessionTalk(shell),
) {
  const node = el('section', 'ops-dm');
  node.setAttribute('aria-label', 'Talk history');
  const olderButton = el('button', 'ops-dm-older', 'Show older messages');
  olderButton.type = 'button';
  const status = el('p', 'ops-dm-status', 'Choose a member to read the retained conversation.');
  status.setAttribute('role', 'status');
  const stream = talkList('Conversation');
  const list = stream.list;
  const compose = el('section', 'ops-channel-compose');
  compose.setAttribute('aria-label', 'Message');
  const composerHost = el('div', 'ops-composer-host');
  const sendNote = el('p', 'ops-channel-compose-reason');
  sendNote.id = 'ops-dm-send-note';
  sendNote.setAttribute('aria-live', 'polite');
  compose.append(composerHost, sendNote);
  node.append(olderButton, status, list, compose);
  const composer = composerSlot(composerHost);
  const seen = conversationSeen(storage());
  const items = new Map<string, ConversationItem>();
  // A reply's preview is capped; its full text comes from the request's result, read once per
  // shortened reply and at most `FULL_REPLIES` of them per conversation opened.
  const fullReplies = new Map<string, string>();
  // The same result carries the whole text of the person's own message cut at the preview.
  const fullPosts = new Map<string, string>();
  const asked = new Set<string>();
  let memberId: string | undefined,
    memberName = '',
    panelVisible = false;
  let generation = 0,
    running = false,
    wanted = false;
  let scope: ConversationScope | undefined;
  let olderCursor: ConversationCursor | null | undefined;
  let reported = '';
  const box = outbox(talk, (value) => {
    draw();
    showComposer();
    if (value.state === 'accepted') {
      wanted = true;
      void refresh();
    }
  });
  function report(value: ConversationObservation) {
    const fingerprint = JSON.stringify(value);
    if (fingerprint !== reported) {
      reported = fingerprint;
      observed(value);
    }
  }
  function controls() {
    olderButton.hidden = !memberId || !olderCursor;
    olderButton.disabled = running;
    node.setAttribute('aria-busy', String(running));
  }
  function draw() {
    const unlisted = memberId ? box.unlisted(memberId, (id) => items.has(id)) : undefined;
    stream.draw(
      items.values(),
      (item) =>
        exchangeRows(
          item,
          {
            me: 'You',
            them: memberName,
            fromMe: item.direction === 'toMember',
          },
          fullReplies.get(item.requestId),
          fullPosts.get(item.requestId),
        ),
      [memberName, fullReplies.size, fullPosts.size],
      unlisted && pendingRow(unlisted, memberName),
    );
  }
  function showComposer() {
    if (!memberId) return;
    const { canSend, busy } = box.box(memberId, sendNote);
    composer.show({
      key: memberId,
      label: `Message ${memberName}`,
      placeholder: `Message ${memberName}…`,
      hint: 'Enter sends · Shift+Enter for a new line',
      describedBy: sendNote.id,
      canSend,
      busy,
      cleared: box.cleared,
      onSend: (message) => {
        const agentId = memberId;
        if (!agentId || shell.signal.aborted) return;
        void box.send(agentId, message, (operationId) => ({ operationId, agentId, message }));
      },
    });
  }
  /** The full text of the newest shortened replies and of the person's own cut messages, one read
   * at a time; a failed read keeps the shortened preview and is not asked again until the
   * conversation opens again. */
  async function readFullReplies(selected: string, ticket: number) {
    const wanted = [...items.values()]
      .filter(
        (item) =>
          !asked.has(item.requestId) &&
          (shortenedReply(item) || (item.previewTruncated && item.direction === 'toMember')),
      )
      .sort((a, b) => b.preparedAtMs - a.preparedAtMs)
      .slice(0, Math.max(0, FULL_REPLIES - asked.size));
    for (const item of wanted) {
      asked.add(item.requestId);
      try {
        const value = await talk.result(item.requestId);
        if (shell.signal.aborted || ticket !== generation || memberId !== selected) return;
        if (value.state === 'replied' && shortenedReply(item))
          fullReplies.set(item.requestId, value.message);
        if (typeof value.requestMessage === 'string' && item.previewTruncated)
          fullPosts.set(item.requestId, value.requestMessage);
        draw();
      } catch {
        // The preview stays, with its ellipsis.
      }
    }
  }
  async function load(before?: ConversationCursor): Promise<boolean> {
    if (!memberId || shell.signal.aborted || document.visibilityState !== 'visible') return true;
    if (running) return true;
    running = true;
    controls();
    const selected = memberId,
      ticket = generation;
    const input: ConversationInput = { limit: 20, ...(before ? { before } : {}) };
    if (scope?.memberId === selected) {
      const baseline = seen.read(scope);
      if (baseline.available && baseline.position) input.since = baseline.position;
    }
    const current = () => !shell.signal.aborted && ticket === generation && memberId === selected;
    try {
      let next = await read(selected, input);
      if (!current()) return false;
      let nextScope = {
        machineId: next.machineId,
        viewerId: next.page.viewerId,
        memberId: selected,
      };
      let baseline = seen.read(nextScope);
      // The first verified response supplies the viewer. Ask once with that scope's stored
      // position, rather than choosing a viewer or assuming an absent baseline means zero.
      if (baseline.available && baseline.position && input.since !== baseline.position) {
        input.since = baseline.position;
        next = await read(selected, input);
        if (!current()) return false;
        const secondScope = {
          machineId: next.machineId,
          viewerId: next.page.viewerId,
          memberId: selected,
        };
        if (JSON.stringify(secondScope) !== JSON.stringify(nextScope))
          baseline = { available: false, position: null };
        nextScope = secondScope;
      }
      if (
        scope &&
        (scope.machineId !== nextScope.machineId || scope.viewerId !== nextScope.viewerId)
      ) {
        items.clear();
        fullReplies.clear();
        fullPosts.clear();
        asked.clear();
        stream.reset();
        olderCursor = undefined;
      }
      scope = nextScope;
      let changes =
        input.since === baseline.position
          ? conversationUnread(baseline, next.page.changedSince)
          : UNKNOWN;
      for (const item of next.page.items) items.set(item.requestId, item);
      if (before || olderCursor === undefined) olderCursor = next.page.nextBefore;
      status.textContent =
        next.page.member === 'unknown'
          ? 'This member is unknown on this machine.'
          : next.page.member === 'retired'
            ? 'This member has been retired.'
            : items.size
              ? ''
              : `No messages with ${memberName} yet. Say hello below.`;
      status.hidden = status.textContent === '';
      draw();
      void readFullReplies(selected, ticket);
      const visible = panelVisible && node.isConnected && document.visibilityState === 'visible';
      if (
        !before &&
        visible &&
        !seen.markVisibleNewest(scope, next.page, {
          newest: true,
          documentVisible: true,
          panelVisible: true,
        })
      )
        changes = UNKNOWN;
      report({ scope, unread: changes });
      return true;
    } catch {
      if (current()) {
        items.clear();
        fullReplies.clear();
        fullPosts.clear();
        asked.clear();
        stream.reset();
        olderCursor = undefined;
        status.hidden = false;
        status.textContent =
          'The conversation is unavailable for this browser. Reload the page, or use Ops in this machine’s terminal.';
        report({ unread: UNKNOWN });
      }
      return false;
    } finally {
      running = false;
      controls();
      if (wanted && !shell.signal.aborted) {
        wanted = false;
        void refresh();
      }
    }
  }
  async function refresh(): Promise<boolean> {
    await box.observe();
    return load();
  }
  olderButton.addEventListener('click', () => {
    if (!olderCursor || running) return;
    generation++;
    void load(olderCursor);
  });
  shell.signal.addEventListener(
    'abort',
    () => {
      generation++;
      stream.forget();
      items.clear();
    },
    { once: true },
  );
  whileVisible(5000, shell.signal, refresh);
  controls();
  return {
    node,
    select(member: { id: string; name: string } | undefined) {
      const wasVisible = panelVisible;
      panelVisible = member !== undefined;
      // Opening the conversation again asks again for replies whose full text could not be read.
      if (member && !wasVisible) asked.clear();
      if (member && member.id !== memberId) {
        memberId = member.id;
        memberName = member.name;
        generation++;
        scope = undefined;
        olderCursor = undefined;
        items.clear();
        fullReplies.clear();
        fullPosts.clear();
        asked.clear();
        stream.reset();
        status.hidden = false;
        status.textContent = 'Reading the conversation…';
        report({ unread: UNKNOWN });
        showComposer();
        if (running) wanted = true;
        else void refresh();
      } else if (member) {
        if (member.name !== memberName) {
          memberName = member.name;
          stream.forget();
          draw();
          showComposer();
        }
        if (!wasVisible) void refresh();
      }
      controls();
    },
  };
}

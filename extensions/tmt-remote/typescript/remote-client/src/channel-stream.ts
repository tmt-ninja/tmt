/** The channel stream (#5704 A4, spec 8d17ce7c screens 1-2): the squad room's posts, each with its
 * recipients' replies under it, and the box that posts to the room. A post goes to the squad lead,
 * or to each member it @mentions; it carries the room exactly as the board names it, so a stale
 * roster revision comes back refused with Core's reason and the person sends again after the board
 * refreshes. The room read has no change positions yet, so the channel shows no unread count and
 * refreshes by rereading its newest page. */
import { el } from './ops-parts.js';
import { composerSlot } from './ops-composer-slot.js';
import { whileVisible } from './owner-reads.js';
import type { RemoteShell } from './remote-shell.js';
import { RefusalError, type ResultState } from './operations.js';
import type { ConversationCursor, ConversationItem } from './conversations.js';
import {
  messageRow,
  outbox,
  pendingRow,
  talkList,
  deliveryMark,
  deliveryText,
} from './talk-stream.js';
import type { TalkPort } from './talk-stream.js';

export interface RoomRef {
  roomId: string;
  revision: number;
}
export interface RoomSendInput {
  operationId: string;
  message: string;
  room: RoomRef;
  recipientIds: string[];
  kind?: 'request' | 'announcement';
}
/** A room exchange: the conversation item shape with its room and recipient, and no direction or
 * reply words (a reply is read with `result`). */
export type RoomItem = Omit<ConversationItem, 'direction' | 'responsePreview'> & { roomId: string };
export interface RoomPage {
  roomId: string;
  items: RoomItem[];
  nextBefore: ConversationCursor | null;
  changes: 'unknown';
}
/** Remote's room read, room send and reply read (remote-3, #5704 A4). */
export interface ChannelPort extends TalkPort<RoomSendInput> {
  readRoom(
    roomId: string,
    input: { limit: number; before?: ConversationCursor },
  ): Promise<RoomPage>;
  result(requestId: string): Promise<ResultState>;
}
export interface ChannelRoom {
  squad: string;
  /** The squad's Core room, `null` when the squad has none, `undefined` when the board does not say. */
  room: RoomRef | null | undefined;
  lead?: { id: string; name: string };
  members: readonly { id: string; name: string }[];
}

/** The members a post @mentions, or the lead when it mentions none. */
export function recipients(message: string, channel: ChannelRoom): { id: string; name: string }[] {
  const named = channel.members.filter((member) =>
    new RegExp(`(^|\\s)@${member.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(
      message,
    ),
  );
  if (named.length) return named;
  return channel.lead ? [channel.lead] : [];
}

/** One post: the items of one send share their words and time, one per recipient. */
interface Post {
  requestId: string;
  preparedAtMs: number;
  items: RoomItem[];
}
function posts(items: Iterable<RoomItem>): Post[] {
  const out = new Map<string, Post>();
  for (const item of items) {
    const key = `${item.preparedAtMs}\u0000${item.sender.identityId}\u0000${item.preview}`;
    const post = out.get(key);
    if (post) post.items.push(item);
    else
      out.set(key, { requestId: item.requestId, preparedAtMs: item.preparedAtMs, items: [item] });
  }
  return [...out.values()];
}

export function channelStream(shell: RemoteShell, port: ChannelPort | undefined) {
  const node = el('section', 'ops-dm');
  node.setAttribute('aria-label', 'Channel messages');
  const olderButton = el('button', 'ops-dm-older', 'Show older messages');
  olderButton.type = 'button';
  const empty = el('div', 'ops-channel-empty');
  const emptyTitle = el('p', 'ops-channel-empty-title', 'No channel messages yet');
  const emptyText = el('p', 'ops-channel-empty-text');
  empty.append(emptyTitle, emptyText);
  empty.setAttribute('role', 'status');
  const stream = talkList('Channel messages');
  const compose = el('section', 'ops-channel-compose');
  compose.setAttribute('aria-label', 'Message');
  const composerHost = el('div', 'ops-composer-host');
  const sendNote = el('p', 'ops-channel-compose-reason');
  sendNote.id = 'ops-channel-write-reason';
  sendNote.setAttribute('aria-live', 'polite');
  compose.append(composerHost, sendNote);
  node.append(olderButton, empty, stream.list, compose);
  const composer = composerSlot(composerHost);
  const items = new Map<string, RoomItem>();
  const replies = new Map<string, ResultState>();
  let channel: ChannelRoom | undefined;
  let roomId: string | undefined;
  let olderCursor: ConversationCursor | null | undefined;
  let generation = 0,
    running = false,
    wanted = false,
    visible = false,
    refused = false,
    known = '';
  const box = port
    ? outbox(port, (value) => {
        draw();
        showComposer();
        if (value.state === 'accepted') {
          wanted = true;
          void refresh();
        }
      })
    : undefined;
  const names = () => new Map(channel?.members.map((member) => [member.id, member.name]) ?? []);

  function postRows(post: Post): HTMLElement[] {
    const who = names();
    const to = post.items.map((item) => who.get(item.recipientId) ?? 'a former member');
    const first = post.items[0]!;
    const rows = [
      messageRow({
        who: 'You',
        to: to.join(', '),
        self: true,
        at: new Date(post.preparedAtMs),
        text: first.preview,
        mentions: channel?.members.map((member) => member.name) ?? [],
        ...(first.previewTruncated ? { note: 'Preview shortened' } : {}),
        state: deliveryText({ ...first, direction: 'toMember', responsePreview: null }),
        mark: deliveryMark({ ...first, direction: 'toMember', responsePreview: null }),
      }),
    ];
    post.items.forEach((item, at) => {
      const reply = replies.get(item.requestId);
      const words =
        reply?.state === 'replied'
          ? reply.message
          : item.final.status === 'retained'
            ? reply?.state === 'unavailable'
              ? 'The reply is unavailable'
              : null
            : item.final.status === 'expired'
              ? 'The reply has expired'
              : undefined;
      if (words === undefined) return;
      rows.push(
        messageRow({
          who: to[at]!,
          to: 'You',
          self: false,
          ...(item.final.status === 'retained' ? { at: new Date(item.final.submittedAtMs) } : {}),
          text: words ?? 'Reading the reply…',
          quiet: words === null || reply?.state !== 'replied',
        }),
      );
    });
    return rows;
  }
  function draw() {
    const target = roomId ?? '';
    const unlisted = box?.unlisted(target, (id) => items.has(id));
    const shown = posts(items.values());
    stream.draw(
      shown,
      postRows,
      [[...names()], [...replies]],
      unlisted &&
        pendingRow(
          unlisted,
          recipientsLabel(unlisted.message),
          channel?.members.map((member) => member.name),
        ),
    );
    empty.hidden = shown.length > 0 || !!unlisted;
  }
  function recipientsLabel(message: string): string {
    return channel
      ? recipients(message, channel)
          .map((member) => member.name)
          .join(', ')
      : '';
  }
  function showComposer() {
    if (!channel) return;
    const name = `#${channel.squad}`;
    const room = channel.room;
    let canSend = false,
      busy = false;
    if (!port) {
      sendNote.textContent = `Sending to ${name} from the browser needs the next Remote update. Until then, use Ops in this machine’s terminal.`;
      sendNote.hidden = false;
    } else if (!room) {
      sendNote.textContent =
        room === null
          ? `${name} has no channel room on this machine yet. Talk to a member directly instead.`
          : 'Reading the channel…';
      sendNote.hidden = false;
    } else ({ canSend, busy } = box!.box(room.roomId, sendNote));
    composer.show({
      key: `channel:${channel.squad}`,
      label: `Message ${name}`,
      placeholder: `Message ${name} — @ to mention agents`,
      hint: 'Enter sends · Shift+Enter for a new line',
      describedBy: sendNote.id,
      canSend,
      busy,
      cleared: box?.cleared ?? 0,
      onSend: (message) => {
        if (!channel?.room || !box || shell.signal.aborted) return;
        const target = channel.room;
        const to = recipients(message, channel);
        if (!to.length) {
          sendNote.textContent = `${name} has no lead to take a message. Mention a member with @name.`;
          sendNote.hidden = false;
          return;
        }
        void box.send(
          target.roomId,
          message,
          (operationId) => ({
            operationId,
            message,
            room: { roomId: target.roomId, revision: target.revision },
            recipientIds: to.map((member) => member.id),
            kind: 'request',
          }),
          `${target.revision}:${to.map((member) => member.id).join(',')}`,
        );
      },
    });
  }
  async function readReplies(ticket: number) {
    for (const item of items.values()) {
      const known = replies.get(item.requestId)?.state;
      if (item.final.status !== 'retained' || known === 'replied' || known === 'unavailable')
        continue;
      try {
        const value = await port!.result(item.requestId);
        if (ticket !== generation) return;
        replies.set(item.requestId, value);
      } catch {
        // Left as "Reading the reply…"; the next refresh asks again.
      }
    }
  }
  async function load(before?: ConversationCursor): Promise<boolean> {
    if (!port || !roomId || !visible || refused || shell.signal.aborted) return true;
    if (document.visibilityState !== 'visible') return true;
    if (running) {
      wanted = true;
      return true;
    }
    running = true;
    olderButton.disabled = true;
    const ticket = generation,
      reading = roomId;
    try {
      const page = await port.readRoom(reading, { limit: 20, ...(before ? { before } : {}) });
      if (ticket !== generation || reading !== roomId) return true;
      for (const item of page.items) items.set(item.requestId, item);
      if (before || olderCursor === undefined) olderCursor = page.nextBefore;
      emptyTitle.textContent = 'No channel messages yet';
      emptyText.textContent = `Post to the lead, or @mention members. Their replies show under your post.`;
      draw();
      await readReplies(ticket);
      if (ticket === generation) draw();
      return true;
    } catch (error) {
      if (ticket === generation) {
        empty.hidden = false;
        if (error instanceof RefusalError) {
          // A refused read waits for the board or the grant to change; the tick does not ask again.
          refused = true;
          const reason = (error as RefusalError & { reason?: string }).reason;
          emptyTitle.textContent = 'This browser cannot read the channel';
          emptyText.replaceChildren(
            reason === 'owner_browser_required'
              ? 'Open this channel from your own browser, the one paired as the owner.'
              : reason === 'all_agents_required'
                ? 'This browser needs access to every agent. Change it in Remote settings.'
                : 'This browser may not read replies and channel messages. Allow it in Remote settings.',
          );
          if (error.settingsUrl) {
            const link = el('a', undefined, 'Open Remote settings');
            link.href = error.settingsUrl;
            emptyText.append(' ', link);
          }
          return true;
        }
        emptyTitle.textContent = 'The channel could not be read';
        emptyText.textContent = 'Reload the page, or use Ops in this machine’s terminal.';
      }
      return false;
    } finally {
      running = false;
      olderButton.disabled = false;
      olderButton.hidden = !olderCursor;
      if (wanted && !shell.signal.aborted) {
        wanted = false;
        void refresh();
      }
    }
  }
  async function refresh(): Promise<boolean> {
    await box?.observe();
    return load();
  }
  olderButton.hidden = true;
  olderButton.addEventListener('click', () => {
    if (olderCursor && !running) void load(olderCursor);
  });
  whileVisible(5000, shell.signal, refresh);
  return {
    node,
    select(next: ChannelRoom | undefined) {
      visible = next !== undefined;
      channel = next;
      // A board change (room, revision or roster) may lift a refused read.
      const seen = JSON.stringify([next?.room, next?.members]);
      if (seen !== known) {
        known = seen;
        refused = false;
      }
      const nextRoom = next?.room?.roomId;
      if (nextRoom !== roomId) {
        roomId = nextRoom;
        generation++;
        items.clear();
        replies.clear();
        olderCursor = undefined;
        stream.reset();
        olderButton.hidden = true;
        emptyTitle.textContent = 'No channel messages yet';
        emptyText.textContent = port
          ? next?.room === null
            ? 'This squad has no channel room on this machine.'
            : 'Reading the channel…'
          : 'Messages to this channel appear here. Open a member to read your conversation with them.';
        empty.hidden = false;
        void refresh();
      } else draw();
      showComposer();
    },
  };
}

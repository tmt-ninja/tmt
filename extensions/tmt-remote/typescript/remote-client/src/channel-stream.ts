/** The channel stream (#5704 A4, spec 8d17ce7c screens 1-2): the squad room's posts, each with its
 * recipients' replies under it, and the box that posts to the room. A post goes to the squad lead,
 * or to each member it @mentions; it carries the room exactly as the board names it, so a stale
 * roster revision comes back refused with Core's reason and the person sends again after the board
 * refreshes. The room read has no change positions yet, so the channel shows no unread count and
 * refreshes by rereading its newest page. */
import { avatarInitials, browserUiClasses as c } from '@tmt/browser-ui/static';
import { el } from './ops-parts.js';
import { opsHref } from './ops-menu.js';
import { composerSlot } from './ops-composer-slot.js';
import { whileVisible } from './owner-reads.js';
import type { RemoteShell } from './remote-shell.js';
import { RefusalError, operations, type ResultState, type RoomSendInput } from './operations.js';
import {
  conversations,
  type ConversationCursor,
  type RoomInput,
  type RoomItem,
  type RoomPage,
} from './conversations.js';
import { onSession } from './conversation-history.js';
import {
  attributed,
  messageRow,
  noticeRow,
  outbox,
  pendingRow,
  talkList,
  deliveryMark,
  deliveryText,
  PREVIEW_CHARACTERS,
  SHORTENED_POST,
  sendNowAsks,
} from './talk-stream.js';
import type { SendNowPort, TalkPort } from './talk-stream.js';

/** Remote's room read, room send, reply read and send-now (#6378); tests inject a double. */
export interface ChannelPort extends TalkPort<RoomSendInput>, SendNowPort {
  readRoom(roomId: string, input: RoomInput): Promise<RoomPage>;
  result(requestId: string): Promise<ResultState>;
}
/** The channel's calls on the owner's signed Session. */
export function sessionChannel(shell: RemoteShell): ChannelPort {
  return {
    readRoom: (roomId, input) =>
      onSession(shell, (session) => conversations(session).readRoom(roomId, input)),
    result: (requestId) => onSession(shell, (session) => operations(session).result(requestId)),
    sendNow: (requestId) => onSession(shell, (session) => operations(session).sendNow(requestId)),
    send: (input) => onSession(shell, (session) => operations(session).send(input)),
    operation: (operationId) =>
      onSession(shell, (session) => operations(session).operation(operationId)),
  };
}
export interface ChannelRoom {
  squad: string;
  /** The squad's Core room, `null` when the squad has none, `undefined` when the board does not say. */
  room: { roomId: string; revision: number } | null;
  lead?: { id: string; name: string };
  members: readonly { id: string; name: string }[];
}

/** How many cut posts one opened channel reads in full. */
const FULL_POSTS = 10;
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

export function channelStream(
  shell: RemoteShell,
  port: ChannelPort = sessionChannel(shell),
  rereadBoard: () => void = () => {},
) {
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
  // A post cut at the preview shows its whole text from its result's `requestMessage`, read once
  // per post and at most `FULL_POSTS` of them per channel opened; until then, or when the read
  // fails or Core no longer keeps the words, the preview stays with its ellipsis.
  const fullPosts = new Map<string, string>();
  const askedPosts = new Set<string>();
  // Send now asks once for each recipient's request of a post.
  const now = sendNowAsks(port, () => draw());
  let channel: ChannelRoom | undefined;
  let roomId: string | undefined;
  let olderCursor: ConversationCursor | null | undefined;
  let generation = 0,
    running = false,
    wanted = false,
    visible = false,
    refused = false,
    known = '';
  const box = outbox(port, (value) => {
    // A stale roster: read the board again so the recipients refresh; the person sends again.
    if (value.state === 'refused' && value.reason === 'ROOM_ROSTER_CHANGED') rereadBoard();
    draw();
    showComposer();
    if (value.state === 'accepted') {
      wanted = true;
      void refresh();
    }
  });
  const names = () => new Map(channel?.members.map((member) => [member.id, member.name]) ?? []);

  /** Each recipient's side of a post: their reply words, or why there are none. */
  function answers(post: Post) {
    const who = names();
    return post.items.map((item) => {
      const reply = replies.get(item.requestId);
      const name = who.get(item.recipientId) ?? 'a former member';
      const at = item.final.status === 'retained' ? new Date(item.final.submittedAtMs) : undefined;
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
      return { item, name, at, words, read: reply?.state === 'replied' };
    });
  }
  const capped = (post: Post) => {
    const preview = post.items[0]!.preview;
    return !!preview && [...preview].length >= PREVIEW_CHARACTERS;
  };
  const fullText = (post: Post) =>
    post.items.map((item) => fullPosts.get(item.requestId)).find((text) => text !== undefined);
  function postRow(post: Post, inThread = false): HTMLElement {
    const first = post.items[0]!;
    const whole = fullText(post);
    const as = now.current(first);
    if (!inThread && first.kind === 'announcement')
      return noticeRow(first.preview, new Date(post.preparedAtMs));
    const row = messageRow({
      who: 'You',
      to: answers(post)
        .map((side) => side.name)
        .join(', '),
      self: true,
      at: new Date(post.preparedAtMs),
      text: whole ?? first.preview,
      mentions: channel?.members.map((member) => member.name) ?? [],
      ...(whole === undefined && capped(post) ? { shortened: SHORTENED_POST } : {}),
      // The thread's header already says how the post stands; the root carries no second line.
    });
    if (inThread) return row;
    // Under the post, the thread in one line; the replies open beside the channel.
    const sides = answers(post).filter((side) => side.words !== undefined);
    const last = sides.map((side) => side.at?.valueOf() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const open = el('button', 'ops-thread-open');
    open.type = 'button';
    open.dataset.requestId = post.requestId;
    // Slack's thread line: who replied, how many, and when last; the state only before any reply.
    const shown = sides.filter((side) => side.words !== null);
    if (shown.length) {
      const faces = el('span', 'ops-thread-faces');
      faces.setAttribute('aria-hidden', 'true');
      for (const side of shown.slice(0, 3)) {
        const face = el('span', c.avatar, avatarInitials(side.name));
        face.dataset.size = 's';
        faces.append(face);
      }
      open.append(faces);
    }
    open.append(
      el(
        'span',
        'ops-thread-count',
        sides.length ? `${sides.length} repl${sides.length === 1 ? 'y' : 'ies'}` : 'No replies yet',
      ),
    );
    if (last)
      open.append(
        el(
          'span',
          'ops-thread-last',
          `Last reply ${new Date(last).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
        ),
      );
    if (!shown.length) {
      const state = el(
        'span',
        'ops-dm-message-state',
        sides.length ? 'Answered' : deliveryText(as),
      );
      state.dataset.mark = sides.length ? 'answered' : deliveryMark(as);
      open.append(state);
    }
    open.setAttribute('aria-expanded', String(threadKey === post.requestId));
    open.addEventListener('click', () => openThread(post.requestId));
    // Send now ends the same line, beside the thread button rather than inside it.
    const threadLine = el('div', 'ops-thread-line');
    threadLine.append(open);
    if (!sides.length) {
      const control = now.control(post.items);
      if (control) threadLine.append(control);
    }
    row.querySelector('.ops-dm-message-body')!.append(threadLine);
    if (threadKey === post.requestId) row.dataset.selected = '';
    return row;
  }

  // The thread beside the channel (spec screen 2): the post, then each recipient's reply.
  const thread = el('aside', 'ops-thread');
  thread.hidden = true;
  thread.setAttribute('aria-label', 'Thread');
  const threadHead = el('header', 'ops-thread-head');
  const threadTitle = el('h3', 'ops-thread-title');
  threadTitle.tabIndex = -1;
  const threadClose = el('button', 'ops-thread-close', '×');
  threadClose.type = 'button';
  threadClose.setAttribute('aria-label', 'Close thread');
  const threadMeta = el('p', 'ops-thread-meta');
  threadHead.append(threadTitle, threadClose, threadMeta);
  const threadList = el('ol', 'ops-dm-stream ops-thread-stream');
  threadList.setAttribute('aria-label', 'Thread messages');
  const threadNote = el(
    'p',
    'ops-thread-note',
    'Each member answers a post once. To follow up, post again or open their DM.',
  );
  thread.append(threadHead, threadList, threadNote);
  let threadKey: string | undefined;
  let threadFrom: HTMLElement | null = null;
  function openThread(key: string) {
    threadFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    threadKey = key;
    draw();
    threadTitle.focus();
  }
  function closeThread() {
    if (!threadKey) return;
    const key = threadKey;
    threadKey = undefined;
    draw();
    const back = threadFrom?.isConnected
      ? threadFrom
      : node.querySelector<HTMLElement>(`.ops-thread-open[data-request-id="${key}"]`);
    back?.focus();
  }
  threadClose.addEventListener('click', closeThread);
  thread.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeThread();
    }
  });
  function drawThread(shown: Post[]) {
    const post = threadKey ? shown.find((each) => each.requestId === threadKey) : undefined;
    if (!post) threadKey = undefined;
    thread.hidden = !post;
    thread.parentElement?.toggleAttribute('data-thread', !!post);
    if (!post) return;
    const words = attributed(post.items[0]!.preview).words ?? 'Message preview unavailable';
    // A short one-line title; the whole post is the first row below.
    const line = words.split('\n')[0]!;
    threadTitle.textContent = line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
    threadTitle.title = words;
    const sides = answers(post);
    const replied = sides.filter((side) => side.words !== undefined);
    const waiting = sides.length - replied.length;
    const state = el(
      'span',
      'ops-dm-message-state',
      waiting ? `Waiting on ${waiting} of ${sides.length}` : 'Answered',
    );
    state.dataset.mark = waiting ? 'wait' : 'answered';
    threadMeta.replaceChildren(
      el(
        'span',
        'ops-thread-count',
        replied.length
          ? `${replied.length} repl${replied.length === 1 ? 'y' : 'ies'}`
          : 'No replies yet',
      ),
      state,
    );
    const rows: HTMLElement[] = [postRow(post, true)];
    const divider = el('li', 'ops-dm-day');
    divider.append(
      el(
        'span',
        undefined,
        replied.length
          ? `${replied.length} repl${replied.length === 1 ? 'y' : 'ies'}`
          : 'No replies yet',
      ),
    );
    rows.push(divider);
    for (const side of sides) {
      if (side.words === undefined) {
        rows.push(el('li', 'ops-thread-waiting', `Waiting on ${side.name}`));
        continue;
      }
      rows.push(
        messageRow({
          who: side.name,
          to: 'You',
          self: false,
          ...(side.at ? { at: side.at } : {}),
          text: side.words ?? 'Reading the reply…',
          quiet: !side.read,
        }),
      );
    }
    threadList.replaceChildren(...rows);
  }

  function draw() {
    const target = roomId ?? '';
    const unlisted = box.unlisted(target, (id) => items.has(id));
    const shown = posts(items.values());
    stream.draw(
      shown,
      (post) => [postRow(post)],
      [[...names()], [...replies], threadKey, [...fullPosts], now.version()],
      unlisted &&
        pendingRow(
          unlisted,
          recipientsLabel(unlisted.message),
          channel?.members.map((member) => member.name),
        ),
    );
    empty.hidden = shown.length > 0 || !!unlisted;
    drawThread(shown);
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
    compose.hidden = !room;
    if (!room) return;
    const { canSend, busy } = box.box(room.roomId, sendNote);
    composer.show({
      key: `channel:${channel.squad}`,
      label: `Message ${name}`,
      placeholder: `Message ${name} — @ to mention agents`,
      hint: 'Enter sends · Shift+Enter for a new line',
      describedBy: sendNote.id,
      canSend,
      busy,
      cleared: box.cleared,
      onSend: (message) => {
        if (!channel?.room || shell.signal.aborted) return;
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
  /** The whole text of the newest posts cut at the preview, one read at a time. */
  async function readFullPosts(ticket: number) {
    const wanted = posts(items.values())
      .filter(
        (post) => capped(post) && fullText(post) === undefined && !askedPosts.has(post.requestId),
      )
      .sort((a, b) => b.preparedAtMs - a.preparedAtMs)
      .slice(0, Math.max(0, FULL_POSTS - askedPosts.size));
    for (const post of wanted) {
      askedPosts.add(post.requestId);
      try {
        const value = await port.result(post.items[0]!.requestId);
        if (ticket !== generation) return;
        if (typeof value.requestMessage === 'string') {
          fullPosts.set(post.items[0]!.requestId, value.requestMessage);
          draw();
        }
      } catch {
        // The preview stays, with its ellipsis.
      }
    }
  }
  async function readReplies(ticket: number) {
    for (const item of items.values()) {
      const known = replies.get(item.requestId)?.state;
      if (item.final.status !== 'retained' || known === 'replied' || known === 'unavailable')
        continue;
      try {
        const value = await port.result(item.requestId);
        if (ticket !== generation) return;
        replies.set(item.requestId, value);
        if (typeof value.requestMessage === 'string')
          fullPosts.set(item.requestId, value.requestMessage);
      } catch {
        // Left as "Reading the reply…"; the next refresh asks again.
      }
    }
  }
  async function load(before?: ConversationCursor): Promise<boolean> {
    if (!roomId || !visible || refused || shell.signal.aborted) return true;
    if (document.visibilityState !== 'visible') return true;
    if (running) {
      wanted = true;
      return true;
    }
    running = true;
    olderButton.disabled = true;
    const ticket = generation,
      reading = roomId,
      mark = now.mark();
    try {
      const page = await port.readRoom(reading, { limit: 20, ...(before ? { before } : {}) });
      if (ticket !== generation || reading !== roomId) return true;
      for (const item of page.items) items.set(item.requestId, item);
      if (before || olderCursor === undefined) olderCursor = page.nextBefore;
      emptyTitle.textContent = 'No channel messages yet';
      emptyText.textContent = `Post to the lead, or @mention members. Their replies show under your post.`;
      draw();
      void now.listed(mark);
      await readReplies(ticket);
      if (ticket === generation) draw();
      await readFullPosts(ticket);
      return true;
    } catch (error) {
      if (ticket === generation) {
        empty.hidden = false;
        if (error instanceof RefusalError) {
          // A refused read waits for the board or the grant to change; the tick does not ask again.
          refused = true;
          const reason = error.reason;
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
    await box.observe();
    return load();
  }
  olderButton.hidden = true;
  olderButton.addEventListener('click', () => {
    if (olderCursor && !running) void load(olderCursor);
  });
  whileVisible(5000, shell.signal, refresh);
  return {
    node,
    thread,
    select(next: ChannelRoom | undefined) {
      // Opening the channel again asks again for posts whose whole text could not be read.
      if (next && !visible) askedPosts.clear();
      // Leaving the channel closes its thread: coming back shows the channel, as Slack does.
      if (!next && threadKey) {
        threadKey = undefined;
        drawThread([]);
      }
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
        fullPosts.clear();
        askedPosts.clear();
        threadKey = undefined;
        drawThread([]);
        olderCursor = undefined;
        stream.reset();
        olderButton.hidden = true;
        emptyTitle.textContent = 'No channel messages yet';
        emptyText.textContent =
          next?.room === null
            ? 'This squad has no channel room on this machine.'
            : 'Reading the channel…';
        empty.hidden = false;
        void refresh();
      } else draw();
      if (next?.room === null) {
        emptyTitle.textContent = 'No channel room on this machine yet';
        if (next.lead) {
          const link = el('a', undefined, `Talk to ${next.lead.name}`);
          link.href = opsHref(location.pathname, { squad: next.squad, memberId: next.lead.id });
          emptyText.replaceChildren(link, ' directly instead.');
        } else emptyText.textContent = 'Choose a member from the sidebar to talk directly.';
        empty.hidden = false;
      }
      showComposer();
    },
  };
}

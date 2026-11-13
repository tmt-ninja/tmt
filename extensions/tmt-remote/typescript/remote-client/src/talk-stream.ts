/** The talk stream shared by the Ops DM and channel (#5704, spec 8d17ce7c screens 1-3): messages
 * anchored at the bottom with day separators, each message's delivery under it and replies as their
 * own rows; and the one outbox both send through. The outbox keeps Talk's rules in one place: an
 * operation id frozen with its draft and reused by a retry of the same words while its outcome is
 * open, a refused or cancelled one retried under a new id (Remote replays a settled id and never
 * asks Core again), an unknown outcome only observed and never sent again, and a Talk-grant refusal answered with the setting, not a
 * retry. Untrusted words stay text. */
import { avatarInitials, browserUiClasses as c } from '@tmt/browser-ui/static';
import { el } from './ops-parts.js';
import type { SendState } from './operations.js';
import type { ConversationItem } from './conversations.js';

/** Core's words start a line, so they start with a capital. */
const sentence = (text: string | undefined) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;
/** The mark beside the delivery words: answered, delivered, still going, unknown or failed. */
export type Mark = 'answered' | 'done' | 'wait' | 'unknown' | 'failed';

/** What a reply row says when there is no reply text to show. */
export const finalLabel = (item: Pick<ConversationItem, 'final'>): string | undefined => {
  switch (item.final.status) {
    case 'not_submitted':
    case 'retained':
      return undefined;
    case 'not_required':
      return 'No reply needed';
    case 'withdrawn':
      return `Withdrawn · ${item.final.reason}`;
    case 'expired':
      return 'The reply has expired';
    case 'unavailable':
      return 'The reply is unavailable';
  }
};
/** The delivery line under a message: Core's own words when it has them. */
/** What the delivery words and mark read from: a DM exchange or a room post. */
type Delivered = Pick<ConversationItem, 'delivery' | 'messageState' | 'final'>;
export const deliveryText = (item: Delivered): string =>
  sentence(item.messageState?.reason.text) ??
  {
    prepared: 'Preparing',
    sending: 'Sending',
    sent: 'Sent',
    queued: 'Queued',
    uncertain: 'Delivery unknown',
    definitely_failed: 'Not delivered',
  }[item.delivery] ??
  item.delivery;
export const deliveryMark = (item: Delivered): Mark =>
  item.final.status !== 'not_submitted' || item.messageState?.state === 'answered'
    ? 'answered'
    : item.delivery === 'definitely_failed'
      ? 'failed'
      : item.delivery === 'uncertain'
        ? 'unknown'
        : item.delivery === 'sent'
          ? 'done'
          : 'wait';
const dayKey = (at: Date) => `${at.getFullYear()}-${at.getMonth()}-${at.getDate()}`;
function dayLabel(at: Date, now = new Date()): string {
  if (dayKey(at) === dayKey(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(at) === dayKey(yesterday)) return 'Yesterday';
  return at.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
const clock = (at: Date) =>
  at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** One sender's row: avatar, "who → whom", time, the words in a box and their delivery. */
/**
 * Remote prepends `[remote: <device name>]` and LF to a browser's message (colab-v1). The chat
 * already says "You", so the bubble shows the words and the device moves to the header.
 */
export function attributed(text: string | null): { device?: string; words: string | null } {
  const match = text === null ? null : /^\[remote: ([^\]\n]+)\]\n/.exec(text);
  return match ? { device: match[1]!, words: text!.slice(match[0].length) } : { words: text };
}

/** This browser's device name, once Remote says it; until then every device stays in a tooltip. */
let ownDevice: string | null = null;
/** Learn this browser's device name: a message names its device only when another one sent it. */
export function knowOwnDevice(name: string | null, root: ParentNode = document) {
  ownDevice = name;
  for (const node of root.querySelectorAll<HTMLElement>('.ops-dm-message-device'))
    node.hidden = ownDevice === null || node.dataset.device === ownDevice;
}

/** An announcement (a timer added, a member joined) is a quiet line in the stream, not a message
 * someone said, and it asks for no reply. */
export function noticeRow(text: string | null, at?: Date): HTMLElement {
  const row = el('li', 'ops-dm-notice');
  // TMT's terminal notice mark (▚) leads the words; the web line keeps only the notice's own icon.
  const words = attributed(text).words?.replace(/^▚\s*/, '') ?? null;
  row.append(el('span', 'ops-dm-notice-text', words ?? 'Notice unavailable'));
  if (at && Number.isFinite(at.valueOf())) {
    const time = el('time', 'ops-dm-message-time', clock(at));
    time.dateTime = at.toISOString();
    time.title = at.toLocaleString();
    row.append(time);
  }
  return row;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * A message's words as nodes, never as HTML: an http or https address becomes a link that opens in
 * a new tab and shows its full address on hover; words between a pair of backticks on one line
 * become inline code (kept literal); an @mention of a known name is marked. Nothing else is read as
 * markup.
 */
export function richText(words: string, mentions: readonly string[] = []): (Node | string)[] {
  const out: (Node | string)[] = [];
  const named = mentions.length
    ? new RegExp(
        `(@(?:${[...mentions]
          .sort((a, b) => b.length - a.length)
          .map(escape)
          .join('|')}))(?![\\w-])`,
      )
    : undefined;
  const plain = (text: string) => {
    if (!text) return;
    if (!named) return void out.push(text);
    text.split(named).forEach((part, at) => {
      if (part) out.push(at % 2 ? el('span', 'ops-dm-mention', part) : part);
    });
  };
  const linked = (text: string) => {
    let from = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
      // Closing punctuation after an address belongs to the sentence.
      const address = match[0].replace(/[.,;:!?)\]}'"]+$/, '');
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        continue;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      plain(text.slice(from, match.index));
      const link = el('a', 'ops-dm-link', address);
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = url.href;
      out.push(link);
      from = match.index + address.length;
    }
    plain(text.slice(from));
  };
  let from = 0;
  for (const match of words.matchAll(/`([^`\n]+)`/g)) {
    linked(words.slice(from, match.index));
    out.push(el('code', 'ops-dm-code', match[1]!));
    from = match.index + match[0].length;
  }
  linked(words.slice(from));
  return out;
}

export function messageRow(options: {
  who: string;
  to: string;
  self: boolean;
  at?: Date;
  text: string | null;
  note?: string;
  state?: string;
  mark?: Mark;
  quiet?: boolean;
  /** Names to mark where the words @mention them. */
  mentions?: readonly string[];
  /** The words are a shortened preview: they end in an ellipsis and this says so on hover. */
  shortened?: string;
}): HTMLElement {
  const row = el('li', 'ops-dm-message');
  if (options.self) row.dataset.self = '';
  const face = el('span', c.avatar, options.self ? 'Y' : avatarInitials(options.who));
  face.dataset.size = 's';
  face.setAttribute('aria-hidden', 'true');
  const { device, words } = attributed(options.text);
  const head = el('div', 'ops-dm-message-head');
  const who = el('strong', 'ops-dm-message-who', options.self ? 'You' : options.who);
  head.append(who, el('span', 'ops-dm-message-to', `→ ${options.to}`));
  if (device) {
    // Named only when another device sent it; this browser's own device stays in the tooltip.
    who.title = `Sent from ${device}`;
    const from = el('span', 'ops-dm-message-device', `· from ${device}`);
    from.dataset.device = device;
    from.hidden = ownDevice === null || device === ownDevice;
    head.append(from);
  }
  // Consecutive messages from the same sender to the same people share one header (`talkList`).
  row.dataset.group = JSON.stringify([options.who, options.to, options.self, device ?? '']);
  const side = el('span', 'ops-dm-message-side');
  side.append(face);
  if (options.at && Number.isFinite(options.at.valueOf())) {
    const time = el('time', 'ops-dm-message-time', clock(options.at));
    time.dateTime = options.at.toISOString();
    time.title = options.at.toLocaleString();
    head.append(time);
    row.dataset.at = String(options.at.valueOf());
    // A grouped message shows its time beside it under the pointer; the header keeps it for readers.
    const gutter = el('span', 'ops-dm-message-gutter', clock(options.at));
    gutter.setAttribute('aria-hidden', 'true');
    side.append(gutter);
  }
  const text = el('p', 'ops-dm-message-text', words ?? 'Message preview unavailable');
  if (words === null || options.quiet) text.dataset.quiet = '';
  else {
    text.replaceChildren(...richText(words, options.mentions));
    if (options.shortened) {
      text.append('…');
      text.title = options.shortened;
    }
  }
  const content = el('div', 'ops-dm-message-body');
  content.append(head, text);
  if (options.note) content.append(el('p', 'ops-dm-message-note', options.note));
  if (options.state) {
    const state = el('p', 'ops-dm-message-state', options.state);
    state.dataset.mark = options.mark ?? 'done';
    content.append(state);
  }
  row.append(side, content);
  return row;
}

/** Core keeps a post's preview to this many characters; a longer post is cut there. */
export const PREVIEW_CHARACTERS = 160;
/** The hover line of a post cut to its preview; Core does not say how long the whole post is. */
export const SHORTENED_POST = `Preview shortened · the full message is longer than ${PREVIEW_CHARACTERS} characters`;
const utf8 = new TextEncoder();
/** A reply preview shorter than the reply Core retained, or nothing when it is whole. */
export function shortenedReply(item: Pick<ConversationItem, 'final' | 'responsePreview'>) {
  return item.final.status === 'retained' &&
    item.responsePreview !== null &&
    item.final.bodyBytes > utf8.encode(item.responsePreview).length
    ? `Preview shortened · the full reply is ${item.final.bodyBytes.toLocaleString()} bytes`
    : undefined;
}

/** A sent exchange: the owner's words to `to`, then the recipient's reply when there is one; each
 * shows its full text once read (`fullPost`, `fullReply`), else its preview. */
export function exchangeRows(
  item: ConversationItem,
  names: { me: string; them: string; fromMe: boolean },
  fullReply?: string,
  fullPost?: string,
): HTMLElement[] {
  const { fromMe, them } = names;
  if (item.kind === 'announcement') return [noticeRow(item.preview, new Date(item.preparedAtMs))];
  const out = [
    messageRow({
      who: fromMe ? names.me : them,
      to: fromMe ? them : 'You',
      self: fromMe,
      at: new Date(item.preparedAtMs),
      text: fullPost ?? item.preview,
      ...(item.previewTruncated && fullPost === undefined ? { shortened: SHORTENED_POST } : {}),
      ...(fromMe ? { state: deliveryText(item), mark: deliveryMark(item) } : {}),
    }),
  ];
  const replyWords = fullReply ?? item.responsePreview ?? finalLabel(item);
  const replyShortened = fullReply === undefined ? shortenedReply(item) : undefined;
  if (replyWords !== undefined && replyWords !== null)
    out.push(
      messageRow({
        who: fromMe ? them : names.me,
        to: fromMe ? 'You' : them,
        self: !fromMe,
        ...(item.final.status === 'retained' ? { at: new Date(item.final.submittedAtMs) } : {}),
        text: replyWords,
        quiet: fullReply === undefined && item.responsePreview === null,
        ...(replyShortened ? { shortened: replyShortened } : {}),
      }),
    );
  return out;
}

/** The scrolling list: day separators, cached exchange rows, and a hold on the newest exchange
 * while the reader is there, also when the view resizes. Scrolling up releases it. */
export function talkList(label: string) {
  const list = el('ol', 'ops-dm-stream');
  list.setAttribute('aria-label', label);
  const rows = new Map<string, { node: HTMLElement; fingerprint: string }>();
  // Each day is a block: its line sticks to the top only while its own messages scroll under it.
  const days = new Map<string, { node: HTMLElement; line: HTMLElement; rows: HTMLElement }>();
  let pinned = true;
  // Where the stream last scrolled itself: its own scroll events never release the hold.
  let placed = -1;
  // The newest message, and the newest the reader has seen at the bottom: a reader scrolled up is
  // told how many arrived since and can jump back to the latest.
  let latest = -Infinity,
    seen = -Infinity,
    unseen = 0;
  const jump = el('li', 'ops-dm-jump');
  const jumpButton = el('button', 'ops-dm-jump-button');
  jumpButton.type = 'button';
  jump.append(jumpButton);
  jump.hidden = true;
  const showJump = () => {
    const far = list.scrollHeight - list.scrollTop - list.clientHeight > list.clientHeight;
    jump.hidden = pinned || (unseen === 0 && !far);
    jumpButton.textContent = unseen
      ? `${unseen} new message${unseen === 1 ? '' : 's'} ↓`
      : 'Jump to latest ↓';
  };
  const caughtUp = () => {
    seen = latest;
    unseen = 0;
  };
  const toBottom = () => {
    list.scrollTop = list.scrollHeight;
    placed = list.scrollTop;
  };
  jumpButton.addEventListener('click', () => {
    pinned = true;
    caughtUp();
    jump.hidden = true;
    toBottom();
  });
  // The view's height when last seen: a scroll that comes with a new height (the on-screen keyboard,
  // a folded header) is the layout moving, not the reader, and keeps the hold.
  let height = 0;
  list.addEventListener('scroll', () => {
    if (list.scrollTop === placed) return;
    if (list.clientHeight !== height) {
      height = list.clientHeight;
      if (pinned) return toBottom();
    }
    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (pinned) caughtUp();
    showJump();
  });
  // The view and every row: a row that grows (a font, a reply) keeps the newest in view too.
  const sizes = new ResizeObserver(() => {
    height = list.clientHeight;
    if (pinned) toBottom();
  });
  sizes.observe(list);
  return {
    list,
    reset() {
      rows.clear();
      days.clear();
      list.replaceChildren();
      sizes.disconnect();
      sizes.observe(list);
      pinned = true;
      latest = seen = -Infinity;
      unseen = 0;
      jump.hidden = true;
    },
    forget() {
      rows.clear();
      days.clear();
    },
    draw<T extends { requestId: string; preparedAtMs: number }>(
      items: Iterable<T>,
      render: (item: T) => HTMLElement[],
      context: unknown,
      tail?: HTMLElement,
    ) {
      const atBottom = pinned;
      const ordered = [...items].sort(
        (a, b) => a.preparedAtMs - b.preparedAtMs || a.requestId.localeCompare(b.requestId),
      );
      const blocks: {
        block: { node: HTMLElement; line: HTMLElement; rows: HTMLElement };
        rows: HTMLElement[];
      }[] = [];
      let day = '';
      for (const item of ordered) {
        const at = new Date(item.preparedAtMs);
        const key = Number.isFinite(at.valueOf()) ? dayKey(at) : 'unknown';
        if (key !== day) {
          day = key;
          const label = key === 'unknown' ? 'Date unknown' : dayLabel(at);
          let block = days.get(key);
          if (!block) {
            const node = el('li', 'ops-dm-dayblock');
            const line = el('div', 'ops-dm-day');
            const rows = el('ol', 'ops-dm-day-rows');
            node.append(line, rows);
            block = { node, line, rows };
            days.set(key, block);
          }
          if (block.line.textContent !== label)
            block.line.replaceChildren(el('span', undefined, label));
          blocks.push({ block, rows: [] });
        }
        const fingerprint = JSON.stringify([item, context]);
        let row = rows.get(item.requestId);
        if (!row || row.fingerprint !== fingerprint) {
          const group = el('li', 'ops-dm-exchange');
          group.dataset.requestId = item.requestId;
          const inner = el('ol', 'ops-dm-exchange-rows');
          inner.append(...render(item));
          group.append(inner);
          row = { node: group, fingerprint };
          rows.set(item.requestId, row);
        }
        blocks.at(-1)!.rows.push(row.node);
      }
      // The post on its way belongs to today's block, or stands alone in an empty stream.
      if (tail && blocks.length) blocks.at(-1)!.rows.push(tail);
      const children = blocks.map(({ block }) => block.node);
      if (tail && !blocks.length) children.push(tail);
      group(blocks.flatMap(({ block, rows }) => [block.line, ...rows]));
      children.push(jump);
      latest = ordered.reduce((at, item) => Math.max(at, item.preparedAtMs), latest);
      if (atBottom) caughtUp();
      else unseen = ordered.filter((item) => item.preparedAtMs > seen).length;
      // Unchanged rows stay in place, so a refresh keeps the reader's text selection.
      const same = (parent: Element, next: readonly HTMLElement[]) =>
        next.length === parent.children.length &&
        next.every((child, at) => parent.children[at] === child);
      for (const { block, rows: next } of blocks)
        if (!same(block.rows, next)) {
          block.rows.replaceChildren(...next);
          for (const child of next) sizes.observe(child);
        }
      if (!same(list, children)) {
        list.replaceChildren(...children);
        for (const child of children) sizes.observe(child);
      }
      if (atBottom) toBottom();
      showJump();
    },
  };
}

/** Five minutes: Slack's window for messages that read as one turn. */
const GROUP_MS = 5 * 60_000;
/** A message continues the one above it (no face, no header) when the same sender wrote to the same
 * people within `GROUP_MS`, with no day line or notice between them. */
function group(children: readonly HTMLElement[]) {
  let previous: { key: string; at: number } | undefined;
  for (const child of children) {
    const rows = child.matches('.ops-dm-exchange')
      ? child.querySelectorAll<HTMLElement>(':scope > ol > .ops-dm-message')
      : [];
    if (!rows.length) previous = undefined;
    for (const row of rows) {
      const key = row.dataset.group ?? '';
      const at = Number(row.dataset.at);
      const continued =
        previous !== undefined &&
        previous.key === key &&
        Number.isFinite(at) &&
        at >= previous.at &&
        at - previous.at <= GROUP_MS;
      row.toggleAttribute('data-continued', continued);
      previous = Number.isFinite(at) ? { key, at } : undefined;
    }
  }
}

/** One post on its way: its frozen operation id and words, where it goes and how it stands. */
export interface Pending {
  operationId: string;
  message: string;
  /** The DM member or channel the post belongs to. */
  target: string;
  /** The send's context (such as a room revision), captured with its draft. */
  version: string;
  state: 'sending' | 'held' | 'uncertain' | 'accepted' | 'refused' | 'cancelled';
  requestId?: string;
  reason?: string;
  settingsUrl?: string;
  /** Refused for the Talk grant: no retry, only the setting. */
  grant?: boolean;
}
export interface TalkPort<I> {
  send(input: I): Promise<SendState>;
  operation(operationId: string): Promise<SendState>;
}
const GOING = ['sending', 'held', 'uncertain'];

/** The outbox: at most one post on its way. `changed` runs after every state change. */
export function outbox<I>(port: TalkPort<I>, changed: (pending: Pending) => void) {
  let pending: Pending | undefined;
  let cleared = 0;
  function settle(value: SendState) {
    if (!pending || pending.operationId !== value.operationId) return;
    if (value.state === 'accepted') {
      pending = { ...pending, state: 'accepted', requestId: value.requestId };
      cleared++;
    } else if (value.state === 'held') pending = { ...pending, state: 'held' };
    else if (value.state === 'uncertain')
      pending = {
        ...pending,
        state: 'uncertain',
        ...(value.requestId ? { requestId: value.requestId } : {}),
      };
    else if (value.state === 'cancelled') pending = { ...pending, state: 'cancelled' };
    else
      pending = {
        ...pending,
        state: 'refused',
        ...(value.reason ? { reason: value.reason } : {}),
        ...(value.settingsUrl ? { settingsUrl: value.settingsUrl } : {}),
        grant: value.scope === 'talk',
      };
    changed(pending);
  }
  return {
    get pending() {
      return pending;
    },
    get cleared() {
      return cleared;
    },
    async send(target: string, message: string, input: (operationId: string) => I, version = '') {
      if (pending && GOING.includes(pending.state)) return;
      // Held and uncertain sends are observed above; settled attempts need a fresh operation.
      pending = { operationId: crypto.randomUUID(), message, target, version, state: 'sending' };
      const { operationId } = pending;
      changed(pending);
      try {
        settle(await port.send(input(operationId)));
      } catch {
        // A send that did not answer may still have arrived: observe it, never send it again.
        if (pending?.operationId === operationId) {
          pending = { ...pending, state: 'uncertain' };
          changed(pending);
        }
      }
    },
    async observe() {
      if (!pending || !['held', 'uncertain'].includes(pending.state)) return;
      try {
        settle(await port.operation(pending.operationId));
      } catch {
        // Still unknown; the next visible tick asks again.
      }
    },
    /** The post for `target` that its stream does not list yet. */
    unlisted(target: string, listed: (requestId: string) => boolean): Pending | undefined {
      return pending?.target === target && !(pending.requestId && listed(pending.requestId))
        ? pending
        : undefined;
    },
    /** What the box can do for `target`, and the line under it. */
    box(target: string, note: HTMLElement): { canSend: boolean; busy: boolean } {
      const mine = pending?.target === target ? pending : undefined;
      const busy = !!mine && GOING.includes(mine.state);
      note.replaceChildren();
      if (mine?.grant) {
        note.append(`${mine.reason ?? 'Talk is off for this browser.'} `);
        if (mine.settingsUrl) {
          const link = el('a', undefined, 'Turn on Talk in Remote settings');
          link.href = mine.settingsUrl;
          note.append(link);
        }
      } else if (mine?.state === 'refused')
        note.textContent = `Not sent: ${refusalWords(mine.reason)}`;
      else if (mine?.state === 'cancelled')
        note.textContent = 'Not sent: it was cancelled on the machine. Send again to send it anew.';
      else if (busy && mine!.state !== 'sending')
        // "Sending…" already shows under the message itself.
        note.textContent =
          mine!.state === 'uncertain'
            ? 'Checking whether the message arrived. It is never sent twice.'
            : 'Waiting for approval on the machine.';
      note.hidden = !note.textContent;
      return { canSend: !mine?.grant, busy };
    },
  };
}

/** Core's refusal in words, with what the person can do; an unknown code is named as it is. */
function refusalWords(reason: string | undefined): string {
  switch (reason) {
    case 'ROOM_ROSTER_CHANGED':
      return 'the squad changed. Check the recipients and send again.';
    case undefined:
      return 'the machine refused it. Send again to send it anew.';
    default:
      return `the machine refused it (${reason}). Send again to send it anew.`;
  }
}

/** The row of a post on its way, under the stream until the stream lists it. */
export function pendingRow(
  value: Pending,
  to: string,
  mentions: readonly string[] = [],
): HTMLElement {
  const group = el('li', 'ops-dm-exchange');
  group.dataset.pending = value.state;
  const inner = el('ol', 'ops-dm-exchange-rows');
  inner.append(
    messageRow({
      who: 'You',
      to,
      self: true,
      at: new Date(),
      text: value.message,
      mentions,
      state:
        value.state === 'sending'
          ? 'Sending…'
          : value.state === 'held'
            ? 'Waiting for approval on the machine'
            : value.state === 'uncertain'
              ? 'Delivery unknown · checking, nothing is sent again'
              : value.state === 'accepted'
                ? 'Sent'
                : 'Not sent',
      mark:
        value.state === 'uncertain'
          ? 'unknown'
          : value.state === 'accepted'
            ? 'done'
            : value.state === 'refused' || value.state === 'cancelled'
              ? 'failed'
              : 'wait',
    }),
  );
  group.append(inner);
  return group;
}

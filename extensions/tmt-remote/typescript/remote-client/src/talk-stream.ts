/** The talk stream shared by the Ops DM and channel (#5704, spec 8d17ce7c screens 1-3): messages
 * anchored at the bottom with day separators, each message's delivery under it and replies as their
 * own rows; and the one outbox both send through. The outbox keeps Talk's rules in one place: an
 * operation id frozen with its draft and reused by a retry of the same words, an unknown outcome
 * only observed and never sent again, and a Talk-grant refusal answered with the setting, not a
 * retry. Untrusted words stay text. */
import { avatarInitials, browserUiClasses as c } from '@tmt/browser-ui/static';
import { el } from './ops-parts.js';
import type { SendState } from './operations.js';
import type { ConversationItem } from './conversations.js';

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
export const deliveryText = (item: ConversationItem): string =>
  item.messageState?.reason.text ??
  {
    prepared: 'Preparing',
    sending: 'Sending',
    sent: 'Sent',
    queued: 'Queued',
    uncertain: 'Delivery unknown',
    definitely_failed: 'Not delivered',
  }[item.delivery] ??
  item.delivery;
export const deliveryMark = (item: ConversationItem): Mark =>
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
}): HTMLElement {
  const row = el('li', 'ops-dm-message');
  if (options.self) row.dataset.self = '';
  const face = el('span', c.avatar, options.self ? 'Y' : avatarInitials(options.who));
  face.dataset.size = 's';
  face.setAttribute('aria-hidden', 'true');
  const head = el('div', 'ops-dm-message-head');
  head.append(
    el('strong', 'ops-dm-message-who', options.self ? 'You' : options.who),
    el('span', 'ops-dm-message-to', `→ ${options.to}`),
  );
  if (options.at && Number.isFinite(options.at.valueOf())) {
    const time = el('time', 'ops-dm-message-time', clock(options.at));
    time.dateTime = options.at.toISOString();
    time.title = options.at.toLocaleString();
    head.append(time);
  }
  const text = el('p', 'ops-dm-message-text', options.text ?? 'Message preview unavailable');
  if (options.text === null || options.quiet) text.dataset.quiet = '';
  else if (options.mentions?.length) {
    const names = [...options.mentions]
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const parts = options.text!.split(new RegExp(`(@(?:${names.join('|')}))(?![\\w-])`));
    text.replaceChildren(
      ...parts.map((part, at) => (at % 2 ? el('span', 'ops-dm-mention', part) : part)),
    );
  }
  const content = el('div', 'ops-dm-message-body');
  content.append(head, text);
  if (options.note) content.append(el('p', 'ops-dm-message-note', options.note));
  if (options.state) {
    const state = el('p', 'ops-dm-message-state', options.state);
    state.dataset.mark = options.mark ?? 'done';
    content.append(state);
  }
  row.append(face, content);
  return row;
}

/** A sent exchange: the owner's words to `to`, then the recipient's reply when there is one. */
export function exchangeRows(
  item: ConversationItem,
  names: { me: string; them: string; fromMe: boolean },
): HTMLElement[] {
  const { fromMe, them } = names;
  const out = [
    messageRow({
      who: fromMe ? names.me : them,
      to: fromMe ? them : 'You',
      self: fromMe,
      at: new Date(item.preparedAtMs),
      text: item.preview,
      ...(item.previewTruncated ? { note: 'Preview shortened' } : {}),
      ...(fromMe ? { state: deliveryText(item), mark: deliveryMark(item) } : {}),
    }),
  ];
  const replyWords = item.responsePreview ?? finalLabel(item);
  if (replyWords !== undefined && replyWords !== null)
    out.push(
      messageRow({
        who: fromMe ? them : names.me,
        to: fromMe ? 'You' : them,
        self: !fromMe,
        ...(item.final.status === 'retained' ? { at: new Date(item.final.submittedAtMs) } : {}),
        text: replyWords,
        quiet: item.responsePreview === null,
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
  const days = new Map<string, HTMLElement>();
  let pinned = true;
  list.addEventListener('scroll', () => {
    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  });
  new ResizeObserver(() => {
    if (pinned) list.scrollTop = list.scrollHeight;
  }).observe(list);
  return {
    list,
    reset() {
      rows.clear();
      days.clear();
      list.replaceChildren();
      pinned = true;
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
      const children: HTMLElement[] = [];
      let day = '';
      for (const item of ordered) {
        const at = new Date(item.preparedAtMs);
        const key = Number.isFinite(at.valueOf()) ? dayKey(at) : 'unknown';
        if (key !== day) {
          day = key;
          const label = key === 'unknown' ? 'Date unknown' : dayLabel(at);
          let separator = days.get(key);
          if (separator?.textContent !== label) {
            separator = el('li', 'ops-dm-day');
            separator.append(el('span', undefined, label));
            days.set(key, separator);
          }
          children.push(separator);
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
        children.push(row.node);
      }
      if (tail) children.push(tail);
      // Unchanged rows stay in place, so a refresh keeps the reader's text selection.
      const same =
        children.length === list.children.length &&
        children.every((child, at) => list.children[at] === child);
      if (!same) list.replaceChildren(...children);
      if (atBottom) list.scrollTop = list.scrollHeight;
    },
  };
}

/** One post on its way: its frozen operation id and words, where it goes and how it stands. */
export interface Pending {
  operationId: string;
  message: string;
  /** The DM member or channel the post belongs to. */
  target: string;
  /** What else the send carries (a room revision): a retry reuses the id only when it matches. */
  version: string;
  state: 'sending' | 'held' | 'uncertain' | 'accepted' | 'refused';
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
      // One operation per draft: a retry of the same words reuses its id; new words get a new one.
      if (
        !pending ||
        pending.target !== target ||
        pending.message !== message ||
        pending.version !== version ||
        pending.state === 'accepted'
      )
        pending = { operationId: crypto.randomUUID(), message, target, version, state: 'sending' };
      else pending = { ...pending, state: 'sending' };
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
        note.textContent = `Not sent: ${mine.reason ?? 'the machine refused it'}. Send again to retry the same message.`;
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
                : `Not sent${value.reason ? ` · ${value.reason}` : ''}`,
      mark:
        value.state === 'uncertain'
          ? 'unknown'
          : value.state === 'accepted'
            ? 'done'
            : value.state === 'refused'
              ? 'failed'
              : 'wait',
    }),
  );
  group.append(inner);
  return group;
}

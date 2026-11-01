/** One bounded DM read at a time; positions and seen state never leave their owners. */
import { browserUiClasses as c } from '@tmt/browser-ui/static';
import { el } from './ops-parts.js';
import { commandCopy } from './command-copy.js';
import { whileVisible } from './owner-reads.js';
import type { RemoteShell } from './remote-shell.js';
import { ClientError, RefusalError } from './operations.js';
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
export interface ConversationObservation {
  scope?: ConversationScope;
  unread: ConversationUnread;
}
function sessionRead(shell: RemoteShell): ConversationRead {
  return async (memberId, input) => {
    if (!shell.session) throw new Error('No signed browser session.');
    const session = await shell.session();
    shell.signal.throwIfAborted();
    try {
      const client = conversations(session);
      return { machineId: client.machineId, page: await client.read(memberId, input) };
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
const finalLabel = (item: ConversationItem): string => {
  switch (item.final.status) {
    case 'not_submitted':
      return 'No reply submitted';
    case 'not_required':
      return 'No reply required';
    case 'withdrawn':
      return `Withdrawn · ${item.final.reason}`;
    case 'expired':
      return 'Reply expired';
    case 'unavailable':
      return 'Reply unavailable';
    case 'retained':
      return item.previewTruncated ? 'Reply preview · truncated' : 'Reply preview';
  }
};
export function conversationHistory(
  shell: RemoteShell,
  observed: (value: ConversationObservation) => void,
  read: ConversationRead = sessionRead(shell),
) {
  const node = el('section', 'ops-channel-history');
  node.setAttribute('aria-label', 'Talk history');
  const heading = el('h2', c.sectionHeading, 'Talk history');
  const unread = el('p', 'ops-detail-note', 'Unread changes: Unknown');
  const status = el('p', 'ops-empty', 'Choose a member to read the retained conversation.');
  status.setAttribute('role', 'status');
  const list = el('ul', c.list);
  list.setAttribute('aria-label', 'Conversation previews');
  const actions = el('div', c.actions);
  const refreshButton = el('button', c.action, 'Refresh history');
  refreshButton.type = 'button';
  const olderButton = el('button', c.action, 'Older');
  olderButton.type = 'button';
  const footer = el(
    'p',
    'ops-foot',
    'Reading here does not acknowledge requests or send messages. Seen state stays in this browser.',
  );
  actions.append(refreshButton, olderButton);
  node.append(heading, unread, status, list, actions, footer);
  const terminal = commandCopy('tmt ops ui');
  terminal.hidden = true;
  node.append(terminal);
  const seen = conversationSeen(storage());
  const rows = new Map<string, { node: HTMLElement; fingerprint: string }>();
  let memberId: string | undefined,
    memberName = '',
    panelVisible = false,
    newest = true;
  let generation = 0,
    running = false,
    wanted = false;
  let scope: ConversationScope | undefined, page: ConversationPage | undefined;
  let reported = '';
  function report(value: ConversationObservation) {
    const fingerprint = JSON.stringify(value);
    unread.textContent =
      value.unread.state === 'unknown'
        ? 'Unread changes: Unknown'
        : `Unread changes: ${value.unread.more ? '50+' : value.unread.count}`;
    if (fingerprint !== reported) {
      reported = fingerprint;
      observed(value);
    }
  }
  function buttons() {
    refreshButton.disabled = running || !memberId;
    refreshButton.textContent = newest ? 'Refresh history' : 'Newest page';
    olderButton.disabled = running || !page?.nextBefore;
    olderButton.textContent = page && !page.nextBefore ? 'No older page' : 'Older';
    node.setAttribute('aria-busy', String(running));
  }
  function draw(next: ConversationPage) {
    terminal.hidden = true;
    page = next;
    status.textContent =
      next.member === 'unknown'
        ? 'This member is unknown on this machine.'
        : next.member === 'retired'
          ? 'This member has been retired.'
          : next.items.length
            ? ''
            : 'No retained conversation in this page.';
    status.hidden = status.textContent === '';
    const remaining = new Set(next.items.map((item) => item.requestId));
    for (const [id, row] of rows)
      if (!remaining.has(id)) {
        row.node.remove();
        rows.delete(id);
      }
    next.items.forEach((item, index) => {
      const fingerprint = JSON.stringify([item, memberName]);
      let row = rows.get(item.requestId);
      if (!row) {
        row = { node: el('li', c.listRow), fingerprint: '' };
        row.node.dataset.requestId = item.requestId;
        rows.set(item.requestId, row);
      }
      if (row.fingerprint !== fingerprint) {
        row.fingerprint = fingerprint;
        const title = el('div', `${c.listTitle} ops-detail-block`);
        title.append(
          el(
            'strong',
            c.listLabel,
            item.direction === 'toMember' ? `You → ${memberName}` : `${memberName} → You`,
          ),
          el('p', c.listDescription, item.preview ?? 'Request preview unavailable'),
          el(
            'p',
            c.listDescription,
            item.responsePreview === null
              ? finalLabel(item)
              : `${finalLabel(item)} · ${item.responsePreview}`,
          ),
        );
        const meta = el('div', c.listMeta);
        const at = new Date(item.preparedAtMs);
        const time = el(
          'time',
          c.listUpdated,
          Number.isFinite(at.valueOf()) ? at.toLocaleString() : 'Time unavailable',
        );
        if (Number.isFinite(at.valueOf())) time.dateTime = at.toISOString();
        meta.append(
          time,
          el(
            'span',
            c.listState,
            item.messageState?.reason.text ?? item.delivery.replaceAll('_', ' '),
          ),
        );
        row.node.replaceChildren(title, meta);
      }
      if (list.children[index] !== row.node)
        list.insertBefore(row.node, list.children[index] ?? null);
    });
  }
  async function load(before?: ConversationCursor): Promise<boolean> {
    if (!memberId || shell.signal.aborted || document.visibilityState !== 'visible') return true;
    if (running) return true;
    running = true;
    buttons();
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
        rows.clear();
        list.replaceChildren();
      }
      scope = nextScope;
      let changes =
        input.since === baseline.position
          ? conversationUnread(baseline, next.page.changedSince)
          : UNKNOWN;
      const renderedNewest = !before && newest;
      if ((before && !newest) || renderedNewest) draw(next.page);
      const visible = panelVisible && node.isConnected && document.visibilityState === 'visible';
      if (
        renderedNewest &&
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
        page = undefined;
        rows.clear();
        list.replaceChildren();
        terminal.hidden = false;
        status.hidden = false;
        status.textContent =
          'Conversation history is unavailable for this browser. Use Ops in this machine’s terminal.';
        report({ unread: UNKNOWN });
      }
      return false;
    } finally {
      running = false;
      buttons();
      if (wanted && !shell.signal.aborted) {
        wanted = false;
        void refresh();
      }
    }
  }
  async function refresh(): Promise<boolean> {
    if (panelVisible && !newest) return true;
    return load();
  }
  refreshButton.addEventListener('click', () => {
    newest = true;
    generation++;
    void load();
  });
  olderButton.addEventListener('click', () => {
    const before = page?.nextBefore;
    if (!before || running) return;
    newest = false;
    generation++;
    void load(before);
  });
  shell.signal.addEventListener(
    'abort',
    () => {
      generation++;
      rows.clear();
    },
    { once: true },
  );
  whileVisible(5000, shell.signal, refresh);
  buttons();
  return {
    node,
    select(member: { id: string; name: string } | undefined) {
      const wasVisible = panelVisible;
      panelVisible = member !== undefined;
      if (member && member.id !== memberId) {
        memberId = member.id;
        memberName = member.name;
        newest = true;
        generation++;
        scope = undefined;
        page = undefined;
        rows.clear();
        list.replaceChildren();
        status.hidden = false;
        status.textContent = 'Reading retained conversation…';
        report({ unread: UNKNOWN });
        if (running) wanted = true;
        else void refresh();
      } else if (member) {
        memberName = member.name;
        if (!wasVisible) void refresh();
      }
      buttons();
    },
  };
}

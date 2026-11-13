/** The Ops web view: local squad channels and Orchestration, one section at a time
 * from the module menu. Only Orchestration changes anything, through Core's own preview and confirm
 * (#4894). Every state is a mark and a word; what the reader sets on a section stays across the
 * board's refreshes. */
import { pageLoading } from './page-loading.js';
import type { RemoteShell } from './remote-shell.js';
import { notAvailable } from './not-available.js';
import { bySquad } from './ops-parts.js';
import { orchestrationView, type OrchestrationConnect } from './ops-orchestration.js';
import { orchestrationApi } from './orchestration-client.js';
import { opsSource, type OpsBoard, type OpsSource } from './ops-source.js';
import { whileVisible } from './owner-reads.js';
import { channelView } from './ops-channel.js';
import type { ChannelPort } from './channel-stream.js';
import {
  conversationHistory,
  type ConversationRead,
  type ConversationTalk,
} from './conversation-history.js';
import type { ConversationUnread } from './conversation-seen.js';
import { OPS_SECTIONS, opsMenu, opsPlace, type OpsPlace } from './ops-menu.js';

/** The board's own reload cadence (`tmt ops ui`). */
const REFRESH_MS = 5000;
/** Orchestration changes by configuration, not by turn: a slower reread while it is shown. */
const ORCHESTRATION_REFRESH_MS = 30_000;

export function opsPage(
  shell: RemoteShell,
  source: OpsSource = opsSource,
  historyRead?: ConversationRead,
  orchestrationConnect: OrchestrationConnect = async () => {
    if (!shell.session) throw new Error('No signed browser session.');
    return orchestrationApi(await shell.session());
  },
  historyTalk?: ConversationTalk,
  channelPort?: ChannelPort,
): void {
  const main = document.getElementById('ops-section');
  const note = document.getElementById('ops-note');
  if (!main || !note) return;
  let board: OpsBoard | undefined;
  const current = (): OpsPlace => {
    const place = opsPlace(location.hash);
    if (place !== 'home' || !board || board.unavailable) return place;
    const first = bySquad(board, true)[0];
    return first ? { squad: first.name } : 'home';
  };
  const orchestration = orchestrationView(orchestrationConnect);
  let orchestrationAt = 0;
  const refreshOrchestration = () => {
    orchestrationAt = Date.now();
    return orchestration.refresh();
  };
  const channel = channelView(location.pathname, shell, channelPort);
  const collapsedSquads = new Set<string>();
  const unread = new Map<string, ConversationUnread>();
  let unreadScope = '';
  const history = conversationHistory(
    shell,
    (value) => {
      const next = value.scope ? `${value.scope.machineId}/${value.scope.viewerId}` : '';
      if (next !== unreadScope || !value.scope) {
        unread.clear();
        unreadScope = next;
      }
      if (value.scope) unread.set(value.scope.memberId, value.unread);
      paintMenu();
    },
    historyRead,
    historyTalk,
  );
  const paintMenu = () => {
    const section = current();
    shell.setMenu(
      opsMenu(
        section,
        board,
        location.pathname,
        {
          collapsed: collapsedSquads,
          toggle(squad) {
            if (collapsedSquads.has(squad)) collapsedSquads.delete(squad);
            else collapsedSquads.add(squad);
            paint();
          },
        },
        unread,
      ),
    );
  };
  const paint = () => {
    const section = current();
    paintMenu();
    const member =
      board && !board.unavailable && typeof section !== 'string' && section.memberId
        ? board.agents.find(
            (agent) => agent.id === section.memberId && agent.squad === section.squad,
          )
        : undefined;
    history.select(member ? { id: member.id, name: member.name } : undefined);
    const label =
      typeof section === 'string'
        ? (OPS_SECTIONS.find((item) => item.id === section)?.label ?? 'Ops')
        : section.memberId
          ? (board?.agents.find(
              (agent) => agent.id === section.memberId && agent.squad === section.squad,
            )?.name ?? 'Member unavailable')
          : `#${section.squad}`;
    shell.setTitle(label, label === 'Ops' ? [] : ['Ops'], 'Ops');
    if (!board) main.replaceChildren(pageLoading());
    else if (board.unavailable) main.replaceChildren();
    else if (typeof section !== 'string') {
      if (channel.node.parentElement !== main) main.replaceChildren(channel.node);
      channel.update(board, section);
      if (member && history.node.parentElement !== channel.history)
        channel.history.replaceChildren(history.node);
    } else if (section === 'orchestration') {
      // Core's own reads, not the board: the first paint of the section loads it.
      if (orchestration.node.parentElement !== main) {
        main.replaceChildren(orchestration.node);
        void refreshOrchestration();
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'ops-empty';
      empty.textContent = 'No squads yet.';
      main.replaceChildren(empty);
    }
  };
  window.addEventListener('hashchange', paint, { signal: shell.signal });
  paint();
  whileVisible(ORCHESTRATION_REFRESH_MS, shell.signal, async () => {
    const due = Date.now() - orchestrationAt >= ORCHESTRATION_REFRESH_MS;
    if (due && current() === 'orchestration' && orchestration.node.parentElement === main)
      await refreshOrchestration();
    return true;
  });
  // The board while the route is visible, at the board's own cadence; a page repaints only when
  // the board changed, so a reader's place and selection stay.
  let last = '';
  whileVisible(REFRESH_MS, shell.signal, async () => {
    const next = await source.board(shell.signal);
    if (shell.signal.aborted) return true;
    const seen = JSON.stringify(next);
    if (seen !== last) {
      last = seen;
      board = next;
      if (next.unavailable) {
        notAvailable(note, next.unavailable);
      } else {
        if (next.truncated)
          notAvailable(
            note,
            'The board is larger than the browser shows. `tmt ops ui` shows all of it.',
          );
        else {
          note.textContent = '';
          note.hidden = true;
        }
      }
      paint();
    }
    return next.unavailable === undefined;
  });
}

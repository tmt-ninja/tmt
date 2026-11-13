/** The fixed Ops rail: observed counts only; the shared leaf owns row presentation. */
import type { ShellMenu, ShellMenuGroup } from '@tmt/browser-ui/shell';
import { AGENT_STATES, type OpsBoard } from './ops-source.js';
import { bySquad, mark } from './ops-parts.js';
import type { ConversationUnread } from './conversation-seen.js';

export const OPS_SECTIONS = [{ id: 'orchestration', label: 'Orchestration' }] as const;
export type OpsSection = (typeof OPS_SECTIONS)[number]['id'] | 'home';

export function opsSection(hash: string): OpsSection {
  return OPS_SECTIONS.find((section) => `#${section.id}` === hash)?.id ?? 'home';
}

export type OpsPlace = OpsSection | { squad: string; memberId?: string };

export function opsPlace(hash: string): OpsPlace {
  try {
    if (hash.startsWith('#channel/')) {
      const squad = decodeURIComponent(hash.slice(9));
      if (squad) return { squad };
    }
    const dm = /^#dm\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.+)$/.exec(
      hash,
    );
    if (dm) return { memberId: dm[1]!, squad: decodeURIComponent(dm[2]!) };
  } catch {
    /* A malformed link never selects a member by name. */
  }
  return opsSection(hash);
}

export function opsHref(pathname: string, place: OpsPlace): string {
  if (typeof place === 'string') return `${pathname}#${place}`;
  const squad = encodeURIComponent(place.squad);
  return place.memberId
    ? `${pathname}#dm/${place.memberId}/${squad}`
    : `${pathname}#channel/${squad}`;
}

/** The rail's mark for a channel or DM whose message box holds unsent words. */
export const DRAFT = '✎ Draft';
export function opsMenu(
  section: OpsPlace,
  board: OpsBoard | undefined,
  pathname: string,
  disclosure?: { collapsed: ReadonlySet<string>; toggle(squad: string): void },
  unread?: ReadonlyMap<string, ConversationUnread>,
  hasDraft: (key: string) => boolean = () => false,
): ShellMenu {
  const unreadItem = (id: string) => {
    const value = unread?.get(id);
    return value?.state === 'known' && value.count > 0
      ? {
          emphasis: 'unread' as const,
          count: { text: value.more ? '50+' : String(value.count), needsYou: false },
        }
      : // Unsent words are a quiet neutral badge, never the unread weight or a count.
        hasDraft(id)
        ? { badges: [DRAFT] }
        : {};
  };
  const stateMark = (state: keyof typeof AGENT_STATES) => {
    const node = mark(AGENT_STATES[state].mark);
    // The Ops mock uses the shared state mark at 9 px in the compact DM tree.
    node.style.width = '9px';
    node.style.height = '9px';
    return node;
  };
  const channelMark = () => {
    const node = document.createElement('span');
    node.textContent = '#';
    return node;
  };
  // Orchestration reads Core, not the board: its row stays below the machine groups in every state.
  const orchestration: ShellMenuGroup = {
    items: OPS_SECTIONS.map((item) => ({
      id: item.id,
      label: item.label,
      icon: 'clock' as const,
      href: opsHref(pathname, item.id),
      current: section === item.id,
    })),
  };
  return {
    title: 'Ops',
    groups: [
      ...(!board?.unavailable && board
        ? [
            {
              label: 'THIS MACHINE',
              items: bySquad(board, true).map((group) => {
                const timers =
                  !board.truncated && board.schedules
                    ? board.schedules.filter((item) => item.squad === group.name).length
                    : undefined;
                const badges = hasDraft(`channel:${group.name}`) ? [DRAFT] : [];
                if (timers) badges.push(`⏱ ${timers}`);
                const idle = board.squads.find((squad) => squad.name === group.name)?.idleAlertMs;
                if (
                  idle !== undefined &&
                  board.defaultIdleAlertMs !== null &&
                  idle !== board.defaultIdleAlertMs
                )
                  badges.push(`Idle ${Math.round(idle / 60_000)}m`);
                return {
                  id: `channel:${group.name}`,
                  label: group.name,
                  leading: { node: channelMark(), label: 'Channel' },
                  ...(badges.length ? { badges: badges.slice(0, 2) } : {}),
                  href: opsHref(pathname, { squad: group.name }),
                  current:
                    typeof section !== 'string' &&
                    section.squad === group.name &&
                    !section.memberId,
                  expanded: !disclosure?.collapsed.has(group.name),
                  toggle: disclosure ? () => disclosure.toggle(group.name) : undefined,
                  children: group.agents.map((agent) => ({
                    id: `dm:${group.name}:${agent.id}`,
                    label: agent.name,
                    leading: {
                      node: stateMark(agent.state),
                      label: AGENT_STATES[agent.state].word,
                    },
                    ...unreadItem(agent.id),
                    href: opsHref(pathname, { squad: group.name, memberId: agent.id }),
                    current:
                      typeof section !== 'string' &&
                      section.squad === group.name &&
                      section.memberId === agent.id,
                  })),
                };
              }),
            },
          ]
        : []),
      orchestration,
    ],
  };
}

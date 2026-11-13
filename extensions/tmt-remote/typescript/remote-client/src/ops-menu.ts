/** The fixed Ops rail: observed counts only; the shared leaf owns row presentation. */
import type { ShellMenu } from '@tmt/browser-ui/shell';
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

export function opsMenu(
  section: OpsPlace,
  board: OpsBoard | undefined,
  pathname: string,
  disclosure?: { collapsed: ReadonlySet<string>; toggle(squad: string): void },
  unread?: ReadonlyMap<string, ConversationUnread>,
): ShellMenu {
  const unreadItem = (id: string) => {
    const value = unread?.get(id);
    return value?.state === 'known' && value.count > 0
      ? {
          emphasis: 'unread' as const,
          count: { text: value.more ? '50+' : String(value.count), needsYou: false },
        }
      : {};
  };
  const stateMark = (state: keyof typeof AGENT_STATES) => {
    const node = mark(AGENT_STATES[state].mark);
    // The Ops mock uses the shared state mark at 9 px in the compact DM tree.
    node.style.width = '9px';
    node.style.height = '9px';
    return node;
  };
  return {
    title: 'Ops',
    groups:
      !board?.unavailable && board
        ? [
            {
              label: 'This machine',
              items: bySquad(board, true).map((group) => {
                const squad = board.squads.find((item) => item.name === group.name);
                const timers =
                  !board.truncated && board.schedules
                    ? board.schedules.filter((item) => item.squad === group.name).length
                    : undefined;
                const badges = [
                  ...(timers ? [`⏱ ${timers}`] : []),
                  ...(squad?.idleAlertMinutes ? [`Idle ${squad.idleAlertMinutes}m`] : []),
                ];
                return {
                  id: `channel:${group.name}`,
                  label: `#${group.name}`,
                  ...(badges.length ? { badges } : {}),
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
        : [],
  };
}

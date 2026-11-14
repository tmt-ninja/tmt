/** The Ops channel and DM (#5704; spec Colab 8d17ce7c screens 1, 3 and 5): a header with the
 * channel's facts, a collapsible Members/Timers panel, the conversation stream anchored at the
 * bottom and the composer fixed under it. The board owns members and timers; admitted
 * conversation reads own the DM stream. Writes stay unavailable until Remote names them. */
import { avatarInitials, browserUiClasses as c } from '@tmt/browser-ui/static';
import {
  AGENT_STATES,
  type AgentState,
  type OpsAgent,
  type OpsBoard,
  type OpsSchedule,
  type OpsSquad,
} from './ops-source.js';
import { el, mark } from './ops-parts.js';
import { opsHref, type OpsPlace } from './ops-menu.js';
import { scheduleWords, timerList } from './ops-timers.js';
import type { RemoteShell } from './remote-shell.js';
import { channelStream, type ChannelPort } from './channel-stream.js';

type ChannelPlace = Exclude<OpsPlace, string>;
type MemberWord = 'Working' | 'Idle' | 'Offline' | 'Unknown';
/** A state word's mark, as the rail draws it. */
const stateMark = (word: MemberWord) => {
  const info = AGENT_STATES[word.toLowerCase() as AgentState];
  return mark(info.mark, info.markTone);
};

export function memberState(agent: Pick<OpsAgent, 'state'>): MemberWord {
  return { working: 'Working', idle: 'Idle', offline: 'Offline', unknown: 'Unknown' }[
    agent.state
  ] as MemberWord;
}

/** An unknown state is its mark alone, the word in the tooltip (the DM header and the member list). */
function unknownMark(): HTMLElement {
  const alone = stateMark('Unknown');
  alone.title = 'State unknown';
  alone.setAttribute('role', 'img');
  alone.setAttribute('aria-label', 'State unknown');
  alone.removeAttribute('aria-hidden');
  return alone;
}

/** A member's state as the spec draws it: an uncoloured mark and its word. */
function stateBadge(agent: OpsAgent): HTMLElement {
  const word = memberState(agent);
  if (word === 'Unknown') {
    const alone = unknownMark();
    alone.classList.add('ops-member-state');
    alone.dataset.state = 'unknown';
    return alone;
  }
  const badge = el('span', `${c.chip} ops-member-state`);
  badge.dataset.state = word.toLowerCase();
  badge.append(stateMark(word), el('span', c.chipLabel, word));
  return badge;
}

/** The last day's tokens (#6372) as "~1.4B 1d"; nothing when the machine did not say. */
export function usage(agent: OpsAgent): string {
  if (!agent.tokens1d) return '';
  const amount = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(agent.tokens1d.tokens);
  return `~${amount} 1d${agent.tokens1d.complete ? '' : ' (partial)'}`;
}

function avatar(name: string, size: 's' | 'm'): HTMLElement {
  const node = el('span', c.avatar, avatarInitials(name));
  node.dataset.size = size;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function chip(text: string): HTMLElement {
  const node = el('span', `${c.chip} ops-channel-chip`);
  node.append(el('span', c.chipLabel, text));
  return node;
}

export function channelView(
  pathname: string,
  shell: RemoteShell,
  port: ChannelPort | undefined = undefined,
  /** Reads the board again now, as after a stale-roster refusal. */
  rereadBoard: () => void = () => {},
): {
  node: HTMLElement;
  history: HTMLElement;
  focusTitle(fromKeyboard: boolean): void;
  update(board: OpsBoard, place: ChannelPlace): void;
} {
  const page = el('div', 'ops-channel');
  // Header: the channel or member, its chips and one line of facts.
  const head = el('header', 'ops-channel-head');
  const titleRow = el('div', 'ops-channel-titlebar');
  const face = el('span', 'ops-channel-face');
  const title = el('h2', 'ops-channel-name');
  title.tabIndex = -1;
  title.addEventListener('blur', () => title.removeAttribute('data-quiet-focus'));
  const chips = el('span', 'ops-channel-chips');
  // On a phone a DM leads with the way back to its channel, as Slack's back chevron does.
  const back = el('a', 'ops-channel-back', '‹');
  back.hidden = true;
  titleRow.append(back, face, title, chips);
  const line = el('p', 'ops-channel-line');
  head.append(titleRow, line);

  // Panel: Members and Timers, collapsible.
  const panel = el('section', 'ops-channel-panel');
  const bar = el('div', 'ops-channel-panel-bar');
  const tabs = el('div', 'ops-channel-tabs');
  tabs.setAttribute('role', 'tablist');
  const membersPanel = el('div', 'ops-channel-tabpanel');
  membersPanel.id = 'ops-channel-members';
  membersPanel.setAttribute('role', 'tabpanel');
  const timersPanel = el('div', 'ops-channel-tabpanel');
  timersPanel.id = 'ops-channel-timers';
  timersPanel.setAttribute('role', 'tabpanel');
  const panels = [membersPanel, timersPanel];
  const toggle = el('button', 'ops-channel-collapse');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', `${membersPanel.id} ${timersPanel.id}`);
  let selected = 0;
  let open = true;
  const buttons = panels.map((target, index) => {
    const button = el('button', 'ops-channel-tab');
    button.type = 'button';
    button.id = `ops-channel-tab-${index}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', target.id);
    target.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => {
      select(index);
      setOpen(true);
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const shown = buttons.filter((other) => !other.hidden);
      const at = shown.indexOf(button);
      const next =
        event.key === 'Home'
          ? shown[0]
          : event.key === 'End'
            ? shown[shown.length - 1]
            : shown[(at + (event.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length];
      if (!next || next === button) return;
      event.preventDefault();
      select(buttons.indexOf(next));
      setOpen(true);
      next.focus();
    });
    return button;
  });
  tabs.append(...buttons);
  // Folded, the bar is one summary line (spec: "4 members · 2 working · 1 idle   Timers 3").
  const summary = el('button', 'ops-channel-summary');
  summary.type = 'button';
  summary.addEventListener('click', () => setOpen(true));
  bar.append(summary, tabs, toggle);
  panel.append(bar, ...panels);
  function select(index: number): void {
    selected = index;
    buttons.forEach((button, at) => {
      button.tabIndex = at === index ? 0 : -1;
      button.setAttribute('aria-selected', String(open && at === index));
    });
    panels.forEach((target, at) => (target.hidden = !open || at !== index));
  }
  // A DM with one timer shows it as a chip on the facts line; the panel opens from it and folds away.
  let oneTimer = false;
  function setOpen(value: boolean): void {
    open = value;
    if (oneTimer) panel.hidden = !value;
    panel.dataset.open = String(value);
    tabs.hidden = !value;
    summary.hidden = value;
    toggle.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-label', value ? 'Hide details' : 'Show details');
    select(selected);
  }
  toggle.addEventListener('click', () => setOpen(!open));

  // The stream with its message box: the channel's own, or the DM's (placed by the Ops page).
  const history = el('section', 'ops-channel-history');
  const stream = channelStream(shell, port, rereadBoard);
  page.append(head, panel, history, stream.thread);
  setOpen(false);
  // Slack's frame: the view fills the window below the top bar and only the stream scrolls, so the
  // header and the message box stay in view while reading or typing.
  // The visible height: a phone's on-screen keyboard shrinks the visual viewport, not the window.
  const viewHeight = () => visualViewport?.height ?? innerHeight;
  const fit = () => {
    if (!page.isConnected) return;
    const top = page.getBoundingClientRect().top + scrollY;
    const height = viewHeight() - top;
    page.style.height = `${height}px`;
    // Whatever the page keeps below the view (the note) comes off the same height.
    const below = document.documentElement.scrollHeight - innerHeight;
    if (below > 0) page.style.height = `${Math.max(240, height - below)}px`;
  };
  addEventListener('resize', fit);
  visualViewport?.addEventListener('resize', fit);

  const missing = el('p', 'ops-empty');
  missing.dataset.opsChannelMissing = '';
  let identity = '';
  let fingerprint = '';
  const memberList = el('ul', 'ops-member-list');
  memberList.setAttribute('aria-label', 'Members');
  const memberRows = new Map<string, { node: HTMLElement; fingerprint: string }>();

  function memberRow(agent: OpsAgent): HTMLElement {
    const row = el('li', 'ops-member-row');
    row.dataset.memberId = agent.id;
    const name = el('a', 'ops-member-name', agent.name);
    name.href = opsHref(pathname, { squad: agent.squad, memberId: agent.id });
    const who = el('span', 'ops-member-who');
    who.append(avatar(agent.name, 's'), name);
    if (agent.role === 'lead') who.append(el('span', 'ops-member-role', 'Lead'));
    const task = el('span', 'ops-member-task', agent.task || 'No task reported');
    if (!agent.task) task.dataset.empty = '';
    row.append(who, task, el('span', 'ops-member-usage', usage(agent)), stateBadge(agent));
    return row;
  }

  function drawMembers(people: readonly OpsAgent[], truncated: boolean): void {
    const ids = new Set(people.map((agent) => agent.id));
    for (const [id, row] of memberRows)
      if (!ids.has(id)) {
        const heldFocus = row.node.contains(document.activeElement);
        row.node.remove();
        memberRows.delete(id);
        if (heldFocus) title.focus();
      }
    people.forEach((agent, index) => {
      const seen = JSON.stringify([
        agent.name,
        agent.role,
        agent.task,
        memberState(agent),
        agent.tokens1d,
        agent.checklistCount,
      ]);
      let row = memberRows.get(agent.id);
      if (!row || row.fingerprint !== seen) {
        const next = memberRow(agent);
        const heldFocus = row?.node.contains(document.activeElement);
        if (row) row.node.replaceWith(next);
        row = { node: next, fingerprint: seen };
        memberRows.set(agent.id, row);
        if (heldFocus) next.querySelector('a')!.focus();
      }
      if (memberList.children[index] !== row.node)
        memberList.insertBefore(row.node, memberList.children[index] ?? null);
    });
    const content: HTMLElement[] = people.length
      ? [memberList]
      : [el('p', 'ops-empty', 'No members listed.')];
    if (truncated)
      content.push(el('p', 'ops-detail-note', 'Partial board; some members may be missing.'));
    if (membersPanel.firstChild !== content[0] || membersPanel.childNodes.length !== content.length)
      membersPanel.replaceChildren(...content);
  }

  function channelFacts(squad: OpsSquad | undefined, people: readonly OpsAgent[]): void {
    const lead = people.find((agent) => agent.role === 'lead')?.name ?? squad?.lead;
    line.replaceChildren();
    // The member count lives once, in the summary bar below.
    if (lead) line.append('Lead ', el('strong', undefined, lead), ' · ');
    line.append('This machine');
  }

  return {
    node: page,
    history,
    /** After a route the person chose: the title takes focus, so reading starts at the new place. */
    focusTitle(fromKeyboard: boolean) {
      if (!title.isConnected || head.hidden) return;
      // The focus moves either way; only a keyboard route draws the ring.
      title.toggleAttribute('data-quiet-focus', !fromKeyboard);
      title.focus({ preventScroll: true });
    },
    update(board, place) {
      requestAnimationFrame(fit);
      const key = opsHref(pathname, place);
      const people = board.agents
        .filter((agent) => agent.squad === place.squad)
        .sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead'));
      const member = place.memberId
        ? people.find((agent) => agent.id === place.memberId)
        : undefined;
      const squad = board.squads.find((entry) => entry.name === place.squad);
      const known = place.memberId ? !!member : !!squad || people.length > 0;
      const squadJobs = board.schedules?.filter((job) => job.squad === place.squad) ?? null;
      const jobs: readonly OpsSchedule[] | null =
        squadJobs && member ? squadJobs.filter((job) => job.owner === member.name) : squadJobs;
      const seen = JSON.stringify({ key, people, squad, jobs, known, truncated: board.truncated });
      if (seen === fingerprint) return;
      fingerprint = seen;
      const moved = identity !== key;
      if (moved) {
        identity = key;
        memberRows.clear();
        memberList.replaceChildren();
        selected = place.memberId ? 1 : 0;
        // Both open on the conversation; the summary line says who is in it.
        setOpen(false);
      }
      page.dataset.view = place.memberId ? 'dm' : 'channel';
      for (const part of [head, panel, history]) part.hidden = !known;
      if (!known) {
        stream.select(undefined);
        missing.textContent = board.truncated
          ? 'This selection is not in the partial board. Open Ops in the terminal to see the full list.'
          : place.memberId
            ? 'This member is no longer listed in this squad. Choose a current member from the sidebar.'
            : 'This squad is no longer listed. Choose a current squad from the sidebar.';
        if (!missing.isConnected) page.append(missing);
        memberRows.clear();
        memberList.replaceChildren();
        timersPanel.replaceChildren();
        return;
      }
      missing.remove();
      const timerCount = jobs === null ? undefined : jobs.length;
      chips.replaceChildren();
      if (member) {
        face.replaceChildren(avatar(member.name, 'm'));
        title.textContent = member.name;
        const state = memberState(member);
        const facts = el('span', 'ops-channel-member-facts');
        const marked = state === 'Unknown' ? unknownMark() : stateMark(state);
        // The member's channel is a link back to it.
        const channelHref = opsHref(pathname, { squad: member.squad });
        const squadLink = el('a', 'ops-channel-squad-link', `#${member.squad}`);
        squadLink.href = channelHref;
        facts.append(
          marked,
          `${[
            state === 'Unknown' ? undefined : state,
            member.role === 'lead' ? 'Lead' : 'Member',
            member.model,
            usage(member) || undefined,
          ]
            .filter(Boolean)
            .join(' · ')} · `,
          squadLink,
          ' · This machine',
        );
        if (member.task)
          facts.append(' · ', el('span', 'ops-channel-line-task', `Task: ${member.task}`));
        back.href = channelHref;
        back.setAttribute('aria-label', `Back to #${member.squad}`);
        back.hidden = false;
        line.replaceChildren(facts);
        if (jobs?.length === 1) {
          const timer = el('button', `${c.chip} ops-channel-timer-chip`);
          timer.type = 'button';
          timer.append(
            mark('clock', 'neutral'),
            el('span', c.chipLabel, scheduleWords(jobs[0]!.when).toLowerCase()),
          );
          timer.setAttribute('aria-label', `Timer: ${jobs[0]!.what}. Show timers`);
          timer.addEventListener('click', () => {
            select(1);
            setOpen(true);
          });
          line.append(timer);
        }
      } else {
        back.hidden = true;
        face.replaceChildren();
        title.textContent = `#${place.squad}`;
        // A chip says what is set; an unset or unknown value shows nothing (as for #6372).
        if (squad?.idleAlertMs)
          chips.append(chip(`Idle alert ${Math.round(squad.idleAlertMs / 60_000)}m`));
        channelFacts(squad, people);
      }
      // A DM with no timers has no Timers bar: an empty line on a phone says nothing. One timer is a
      // chip on the facts line; two or more keep the bar.
      oneTimer = !!member && timerCount === 1;
      panel.hidden = (!!member && timerCount === 0) || (oneTimer && !open);
      // The Timers count lives once, in the summary row below the title.
      const working = people.filter((agent) => memberState(agent) === 'Working').length;
      const idle = people.filter((agent) => memberState(agent) === 'Idle').length;
      const timersWord = timerCount === undefined ? 'Timers unavailable' : `Timers ${timerCount}`;
      summary.replaceChildren(
        ...(member
          ? []
          : [
              el(
                'span',
                undefined,
                [
                  board.truncated
                    ? 'Members (partial)'
                    : `${people.length} member${people.length === 1 ? '' : 's'}`,
                  `${working} working`,
                  `${idle} idle`,
                ].join(' · '),
              ),
            ]),
        el('span', 'ops-channel-summary-timers', timersWord),
      );
      buttons[0]!.hidden = !!member;
      buttons[0]!.textContent = board.truncated ? 'Members' : `Members ${people.length}`;
      buttons[1]!.textContent = timerCount === undefined ? 'Timers' : `Timers ${timerCount}`;
      const label = member ? 'Member details' : 'Channel details';
      tabs.setAttribute('aria-label', label);
      panel.setAttribute('aria-label', label);
      if (!member) drawMembers(people, board.truncated);
      timersPanel.replaceChildren(timerList(jobs, board.truncated));
      if (member) stream.select(undefined);
      else {
        if (stream.node.parentElement !== history) history.replaceChildren(stream.node);
        const lead = people.find((agent) => agent.role === 'lead');
        stream.select({
          squad: place.squad,
          room: squad?.room ?? null,
          ...(lead ? { lead: { id: lead.id, name: lead.name } } : {}),
          members: people.map((agent) => ({ id: agent.id, name: agent.name })),
        });
      }
      select(selected);
    },
  };
}

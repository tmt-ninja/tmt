/** Timers: the channel and DM panel's timer rows (#5704), and the retired timers page, which ops-page
 * drops in its own change. Schedules are the board's text put into words, never computed. */
import { browserUiClasses } from '@tmt/browser-ui/static';
import type { OpsBoard, OpsSchedule } from './ops-source.js';
import { el, pageFoot, pageHead, readOnlyBadge, sentence, terminalCard } from './ops-parts.js';

export function timersView(): { node: HTMLElement; update(board: OpsBoard): void } {
  const page = el('div', 'ops-timers-page');
  const grid = el('div', 'ops-grid');
  const card = el('section', browserUiClasses.card);
  card.setAttribute('aria-labelledby', 'ops-timers-title');
  const head = el('div', browserUiClasses.cardHead);
  const title = el('h3', browserUiClasses.cardTitle, 'Timers');
  title.id = 'ops-timers-title';
  head.append(title, readOnlyBadge());
  const body = el('div');
  card.append(head, body);
  grid.append(
    card,
    terminalCard({
      id: 'ops-manage-title',
      title: 'Manage in the terminal',
      text: 'Use the Ops workspace to manage your timers. This web view does not change schedules.',
    }),
  );
  page.append(
    pageHead('A simple view of the schedules that keep your team moving.'),
    grid,
    pageFoot(),
  );
  return {
    node: page,
    update(board) {
      if (board.schedules === null)
        return body.replaceChildren(
          sentence('Your machine could not read the timers. Run `tmt ops ui` to see them.'),
        );
      if (!board.schedules.length) return body.replaceChildren(sentence('No timers are set.'));
      const scroll = el('div', browserUiClasses.tableScroll);
      const table = el('table', browserUiClasses.table);
      table.dataset.roomy = '';
      const headRow = el('tr');
      for (const text of ['Timer name', 'Squad', 'Schedule', 'Owner', 'Timer ID']) {
        const cell = el('th', undefined, text);
        cell.scope = 'col';
        if (text === 'Owner' || text === 'Timer ID') cell.dataset.compactHide = '';
        headRow.append(cell);
      }
      const thead = el('thead');
      thead.append(headRow);
      const rows = el('tbody');
      for (const timer of board.schedules) {
        const name = el('td', undefined, timer.what || timer.id);
        // Under the compact width the owner and the id move under the name.
        name.append(
          el(
            'span',
            browserUiClasses.tableCompactMeta,
            [timer.owner, timer.id].filter(Boolean).join(' · '),
          ),
        );
        const when = el('td', browserUiClasses.tableMono, timer.when);
        const owner = el('td', undefined, timer.owner || '—');
        const id = el(
          'td',
          `${browserUiClasses.tableMono} ${browserUiClasses.tableQuiet}`,
          timer.id,
        );
        for (const cell of [owner, id]) cell.dataset.compactHide = '';
        const tr = el('tr');
        tr.append(name, el('td', undefined, timer.squad), when, owner, id);
        rows.append(tr);
      }
      table.append(thead, rows);
      scroll.append(table);
      body.replaceChildren(scroll, el('p', 'ops-note', 'Schedules are shown as recorded.'));
    },
  };
}

const DAYS: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
const UNITS: Record<string, [string, string]> = {
  s: ['second', 'seconds'],
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
};
const two = (value: string) => value.padStart(2, '0');
/**
 * A board schedule in words: `every 30m from 09:00`, `daily 09:00`, `weekdays 09:00`,
 * `mon,thu 10:00` and the simple cron shapes read as a sentence; anything else stays as written.
 */
export function scheduleWords(text: string): string {
  const every = /^every (\d+)([smhd])(?: from (\S+))?$/.exec(text);
  if (every) {
    const [, count, unit, from] = every;
    const [one, many] = UNITS[unit!]!;
    const step = count === '1' ? `Every ${one}` : `Every ${count} ${many}`;
    return from ? `${step} from ${from}` : step;
  }
  const at = /^(daily|weekdays|[a-z]{3}(?:,[a-z]{3})*) (\d{1,2}:\d{2})$/.exec(text);
  if (at) {
    const [, on, time] = at;
    if (on === 'daily') return `Every day at ${time}`;
    if (on === 'weekdays') return `Weekdays at ${time}`;
    const days = on!.split(',').map((day) => DAYS[day]);
    if (days.every(Boolean)) return `${days.join(', ')} at ${time}`;
  }
  const cron = /^cron (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(text);
  if (cron) {
    const [, minute, hour, dom, month, dow] = cron;
    const plain = dom === '*' && month === '*';
    const step = /^\*\/(\d+)$/.exec(minute!);
    if (plain && dow === '*' && hour === '*' && step) return `Every ${step[1]} minutes`;
    if (plain && dow === '*' && hour === '*' && /^\d+$/.test(minute!))
      return `Every hour at :${two(minute!)}`;
    if (plain && /^\d+$/.test(minute!) && /^\d+$/.test(hour!)) {
      const time = `${two(hour!)}:${two(minute!)}`;
      if (dow === '*') return `Every day at ${time}`;
      if (dow === '1-5') return `Weekdays at ${time}`;
    }
  }
  return text;
}

/** One timer row: what it sends, its schedule in words, and whose it is. */
export function timerRow(job: OpsSchedule): HTMLElement {
  const row = el('li', 'ops-timer-row');
  row.dataset.timerId = job.id;
  const icon = el('span', 'ops-timer-icon');
  icon.setAttribute('aria-hidden', 'true');
  const name = el('span', 'ops-timer-name', job.what || job.id);
  const words = scheduleWords(job.when);
  const when = el('span', 'ops-timer-when', words);
  if (words !== job.when) when.title = job.when;
  row.append(icon, name, when);
  if (job.owner) row.append(el('span', 'ops-timer-owner', job.owner));
  return row;
}

/** The panel's timers: a list, or a sentence that never reads an unknown as none. */
export function timerList(jobs: readonly OpsSchedule[] | null, truncated: boolean): HTMLElement {
  if (jobs === null) return sentence('Timers are unavailable from this machine right now.');
  if (!jobs.length)
    return sentence(truncated ? 'No timers in this partial read.' : 'No timers are set.');
  const list = el('ul', 'ops-timer-list');
  list.setAttribute('aria-label', 'Timers');
  list.append(...jobs.map(timerRow));
  return list;
}

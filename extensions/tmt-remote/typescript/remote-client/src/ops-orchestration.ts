/** The Orchestration page (#4894, #5986): Core's plans on a timeline in Core's zone, each member's
 * effective policy at the selected time, who may message whom, this hour's talks and each member's
 * jobs. Every change shows Core's preview first and saves only that exact preview after the person
 * confirms. Nothing is computed here: each value and its source is Core's. */
import { browserUiClasses as c } from '@tmt/browser-ui/static';
import { createIcon } from '@tmt/browser-ui/glyph';
import { el, mark, sentence } from './ops-parts.js';
import {
  OrchestrationRefused,
  applyInput,
  decodeOverview,
  previewLines,
  readJobs,
  readSending,
  receivingCell,
  type Job,
  type Json,
  type Member,
  type OrchestrationApi,
  type Overview,
  type Plan,
  type Sending,
  type Source,
} from './orchestration-client.js';

export type OrchestrationConnect = () => Promise<OrchestrationApi>;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RANGES = [1, 7, 30] as const;
const STATE: Record<string, string> = {
  awake: '● Awake',
  low: '◐ Low',
  focus: '◑ Focus',
  sleep: '◌ Sleep',
};
const SENDING: Record<string, string> = { anyone: 'Anyone', leads: 'Leads only', paused: 'Paused' };
const ROUTINE: Record<string, string> = { run: 'Run', hold: 'Hold' };
const JOB: Record<Job['state'], string> = {
  on: '● ready',
  held: '◆ held',
  paused: '⏸ paused',
  no_owner: '○ no owner',
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Core's receiving value in words for the member panel. */
function receivingWords(value: unknown): string {
  if (!value || typeof value !== 'object') return '—';
  const row = value as Json;
  if (row.mode === 'batch' && Number.isSafeInteger(row.intervalMs))
    return `Batch ${Math.round(Number(row.intervalMs) / 60_000)} min`;
  if (row.mode === 'urgent') return 'Urgent only';
  return receivingCell(value);
}
function fieldWords(key: string, value: unknown): string {
  if (value === null || value === undefined) return key === 'talkLimit' ? 'No limit' : '—';
  if (key === 'receiving') return receivingWords(value);
  if (key === 'talkLimit' && typeof value === 'number') return `${value} / h`;
  const table = key === 'state' ? STATE : key === 'sending' ? SENDING : ROUTINE;
  return typeof value === 'string' ? (table[value] ?? value) : JSON.stringify(value);
}

export function orchestrationView(connect: OrchestrationConnect, now = () => Date.now()) {
  const node = el('div', 'ops-orchestration-page');
  const status = el('p', 'ops-note');
  status.setAttribute('role', 'status');

  // Toolbar: range, the range's date in Core's zone, plan filter, member filter.
  const bar = el('div', 'ops-orchestration-bar');
  const rangeGroup = el('div', 'ops-orchestration-range');
  rangeGroup.setAttribute('role', 'group');
  rangeGroup.setAttribute('aria-label', 'Time range');
  const ranges = RANGES.map((days) => {
    const button = el('button', undefined, days === 1 ? '1 day' : `${days} days`);
    button.type = 'button';
    button.dataset.days = String(days);
    rangeGroup.append(button);
    return button;
  });
  const when = el('p', 'ops-orchestration-when');
  const planSelect = el('select', `${c.fieldControl} ops-orchestration-plan`);
  planSelect.setAttribute('aria-label', 'Plans');
  const filter = el('input', c.fieldControl);
  filter.type = 'search';
  filter.placeholder = 'Members: prefix or contains';
  filter.setAttribute('aria-label', 'Filter members');
  const search = el('div', c.searchField);
  search.append(createIcon('search'), filter);
  bar.append(rangeGroup, when, planSelect, search);

  const plansCard = el('section', `${c.card} ops-orchestration-plans`);
  plansCard.setAttribute('aria-label', 'Plan list');
  const plansHead = el('div', c.cardHead);
  plansHead.append(el('h3', c.cardTitle, 'Plans'));
  const planList = el('ul', 'ops-orchestration-plan-list');
  plansCard.append(plansHead, planList);

  // Timeline: axis, the in-effect track, one lane per plan, then the selected time and its plans.
  const timelineCard = el('section', `${c.card} ops-orchestration-timeline`);
  timelineCard.setAttribute('aria-label', 'Timeline');
  const axis = el('div', 'ops-orchestration-axis');
  axis.setAttribute('aria-hidden', 'true');
  const track = el('div', 'ops-orchestration-track');
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', 'Plans in effect over the range');
  const lanes = el('div', 'ops-orchestration-lanes');
  lanes.setAttribute('aria-hidden', 'true');
  const stepRow = el('div', 'ops-orchestration-step');
  // The design system has one chevron; Earlier mirrors it.
  const earlier = el('button', `${c.action} ops-orchestration-icon`);
  const back = createIcon('chevron-right');
  back.classList.add('ops-orchestration-back');
  earlier.append(back);
  earlier.setAttribute('aria-label', 'Earlier');
  earlier.title = 'Earlier: the previous change';
  const later = el('button', `${c.action} ops-orchestration-icon`);
  later.append(createIcon('chevron-right'));
  later.setAttribute('aria-label', 'Later');
  later.title = 'Later: the next change';
  const nowButton = el('button', c.action, 'Now');
  for (const button of [earlier, later, nowButton]) button.type = 'button';
  const atText = el('p', 'ops-orchestration-at');
  stepRow.append(earlier, atText, later, nowButton);
  const legend = el('ul', 'ops-orchestration-legend');
  legend.setAttribute('aria-label', 'Plans at the selected time');
  timelineCard.append(axis, track, lanes, stepRow, legend);

  const matrixCard = el('section', `${c.card} ops-orchestration-routes`);
  const matrixHead = el('div', c.cardHead);
  const matrixMeta = el('span', c.cardMeta);
  const matrixCue = el('span', 'ops-orchestration-scroll-cue', 'Scroll ↔ ↕');
  matrixHead.append(el('h3', c.cardTitle, 'Who may message whom'), matrixMeta, matrixCue);
  const matrixBody = el('div', 'ops-orchestration-matrix-body');
  const talks = el('div', 'ops-orchestration-talks');
  matrixCard.append(matrixHead, matrixBody, talks);
  const inspector = el('section', `${c.card} ops-orchestration-inspector`);
  inspector.setAttribute('aria-label', 'Selected member and route');
  const grid = el('div', 'ops-grid');
  grid.append(matrixCard, inspector);
  const dialog = el('dialog', c.dialog);
  // Until Core's first answer there is nothing to place: the status line says so.
  timelineCard.hidden = true;
  plansCard.hidden = true;
  grid.hidden = true;
  node.append(bar, status, plansCard, timelineCard, grid, dialog);

  let api: OrchestrationApi | undefined;
  let days = 1;
  let atMs: number | null = null;
  let plan: string | null = null;
  let memberQuery = '';
  let overview: Overview | undefined;
  let sending: Sending | undefined;
  let selected: string | undefined;
  let target: string | undefined;
  let why: { id: string; lines: string[] } | undefined;
  // Each member's jobs as last read, tagged with the overview read they belong to: every overview
  // read (the 30 s refresh, after a save) starts a new round, and the shown member is read again
  // while its earlier list stays on screen.
  const jobs = new Map<
    string,
    { round: number; value: { jobs: Job[]; more: boolean } | 'failed' }
  >();
  const reading = new Set<string>();
  let jobsRound = 0;
  let generation = 0;

  const say = (text: string) => {
    status.textContent = text;
  };
  const zone = () => overview?.timeZone ?? 'UTC';
  /** Core's zone, 24-hour: `23:00`. */
  const time = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: zone(),
    }).format(ms);
  /** Core's zone: `Tue 10-27`. */
  const date = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: '2-digit',
        day: '2-digit',
        timeZone: zone(),
      })
        .formatToParts(ms)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.weekday} ${parts.month}-${parts.day}`;
  };
  /** A time in the range, with its day when the range spans days. */
  const moment = (ms: number) => (days > 1 ? `${date(ms)} ${time(ms)}` : time(ms));
  const member = (id?: string) => overview?.members.find((m) => m.identityId === id);
  const name = (id: string) => member(id)?.name ?? id;
  const planOf = (id: string | null) => overview?.plans.find((p) => p.id === id);
  const planName = (id: string | null) => planOf(id)?.name ?? 'a plan';
  const swatch = (id: string) => {
    const index = overview?.plans.findIndex((p) => p.id === id) ?? 0;
    return `var(--tmt-ui-color-series-${(Math.max(0, index) % 7) + 1})`;
  };
  const from = (source: Source | null) => {
    switch (source?.kind) {
      case 'base':
        return 'Base';
      case 'plan':
        return planName(source.planId);
      case 'member':
        return 'member setting';
      case 'focus':
        return 'focus';
      case 'grant':
        return 'allowed once';
      default:
        return 'unknown';
    }
  };
  /** A plan's schedule and who it covers, in Core's words: `every day 22:00–08:00 · everyone`. */
  const planSummary = (p: Plan, includeState = true) => {
    const rule = p.schedule;
    let when = 'always';
    if (rule.kind === 'once')
      when = `once ${date(rule.startMs)} ${time(rule.startMs)}–${time(rule.endMs)}`;
    else if (rule.kind === 'weekly') {
      const set = [...rule.weekdays].sort();
      const dayWords =
        set.length === 7
          ? 'every day'
          : set.join() === '1,2,3,4,5'
            ? 'weekdays'
            : set.map((d) => WEEKDAYS[d - 1]).join(' ');
      const every =
        rule.intervalWeeks === 2
          ? 'every other week '
          : rule.intervalWeeks > 2
            ? `every ${rule.intervalWeeks} weeks `
            : '';
      when = `${every}${dayWords} ${rule.allDay ? 'all day' : `${rule.start}–${rule.end}`}`;
    }
    const who = p.targets
      .map((t) => (t.kind === 'all' ? 'everyone' : t.kind === 'identity' ? name(t.id) : t.pattern))
      .join(', ');
    return `${when} · ${who || 'no one'}${includeState && !p.enabled ? ' · off' : ''}`;
  };

  function drawPlans(view: Overview) {
    const focused =
      document.activeElement instanceof HTMLElement && planList.contains(document.activeElement)
        ? document.activeElement.dataset.planId
        : undefined;
    planList.replaceChildren(
      ...view.plans.map((item) => {
        const row = el('li');
        const button = el('button', 'ops-orchestration-plan-row');
        button.type = 'button';
        button.dataset.planId = item.id;
        button.ariaPressed = String(item.id === view.selectedPlanId);
        const text = el('span', 'ops-orchestration-plan-text');
        text.append(
          el('strong', undefined, item.name),
          el('span', undefined, planSummary(item, false)),
        );
        const state = el('span', 'ops-orchestration-plan-state');
        state.append(mark(item.enabled ? 'dot' : 'ring', 'neutral'), item.enabled ? 'On' : 'Off');
        button.append(text, state);
        button.addEventListener('click', () => {
          plan = item.id;
          void load();
        });
        row.append(button);
        return row;
      }),
    );
    if (!view.plans.length) planList.append(el('li', undefined, 'No plans yet.'));
    if (focused) {
      [...planList.querySelectorAll<HTMLElement>('button')]
        .find((button) => button.dataset.planId === focused)
        ?.focus({ preventScroll: true });
    }
  }

  async function load() {
    const mine = ++generation;
    if (!overview) say('Reading orchestration from Core…');
    try {
      api ??= await connect();
      const input: Json = {
        view: 'overview',
        rangeDays: days,
        ...(atMs === null ? {} : { atMs }),
        ...(plan === null ? {} : { plan }),
        ...(memberQuery ? { memberQuery } : {}),
      };
      const next = decodeOverview(await api.read(input));
      const nextSending = await readSending(api, memberQuery || undefined);
      if (mine !== generation) return;
      jobsRound += 1;
      overview = next;
      sending = nextSending;
      if (!member(selected)) selected = next.members[0]?.identityId;
      if (!member(target) || target === selected)
        target = next.members.find((m) => m.identityId !== selected)?.identityId;
      say('');
      draw();
    } catch (error) {
      if (mine !== generation) return;
      api = undefined;
      say(
        error instanceof OrchestrationRefused
          ? (error.detail ?? `Core refused the read (${error.code}).`)
          : 'Orchestration is not available right now. `tmt orch` shows it in the terminal.',
      );
    }
  }

  function drawBar(view: Overview) {
    for (const button of ranges) button.ariaPressed = String(button.dataset.days === String(days));
    const last = view.range.endMs - 1;
    when.replaceChildren(
      el(
        'span',
        undefined,
        days === 1 ? date(view.range.startMs) : `${date(view.range.startMs)} – ${date(last)}`,
      ),
      el('span', 'ops-orchestration-zone', view.timeZone),
    );
    const options = [
      Object.assign(el('option', undefined, `All plans (${view.plans.length})`), { value: '' }),
      ...view.plans.map((p) => Object.assign(el('option', undefined, p.name), { value: p.id })),
    ];
    planSelect.replaceChildren(...options);
    planSelect.value = view.selectedPlanId ?? '';
  }

  /** Where a time sits on the range, as a share of its width. */
  const share = (view: Overview, ms: number) =>
    Math.min(
      1,
      Math.max(0, (ms - view.range.startMs) / Math.max(1, view.range.endMs - view.range.startMs)),
    );
  const place = (node: HTMLElement, view: Overview, start: number, end: number) => {
    node.style.left = `${share(view, start) * 100}%`;
    node.style.width = `${(share(view, end) - share(view, start)) * 100}%`;
  };

  function drawTimeline(view: Overview) {
    // Axis: every 3 hours over a day, each day over 7, each week over 30; half are minor at phone width.
    const step = days === 1 ? 3 * HOUR : days === 7 ? DAY : 7 * DAY;
    const ticks: HTMLElement[] = [];
    for (let at = view.range.startMs, index = 0; at <= view.range.endMs; at += step, index++) {
      // Hours mark points; a day or week label names the span starting at its tick.
      if (days > 1 && at === view.range.endMs) break;
      const [weekday, monthDay] = date(at).split(' ');
      const label =
        days === 1
          ? at === view.range.endMs
            ? '24'
            : time(at).slice(0, 2)
          : days === 7
            ? `${weekday} ${monthDay!.slice(3)}`
            : monthDay!;
      const tick = el('span', 'ops-orchestration-tick', label);
      tick.style.left = `${share(view, at) * 100}%`;
      if (days > 1) tick.dataset.span = '';
      if (index % 2) tick.dataset.minor = '';
      ticks.push(tick);
    }
    axis.replaceChildren(...ticks);
    const marker = () => {
      const line = el('span', 'ops-orchestration-marker');
      line.style.left = `${share(view, view.atMs) * 100}%`;
      return line;
    };
    const slots = view.timeline.map((interval) => {
      const slot = el('button', 'ops-orchestration-slot');
      slot.type = 'button';
      place(slot, view, interval.startMs, interval.endMs);
      const count = interval.planIds.length;
      slot.textContent = count ? String(count) : '';
      if (!count) slot.dataset.empty = '';
      const plans = count ? interval.planIds.map(planName).join(', ') : 'Base only';
      slot.title = `${moment(interval.startMs)}–${moment(interval.endMs)} · ${plans}`;
      slot.setAttribute('aria-label', `From ${moment(interval.startMs)}: ${plans}`);
      if (view.atMs >= interval.startMs && view.atMs < interval.endMs) slot.ariaCurrent = 'time';
      slot.addEventListener('click', () => {
        atMs = Math.max(interval.startMs, view.range.startMs);
        void load();
      });
      return slot;
    });
    track.dataset.days = String(days);
    track.replaceChildren(...slots, marker());
    // One lane per shown plan: where Core's timeline has it in effect.
    const shown = view.plans.filter(
      (p) =>
        (!view.selectedPlanId || p.id === view.selectedPlanId) &&
        view.timeline.some((interval) => interval.planIds.includes(p.id)),
    );
    lanes.dataset.days = String(days);
    lanes.replaceChildren(
      ...shown.map((p) => {
        const lane = el('div', 'ops-orchestration-lane');
        // The plan's own swatch, the same one the legend shows; its widest segment carries its name.
        lane.style.setProperty('--ops-orchestration-plan', swatch(p.id));
        const segments = view.timeline.filter((interval) => interval.planIds.includes(p.id));
        const widest = segments.reduce((best, interval) =>
          interval.endMs - interval.startMs > best.endMs - best.startMs ? interval : best,
        );
        for (const interval of segments) {
          const bar = el('span', 'ops-orchestration-lane-bar', interval === widest ? p.name : '');
          place(bar, view, interval.startMs, interval.endMs);
          bar.title = `${p.name} · ${moment(interval.startMs)}–${moment(interval.endMs)}`;
          lane.append(bar);
        }
        return lane;
      }),
    );
    const active = view.timeline.find((i) => view.atMs >= i.startMs && view.atMs < i.endMs);
    const ids = active?.planIds ?? [];
    const at = el('time', undefined, moment(view.atMs));
    at.dateTime = new Date(view.atMs).toISOString();
    atText.replaceChildren(
      at,
      ` · ${ids.length ? `${ids.length} plan${ids.length === 1 ? '' : 's'} in effect` : 'Base only'}${atMs === null ? ' · now' : ''}`,
    );
    // Every plan with a lane, in effect at the selected time first; the others are muted.
    const listed = [
      ...ids.flatMap((id) => (planOf(id) ? [planOf(id)!] : [])),
      ...shown.filter((p) => !ids.includes(p.id)),
    ];
    legend.replaceChildren(
      ...listed
        .map((p) => {
          const item = el('li');
          const mark = el('span', 'ops-orchestration-swatch');
          mark.style.background = swatch(p.id);
          item.append(mark, el('strong', undefined, p.name), el('span', undefined, planSummary(p)));
          if (!ids.includes(p.id)) {
            item.dataset.later = '';
            item.append(el('span', 'ops-orchestration-source', 'not at this time'));
          }
          return [item];
        })
        .flat(),
    );
    if (!view.plans.length)
      legend.replaceChildren(
        el('li', undefined, 'Base only: no plans yet. `tmt orch plan add --help`'),
      );
  }

  function cellText(
    row: Member,
    column: Member,
  ): { text: string; label: string; verdict?: string } {
    if (row.identityId === column.identityId) return { text: '—', label: 'same member' };
    const route = sending?.routes?.get(`${row.identityId}>${column.identityId}`);
    if (!route) return { text: '·', label: 'not reported' };
    if (route.verdict === 'blocked')
      return { text: '✕', label: `blocked by ${from(route.source)}`, verdict: 'blocked' };
    if (route.verdict === 'needs_person')
      return { text: '◆', label: 'needs a person', verdict: 'needs_person' };
    const receiving = receivingCell(column.fields.receiving.value);
    return {
      text: receiving,
      label: `allowed · receives ${receivingWords(column.fields.receiving.value)}`,
    };
  }

  function drawMatrix(view: Overview) {
    const count = view.members.length;
    matrixMeta.textContent = memberQuery
      ? `${count} matching “${memberQuery}”`
      : `${count} × ${count}`;
    if (!sending?.routes) {
      matrixBody.replaceChildren(
        sentence('Routes are not available on this Core. Member policies are shown beside it.'),
      );
      return;
    }
    if (!count) {
      matrixBody.replaceChildren(sentence('No members match.'));
      return;
    }
    const scroll = el('div', 'ops-orchestration-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Route matrix, scrolls both ways');
    const table = el('table', 'ops-orchestration-matrix');
    const head = el('tr');
    const corner = el('th', undefined, 'From ↓ To →');
    corner.scope = 'col';
    head.append(corner);
    const columnAt = view.members.findIndex((m) => m.identityId === target);
    view.members.forEach((column, index) => {
      const th = el('th', undefined, column.name);
      th.scope = 'col';
      th.title = column.name;
      if (index === columnAt) th.dataset.cross = '';
      head.append(th);
    });
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const row of view.members) {
      const tr = el('tr');
      const th = el('th', undefined, row.name);
      th.scope = 'row';
      th.title = row.name;
      const inRow = row.identityId === selected;
      if (inRow) th.dataset.cross = '';
      tr.append(th);
      view.members.forEach((column, index) => {
        const cell = cellText(row, column);
        const td = el('td');
        if (inRow || index === columnAt) td.dataset.cross = '';
        const button = el('button', 'ops-orchestration-cell', cell.text);
        button.type = 'button';
        if (cell.verdict) button.dataset.verdict = cell.verdict;
        button.setAttribute('aria-label', `${row.name} to ${column.name}: ${cell.label}`);
        if (inRow && index === columnAt) {
          button.ariaPressed = 'true';
          // The selected blocked cell names the sender's rule, as the terminal page does.
          if (cell.verdict === 'blocked')
            button.textContent = `✕ ${fieldWords('sending', row.fields.sending.value).toLowerCase()}`;
        }
        button.addEventListener('click', () => {
          selected = row.identityId;
          target = column.identityId === row.identityId ? target : column.identityId;
          why = undefined;
          draw();
          // Side by side the cell keeps focus; stacked, the panel is below the fold, so it comes
          // into view and its heading takes focus.
          if (matchMedia('(max-width: 1050px)').matches) {
            const heading = inspector.querySelector<HTMLElement>('h3');
            if (!heading) return;
            heading.tabIndex = -1;
            heading.scrollIntoView({
              block: 'start',
              behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            });
            heading.focus({ preventScroll: true });
            return;
          }
          matrixBody
            .querySelector<HTMLElement>(
              `tbody tr:nth-child(${view.members.indexOf(row) + 1}) td:nth-of-type(${index + 1}) button`,
            )
            ?.focus({ preventScroll: true });
        });
        td.append(button);
        tr.append(td);
      });
      body.append(tr);
    }
    table.append(thead, body);
    // Arrow keys move between cells, like the terminal page.
    table.addEventListener('keydown', (event) => {
      const moves: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const move = moves[event.key];
      const cell = (event.target as HTMLElement).closest('td');
      if (!move || !cell) return;
      const tr = cell.parentElement as HTMLTableRowElement;
      const rows = [...body.rows];
      const r = rows.indexOf(tr) + move[0];
      const col = cell.cellIndex + move[1];
      const next = rows[r]?.cells[col]?.querySelector('button');
      if (!next) return;
      event.preventDefault();
      next.focus();
    });
    scroll.append(table);
    // A compact key: each cell glyph in the matrix's own type, then what it means.
    const key = el('dl', 'ops-orchestration-key');
    key.setAttribute('aria-label', 'Matrix key');
    for (const [glyph, meaning, verdict] of [
      ['B30', 'batch every 30 min'],
      ['Direct', 'right away'],
      ['Urgent', 'urgent only'],
      ['✕', 'blocked by the sender rule', 'blocked'],
      ['◆', 'needs a person', 'needs_person'],
    ] as const) {
      const item = el('div');
      const term = el('dt', undefined, glyph);
      if (verdict) term.dataset.verdict = verdict;
      item.append(term, el('dd', undefined, meaning));
      key.append(item);
    }
    const notes: HTMLElement[] = [key];
    if (atMs !== null)
      notes.push(
        el(
          'p',
          'ops-orchestration-caption',
          `✕ and ◆ are Core’s verdicts for now; receiving is at ${moment(view.atMs)}.`,
        ),
      );
    if (sending.truncated)
      notes.push(
        el(
          'p',
          'ops-orchestration-caption',
          'Core stopped at its page limit; filter members to see the rest.',
        ),
      );
    const keep = matrixBody.querySelector('.ops-orchestration-scroll');
    const position = keep ? [keep.scrollLeft, keep.scrollTop] : [0, 0];
    matrixBody.replaceChildren(scroll, ...notes);
    scroll.scrollLeft = position[0]!;
    scroll.scrollTop = position[1]!;
  }

  function drawTalks() {
    if (!sending?.talks) return talks.replaceChildren();
    if (!sending.talks.length)
      return talks.replaceChildren(
        el('p', 'ops-orchestration-caption', 'Talks this hour: none counted.'),
      );
    const list = el('ul', c.list);
    list.setAttribute('aria-label', 'Talks this hour');
    for (const pair of sending.talks) {
      const item = el('li', c.listRow);
      const limit = pair.limit === null ? '' : `/${pair.limit}`;
      item.append(
        el('span', c.listTitle, `${pair.held ? '◆ ' : ''}${pair.names[0]} ⇄ ${pair.names[1]}`),
        el(
          'span',
          c.listMeta,
          `${pair.count}${limit}${pair.held ? ` · ${pair.heldCount} held · needs a person` : ''}`,
        ),
      );
      if (pair.held) item.dataset.held = '';
      list.append(item);
    }
    talks.replaceChildren(el('h4', c.sectionHeading, 'Talks this hour'), list);
  }

  /** One action: its label stays on one line, cut with the full text as its title when long. */
  const action = (label: string, run: () => void, accessible?: string) => {
    const button = el('button', c.action);
    button.append(el('span', c.actionLabel, label));
    button.title = accessible ?? label;
    if (accessible) button.setAttribute('aria-label', accessible);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  };
  /** Facts; a value's source follows it, muted: `Leads only ← Shift B`. */
  const facts = (rows: [string, string, string?][]) => {
    const list = el('dl', c.facts);
    for (const [term, value, source] of rows) {
      const dd = el('dd', undefined, value);
      if (source) dd.append(el('span', 'ops-orchestration-source', ` ← ${source}`));
      list.append(el('dt', undefined, term), dd);
    }
    return list;
  };

  function drawJobs(row: Member): HTMLElement[] {
    const entry = jobs.get(row.identityId)?.value;
    if (entry === undefined) return [el('p', 'ops-orchestration-caption', 'Jobs · reading…')];
    if (entry === 'failed')
      return [el('p', 'ops-orchestration-caption', 'Jobs · Core could not read them right now.')];
    const head = el('h4', c.sectionHeading, `Jobs ${entry.jobs.length}${entry.more ? '+' : ''}`);
    if (!entry.jobs.length) return [head, el('p', 'ops-orchestration-caption', 'No jobs.')];
    const list = el('ul', 'ops-orchestration-jobs');
    list.setAttribute('aria-label', `Jobs · ${row.name}`);
    for (const job of entry.jobs) {
      const item = el('li');
      const next = job.nextRunAtMs === null ? '' : ` · next ${moment(job.nextRunAtMs)}`;
      const title = el('span', undefined, job.title);
      title.title = job.title;
      item.append(
        title,
        el('span', undefined, JOB[job.state]),
        el('span', undefined, `${job.schedule}${next}`),
      );
      item.dataset.state = job.state;
      list.append(item);
    }
    return [head, list];
  }

  async function loadJobs(id: string) {
    if (jobs.get(id)?.round === jobsRound || reading.has(id) || !api) return;
    const round = jobsRound;
    reading.add(id);
    try {
      jobs.set(id, { round, value: await readJobs(api, id) });
    } catch {
      jobs.set(id, { round, value: 'failed' });
    }
    reading.delete(id);
    if (selected === id) drawInspector();
  }

  function drawInspector() {
    const parts: HTMLElement[] = [];
    const row = member(selected);
    const column = member(target);
    const at = overview ? moment(overview.atMs) : '';
    if (row && column) {
      const route = sending?.routes?.get(`${row.identityId}>${column.identityId}`);
      const head = el('div', 'ops-orchestration-panel-head');
      head.append(
        el('h3', c.cardTitle, `${row.name} → ${column.name}`),
        el('span', c.cardMeta, at),
      );
      parts.push(head);
      parts.push(
        facts([
          [
            'Sending',
            fieldWords('sending', row.fields.sending.value),
            from(row.fields.sending.source),
          ],
          [
            'Result',
            !route
              ? 'not reported'
              : route.verdict === 'blocked'
                ? 'Blocked · explained'
                : route.verdict === 'needs_person'
                  ? '◆ held for a person'
                  : `Allowed · ${receivingWords(column.fields.receiving.value)}`,
          ],
        ]),
      );
      const actions = el('div', c.actions);
      if (route?.verdict === 'blocked') {
        const end = Math.min(row.nextChangeAtMs ?? now() + DAY, now() + DAY);
        actions.append(
          action(`Allow once until ${moment(end)}`, () =>
            preview(`Allow ${row.name} → ${column.name} once`, {
              kind: 'route.allow',
              fromId: row.identityId,
              toId: column.identityId,
              untilMs: end,
            }),
          ),
        );
      }
      const pair = sending?.talks?.find(
        (p) => p.ids.includes(row.identityId) && p.ids.includes(column.identityId),
      );
      if (pair?.held)
        actions.append(
          action(`Resume ${row.name} ⇄ ${column.name}`, () =>
            preview(`Resume ${row.name} ⇄ ${column.name}`, {
              kind: 'talks.resume',
              aId: row.identityId,
              bId: column.identityId,
            }),
          ),
        );
      if (actions.childElementCount) parts.push(actions);
    }
    if (row) {
      const section = el('div', 'ops-orchestration-member');
      const head = el('div', 'ops-orchestration-panel-head');
      head.append(
        el('h3', c.cardTitle, row.name),
        action('Why', () => void explain(row), `Why · ${row.name}`),
      );
      section.append(head);
      const value = (key: keyof Member['fields'], label: string): [string, string, string] => [
        label,
        fieldWords(key, row.fields[key].value),
        from(row.fields[key].source),
      ];
      section.append(
        facts([
          value('state', 'State'),
          value('receiving', 'Receiving'),
          value('sending', 'Sending'),
          value('routine', 'Routine jobs'),
          value('talkLimit', 'Talk limit'),
          [
            'Plans',
            row.activePlans.length ? row.activePlans.map(planName).join(', ') : 'Base only',
          ],
          [
            'Next change',
            row.nextChangeAtMs === null ? 'none in view' : moment(row.nextChangeAtMs),
          ],
        ]),
      );
      const start = now();
      const focus = el('div', 'ops-orchestration-focus');
      const focusActions = el('div', c.actions);
      const focusFor = (hours: number) =>
        action(
          `${hours}h`,
          () =>
            preview(`Focus ${row.name} for ${hours === 1 ? 'one hour' : `${hours} hours`}`, {
              kind: 'focus.set',
              identityId: row.identityId,
              startMs: start,
              endMs: start + hours * HOUR,
            }),
          `Focus now ${hours}h`,
        );
      focusActions.append(
        focusFor(1),
        focusFor(2),
        action('End focus', () =>
          preview(`End ${row.name}'s focus`, { kind: 'focus.clear', identityId: row.identityId }),
        ),
      );
      focus.append(el('span', 'ops-orchestration-focus-label', 'Focus now'), focusActions);
      section.append(focus);
      if (why?.id === row.identityId) {
        const list = el('ul', c.list);
        list.setAttribute('aria-label', `Why · ${row.name}`);
        for (const line of why.lines) list.append(el('li', c.listRow, line));
        section.append(list);
      }
      section.append(...drawJobs(row));
      parts.push(section);
      void loadJobs(row.identityId);
    }
    if (!parts.length) parts.push(sentence('No members match.'));
    // A redraw (jobs arriving, the 30 s refresh) keeps focus on the same heading.
    const focused = document.activeElement;
    const kept =
      focused instanceof HTMLHeadingElement && inspector.contains(focused)
        ? focused.textContent
        : null;
    inspector.replaceChildren(...parts);
    if (kept === null) return;
    const heading = [...inspector.querySelectorAll<HTMLElement>('h3')].find(
      (node) => node.textContent === kept,
    );
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  function draw() {
    for (const button of ranges) button.ariaPressed = String(button.dataset.days === String(days));
    if (!overview) return;
    plansCard.hidden = false;
    timelineCard.hidden = false;
    grid.hidden = false;
    drawBar(overview);
    drawPlans(overview);
    drawTimeline(overview);
    drawMatrix(overview);
    drawTalks();
    drawInspector();
  }

  async function explain(row: Member) {
    try {
      api ??= await connect();
      const page = await api.read({
        view: 'why',
        subject: { kind: 'identity', id: row.identityId },
        limit: 20,
      });
      const items = Array.isArray(page.items) ? (page.items as Json[]) : [];
      why = {
        id: row.identityId,
        lines: items.length
          ? items.map(
              (item) =>
                `${String(item.action ?? '?')} ${String(item.outcome ?? '?')} · ${String(item.reason ?? '?')}`,
            )
          : ['No recorded decision.'],
      };
      drawInspector();
    } catch {
      say('Core could not read the decisions right now.');
    }
  }

  /** Core's preview in a dialog; Save applies exactly that preview, Cancel sends nothing. */
  async function preview(title: string, mutation: Json) {
    try {
      api ??= await connect();
      const answer = await api.write({ phase: 'preview', mutation });
      const head = el('div', c.dialogHeader);
      head.append(el('h2', c.title, title));
      const body = el('div', c.dialogBody);
      for (const line of previewLines(answer, name)) body.append(el('p', undefined, line));
      const actions = el('div', c.dialogActions);
      const cancel = action('Cancel', () => dialog.close());
      const save = action('Save', () => {
        save.disabled = true;
        void apply(answer);
      });
      save.dataset.primary = '';
      actions.append(cancel, save);
      dialog.replaceChildren(head, body, actions);
      dialog.showModal();
    } catch (error) {
      say(
        error instanceof OrchestrationRefused
          ? (error.detail ?? `Core refused the change (${error.code}).`)
          : 'Core could not preview the change right now; nothing was saved.',
      );
    }
  }

  async function apply(previewed: Json) {
    try {
      await api!.write(applyInput(previewed));
      dialog.close();
      await load();
      // A failed reread keeps its own message; otherwise the save is the news.
      if (!status.textContent) say('Orchestration saved.');
    } catch (error) {
      dialog.close();
      say(
        error instanceof OrchestrationRefused && error.code === 'ORCH_CONFLICT'
          ? 'Orchestration changed since the preview; nothing was saved. Try again.'
          : error instanceof OrchestrationRefused
            ? (error.detail ?? `Core refused the change (${error.code}).`)
            : 'The save could not be confirmed. Refresh to see what Core recorded.',
      );
    }
  }

  for (const button of ranges)
    button.addEventListener('click', () => {
      days = Number(button.dataset.days);
      void load();
    });
  planSelect.addEventListener('change', () => {
    plan = planSelect.value || null;
    void load();
  });
  const step = (direction: -1 | 1) => {
    if (!overview) return;
    const boundaries = [
      ...overview.timeline.flatMap((i) => [i.startMs, i.endMs]),
      ...overview.members.flatMap((m) => (m.nextChangeAtMs === null ? [] : [m.nextChangeAtMs])),
    ]
      .filter((value, at, all) => all.indexOf(value) === at && value < overview!.range.endMs)
      .sort((a, b) => a - b);
    const next =
      direction < 0
        ? boundaries.reverse().find((at) => at < overview!.atMs)
        : boundaries.find((at) => at > overview!.atMs);
    if (next === undefined) return;
    atMs = next;
    void load();
  };
  earlier.addEventListener('click', () => step(-1));
  later.addEventListener('click', () => step(1));
  nowButton.addEventListener('click', () => {
    atMs = null;
    void load();
  });
  let typing: ReturnType<typeof setTimeout> | undefined;
  filter.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      memberQuery = filter.value.trim();
      void load();
    }, 300);
  });

  return {
    node,
    /** One refresh; the page's owner calls it while the section is visible. */
    refresh: load,
  };
}

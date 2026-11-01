/** The Orchestration page (#4894): Core's plans and each member's effective policy at a selected
 * time, who may message whom, and this hour's talks. Every change shows Core's preview first and
 * saves only that exact preview after the person confirms. Nothing is computed here: each value and
 * its source is Core's. */
import { browserUiClasses as c } from '@tmt/browser-ui/static';
import { createIcon } from '@tmt/browser-ui/glyph';
import { el, pageFoot, pageHead, sentence } from './ops-parts.js';
import {
  OrchestrationRefused,
  applyInput,
  decodeOverview,
  previewLines,
  readSending,
  receivingCell,
  type Json,
  type Member,
  type OrchestrationApi,
  type Overview,
  type Sending,
  type Source,
} from './orchestration-client.js';

export type OrchestrationConnect = () => Promise<OrchestrationApi>;
const DAY = 86_400_000;
const FIELDS = [
  ['state', 'State'],
  ['receiving', 'Receiving'],
  ['sending', 'Sending'],
  ['routine', 'Routine jobs'],
] as const;

const words = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.charAt(0).toUpperCase() + value.slice(1);
  if (typeof value === 'object' && 'mode' in value) return receivingCell(value);
  return JSON.stringify(value);
};

export function orchestrationView(connect: OrchestrationConnect, now = () => Date.now()) {
  const node = el('div', 'ops-orchestration-page');
  const status = el('p', 'ops-note');
  status.setAttribute('role', 'status');
  const controls = el('div', c.actions);
  const ranges = [1, 7, 30].map((days) => {
    const button = el('button', c.action, days === 1 ? '1 day' : `${days} days`);
    button.type = 'button';
    button.dataset.days = String(days);
    return button;
  });
  const earlier = el('button', c.action, '◀ Earlier');
  const later = el('button', c.action, 'Later ▶');
  const nowButton = el('button', c.action, 'Now');
  for (const button of [earlier, later, nowButton]) button.type = 'button';
  const filter = el('input', c.fieldControl);
  filter.type = 'search';
  filter.placeholder = 'Members: prefix or contains';
  filter.setAttribute('aria-label', 'Filter members');
  const search = el('div', c.searchField);
  search.append(createIcon('search'), filter);
  controls.append(...ranges, earlier, later, nowButton, search);
  const timeline = el('div', 'ops-orchestration-timeline');
  timeline.setAttribute('role', 'group');
  timeline.setAttribute('aria-label', 'Plans in effect over the range');
  const matrixCard = el('section', c.card);
  const matrixHead = el('div', c.cardHead);
  matrixHead.append(el('h3', c.cardTitle, 'Who may message whom'));
  const matrixBody = el('div');
  const talks = el('div', 'ops-orchestration-talks');
  matrixCard.append(matrixHead, matrixBody, talks);
  const inspector = el('section', c.card);
  inspector.setAttribute('aria-label', 'Selected member and route');
  const grid = el('div', 'ops-grid');
  grid.append(matrixCard, inspector);
  const dialog = el('dialog', c.dialog);
  node.append(
    pageHead('Plans, time slots and who may message whom, as Core decides them.'),
    controls,
    status,
    timeline,
    grid,
    pageFoot('Changes show Core’s preview first · Refreshes while visible'),
    dialog,
  );

  let api: OrchestrationApi | undefined;
  let days = 1;
  let atMs: number | null = null;
  let memberQuery = '';
  let overview: Overview | undefined;
  let sending: Sending | undefined;
  let selected: string | undefined;
  let target: string | undefined;
  let why: { id: string; lines: string[] } | undefined;
  let generation = 0;

  const say = (text: string) => {
    status.textContent = text;
  };
  const time = (ms: number) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: days > 1 ? 'short' : undefined,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: overview?.timeZone,
    }).format(ms);
  const member = (id?: string) => overview?.members.find((m) => m.identityId === id);
  const name = (id: string) => member(id)?.name ?? id;
  const planName = (id: string | null) =>
    overview?.plans.find((plan) => plan.id === id)?.name ?? 'a plan';
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

  async function load() {
    const mine = ++generation;
    try {
      api ??= await connect();
      const input: Json = {
        view: 'overview',
        rangeDays: days,
        ...(atMs === null ? {} : { atMs }),
        ...(memberQuery ? { memberQuery } : {}),
      };
      const next = decodeOverview(await api.read(input));
      const nextSending = await readSending(api, memberQuery || undefined);
      if (mine !== generation) return;
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

  function drawTimeline(view: Overview) {
    const span = Math.max(1, view.range.endMs - view.range.startMs);
    const row = el('div', 'ops-orchestration-slots');
    for (const interval of view.timeline) {
      const slot = el('button', 'ops-orchestration-slot');
      slot.type = 'button';
      slot.style.flexGrow = String(Math.max(1, interval.endMs - interval.startMs) / span);
      const count = interval.planIds.length;
      slot.textContent = count ? String(count) : '·';
      slot.title = `${time(interval.startMs)} · ${count} plan${count === 1 ? '' : 's'}`;
      if (view.atMs >= interval.startMs && view.atMs < interval.endMs) slot.ariaCurrent = 'time';
      slot.addEventListener('click', () => {
        atMs = Math.max(interval.startMs, view.range.startMs);
        void load();
      });
      row.append(slot);
    }
    const active = view.timeline.find((i) => view.atMs >= i.startMs && view.atMs < i.endMs);
    const names = active?.planIds.map((id) => planName(id)) ?? [];
    timeline.replaceChildren(
      row,
      el(
        'p',
        'ops-note',
        `${time(view.atMs)} ${view.timeZone} · ${names.length ? names.join(', ') : 'Base only'}`,
      ),
    );
  }

  function cellText(row: Member, column: Member): { text: string; label: string } {
    if (row.identityId === column.identityId) return { text: '—', label: 'same member' };
    const route = sending?.routes?.get(`${row.identityId}>${column.identityId}`);
    if (!route) return { text: '·', label: 'not reported' };
    if (route.verdict === 'blocked')
      return { text: '✕', label: `blocked by ${from(route.source)}` };
    if (route.verdict === 'needs_person') return { text: '◆', label: 'needs a person' };
    const receiving = receivingCell(column.fields.receiving.value);
    return { text: receiving, label: `allowed · receives ${receiving}` };
  }

  function drawMatrix(view: Overview) {
    if (!sending?.routes) {
      matrixBody.replaceChildren(
        sentence('Routes are not available on this Core. Member policies are shown on the right.'),
      );
      return;
    }
    const scroll = el('div', c.tableScroll);
    const table = el('table', `${c.table} ops-orchestration-matrix`);
    const head = el('tr');
    head.append(el('th', undefined, 'From ↓ To →'));
    for (const column of view.members) {
      const th = el('th', undefined, column.name);
      th.scope = 'col';
      if (column.identityId === target) th.dataset.crosshair = '';
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const row of view.members) {
      const tr = el('tr');
      const th = el('th', undefined, row.name);
      th.scope = 'row';
      if (row.identityId === selected) th.dataset.crosshair = '';
      tr.append(th);
      for (const column of view.members) {
        const cell = cellText(row, column);
        const td = el('td', c.tableMono);
        const button = el('button', 'ops-orchestration-cell', cell.text);
        button.type = 'button';
        button.setAttribute('aria-label', `${row.name} to ${column.name}: ${cell.label}`);
        if (row.identityId === selected && column.identityId === target)
          button.ariaPressed = 'true';
        button.addEventListener('click', () => {
          selected = row.identityId;
          target = column.identityId === row.identityId ? target : column.identityId;
          why = undefined;
          draw();
        });
        td.append(button);
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(thead, body);
    scroll.append(table);
    const notes = [
      el(
        'p',
        'ops-note',
        'B30 batch 30 min · Direct · ✕ blocked by the sender rule · ◆ needs a person',
      ),
    ];
    if (sending.truncated)
      notes.push(
        el('p', 'ops-note', 'Core stopped at its page limit; filter members to see the rest.'),
      );
    matrixBody.replaceChildren(scroll, ...notes);
  }

  function drawTalks() {
    if (!sending?.talks) return talks.replaceChildren();
    if (!sending.talks.length)
      return talks.replaceChildren(el('p', 'ops-note', 'Talks this hour: none counted.'));
    const list = el('ul', c.list);
    list.setAttribute('aria-label', 'Talks this hour');
    for (const pair of sending.talks) {
      const item = el('li', c.listRow);
      const limit = pair.limit === null ? '' : `/${pair.limit}`;
      item.append(
        el('span', c.listTitle, `${pair.names[0]} ⇄ ${pair.names[1]}`),
        el(
          'span',
          c.listMeta,
          `${pair.count}${limit}${pair.held ? ` · ◆ ${pair.heldCount} held` : ''}`,
        ),
      );
      list.append(item);
    }
    talks.replaceChildren(el('h4', c.sectionHeading, 'Talks this hour'), list);
  }

  const action = (label: string, run: () => void) => {
    const button = el('button', c.action, label);
    button.type = 'button';
    button.addEventListener('click', run);
    return button;
  };

  function drawInspector() {
    const parts: HTMLElement[] = [];
    const row = member(selected);
    const column = member(target);
    if (row && column) {
      const route = sending?.routes?.get(`${row.identityId}>${column.identityId}`);
      parts.push(el('h3', c.cardTitle, `${row.name} → ${column.name}`));
      const facts = el('dl', c.facts);
      const add = (term: string, value: string) =>
        facts.append(el('dt', undefined, term), el('dd', undefined, value));
      add('Sending', `${words(row.fields.sending.value)} ← ${from(row.fields.sending.source)}`);
      add(
        'Result',
        !route
          ? 'not reported'
          : route.verdict === 'blocked'
            ? '◆ not sent, explained'
            : route.verdict === 'needs_person'
              ? '◆ held for a person'
              : `sent · ${receivingCell(column.fields.receiving.value)}`,
      );
      parts.push(facts);
      const actions = el('div', c.actions);
      if (route?.verdict === 'blocked') {
        const end = Math.min(row.nextChangeAtMs ?? now() + DAY, now() + DAY);
        actions.append(
          action(`Allow once until ${time(end)}`, () =>
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
      parts.push(el('h3', c.cardTitle, row.name));
      const facts = el('dl', c.facts);
      for (const [key, label] of FIELDS) {
        const field = row.fields[key];
        facts.append(
          el('dt', undefined, label),
          el('dd', undefined, `${words(field.value)} ← ${from(field.source)}`),
        );
      }
      parts.push(facts);
      const at = now();
      const actions = el('div', c.actions);
      actions.append(
        action('Focus now 1h', () =>
          preview(`Focus ${row.name} for one hour`, {
            kind: 'focus.set',
            identityId: row.identityId,
            startMs: at,
            endMs: at + 3_600_000,
          }),
        ),
        action('End focus', () =>
          preview(`End ${row.name}'s focus`, { kind: 'focus.clear', identityId: row.identityId }),
        ),
        action('Why', () => void explain(row)),
      );
      parts.push(actions);
      if (why?.id === row.identityId) {
        const list = el('ul', c.list);
        list.setAttribute('aria-label', `Why · ${row.name}`);
        for (const line of why.lines) list.append(el('li', c.listRow, line));
        parts.push(list);
      }
      parts.push(el('p', 'ops-note', 'Jobs · not available yet'));
    }
    if (!parts.length) parts.push(sentence('No members match.'));
    inspector.replaceChildren(...parts);
  }

  function draw() {
    for (const button of ranges) button.ariaPressed = String(button.dataset.days === String(days));
    if (!overview) return;
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
  const step = (direction: -1 | 1) => {
    if (!overview) return;
    const boundaries = [
      ...overview.timeline.flatMap((i) => [i.startMs, i.endMs]),
      ...overview.members.flatMap((m) => (m.nextChangeAtMs === null ? [] : [m.nextChangeAtMs])),
    ]
      .filter((value, at, all) => all.indexOf(value) === at)
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

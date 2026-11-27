/**
 * The Digest usage report follows the concept website: provider allowance cards with each
 * window's runway, the token chart and seat legend, usage share by model and by seat, the trend,
 * a full-width Messages heatmap, what Digest saved, and a coverage/method footer. It depends only on DigestSource; product data comes from the existing owner reads. Samples are injected
 * by tests, the gallery and local development. Range and view state belong to this mounted page.
 */
import { compactCount, createSeriesChart, topLayers } from '@tmt/browser-ui/chart';
import { pageLoading } from './page-loading.js';
import {
  createDigestSource,
  pricingVersion,
  providerRecords,
  USAGE_RANGES,
  type DigestReport,
  type DigestSource,
  type UsageDocument,
  type UsageRange,
} from './digest-source.js';
import {
  coverage,
  coverageHeading,
  exchange,
  providerGroups,
  providerLabel,
  observedAgo,
  modelShares,
  modelCostShares,
  costEstimate,
  usdText,
  ranking,
  rankRows,
  resetsIn,
  runwayWords,
  savingsView,
  seatMix,
  tokenSeries,
  tokensOf,
  trend,
  creditText,
  type ProviderGroup,
  type ProviderView,
  type SeatMix,
} from './digest-view.js';
import { notAvailable } from './not-available.js';
import { browserUiClasses as ui, type BrowserStatusTone } from '@tmt/browser-ui/static';
import { whileVisible } from './owner-reads.js';

/** The terminal Digest's own cadence: the usage read refreshes once a minute. */
const REFRESH_MS = 60_000;

export { compactCount as formatTokens };

/** Distinct series a chart draws; the rest fold into one neutral `Other`. */
const SERIES_KEPT = 6;
/** Models the share card names; the rest fold into one `Other` row. */
const MODELS_KEPT = 4;
/** The neutral palette step of the folded `Other` layer (`tmt-ui-chart-s7`). */
const OTHER_STEP = 7;

function el<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type SeatOrder = 'usage' | 'name';
const SEAT_ORDER_KEY = 'tmt-digest-seat-order';

function readSeatOrder(): SeatOrder {
  try {
    return localStorage.getItem(SEAT_ORDER_KEY) === 'name' ? 'name' : 'usage';
  } catch {
    return 'usage';
  }
}

function writeSeatOrder(value: SeatOrder): void {
  try {
    localStorage.setItem(SEAT_ORDER_KEY, value);
  } catch {
    // Persistence is optional; the mounted page keeps the reader's choice.
  }
}

interface DigestViewState {
  share: boolean;
  allSeats: boolean;
  lines: boolean;
  order: SeatOrder;
  dispose: (() => void)[];
}

/** A flat sheet with a sentence-case title and an optional right-hand slot in its head. */
function card(
  id: string,
  title: string,
  body: readonly Node[],
  options: { actions?: Node; className?: string; subtitle?: string } = {},
): HTMLElement {
  const node = el(
    'section',
    options.className ? `${ui.card} digest-card ${options.className}` : `${ui.card} digest-card`,
  );
  node.id = id;
  node.setAttribute('aria-labelledby', `${id}-title`);
  const heading = el('h2', ui.cardTitle, title);
  heading.id = `${id}-title`;
  const head = el('div', ui.cardHead);
  if (options.subtitle) {
    const title = el('div', 'digest-section-title');
    title.append(heading, el('p', 'digest-subtitle', options.subtitle));
    head.append(title);
  } else head.append(heading);
  if (options.actions) head.append(options.actions);
  node.append(head, ...body);
  return node;
}

function table(head: readonly string[], rows: readonly (readonly (string | Node)[])[]) {
  const node = el('table', ui.table);
  node.dataset.numeric = '';
  const header = el('tr');
  for (const text of head) {
    const cell = el('th', undefined, text);
    cell.scope = 'col';
    header.append(cell);
  }
  const thead = el('thead');
  thead.append(header);
  node.append(thead);
  const body = el('tbody');
  for (const [first, ...rest] of rows) {
    const line = el('tr');
    const name = el('th');
    name.scope = 'row';
    name.append(first!);
    line.append(
      name,
      ...rest.map((value) => {
        const cell = el('td');
        cell.append(value);
        return cell;
      }),
    );
    body.append(line);
  }
  node.append(body);
  return node;
}

/** The leaf's boxed tabs as a two-way choice for one panel; `aria-selected` marks the active one. */
function tabChoice<T extends string>(
  label: string,
  controls: string,
  options: readonly { value: T; text: string }[],
  initial: T,
  change: (value: T) => void,
): HTMLElement {
  const header = el('div', ui.tabsHeader);
  const list = el('div', ui.tabList);
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', label);
  const buttons = options.map((option) => {
    const button = el('button', ui.tab, option.text);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', controls);
    button.id = `${controls}-${option.value}`;
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const index = buttons.findIndex((item) => item.value === option.value);
      const next = buttons[(index + step + buttons.length) % buttons.length]!;
      next.button.click();
      next.button.focus();
    });
    button.addEventListener('click', () => {
      sync(option.value);
      change(option.value);
    });
    return { button, value: option.value };
  });
  const sync = (active: T) => {
    for (const { button, value } of buttons) {
      button.setAttribute('aria-selected', String(value === active));
      button.tabIndex = value === active ? 0 : -1;
    }
  };
  sync(initial);
  list.append(...buttons.map(({ button }) => button));
  header.append(list);
  return header;
}

/** One fact in a card: a number by default, a word or a time with `numeric: false`; a tone adds
 * the leaf's dot before the value. */
function tile(
  label: string,
  value: string,
  options: { tone?: BrowserStatusTone; numeric?: boolean } = {},
): HTMLElement {
  const node = el('div', ui.statusTile);
  const figure = el('dd', ui.statusTileValue);
  if (options.tone) {
    node.dataset.tone = options.tone;
    const dot = el('span', ui.statusTileDot);
    dot.setAttribute('aria-hidden', 'true');
    figure.append(dot);
  }
  figure.append(value);
  if (options.numeric ?? true) figure.dataset.numeric = value === '0' ? 'zero' : 'count';
  node.append(el('dt', ui.statusTileLabel, label), figure);
  return node;
}

/** A weekday, day and time in the owner's zone: when a window runs out. */
function clock(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** #6751 B: where the window is headed, in words, or why there is no runway. */
function runwayText(view: ProviderView, nowMs: number): string {
  if (view.stale) return 'No runway: the latest reading of this window is stale.';
  if (view.runway)
    return view.runway.emptyAtMs === null
      ? `Lasts to the reset. ${runwayWords(view.runway, nowMs)}`
      : runwayWords(view.runway, nowMs);
  return view.chart
    ? 'No runway yet: this window has too few readings.'
    : 'No runway: the weekly history is not served yet.';
}

/** #6751 B: what is left, when it runs out or what is left at the reset, and when it resets. */
function runwayTiles(view: ProviderView, nowMs: number): HTMLElement[] {
  const runway = view.runway;
  const empty = runway?.emptyAtMs ?? null;
  const tone: BrowserStatusTone | undefined = runway
    ? empty === null
      ? 'working'
      : 'blocked'
    : undefined;
  return [
    tile('Left', `${view.leftPercent}%`, tone ? { tone } : {}),
    empty !== null
      ? tile('Runs out', clock(empty), { tone: 'blocked', numeric: false })
      : tile('At the reset', runway ? `${Math.round(runway.leftAtReset)}% left` : '—', {
          ...(tone ? { tone } : {}),
          numeric: false,
        }),
    tile('Resets in', view.stale ? 'stale' : resetsIn(view.resetsAtMs, nowMs), {
      tone: 'muted',
      numeric: false,
    }),
  ];
}

/** A group of bare tiles for use inside a card. */
function bareTiles(...tiles: HTMLElement[]): HTMLElement {
  const group = el('dl', ui.statusTiles);
  group.dataset.bare = '';
  group.append(...tiles);
  return group;
}

function providerRow(view: ProviderView, nowMs: number): HTMLElement {
  const row = el('div', 'digest-provider');
  row.id = `digest-window-${view.key}`;
  const label = el('div', 'digest-provider-label');
  label.append(
    el('strong', undefined, view.provider),
    el('strong', undefined, `${view.leftPercent}% left${view.stale ? ' (stale)' : ''}`),
  );
  const meter = el('div', ui.meter);
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', `${view.leftPercent}% of the weekly allowance left`);
  const fill = el('div', `${ui.meterFill} tmt-ui-chart-s${view.style}`);
  fill.style.setProperty(
    '--tmt-ui-meter-fill',
    String(Math.max(0, Math.min(100, view.leftPercent))),
  );
  meter.append(fill);
  // #6751 B: the runway in words under the meter, then the week's history and its facts in view.
  // The card's most useful line reads as its body text, like the provider's own note lines.
  const words = el('p', 'usage-note digest-runway', runwayText(view, nowMs));
  const history = el('div', 'digest-provider-history');
  history.id = `${row.id}-history`;
  if (view.chart) history.append(createSeriesChart(view.chart));
  history.append(bareTiles(...runwayTiles(view, nowMs)));
  const observation = el(
    'p',
    'usage-note digest-window-observation',
    `Observed ${observedAgo(view.observedAtMs, nowMs)}`,
  );
  observation.dataset.observedAt = String(view.observedAtMs);
  const reset = new Date(view.resetsAtMs).toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const metadata = el('div', 'digest-provider-metadata');
  metadata.append(
    observation,
    el('p', 'usage-note', `Resets ${reset}`),
    el(
      'p',
      'usage-note digest-reporters',
      `Reported by ${view.reporters.join(', ') || 'unknown seats'}`,
    ),
  );
  row.append(label, meter, words, history, metadata);
  return row;
}

/** A provider's usage in the allowance week and, where the report carries it, its credits. */
function providerFacts(group: ProviderGroup, nowMs: number): HTMLElement[] {
  const facts: HTMLElement[] = [];
  if (group.usage)
    facts.push(
      el(
        'p',
        'usage-note digest-provider-usage',
        `${compactCount(tokensOf(group.usage))} tokens in the last 7 days`,
      ),
    );
  if (group.credits)
    facts.push(
      el(
        'p',
        'usage-note digest-provider-credits',
        `${group.credits.balance === null ? 'No credits' : `Credits: ${creditText(group.credits.balance)}`} · observed ${observedAgo(group.credits.observedAtMs, nowMs)}`,
      ),
    );
  return facts;
}

/** Coverage first (#6751 F): which seats the report cannot see, and why, above every number. */
function coverageNotice(doc: UsageDocument): HTMLElement | undefined {
  const seen = coverage(doc);
  if (!seen.missingSeats && !seen.partialSeats && !seen.idle.length) return undefined;
  const gap = seen.missingSeats > 0 || seen.partialSeats > 0;
  const node = el('section', `${ui.banner} digest-coverage`);
  node.id = 'digest-coverage';
  // Idle seats alone are no gap: the band stays neutral and says so.
  if (gap) node.dataset.tone = 'waiting';
  const head = el('div', ui.bannerHead);
  const title = el('h2', 'digest-coverage-title', coverageHeading(seen));
  title.id = 'digest-coverage-title';
  node.setAttribute('aria-labelledby', title.id);
  head.append(title);
  node.append(head);
  const rows = [
    ...seen.missing.map((gap) => [gap.id, `${gap.seats.length} ${gap.words}`, gap.seats] as const),
    // Apart from the gaps: an idle seat simply did not work, and its usage is not missing.
    ...(seen.idle.length
      ? [['idle', `${seen.idle.length} idle, with no recent turn (not a gap)`, seen.idle] as const]
      : []),
  ];
  if (rows.length) {
    const list = el('ul', 'digest-coverage-causes');
    for (const [id, words, seats] of rows) {
      const item = el('li', 'digest-coverage-cause');
      item.dataset.cause = id;
      item.append(el('strong', undefined, words), el('span', 'usage-note', seats.join(', ')));
      list.append(item);
    }
    node.append(list);
  }
  return node;
}

function allowanceRow(report: DigestReport, state: DigestViewState): HTMLElement {
  const doc = report.allowance;
  const intro = el('div', 'digest-allowance-intro');
  intro.append(
    el('h2', ui.cardTitle, 'Allowance'),
    el('p', 'digest-subtitle', 'Latest known weekly windows. Independent of the usage range.'),
  );
  const node = el('section', `${ui.card} digest-card digest-allowance`);
  node.id = 'digest-allowance';
  intro.querySelector('h2')!.id = 'digest-allowance-title';
  node.setAttribute('aria-labelledby', 'digest-allowance-title');
  const groups = el('div', 'digest-provider-groups');
  groups.id = 'digest-provider-groups';
  groups.setAttribute('role', 'region');
  groups.setAttribute('aria-label', 'Provider allowances');
  const providers = providerGroups(doc);
  if (!providers.length) {
    node.append(
      intro,
      el(
        'p',
        'usage-note',
        report.allowanceUnavailable ?? 'No weekly allowance observations have been reported.',
      ),
    );
    return node;
  }
  for (const group of providers) {
    const host = el('div', 'digest-provider-group');
    host.id = `digest-provider-${encodeURIComponent(group.id)}`;
    if (group.primary) host.append(providerRow(group.primary, doc!.observedAtMs));
    else {
      // A provider with no window shows its usage and one sentence why, never a 0% meter.
      const label = el('div', 'digest-provider-label');
      label.append(el('strong', undefined, group.label));
      host.append(label, el('p', 'usage-note', report.allowanceUnavailable ?? group.note ?? ''));
    }
    host.append(...providerFacts(group, doc!.observedAtMs));
    if (group.other.length) {
      const other = el('details', `${ui.disclosure} digest-other-windows`);
      other.id = `${host.id}-other`;
      const summary = el(
        'summary',
        undefined,
        `Other ${group.label} windows seen this week (${group.other.length})`,
      );
      summary.id = `${other.id}-summary`;
      other.append(summary, ...group.other.map((view) => providerRow(view, doc!.observedAtMs)));
      host.append(other);
    }
    // The mark says the window's state, never which provider it is: ● current, ◐ stale, ○ none.
    const symbol = el(
      'span',
      'digest-provider-symbol',
      group.primary ? (group.primary.stale ? '◐' : '●') : '○',
    );
    symbol.setAttribute('aria-hidden', 'true');
    host.querySelector('.digest-provider-label')?.prepend(symbol);
    groups.append(host);
  }
  const controls = el('div', 'digest-carousel-controls');
  const count = el('span', 'digest-carousel-count');
  const previous = el('button', ui.action, '←');
  const next = el('button', ui.action, '→');
  // One card and its gap: a click moves by it, and the count reads the first card in view by it.
  const step = () =>
    (groups.firstElementChild?.getBoundingClientRect().width ?? groups.clientWidth) +
    (Number.parseFloat(getComputedStyle(groups).columnGap) || 0);
  for (const [button, name, direction] of [
    [previous, 'Previous provider', -1],
    [next, 'Next provider', 1],
  ] as const) {
    button.type = 'button';
    button.dataset.variant = 'secondary';
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-controls', groups.id);
    button.addEventListener('click', () => {
      groups.scrollBy({ left: direction * step(), behavior: 'smooth' });
    });
  }
  const sync = () => {
    const overflow = groups.scrollWidth > groups.clientWidth + 1;
    controls.hidden = !overflow;
    groups.tabIndex = overflow ? 0 : -1;
    previous.disabled = groups.scrollLeft <= 1;
    next.disabled = groups.scrollLeft + groups.clientWidth >= groups.scrollWidth - 1;
    const at = next.disabled ? providers.length : Math.round(groups.scrollLeft / step()) + 1;
    count.textContent = `${Math.min(at, providers.length)} of ${providers.length}`;
  };
  groups.addEventListener('scroll', sync);
  const observer = new ResizeObserver(sync);
  observer.observe(groups);
  state.dispose.push(() => {
    observer.disconnect();
    groups.removeEventListener('scroll', sync);
  });
  controls.append(count, previous, next);
  intro.append(controls);
  node.append(intro, groups);
  if (report.allowanceUnavailable) node.append(el('p', 'usage-note', report.allowanceUnavailable));
  else if (doc?.limits.some((limit) => !limit.provider))
    node.append(
      el(
        'p',
        'usage-note',
        'Some allowance windows have no reported provider. Upgrade TMT on your machine to identify them.',
      ),
    );
  return node;
}

/** Cost never decides membership or order: tokens are the primary evidence. */
function providerUsageCard(doc: UsageDocument): HTMLElement {
  const records = providerRecords(doc);
  if (!records)
    return card('digest-provider-usage', 'Provider usage', [
      el('p', 'usage-note', 'Provider usage is unavailable in this report.'),
    ]);
  const rest = doc.usage.providerUnattributed;
  const restTokens =
    rest && Number.isSafeInteger(rest.input + rest.output) && rest.input + rest.output > 0
      ? rest.input + rest.output
      : 0;
  const remainder = restTokens ? ` Driver unattributed: ${compactCount(restTokens)} tokens.` : '';
  if (!records.length)
    return card('digest-provider-usage', 'Provider usage', [
      el('p', 'usage-note', `No attributed provider usage was recorded in this range.${remainder}`),
    ]);
  const reasons: Record<string, string> = {
    driver_model_attribution_unknown: 'Driver and model shares cannot be matched.',
    model_attribution_unknown: 'Some input has no recorded model.',
    no_price: 'A recorded model has no list price.',
    unsafe_cost: 'The cost exceeds the supported number range.',
    pricing_unavailable: 'The pricing basis or version was not reported.',
    cost_evidence_invalid: 'The cost evidence could not be read.',
  };
  const rows = [...records].sort(
    (a, b) =>
      b.totals.input + b.totals.output - (a.totals.input + a.totals.output) ||
      a.driver.localeCompare(b.driver),
  );
  const estimateLabel = 'Input cost estimate (list price)';
  const grid = table(
    ['Provider', 'Input', 'Output', 'Cached input', estimateLabel, 'Coverage'],
    rows.map((row) => {
      const name = el('span', undefined, providerLabel(row.driver));
      name.title = row.driver;
      const cost = el(
        'span',
        row.inputCost ? ui.tableMono : undefined,
        row.inputCost ? usdText(row.inputCost.usdMicros) : 'Unavailable',
      );
      if (!row.inputCost)
        cost.append(
          el(
            'span',
            'usage-note',
            ` — ${row.costUnavailable.map((reason) => (Object.hasOwn(reasons, reason) ? reasons[reason] : reason)).join(' ')}`,
          ),
        );
      const coverage = row.partialSeats
        ? `Partial (${row.partialSeats} ${row.partialSeats === 1 ? 'seat' : 'seats'})`
        : 'Recorded';
      const compact = el('span', ui.tableCompactMeta);
      compact.append(`${estimateLabel}: `, cost.cloneNode(true), ` · ${coverage}`);
      name.append(compact);
      return [
        name,
        compactCount(row.totals.input),
        compactCount(row.totals.output),
        compactCount(row.totals.cached),
        cost,
        coverage,
      ];
    }),
  );
  const scroll = el('div', `${ui.tableScroll} digest-provider-usage-scroll`);
  grid.dataset.roomy = '';
  for (const row of grid.rows) {
    row.cells[4]!.dataset.compactHide = '';
    row.cells[5]!.dataset.compactHide = '';
  }
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Provider usage table');
  scroll.append(grid);
  const note = el(
    'p',
    'usage-note',
    `Input cost estimate (list price). Input only, treated as uncached; cached input is included once. Output is not priced. Pricing table: ${pricingVersion(doc.pricing) ?? 'unavailable'}. Incomplete records are lower bounds.`,
  );
  note.append(remainder);
  return card('digest-provider-usage', 'Provider usage', [scroll, note]);
}

function tokensCard(doc: UsageDocument, state: DigestViewState): HTMLElement {
  const data = tokenSeries(doc);
  const body = el('div', 'digest-token-grid tmt-ui-chart-seats');
  const chart = el('div', 'digest-token-chart');
  const rows = rankRows(doc);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  chart.append(
    el(
      'p',
      'digest-total-label',
      `Total${data.partial || doc.usage.unavailable.length > 0 || rows.some((row) => row.partial) ? ' (lower bound)' : ''} · ${doc.since}`,
    ),
    el('p', 'digest-total', rows.length ? compactCount(total) : '—'),
  );
  const host = el('div');
  const draw = () => {
    const layers = state.lines
      ? topLayers(data.layers, data.layers.length)
      : topLayers(data.layers, SERIES_KEPT);
    const series =
      state.lines && state.share
        ? layers.map((layer) => ({
            ...layer,
            values: layer.values.map((value, at) => {
              if (value === null) return null;
              const total = layers.reduce((sum, item) => sum + (item.values[at] ?? 0), 0);
              return total ? (value / total) * 100 : 0;
            }),
          }))
        : layers;
    host.setAttribute(
      'aria-labelledby',
      `digest-tokens-chart-${state.share ? 'share' : 'absolute'}`,
    );
    host.replaceChildren(
      createSeriesChart({
        title: `${state.share ? 'Share of tokens' : 'Tokens'} by seat${state.lines ? ' · Lines' : ''}`,
        kind: state.lines ? 'line' : state.share ? 'share' : 'stack',
        curve: 'monotone',
        x: data.x,
        series,
        ...(state.lines && state.share
          ? { max: 100, format: (value: number) => `${Math.round(value)}%` }
          : {}),
        empty: 'No token observations in this range.',
      }),
    );
    const plot = host.querySelector<HTMLElement>('.tmt-ui-chart-plot');
    if (plot) plot.id = 'digest-token-plot';
  };
  draw();
  chart.append(host);
  let legend = legendTable(doc, state);
  body.append(chart, legend);
  if (data.partial)
    chart.append(
      el('p', 'usage-note', 'Some buckets are incomplete: they are lower bounds, not errors.'),
    );
  if (doc.usage.unavailable.length)
    chart.append(el('p', 'usage-note', 'Unavailable seats are not included in this total.'));
  host.id = 'digest-tokens-chart';
  host.setAttribute('role', 'tabpanel');
  host.setAttribute('aria-label', 'Token usage scale');
  const control = tabChoice(
    'Scale',
    host.id,
    [
      { value: 'absolute', text: 'Absolute' },
      { value: 'share', text: 'Share' },
    ],
    state.share ? 'share' : 'absolute',
    (value) => {
      state.share = value === 'share';
      draw();
    },
  );
  const style = tabChoice(
    'Chart style',
    host.id,
    [
      { value: 'stacked', text: 'Stacked' },
      { value: 'lines', text: 'Lines' },
    ],
    state.lines ? 'lines' : 'stacked',
    (value) => {
      state.lines = value === 'lines';
      draw();
      const next = legendTable(doc, state);
      legend.replaceWith(next);
      legend = next;
    },
  );
  const controls = el('div', 'digest-chart-controls');
  controls.append(control, style);
  return card('digest-tokens', 'Token usage', [body], {
    actions: controls,
    subtitle: 'A shared view, seat by seat.',
  });
}

/** A seat's name on one line, the full name on hover, `*` after a partial one. */
function seatLabel(name: string, partial: boolean): HTMLElement {
  const node = el('span', 'digest-seat', name);
  node.title = partial ? `${name} (partial)` : name;
  if (partial) node.append(el('span', 'digest-partial', '*'));
  return node;
}

/** The seats the token chart draws as hues, with their step; the rest share the neutral one. */
function seatHues(doc: UsageDocument, lines: boolean): Map<string, number> {
  const layers = tokenSeries(doc).layers;
  return new Map(
    topLayers(layers, lines ? layers.length : SERIES_KEPT)
      .filter((layer) => layer.key !== 'other')
      .map((layer, at) => [layer.key, at % 7]),
  );
}

/** One share as a labelled meter: the name and its percent over a bar, and a detail line. */
function shareMeter(
  name: string | HTMLElement,
  share: number,
  style: number,
  detail?: string,
): HTMLElement {
  const row = el('div', 'digest-share');
  const head = el('div', 'digest-share-head');
  const label = typeof name === 'string' ? el('span', 'digest-share-name', name) : name;
  head.append(label, el('span', 'digest-share-value', `${share}%`));
  const meter = el('div', ui.meter);
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', `${label.textContent}: ${share}% of tokens`);
  const fill = el('div', `${ui.meterFill} tmt-ui-chart-s${style}`);
  fill.style.setProperty('--tmt-ui-meter-fill', String(Math.max(0, Math.min(100, share))));
  meter.append(fill);
  row.append(head, meter);
  if (detail) row.append(el('p', 'usage-note digest-share-detail', detail));
  return row;
}

const shareSum = (rows: readonly { share: number }[]) =>
  Math.round(rows.reduce((sum, row) => sum + row.share, 0) * 10) / 10;

/** A seat's model mix in one line: its two largest models, then the rest and what no model covers. */
function mixText(seat: SeatMix): string | undefined {
  const parts = seat.models.slice(0, 2).map((model) => `${model.model} ${model.share}%`);
  const rest = shareSum(seat.models.slice(2));
  if (rest > 0) parts.push(`other ${rest}%`);
  if (seat.unattributed > 0) parts.push(`no model ${seat.unattributed}%`);
  return parts.length ? parts.join(' · ') : undefined;
}

/** #6751 C: token and cost shares by model, token share by seat, and the cached-input ratio. */
function sharesCard(doc: UsageDocument): HTMLElement {
  const id = 'digest-shares';
  const title = 'Usage share';
  const subtitle = 'Tokens by model and by seat. Cost estimates use standard list prices.';
  const seats = seatMix(doc).filter((seat) => seat.tokens > 0);
  if (!seats.length)
    return card(id, title, [el('p', 'usage-note', 'No token observations in this range.')], {
      subtitle,
    });
  const shares = modelShares(doc);
  const byModel = el('div', 'digest-share-group');
  byModel.id = 'digest-shares-models';
  byModel.append(el('h3', 'digest-share-title', 'By model'));
  const costs = modelCostShares(doc, shares.models);
  const modelMeter = (model: (typeof shares.models)[number], tone: number) => {
    const row = costs.rows.get(model.model);
    const cost = row?.cost ? costEstimate(row.cost) : 'No price';
    const percent = row?.share == null ? '' : ` · ${row.share}% of priced cost`;
    return shareMeter(
      model.model,
      model.share,
      tone,
      `${model.tokens.toLocaleString('en-US')} tokens · ${cost}${percent}`,
    );
  };
  shares.models
    .slice(0, MODELS_KEPT)
    .forEach((model, at) => byModel.append(modelMeter(model, at % 7)));
  const restModels = shares.models.slice(MODELS_KEPT);
  if (restModels.length) {
    const rest = el('details');
    const count = restModels.length;
    rest.append(
      el(
        'summary',
        undefined,
        `Other (${count} ${count === 1 ? 'model' : 'models'}): ${shareSum(restModels)}% of tokens`,
      ),
      ...restModels.map((model) => modelMeter(model, OTHER_STEP)),
    );
    byModel.append(rest);
  }
  if (shares.unattributed)
    byModel.append(
      shareMeter(
        'No model recorded',
        shares.unattributed.share,
        OTHER_STEP,
        shares.models.length
          ? `Core recorded no model for part of ${shares.unattributed.seats} ${shares.unattributed.seats === 1 ? "seat's" : "seats'"} tokens.`
          : 'Core recorded no model for these tokens.',
      ),
    );
  byModel.append(
    bareTiles(
      tile('Cached input', shares.cachedRatio === null ? '—' : `${shares.cachedRatio}% of input`, {
        tone: 'info',
        numeric: false,
      }),
    ),
  );
  // The seats palette, as the token chart and its legend draw seats.
  const bySeat = el('div', 'digest-share-group tmt-ui-chart-seats');
  bySeat.id = 'digest-shares-seats';
  bySeat.append(el('h3', 'digest-share-title', 'By seat'));
  // A seat keeps the hue the token chart draws it in; the folded rest is neutral.
  const hue = seatHues(doc, false);
  for (const seat of seats.slice(0, SERIES_KEPT))
    bySeat.append(
      shareMeter(
        seatLabel(seat.name, seat.partial),
        seat.share,
        hue.get(seat.id) ?? OTHER_STEP,
        [`${seat.tokens.toLocaleString('en-US')} tokens`, mixText(seat)]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  const restSeats = seats.slice(SERIES_KEPT);
  if (restSeats.length)
    bySeat.append(shareMeter(`Other (${restSeats.length} seats)`, shareSum(restSeats), OTHER_STEP));
  bySeat.append(el('p', 'usage-note', 'Per-seat cost needs seat-level quotes in the report.'));
  const groups = el('div', 'digest-share-groups');
  groups.append(byModel, bySeat);
  const notes: HTMLElement[] = [];
  if (seats.some((seat) => seat.partial))
    notes.push(el('p', 'usage-note', '* Partial: some of this range has no data for the seat.'));
  if (doc.usage.unavailable.length)
    notes.push(el('p', 'usage-note', 'Unavailable seats are not included in these shares.'));
  const excluded = [
    ...costs.excluded,
    ...(shares.unattributed ? ['tokens with no recorded model'] : []),
  ];
  const costNotes = [
    costs.hasDenominator
      ? 'Cost shares use only priced models.'
      : 'Cost shares are unavailable without a positive priced total.',
    excluded.length ? `Excluded: ${excluded.join(', ')}.` : '',
    costs.hasFloors ? 'Cost shares include lower-bound estimates.' : '',
  ];
  notes.push(el('p', 'usage-note digest-share-cost', costNotes.filter(Boolean).join(' ')));
  return card(id, title, [groups, ...notes], { subtitle });
}

/** #6751 E: every seat together per bucket; a bucket no seat read stays blank, never 0. */
function trendCard(doc: UsageDocument): HTMLElement {
  const id = 'digest-trend';
  const title = 'Trend';
  const hourly = doc.since === '24h';
  const unit = hourly ? 'hour' : 'day';
  const subtitle = `Every seat together, ${unit} by ${unit}.`;
  const data = trend(doc);
  if (!data.tokens.some((value) => value !== null))
    return card(id, title, [el('p', 'usage-note', 'No token observations in this range.')], {
      subtitle,
    });
  const host = el('div', 'digest-trend-chart');
  host.append(
    createSeriesChart({
      title: hourly ? 'Tokens per hour' : 'Tokens per day',
      kind: 'bars',
      x: data.x,
      series: [{ key: 'tokens', label: 'tokens', values: data.tokens }],
      empty: 'No token observations in this range.',
    }),
  );
  const unread = data.tokens.filter((value) => value === null).length;
  const read = data.tokens.filter((value): value is number => value !== null);
  const body: Node[] = [
    host,
    bareTiles(
      tile(
        `Busiest ${unit}`,
        data.peak ? `${compactCount(data.peak.tokens)} at ${data.peak.at}` : '—',
        { numeric: false },
      ),
      tile(
        `Average ${unit}`,
        compactCount(Math.round(read.reduce((sum, value) => sum + value, 0) / read.length)),
        { numeric: false },
      ),
      // Only when some bucket has no reading: "0 hours" says nothing.
      ...(unread
        ? [
            tile('No data', `${unread} ${unread === 1 ? unit : `${unit}s`}`, {
              tone: 'muted',
              numeric: false,
            }),
          ]
        : []),
    ),
  ];
  if (unread)
    body.push(
      el(
        'p',
        'usage-note',
        `No seat has a reading for ${unread} ${unread === 1 ? unit : `${unit}s`} of this range: ${unread === 1 ? 'it is' : 'they are'} left blank, never counted as zero.`,
      ),
    );
  if (data.partial.some(Boolean))
    body.push(el('p', 'usage-note', 'Some buckets are incomplete: they are lower bounds.'));
  if (doc.usage.unavailable.length)
    body.push(el('p', 'usage-note', 'Unavailable seats are not included in this trend.'));
  return card(id, title, body, { subtitle });
}

function legendTable(doc: UsageDocument, state: DigestViewState): HTMLElement {
  const ranked = rankRows(doc);
  const rows = [...ranked].sort(
    (a, b) =>
      (state.order === 'usage' ? b.tokens - a.tokens : 0) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  const view = ranking(ranked, SERIES_KEPT);
  const hue = seatHues(doc, state.lines);
  function legendSeat(id: string, name: string, partial: boolean): HTMLElement {
    const label = el('span', 'digest-legend-seat');
    const dot = el('span', `tmt-ui-status-tile-dot tmt-ui-chart-s${hue.get(id) ?? OTHER_STEP}`);
    dot.setAttribute('aria-hidden', 'true');
    label.append(dot, seatLabel(name, partial));
    return label;
  }
  const host = el('div', 'digest-ranking-table');
  host.id = 'digest-ranking-rows';
  const draw = (all: boolean) => {
    const listed =
      all || state.lines ? rows : rows.filter((row) => view.top.some((top) => top.id === row.id));
    const lines: (string | Node)[][] = listed.map((entry) => [
      legendSeat(entry.id, entry.name, entry.partial),

      compactCount(entry.tokens),
      `${entry.share}%`,
    ]);
    if (!all && !state.lines && view.other)
      lines.push([
        legendSeat('other', `Other (${view.other.seats} seats)`, false),
        compactCount(view.other.tokens),
        `${view.other.share}%`,
      ]);
    host.replaceChildren(table(['Seat', 'Tokens', 'Share'], lines));
  };
  draw(state.allSeats);
  const body: Node[] = [host];
  if (view.partial)
    body.push(el('p', 'usage-note', '* Partial: some of this range has no data for the seat.'));
  if (view.other && !state.lines) {
    const toggle = el('button', ui.action);
    toggle.dataset.variant = 'text';
    toggle.type = 'button';
    toggle.id = 'digest-ranking-toggle';
    toggle.setAttribute('aria-controls', host.id);
    const sync = (all: boolean) => {
      toggle.setAttribute('aria-expanded', String(all));
      toggle.textContent = all ? `Show top ${view.top.length}` : `Show all ${rows.length} seats`;
    };
    sync(state.allSeats);
    toggle.addEventListener('click', () => {
      const all = toggle.getAttribute('aria-expanded') !== 'true';
      state.allSeats = all;
      draw(all);
      sync(all);
    });
    body.push(toggle);
  }
  const legend = el('div', 'digest-legend');
  legend.id = 'digest-ranking';
  legend.append(...body);
  return legend;
}

/** This one caller owns its count heatmap; report aggregation remains in exchange(). */
function exchangeCard(doc: UsageDocument, state: DigestViewState): HTMLElement {
  const flow = exchange(doc);
  if (!flow)
    return card('digest-exchange', 'Messages between seats', [
      el('p', 'usage-note', 'Message traffic is not available in this read.'),
    ]);
  const totals = new Map(rankRows(doc).map((seat) => [seat.id, seat.tokens]));
  const seats = [...flow.participants].sort(
    (a, b) =>
      (state.order === 'usage' ? (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) : 0) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  const maximum = Math.max(
    0,
    ...seats.flatMap((from) =>
      seats.map((to) => (from.id === to.id ? 0 : (flow.value(from.id, to.id) ?? 0))),
    ),
  );
  const matrix = el('table', 'digest-messages');
  matrix.style.setProperty('--digest-message-columns', String(seats.length + 1));
  if (seats.length > 6) matrix.dataset.large = '';
  const caption = el('caption', 'digest-visually-hidden', `Messages, last ${doc.since}`);
  const header = el('tr');
  const corner = el('th', undefined, 'From →');
  corner.scope = 'col';
  header.append(corner);
  for (const seat of seats) {
    const cell = el('th');
    cell.scope = 'col';
    cell.dataset.seatId = seat.id;
    cell.append(messageName(seat.label));
    header.append(cell);
  }
  const head = el('thead');
  head.append(header);
  const body = el('tbody');
  for (const from of seats) {
    const row = el('tr');
    const label = el('th');
    label.scope = 'row';
    label.dataset.seatId = from.id;
    label.append(messageName(from.label));
    row.append(label);
    for (const to of seats) {
      const self = from.id === to.id;
      const count = self ? null : flow.value(from.id, to.id);
      const cell = el('td', undefined, count === null ? '—' : compactCount(count));
      cell.dataset.from = from.id;
      cell.dataset.to = to.id;
      if (self) cell.dataset.self = '';
      else if (count === null) cell.dataset.missing = '';
      else if (count > 0)
        cell.dataset.level = String(Math.min(4, Math.ceil((count / maximum) * 4)));
      const text = self ? 'same seat' : count === null ? 'not observed' : `${count} messages`;
      cell.setAttribute('aria-label', `${from.label} to ${to.label}: ${text}`);
      cell.title = `${from.label} to ${to.label}: ${text}`;
      row.append(cell);
    }
    body.append(row);
  }
  matrix.append(caption, head, body);
  const viewport = el('div', 'digest-messages-viewport');
  const scroll = el('div', 'digest-messages-scroll');
  scroll.id = 'digest-exchange-scroll';
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', `Messages, last ${doc.since}`);
  scroll.append(matrix);
  const edge = el('span', 'digest-messages-edge');
  edge.setAttribute('aria-hidden', 'true');
  const sync = () => {
    const overflow = scroll.scrollWidth > scroll.clientWidth + 1;
    scroll.tabIndex = overflow ? 0 : -1;
    edge.hidden = !overflow || scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 1;
  };
  scroll.addEventListener('scroll', sync);
  const observer = new ResizeObserver(sync);
  observer.observe(scroll);
  state.dispose.push(() => {
    observer.disconnect();
    scroll.removeEventListener('scroll', sync);
  });
  viewport.append(scroll, edge);
  return card('digest-exchange', 'Messages between seats', [
    el('p', 'digest-subtitle', `Talk and reply messages · ${doc.since}`),
    viewport,
  ]);
}

function messageName(text: string): HTMLElement {
  const label = el('span', 'digest-message-name', text);
  label.title = text;
  return label;
}

/** #6751 D: what the delivered digests saved over the selected range, measured first. */
function savingsCard(report: DigestReport): HTMLElement | undefined {
  const savings = report.savings;
  if (!savings) return undefined;
  const id = 'digest-savings';
  const title = 'What Digest saved';
  const subtitle = 'Wake-ups the delivered digests saved in this range.';
  if (!savings.document) {
    const why = el('p', 'usage-note');
    notAvailable(why, savings.unavailable ?? 'What Digest saved is not available.');
    return card(id, title, [why], { subtitle });
  }
  const view = savingsView(savings.document);
  const body: Node[] = [];
  if (view.coverageNote)
    body.push(el('p', 'usage-note digest-savings-coverage', view.coverageNote));
  const tiles = view.tiles.map((figure) => tile(figure.label, figure.value));
  // Whose saved wake-ups the cost covers, or why it is unknown, sits in the cost's own tile.
  if (view.costNote) tiles.at(-1)!.append(el('dd', 'usage-note digest-cost-note', view.costNote));
  body.push(bareTiles(...tiles));
  if (!view.rows.length)
    body.push(el('p', 'usage-note', 'No member held messages for a digest in this range.'));
  else {
    const grid = table(
      [
        'Member',
        'Messages',
        'Deliveries',
        'Saved (measured)',
        'Upper bound',
        'Median delay',
        'Coverage',
      ],
      view.rows.map(([name, messages, deliveries, measured, bound, delay, covered]) => {
        // The report's name as text, never markup, cut like a seat name with the whole in its
        // title; at phone width the compact line carries the dropped columns.
        const label = el('span');
        const member = el('span', 'digest-seat', name);
        member.title = name!;
        label.append(
          member,
          el(
            'span',
            ui.tableCompactMeta,
            `${messages} messages in ${deliveries} deliveries · Upper bound ${bound} · Median ${delay} · ${covered}`,
          ),
        );
        return [label, messages!, deliveries!, measured!, bound!, delay!, covered!];
      }),
    );
    grid.dataset.roomy = '';
    for (const row of grid.rows)
      // Phone width keeps the name and the measured saving, which large figures still fit beside.
      for (const cell of [1, 2, 4, 5, 6]) row.cells[cell]!.dataset.compactHide = '';
    const scroll = el('div', `${ui.tableScroll} digest-savings-scroll`);
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'What Digest saved, by member');
    scroll.append(grid);
    body.push(scroll);
  }
  body.push(
    el(
      'p',
      'usage-note',
      `Measured counts only messages that arrived while their member was idle; the upper bound counts every held message as its own wake-up. Unknown is never counted as zero.${view.pricing ? ` ${view.pricing}` : ''}`,
    ),
  );
  return card(id, title, body, { subtitle });
}

/** The sources the usage read does not carry yet, one line each, with the method below. */
function coverageCard(): HTMLElement {
  const gaps: [string, string][] = [
    [
      'Throughput',
      'merged pull requests per provider and publishes in flight (GitHub, from the PR Agent lines)',
    ],
    [
      'Gates and queue',
      'green-not-armed and review waits, merge-queue entries and merge-group failures (GitHub)',
    ],
    [
      'Cost per merged PR',
      'merged pull requests joined to the allowance points burned in the same window',
    ],
    ['Machine', 'load, free disk and the biggest worktrees with their owners'],
  ];
  const list = el('dl', 'digest-gaps');
  for (const [term, source] of gaps) {
    const line = el('div', 'digest-gap');
    const status = el('dd');
    status.append(el('span', 'digest-subtitle', 'Not connected'));
    const name = el('dt', undefined, term === 'Machine' ? 'Machine load' : term);
    const marker = el('span', 'digest-coverage-marker');
    marker.setAttribute('aria-hidden', 'true');
    name.prepend(marker);
    line.append(name, status);
    line.title = source;
    list.append(line);
  }
  const method = el('details', ui.disclosure);
  method.id = 'digest-method';
  const summary = el('summary', undefined, 'Method & caveats');
  summary.id = 'digest-method-summary';
  method.append(
    summary,
    ...[
      'Tokens are input plus output as Core reports them; cached input is part of input and is not counted again.',
      'An incomplete bucket is a lower bound. A seat with no evidence for part of the range is marked partial, never shown as zero.',
      'Allowance windows are the account percent as the provider reports it, in whole percent; usage on other machines is not seen.',
      'Message counts include talk and reply only.',
    ].map((text) => el('p', 'usage-note', text)),
  );
  const command = el('div', 'digest-method-command');
  command.append(
    el('span', undefined, 'Current data on your machine:'),
    el('code', undefined, 'tmt digest usage report'),
  );
  method.append(command);
  return card('digest-missing', 'Data coverage', [list, method]);
}

/** What a report shows, without the read's own clock: a refresh that changed nothing repaints nothing. */
function fingerprint(report: DigestReport): string {
  return JSON.stringify({
    ...report,
    document: report.document && { ...report.document, observedAtMs: 0 },
    allowance: report.allowance && {
      ...report.allowance,
      observedAtMs: 0,
      limits: report.allowance.limits.filter(
        (limit) => limit.resetsAtMs > report.allowance!.observedAtMs,
      ),
    },
  });
}

export function digestPage(
  source: DigestSource = createDigestSource(),
  signal?: AbortSignal,
): void {
  const tabs = document.getElementById('usage-ranges');
  const panel = document.getElementById('digest-sections');
  const note = document.getElementById('usage-note');
  const badge = document.getElementById('usage-badge');
  if (!tabs || !panel || !note || !badge) return;
  const badgeLabel = badge.querySelector<HTMLElement>(`.${ui.chipLabel}`)!;
  let current: UsageRange = USAGE_RANGES[0];
  let generation = 0;
  let shown = '';
  // The last good report on screen, for the range being shown.
  let good: DigestReport | undefined;
  // The token chart's Absolute/Share choice survives a refresh.
  const state: DigestViewState = {
    share: false,
    allSeats: false,
    lines: false,
    order: readSeatOrder(),
    dispose: [],
  };
  signal?.addEventListener(
    'abort',
    () => {
      state.dispose.splice(0).forEach((dispose) => dispose());
    },
    { once: true },
  );
  const sort = el('div', 'digest-seat-order');
  const renderSort = () => {
    sort.replaceChildren(
      el('span', 'digest-sort-label', 'Seat order'),
      tabChoice(
        'Seat order',
        'usage-panel',
        [
          { value: 'usage', text: 'Usage' },
          { value: 'name', text: 'Name' },
        ],
        state.order,
        (value) => {
          state.order = value;
          writeSeatOrder(value);
          if (good?.range === current) paint(good, false);
          renderSort();
          document.getElementById(`usage-panel-${state.order}`)?.focus({ preventScroll: true });
        },
      ),
    );
  };
  renderSort();
  tabs.closest('.digest-controls')?.append(sort);
  const disclosures = new Map<string, boolean>();
  let matrixLeft = 0;
  let providerLeft = 0;
  function rememberView() {
    for (const detail of panel!.querySelectorAll('details[id]'))
      disclosures.set(detail.id, detail.hasAttribute('open'));
    matrixLeft = document.getElementById('digest-exchange-scroll')?.scrollLeft ?? matrixLeft;
    providerLeft = document.getElementById('digest-provider-groups')?.scrollLeft ?? providerLeft;
  }
  const buttons = USAGE_RANGES.map((range) => {
    const button = el('button', ui.tab, range);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'usage-panel');
    button.dataset.range = range;
    button.addEventListener('click', () => void show(range));
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = USAGE_RANGES.indexOf(current) + step;
      const range = USAGE_RANGES[(next + USAGE_RANGES.length) % USAGE_RANGES.length]!;
      void show(range);
      buttons[USAGE_RANGES.indexOf(range)]!.focus();
    });
    return button;
  });
  tabs.replaceChildren(...buttons);
  function paint(report: DigestReport, updateNotice = true) {
    rememberView();
    const focusId = panel!.contains(document.activeElement)
      ? document.activeElement?.id
      : undefined;
    shown = fingerprint(report);
    good = undefined;
    badge!.hidden = true;
    badgeLabel.textContent = '';
    if (report.unavailable || !report.document) {
      state.dispose.splice(0).forEach((dispose) => dispose());
      panel!.replaceChildren();
      return notAvailable(note!, report.unavailable ?? 'Usage is not available.');
    }
    good = report;
    const doc = report.document;
    state.dispose.splice(0).forEach((dispose) => dispose());
    const covered = coverageNotice(doc);
    const saved = savingsCard(report);
    panel!.replaceChildren(
      ...(covered ? [covered] : []),
      allowanceRow(report, state),
      providerUsageCard(doc),
      tokensCard(doc, state),
      sharesCard(doc),
      trendCard(doc),
      exchangeCard(doc, state),
      ...(saved ? [saved] : []),
      coverageCard(),
    );
    for (const detail of panel!.querySelectorAll<HTMLDetailsElement>('details[id]'))
      detail.open = disclosures.get(detail.id) ?? false;
    const scroll = document.getElementById('digest-exchange-scroll');
    if (scroll) scroll.scrollLeft = matrixLeft;
    const providers = document.getElementById('digest-provider-groups');
    if (providers) providers.scrollLeft = providerLeft;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    if (report.sample) badgeLabel.textContent = 'Sample data';
    badge!.hidden = !report.sample;
    if (updateNotice) ordinaryNote(report);
  }
  /** The note a good report carries: the sample's preview line, else nothing. */
  function ordinaryNote(report: DigestReport) {
    if (report.sample) {
      notAvailable(note!, 'Usage preview. Real numbers: `tmt digest usage report`.');
    } else {
      note!.replaceChildren();
      note!.hidden = true;
    }
  }
  /**
   * A refresh that could not read keeps the last good report on screen and says why in a small
   * note; only a first read with nothing to show empties the panel. The next good read clears it.
   */
  function refreshed(report: DigestReport) {
    if (report.unavailable || !report.document) {
      if (!good?.document) return paint(report);
      const at = new Date(good.document.observedAtMs).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return notAvailable(
        note!,
        `${report.unavailable ?? 'Usage is not available.'} Showing the last report, read at ${at}.`,
      );
    }
    if (fingerprint(report) !== shown) return paint(report);
    // The same report as before: nothing to repaint, only a stale note to clear.
    for (const observation of panel!.querySelectorAll<HTMLElement>('.digest-window-observation'))
      observation.textContent = `Observed ${observedAgo(Number(observation.dataset.observedAt), report.allowance!.observedAtMs)}`;
    ordinaryNote(report);
  }
  async function show(range: UsageRange) {
    current = range;
    const mine = ++generation;
    for (const button of buttons) {
      const selected = button.dataset.range === range;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    rememberView();
    state.dispose.splice(0).forEach((dispose) => dispose());
    panel!.replaceChildren(pageLoading());
    const report = await source.report(range, signal);
    if (mine !== generation || signal?.aborted) return;
    paint(report);
  }
  void show(current);
  // Refresh at the terminal Digest's cadence while mounted and visible. The initial read
  // above already covers the first visible tick; unchanged reports keep the existing DOM.
  let first = true;
  if (signal)
    whileVisible(REFRESH_MS, signal, async () => {
      if (first) {
        first = false;
        return true;
      }
      const range = current;
      const mine = generation;
      const report = await source.report(range, signal, true);
      if (signal.aborted || range !== current || mine !== generation) return true;
      refreshed(report);
      return !report.unavailable;
    });
}

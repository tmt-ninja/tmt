import '@tmt/browser-ui/work.css';
import './work-home.css';
import { BrowserAvatar } from '@tmt/browser-ui/react';
import { Popover, PopoverContent, PopoverTrigger, UiTheme } from '@tmt/browser-ui/ui';
import { getTheme, subscribeTheme } from './theme.js';
import { getRouteApi, Link, useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppHeader } from './app-header.js';
import { useHomeSpace, useSpaceTitle } from './home-space.js';
import { NewPageDialog } from './new-page-dialog.js';
import { text } from './strings.js';
import type { PageTransport } from './transport.js';
import type { WorkFactView } from './reading-details.js';
import { StatusDetailsBody } from './work-band-live.js';
import {
  activityOwners,
  doneChart,
  HIDDEN_WHEN_ZERO,
  inProject,
  OVERVIEW,
  overview,
  overviewStatus,
  projectSections,
  recentlyDone,
  type OverviewStatus,
  type Period,
  type WorkItem,
  type WorkSearch,
  workItems,
} from './work-home-model.js';

/** Set on a Work home entry whose URL is its whole view (#6612). */
type WorkEntry = { workView?: true };

const rootRoute = getRouteApi('__root__');
const workRoute = getRouteApi('/work');
const t = text.workHome;
const PROJECT_KEY = 'tmt-colab-work-project';
const SHOWN = 5;

/** A short age, as the spec's rows write it: `3 min`, `2 h`, `1 day`. */
function age(at: number | undefined, now: number): string {
  if (at === undefined) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
const dayLabel = (at: number) => new Date(at).toLocaleDateString('en', { weekday: 'short' });
const dateLabel = (at: number) =>
  new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric' });
const doneLabel = (at: number, now: number) => {
  const time = new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? `Today ${time}`
    : `${dateLabel(at)} ${time}`;
};

/** The project this browser remembers; the URL's choice comes first (#6612). */
function storedProject(): string | undefined {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
function storeProject(project: string | undefined) {
  try {
    if (project === undefined) localStorage.removeItem(PROJECT_KEY);
    else localStorage.setItem(PROJECT_KEY, project);
  } catch {
    // A browser without storage keeps the choice in the URL only.
  }
}

/**
 * The owners' activity (decision on #6474, option a): one bounded batch on events that already
 * happen (opening, the tab becoming visible, a list re-read), never a timer. The list answer
 * never waits for it: when what it observed changed, the list is read again and its rows show it.
 */
function useOwnerActivity(
  transport: PageTransport,
  items: readonly WorkItem[],
  listed: unknown,
  reread: () => void,
) {
  const owners = activityOwners(items).join('\n');
  const seen = useRef<string>(undefined);
  // The list re-read this hook asks for must not ask again: only opening, the tab becoming visible
  // and a list re-read from elsewhere read activity (#6578 review).
  const own = useRef(false);
  useEffect(() => {
    const read = transport.workActivity;
    if (!read || !owners) return;
    const controller = new AbortController();
    const run = () =>
      void read(owners.split('\n'), controller.signal).then(
        (answer) => {
          // Only a changed state can change a list status; a working agent's newer activity time
          // alone is no reason to read the list again.
          const observed = JSON.stringify(
            Object.entries(answer)
              .map(([owner, row]) => [owner, row.state])
              .sort(),
          );
          if (observed === seen.current) return;
          seen.current = observed;
          own.current = true;
          reread();
        },
        () => undefined,
      );
    if (own.current) own.current = false;
    else run();
    document.addEventListener(
      'visibilitychange',
      () => document.visibilityState === 'visible' && run(),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [transport, owners, listed, reread]);
}

/** The part's state for an overview status: waiting for CI and for release share one tone. */
const partState = (status: OverviewStatus) => (status === 'waiting' ? 'waiting-ci' : status);

function Dot({ status }: { status: string }) {
  return <span className="tmt-ui-work-dot" data-state={status} aria-hidden="true" />;
}

function Ratio({ counts }: { counts: Partial<Record<OverviewStatus, number>> }) {
  const parts = OVERVIEW.filter((status) => (counts[status] ?? 0) > 0);
  if (!parts.length) return null;
  return (
    <div
      className="tmt-ui-work-ratio"
      role="img"
      aria-label={t.ratio(
        parts.map((status) => `${counts[status]} ${t.status[status]}`).join(', '),
      )}
    >
      {parts.map((status) => (
        <span key={status} data-state={partState(status)} style={{ flexGrow: counts[status] }} />
      ))}
    </div>
  );
}

/** The list status as the page's computed state: "not checked yet" reads as unknown there. */
const factState = (status: WorkItem['status']): WorkFactView['state'] =>
  status === 'unchecked' ? 'unknown' : status;

/**
 * A row's status dot opens its details (spec 工作頁細節 › 操作): a page's work facts, read once when
 * opened by its owner; a to-do's details are its list status only.
 */
function RowStatus({ item, transport }: { item: WorkItem; transport: PageTransport }) {
  const [facts, setFacts] = useState<WorkFactView | 'reading' | 'failed'>();
  const reading = useRef<AbortController>(undefined);
  useEffect(() => () => reading.current?.abort(), []);
  const open = (next: boolean) => {
    if (!next || item.blockId || !transport.workFacts || facts === 'reading') return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setFacts('reading');
    transport.workFacts(item.pageId, controller.signal).then(setFacts, () => {
      if (!controller.signal.aborted) setFacts('failed');
    });
  };
  const view = typeof facts === 'object' ? facts : undefined;
  const state = view?.state ?? factState(item.status);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as const);
  return (
    <UiTheme theme={theme}>
      <Popover onOpenChange={open}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="work-home-row-status"
            aria-label={t.statusDetails(item.number ?? item.title)}
          >
            <Dot status={item.status} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="work-status-details">
          {facts === 'reading' ? (
            <p>{t.statusReading}</p>
          ) : (
            <StatusDetailsBody
              state={state}
              {...(view ? { facts: view } : {})}
              {...(item.status === 'blocked' && item.next ? { blocked: item.next } : {})}
            />
          )}
        </PopoverContent>
      </Popover>
    </UiTheme>
  );
}

const IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The owner opens the conversation with that agent in Ops (spec 工作頁細節 › 操作). The link names
 * the member only; Ops finds the member's squad on the board it reads, or says the member is
 * unknown. An owner without an identity (a to-do's assignee name) is not a link.
 */
function OwnerCell({ owner }: { owner: NonNullable<WorkItem['owner']> }) {
  const content = (
    <>
      <BrowserAvatar name={owner.name} kind="agent" size="s" decorative />
      <span>{owner.name}</span>
    </>
  );
  return owner.id && IDENTITY.test(owner.id) ? (
    <a
      className="tmt-ui-work-owner work-home-owner-link"
      href={`/ops/#dm/${owner.id}`}
      aria-label={t.talkTo(owner.name)}
    >
      {content}
    </a>
  ) : (
    <span className="tmt-ui-work-owner">{content}</span>
  );
}

function WorkRow({
  item,
  now,
  transport,
}: {
  item: WorkItem;
  now: number;
  transport: PageTransport;
}) {
  // The title's link covers the row (work-home.css), so the status and owner controls sit beside
  // it rather than inside a link.
  return (
    <div className="tmt-ui-work-row work-home-row">
      <RowStatus item={item} transport={transport} />
      <span className="tmt-ui-work-number">{item.number ?? ''}</span>
      <span className="tmt-ui-work-title">
        {item.high ? <span className="tmt-ui-work-priority">High</span> : null}
        <Link
          className="work-home-row-link"
          to="/pages/$pageId"
          params={{ pageId: item.pageId }}
          {...(item.blockId ? { hash: `block-${item.blockId}` } : {})}
        >
          {item.title}
        </Link>
      </span>
      <span className="tmt-ui-work-next">
        {item.status === 'blocked' && item.next ? `Blocked: ${item.next}` : (item.next ?? '')}
      </span>
      {item.owner ? <OwnerCell owner={item.owner} /> : null}
      <span className="tmt-ui-work-time">{age(item.lastMs, now)}</span>
    </div>
  );
}

/** Work home (#6474): what is open now, what got done, each project's work, and what finished. */
export function WorkHome() {
  const space = workRoute.useLoaderData();
  const { transport } = rootRoute.useRouteContext();
  const router = useRouter();
  const { pages } = useHomeSpace(space);
  const now = space.readAt;
  // The view is the URL (#6612): each change is a history entry, so Back and Forward restore it.
  const search = workRoute.useSearch();
  const navigate = workRoute.useNavigate();
  const entry = useLocation({ select: (location) => (location.state as WorkEntry).workView });
  const go = (patch: Partial<WorkSearch>, replace = false) => {
    const same = (Object.keys(patch) as (keyof WorkSearch)[]).every(
      (key) => JSON.stringify(patch[key]) === JSON.stringify(search[key]),
    );
    if (same && (!replace || entry)) return;
    void navigate({
      search: (previous) => ({ ...previous, ...patch }),
      state: (previous) => ({ ...previous, workView: true }) as typeof previous,
      replace,
      resetScroll: false,
    });
  };
  // The remembered project applies only to an entry whose URL names none and that no choice here
  // made: an entry reached by Back after choosing All stays All.
  const remembered = !entry && search.project === undefined ? storedProject() : undefined;
  useEffect(() => {
    if (!entry) go({ project: search.project ?? remembered }, true);
    // Initialize the entry on mount. Leaving Work home also changes the location state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const project = search.project ?? remembered;
  const period: Period = search.period ?? 'week';
  const only = search.status;
  const expanded = new Set(search.more);
  const [newPage, setNewPage] = useState(false);
  useSpaceTitle(t.title, 'Colab');
  const all = useMemo(() => workItems(pages), [pages]);
  const reread = useMemo(() => () => void router.invalidate(), [router]);
  useOwnerActivity(transport, all, space.pages, reread);
  const projectNames = useMemo(() => {
    const names = [...(space.projects ?? [])];
    for (const item of all)
      for (const name of item.projects) if (!names.includes(name)) names.push(name);
    return names;
  }, [space.projects, all]);
  // A remembered project that no page names any more falls back to every project.
  const scope = project !== undefined && projectNames.includes(project) ? project : undefined;
  const items = all.filter((item) => inProject(item, scope));
  const now7 = overview(items);
  const week = doneChart(items, 'week', now);
  const chart = doneChart(items, period, now);
  const sections = projectSections(items, scope === undefined ? projectNames : [scope], now).filter(
    (section) => scope === undefined || section.name === scope,
  );
  // A day from another period or an older reading names no cell: the whole recent list.
  const cell =
    search.day === undefined ? -1 : chart.cells.findIndex((entry) => entry.from === search.day);
  const chosen = cell < 0 ? undefined : chart.cells[cell];
  const recent = recentlyDone(items, 10, chosen);
  const doneToday = doneChart(items, 'today', now).total;
  const openIn = (name: string | undefined) =>
    all.filter((item) => item.status !== 'done' && inProject(item, name)).length;
  const cellLabel = (index: number) =>
    period === 'today'
      ? `${new Date(chart.cells[index].from).getHours()}:00`
      : chart.cells[index].current
        ? t.today
        : period === 'week'
          ? dayLabel(chart.cells[index].from)
          : dateLabel(chart.cells[index].from);
  const busiest = Math.max(1, ...chart.cells.map((entry) => entry.count));

  if (!all.length)
    return (
      <section className="work-home tmt-ui-page" data-work-home>
        <AppHeader title={t.title} remote={{ deviceName: transport.backendName }} />
        <div className="work-home-empty">
          <p>{t.empty}</p>
          {transport.management ? (
            <button type="button" className="tmt-ui-action" onClick={() => setNewPage(true)}>
              {t.newPage}
            </button>
          ) : null}
        </div>
        <NewPageDialog
          open={newPage}
          onClose={() => setNewPage(false)}
          management={transport.management}
          onCreated={(pageId) => void router.navigate({ to: '/pages/$pageId', params: { pageId } })}
          onBrowse={() => {
            setNewPage(false);
            void router.navigate({ to: '/templates' });
          }}
          focusFallback={() => null}
        />
      </section>
    );

  return (
    <section className="work-home tmt-ui-page" data-work-home>
      <AppHeader title={t.title} remote={{ deviceName: transport.backendName }} />
      <div className="work-home-body">
        <div className="work-home-head">
          <div>
            <h1 className="work-home-title">{t.title}</h1>
            <p className="work-home-summary">
              {t.summary(now7.open, now7.moving.length, week.total)}
            </p>
          </div>
          <div className="work-home-projects" role="group" aria-label={t.projectFilter}>
            {[undefined, ...projectNames.filter((name) => openIn(name) > 0)].map((name) => (
              <button
                key={name ?? ''}
                type="button"
                className="work-home-project"
                aria-pressed={scope === name}
                onClick={() => {
                  storeProject(name);
                  go({ project: name, day: undefined, more: undefined });
                }}
              >
                {name ?? t.all}
                <span>{openIn(name)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="work-home-cards">
          <section className="work-home-card" aria-labelledby="work-home-now">
            <div className="work-home-card-head">
              <h2 id="work-home-now">{t.now}</h2>
              <span>{t.open(now7.open)}</span>
            </div>
            <ul className="tmt-ui-work-overview" aria-label={t.now}>
              {OVERVIEW.filter(
                (status) => now7.counts[status] > 0 || !HIDDEN_WHEN_ZERO.has(status),
              ).map((status) => (
                <li key={status}>
                  <button
                    type="button"
                    className="tmt-ui-work-count"
                    aria-pressed={only === status}
                    aria-label={`${now7.counts[status]} ${t.status[status]}`}
                    data-zero={now7.counts[status] === 0 ? '' : undefined}
                    onClick={() => go({ status: only === status ? undefined : status })}
                  >
                    <span className="tmt-ui-work-count-number">{now7.counts[status]}</span>
                    <span className="tmt-ui-work-count-label">
                      <Dot status={partState(status)} />
                      {t.status[status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Ratio counts={now7.counts} />
            {now7.moving.length ? (
              <div className="work-home-moving">
                <span>{t.moving}</span>
                <span className="work-home-avatars">
                  {now7.moving.map((owner) => (
                    <BrowserAvatar key={owner.name} name={owner.name} kind="agent" size="s" />
                  ))}
                </span>
              </div>
            ) : null}
            {now7.stuckLongest || now7.quietest ? (
              <div className="work-home-notes">
                {now7.stuckLongest ? (
                  <p>
                    <Dot status="blocked" />
                    <span>{t.stuckLongest}</span>
                    <span>
                      {[now7.stuckLongest.number, now7.stuckLongest.title]
                        .filter(Boolean)
                        .join(' ')}{' '}
                      · {age(now7.stuckLongest.blockedSinceMs ?? now7.stuckLongest.lastMs, now)}
                    </span>
                  </p>
                ) : null}
                {now7.quietest ? (
                  <p>
                    <Dot status="possibly-stalled" />
                    <span>{t.quietest}</span>
                    <span>
                      {[now7.quietest.number, now7.quietest.title].filter(Boolean).join(' ')} ·{' '}
                      {age(now7.quietest.lastMs, now)}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="work-home-card" aria-labelledby="work-home-done">
            <div className="work-home-card-head">
              <h2 id="work-home-done">{t.done}</h2>
              <span className="work-home-periods" role="group" aria-label={t.period}>
                {(['today', 'week', 'month'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={period === choice}
                    onClick={() =>
                      go({ period: choice === 'week' ? undefined : choice, day: undefined })
                    }
                  >
                    {t.periods[choice]}
                  </button>
                ))}
              </span>
            </div>
            <p className="work-home-total">
              <span>{chart.total}</span> {t.doneTotal(chart.previous, period)}
            </p>
            <ul className="tmt-ui-work-done" aria-label={t.done} data-period={period}>
              {chart.cells.map((entry, index) => (
                <li key={entry.from}>
                  <button
                    type="button"
                    className="tmt-ui-work-done-cell"
                    aria-label={t.doneCell(cellLabel(index), entry.count)}
                    aria-pressed={cell === index}
                    data-current={entry.current ? '' : undefined}
                    onClick={() => go({ day: cell === index ? undefined : entry.from })}
                  >
                    <span className="tmt-ui-work-done-track">
                      <span aria-hidden="true">{entry.count || ''}</span>
                      <span
                        className="tmt-ui-work-done-bar"
                        style={{ height: `${(entry.count / busiest) * 80}%` }}
                      />
                    </span>
                    <span aria-hidden="true">
                      {period === 'week' || entry.current || index % 6 === 0
                        ? cellLabel(index)
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <h2 className="work-home-heading">
          {t.projects} <span>{sections.filter((section) => section.name).length}</span>
          {only ? (
            <button
              type="button"
              className="work-home-clear"
              onClick={() => go({ status: undefined })}
            >
              {t.showAll}
            </button>
          ) : null}
        </h2>
        {sections.map((section) => {
          const key = section.name ?? '';
          const rows = section.open.filter(
            (item) => only === undefined || overviewStatus(item.status) === only,
          );
          const open = expanded.has(key);
          const shown = open ? rows : rows.slice(0, SHOWN);
          return (
            <section
              key={key}
              className="work-home-card work-home-project-section"
              aria-label={section.name ?? t.noProject}
            >
              <div className="work-home-section-head">
                <h3>
                  {section.name ?? t.noProject}
                  {section.prefix ? <span>{section.prefix}</span> : null}
                </h3>
                <span className="work-home-section-counts">
                  {OVERVIEW.filter((status) => section.counts[status]).map((status) => (
                    <span key={status}>
                      <Dot status={partState(status)} />
                      {section.counts[status]} {t.status[status]}
                    </span>
                  ))}
                  <span className="work-home-avatars" aria-hidden="true">
                    {section.owners.map((owner) => (
                      <BrowserAvatar
                        key={owner.name}
                        name={owner.name}
                        kind="agent"
                        size="s"
                        decorative
                      />
                    ))}
                  </span>
                </span>
              </div>
              <Ratio counts={section.counts} />
              <div className="work-home-rows">
                {shown.map((item) => (
                  <WorkRow key={item.key} item={item} now={now} transport={transport} />
                ))}
              </div>
              {rows.length > SHOWN ? (
                <button
                  type="button"
                  className="work-home-more"
                  aria-expanded={open}
                  onClick={() => {
                    const next = new Set(expanded);
                    if (open) next.delete(key);
                    else next.add(key);
                    go({ more: next.size ? [...next] : undefined });
                  }}
                >
                  {open ? t.showFewer : t.showMore(rows.length - SHOWN)}
                </button>
              ) : null}
            </section>
          );
        })}

        <h2 className="work-home-heading">
          {chosen ? t.recentIn(cellLabel(cell)) : t.recent}{' '}
          {!chosen ? <span>{t.recentCount(doneToday)}</span> : null}
          {chosen ? (
            <button
              type="button"
              className="work-home-clear"
              onClick={() => go({ day: undefined })}
            >
              {t.clearDay}
            </button>
          ) : null}
        </h2>
        {recent.length ? (
          <ul className="work-home-recent">
            {recent.map((item) => (
              <li key={item.key}>
                <Link to="/pages/$pageId" params={{ pageId: item.pageId }}>
                  <span className="work-home-recent-mark" aria-hidden="true">
                    ✓
                  </span>
                  <span className="work-home-recent-number">{item.number ?? ''}</span>
                  <span className="work-home-recent-title">{item.title}</span>
                  {item.owner ? (
                    <span className="work-home-recent-owner">
                      <BrowserAvatar name={item.owner.name} kind="agent" size="s" decorative />
                      <span>{item.owner.name}</span>
                    </span>
                  ) : null}
                  <span className="work-home-recent-release">{item.release ?? ''}</span>
                  <span className="work-home-recent-time">{doneLabel(item.doneAtMs!, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="work-home-none">{t.nothingDone}</p>
        )}
      </div>
    </section>
  );
}

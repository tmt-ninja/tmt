import { openPrStatus } from './open-pr-status.js';
import { WorkRow as WorkRowPart, WorkDoneCellContent } from '@tmt/browser-ui/work-display';
import '@tmt/browser-ui/work.css';
import './work-home.css';
import { BrowserAvatar } from '@tmt/browser-ui/react';
import { WorkOrderView } from './work-order-view.js';
import { Popover, PopoverContent, PopoverTrigger, UiTheme } from '@tmt/browser-ui/ui';
import { getTheme, subscribeTheme } from './theme.js';
import { getRouteApi, Link, useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useOwnerActivity } from './use-owner-activity.js';
import { AppHeader } from './app-header.js';
import { useHomeSpace, useSpaceTitle } from './home-space.js';
import { NewPageDialog } from './new-page-dialog.js';
import { text } from './strings.js';
import type { PageTransport } from './transport.js';
import type { WorkFactView } from './reading-details.js';
import { StatusDetailsBody } from './work-band-live.js';
import type { SectionSummary } from './bootstrap.js';
import { sectionMark, sectionTotals, sectionWord, stuckSection } from './section-view.js';
import {
  byAttention,
  doneChart,
  byTodoAttention,
  inProject,
  overview,
  overviewStatus,
  projectSections,
  recentlyDone,
  type Period,
  type WorkItem,
  type WorkSearch,
  workItems,
} from './work-home-model.js';

/** Set on a Work home entry whose URL is its whole view (#6612). */
type WorkEntry = { workView?: true };

const rootRoute = getRouteApi('__root__');
const workRoute = getRouteApi('/work/');
const t = text.workHome;
const PROJECT_KEY = 'tmt-colab-work-project';
const VIEW_KEY = 'tmt-colab-work-home-view';
const SHOWN = 5;
const pageCountLabels = {
  working: t.inProgressPages,
  'needs-you': t.needsYouPages,
  blocked: t.blockedPages,
};

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

type HomeView = 'pages' | 'todos';

function storedView(): HomeView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'todos' ? 'todos' : 'pages';
  } catch {
    return 'pages';
  }
}

function storeView(view: HomeView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // The active view still works when browser storage is unavailable.
  }
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
    if (!next || !transport.workFacts || facts === 'reading') return;
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setFacts('reading');
    transport
      .workFacts(item.pageId, controller.signal, { blockId: item.blockId })
      .then(setFacts, () => {
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
            title={state === 'waiting-ci' ? openPrStatus(view?.pulls).label : undefined}
            aria-label={t.statusDetails(item.number ?? item.title)}
          >
            <span
              className="tmt-ui-work-dot"
              data-state={view?.state ?? item.status}
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="work-status-details">
          {facts === 'reading' ? (
            <p>{t.statusReading}</p>
          ) : (
            <>
              {/* Where the page is stuck comes first (#6619), then its status in full. */}
              <SectionDetails sections={view?.sections ?? item.sections} />
              <StatusDetailsBody
                state={state}
                change={
                  transport.workFacts &&
                  ((url, ignore) =>
                    transport.workFacts!(item.pageId, new AbortController().signal, {
                      blockId: item.blockId,
                      exclusion: { url, ignore },
                    }).then(setFacts))
                }
                {...(view ? { facts: view } : {})}
                {...(item.status === 'blocked' && item.next ? { blocked: item.next } : {})}
              />
            </>
          )}
        </PopoverContent>
      </Popover>
    </UiTheme>
  );
}

function OwnerCell({ owner }: { owner: NonNullable<WorkItem['owner']> }) {
  return (
    <span className="tmt-ui-work-owner">
      <BrowserAvatar name={owner.name} kind="agent" size="s" decorative />
      <span>{owner.name}</span>
    </span>
  );
}

/** Use counted sections when available and direct sub-pages otherwise. */
function PageProgress({ item }: { item: WorkItem }) {
  const progress = item.sections ? sectionTotals(item.sections) : item.work;
  const label = progress
    ? item.sections
      ? text.sections.summaryLabel(progress.done, progress.total)
      : t.subpageProgress(progress.done, progress.total)
    : t.progressUnavailable;
  return (
    <span className="work-home-sections">
      <span className="work-home-progress" role="img" aria-label={label} title={label}>
        <span
          style={{ width: progress?.total ? `${(100 * progress.done) / progress.total}%` : 0 }}
        />
      </span>
      <span aria-hidden="true">
        {progress ? text.sections.count(progress.done, progress.total) : '—'}
      </span>
    </span>
  );
}

/** The status detail names the section that is stuck, then lists every counted section. */
function SectionDetails({ sections }: { sections?: readonly SectionSummary[] }) {
  if (!sections?.length) return null;
  const stuck = stuckSection(sections);
  return (
    <div className="work-home-section-details">
      {stuck && <p>{text.sections.stuck(sectionWord(stuck.state), stuck.title)}</p>}
      <ul>
        {sections.map((section) => {
          const view = sectionMark(section);
          return (
            <li key={section.id} data-level={section.level}>
              <span
                className="tmt-ui-state-mark"
                data-shape={view.shape}
                data-tone={view.tone}
                aria-hidden="true"
              />
              <span>{section.title}</span>
              <span>{view.count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WorkRow({
  item,
  now,
  transport,
  pageRow = false,
}: {
  item: WorkItem;
  now: number;
  transport: PageTransport;
  pageRow?: boolean;
}) {
  // The title's link covers the row (work-home.css), so the status and owner controls sit beside
  // it rather than inside a link.
  return (
    <WorkRowPart
      words={t.highPriorityBadge}
      className={pageRow ? 'work-home-row work-home-page-row' : 'work-home-row'}
      state={item.status}
      number={item.number}
      statusControl={<RowStatus item={item} transport={transport} />}
      priority={item.high ? 'high' : 'normal'}
      title={
        <>
          <Link
            className="work-home-row-link"
            to="/pages/$pageId"
            params={{ pageId: item.pageId }}
            {...(item.blockId ? { search: { anchor: item.blockId } } : {})}
          >
            {item.title}
          </Link>
          {pageRow && item.number && (
            <span aria-hidden="true" className="work-home-inline-number">
              {item.number}
            </span>
          )}
        </>
      }
      next={rowSummary(item)}
      sections={pageRow || item.sections ? <PageProgress item={item} /> : undefined}
      ownerControl={item.owner ? <OwnerCell owner={item.owner} /> : undefined}
      time={age(item.lastMs, now)}
    />
  );
}

function rowSummary(item: WorkItem): string | undefined {
  if (item.status === 'waiting-ci')
    return [openPrStatus().label, item.next].filter(Boolean).join(' · ');
  if (item.status === 'blocked' && item.next) return `Blocked: ${item.next}`;
  if (item.status === 'needs-you') {
    const section = item.sections && stuckSection(item.sections);
    if (section?.state === 'needs-you') return `${t.status['needs-you']}: ${section.title}`;
    if (item.needsYou) return t.waitingOnYou(item.needsYou);
    return item.next ? `${t.status['needs-you']}: ${item.next}` : t.status['needs-you'];
  }
  return item.next;
}

function TodoRow({ item, now }: { item: WorkItem; now: number }) {
  const status = overviewStatus(item.status);
  const waiting = status === 'needs-you';
  return (
    <li>
      <Link
        className="work-home-todo"
        to="/pages/$pageId"
        params={{ pageId: item.pageId }}
        search={{ anchor: item.blockId }}
      >
        <span className="work-home-todo-mark" aria-hidden="true" />
        <span className="work-home-todo-number">{item.number}</span>
        <span className="work-home-todo-title">
          <span>{item.title}</span>
          <small>{item.pageTitle}</small>
        </span>
        <span className="work-home-todo-status" data-waiting={waiting || undefined}>
          {waiting ? t.status['needs-you'] : (item.owner?.name ?? (status && t.status[status]))}
        </span>
        <span className="work-home-todo-time">{age(item.lastMs, now)}</span>
      </Link>
    </li>
  );
}

/** The page and to-do views share project scope. Project order has its own URL entry. */
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
  const [view, setView] = useState(storedView);
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
  const todoItems = useMemo(
    () => (view === 'todos' ? workItems(pages, 'todos') : []),
    [pages, view],
  );
  const todos = todoItems.filter((item) => inProject(item, scope)).sort(byTodoAttention);
  const todoCounts = overview(todos);
  const todosOmitted =
    view === 'todos' &&
    pages.some(
      (page) =>
        !page.archived &&
        page.summary?.todosOmitted &&
        (scope === undefined || page.projects?.includes(scope)),
    );
  const canOpenOrder =
    !!scope && (!!space.projectOrders || !!space.projectOrdersOmitted?.includes(scope));
  const editingOrder = search.order && canOpenOrder ? scope : undefined;
  const orderItems = useMemo(
    () =>
      editingOrder
        ? workItems(pages, 'order')
            .filter((item) => inProject(item, editingOrder) && item.status !== 'done')
            .sort(byAttention)
        : [],
    [pages, editingOrder],
  );
  const pageCounts = overview(items);
  const week = doneChart(items, 'week', now);
  const chart = doneChart(items, period, now);
  const sections = projectSections(items, scope === undefined ? projectNames : [scope], now)
    .filter((section) => scope === undefined || section.name === scope)
    .map((section) => ({
      section,
      rows: section.open.filter(
        (item) => only === undefined || overviewStatus(item.status) === only,
      ),
    }))
    .filter(({ rows }) => rows.length > 0);
  // A day from another period or an older reading names no cell: the whole recent list.
  const cell =
    search.day === undefined ? -1 : chart.cells.findIndex((entry) => entry.from === search.day);
  const chosen = cell < 0 ? undefined : chart.cells[cell];
  const recent = recentlyDone(items, 10, chosen);
  const doneToday = doneChart(items, 'today', now).total;
  const openIn = (name: string | undefined) =>
    (view === 'pages' ? all : todoItems).filter(
      (item) => item.status !== 'done' && inProject(item, name),
    ).length;
  const cellLabel = (index: number) =>
    period === 'today'
      ? `${new Date(chart.cells[index].from).getHours()}:00`
      : chart.cells[index].current
        ? t.today
        : period === 'week'
          ? dayLabel(chart.cells[index].from)
          : dateLabel(chart.cells[index].from);
  const busiest = Math.max(1, ...chart.cells.map((entry) => entry.count));

  return (
    <section className="work-home tmt-ui-page" data-work-home>
      <AppHeader workView="home" remote={{ deviceName: transport.backendName }} />
      <div className="work-home-body" data-shell-content-column>
        <div className="work-home-head">
          <h1 className="work-home-title">{t.title}</h1>
          <div className="work-home-projects" role="group" aria-label={t.projectFilter}>
            {[
              undefined,
              ...projectNames.filter(
                (name) =>
                  name === scope ||
                  (view === 'pages'
                    ? openIn(name) > 0
                    : todoItems.some((item) => inProject(item, name))),
              ),
            ].map((name) => (
              <button
                key={name ?? ''}
                type="button"
                className="work-home-project"
                aria-pressed={scope === name}
                onClick={() => {
                  storeProject(name);
                  go({ project: name, day: undefined, more: undefined, order: undefined });
                }}
              >
                {name ?? t.all}
                <span>{openIn(name)}</span>
              </button>
            ))}
            {canOpenOrder && (
              <button
                type="button"
                className="work-home-project"
                onClick={() => go({ order: editingOrder ? undefined : true })}
              >
                {editingOrder ? t.backToHome : t.projectOrder}
              </button>
            )}
          </div>
        </div>

        {editingOrder ? (
          <WorkOrderView
            key={editingOrder}
            project={editingOrder}
            refresh={reread}
            rows={orderItems}
            listed={space.projectOrders?.[editingOrder]}
            omitted={space.projectOrdersOmitted?.includes(editingOrder) ?? false}
            transport={transport}
            renderRow={(item) => <WorkRow item={item} now={now} transport={transport} />}
          />
        ) : (
          <>
            {view === 'pages' && all.length > 0 && (
              <ul className="work-home-overview" aria-label={t.now}>
                {(['working', 'needs-you', 'blocked'] as const).map((status) => (
                  <li key={status} data-state={status}>
                    <button
                      type="button"
                      className="tmt-ui-work-count"
                      aria-label={`${pageCounts.counts[status]} ${t.status[status]}`}
                      aria-pressed={only === status}
                      onClick={() => go({ status: only === status ? undefined : status })}
                    >
                      <span className="tmt-ui-work-count-number">{pageCounts.counts[status]}</span>
                      <span>{pageCountLabels[status]}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <span className="tmt-ui-work-count-number">{week.total}</span>
                  <span>{t.donePages}</span>
                </li>
              </ul>
            )}
            <div className="work-home-view-bar">
              <div className="work-home-view" role="group" aria-label={t.view}>
                {(['pages', 'todos'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={view === choice}
                    onClick={() => {
                      setView(choice);
                      storeView(choice);
                    }}
                  >
                    {choice === 'pages' ? t.pagesOnly : t.todosOnly}
                  </button>
                ))}
              </div>
              <span>
                {view === 'pages'
                  ? t.byAttention
                  : t.todoCounts(todoCounts.open, todoCounts.counts['needs-you'])}
              </span>
            </div>
            {view === 'todos' ? (
              <div>
                {todos.length ? (
                  <ul className="work-home-todos">
                    {todos.map((item) => (
                      <TodoRow key={item.key} item={item} now={now} />
                    ))}
                  </ul>
                ) : (
                  <p className="work-home-none">{t.noTodos}</p>
                )}
                <p className="work-home-none">{t.todoEligibility}</p>
                {todosOmitted && <p className="work-home-none">{t.todosOmitted}</p>}
              </div>
            ) : !all.length ? (
              <div className="work-home-empty">
                <p>{t.empty}</p>
                {transport.management && (
                  <button type="button" className="tmt-ui-action" onClick={() => setNewPage(true)}>
                    {t.newPage}
                  </button>
                )}
              </div>
            ) : (
              <>
                {only && (
                  <button
                    type="button"
                    className="work-home-clear"
                    onClick={() => go({ status: undefined })}
                  >
                    {t.showAll}
                  </button>
                )}
                {!sections.length && <p className="work-home-none">{t.noPages}</p>}
                {sections.map(({ section, rows }) => {
                  const key = section.name ?? '';
                  const open = expanded.has(key);
                  const shown = open ? rows : rows.slice(0, SHOWN);
                  return (
                    <section
                      key={key}
                      className="work-home-page-group"
                      aria-label={section.name ?? t.noProject}
                    >
                      <div className="work-home-section-head">
                        <h3>
                          {section.name ?? t.noProject}
                          {section.prefix ? <span>{section.prefix}</span> : null}
                        </h3>
                        <span className="work-home-section-counts">
                          {t.projectCount(section.open.length, section.counts['needs-you'] ?? 0)}
                        </span>
                      </div>
                      <div className="work-home-rows">
                        {shown.map((item) => (
                          <WorkRow
                            key={item.key}
                            item={item}
                            now={now}
                            transport={transport}
                            pageRow
                          />
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
                      {section.name &&
                        (space.projectOrders?.[section.name] ||
                          space.projectOrdersOmitted?.includes(section.name)) &&
                        !scope && (
                          <button
                            type="button"
                            className="work-home-more"
                            onClick={() => {
                              storeProject(section.name);
                              go({
                                project: section.name,
                                order: true,
                                day: undefined,
                                more: undefined,
                              });
                            }}
                          >
                            {t.projectOrder}
                          </button>
                        )}
                    </section>
                  );
                })}

                <div className="work-home-completion">
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
                            <WorkDoneCellContent
                              count={entry.count}
                              max={busiest}
                              label={
                                period === 'week' || entry.current || index % 6 === 0
                                  ? cellLabel(index)
                                  : ''
                              }
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
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
                              <BrowserAvatar
                                name={item.owner.name}
                                kind="agent"
                                size="s"
                                decorative
                              />
                              <span>{item.owner.name}</span>
                            </span>
                          ) : null}
                          <span className="work-home-recent-release">{item.release ?? ''}</span>
                          <span className="work-home-recent-time">
                            {doneLabel(item.doneAtMs!, now)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="work-home-none">{t.nothingDone}</p>
                )}
              </>
            )}
          </>
        )}
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
      </div>
    </section>
  );
}

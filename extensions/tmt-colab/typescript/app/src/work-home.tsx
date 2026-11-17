import '@tmt/browser-ui/work.css';
import './work-home.css';
import { BrowserAvatar } from '@tmt/browser-ui/react';
import { getRouteApi, Link, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from './app-header.js';
import { useHomeSpace, useSpaceTitle } from './home-space.js';
import { NewPageDialog } from './new-page-dialog.js';
import { text } from './strings.js';
import type { PageTransport } from './transport.js';
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
  workItems,
} from './work-home-model.js';

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

/** The chosen project, remembered in this browser only. */
function useProject(): [string | undefined, (project: string | undefined) => void] {
  const [project, setProject] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(PROJECT_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  return [
    project,
    (next) => {
      setProject(next);
      try {
        if (next === undefined) localStorage.removeItem(PROJECT_KEY);
        else localStorage.setItem(PROJECT_KEY, next);
      } catch {
        // A browser without storage keeps the choice for this visit only.
      }
    },
  ];
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
  useEffect(() => {
    const read = transport.workActivity;
    if (!read || !owners) return;
    const controller = new AbortController();
    const run = () =>
      void read(owners.split('\n'), controller.signal).then(
        (answer) => {
          const observed = JSON.stringify(
            Object.entries(answer)
              .map(([owner, row]) => [owner, row.state, row.lastActivityMs])
              .sort(),
          );
          if (observed === seen.current) return;
          seen.current = observed;
          reread();
        },
        () => undefined,
      );
    run();
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

function WorkRow({ item, now }: { item: WorkItem; now: number }) {
  return (
    <Link
      className="tmt-ui-work-row"
      to="/pages/$pageId"
      params={{ pageId: item.pageId }}
      {...(item.blockId ? { hash: item.blockId } : {})}
    >
      <Dot status={item.status} />
      <span className="tmt-ui-work-number">{item.number ?? ''}</span>
      <span className="tmt-ui-work-title">
        {item.high ? <span className="tmt-ui-work-priority">High</span> : null}
        {item.title}
      </span>
      <span className="tmt-ui-work-next">
        {item.status === 'blocked' && item.next ? `Blocked: ${item.next}` : (item.next ?? '')}
      </span>
      {item.owner ? (
        <span className="tmt-ui-work-owner">
          <BrowserAvatar name={item.owner.name} kind="agent" size="s" decorative />
          <span>{item.owner.name}</span>
        </span>
      ) : null}
      <span className="tmt-ui-work-time">{age(item.lastMs, now)}</span>
    </Link>
  );
}

/** Work home (#6474): what is open now, what got done, each project's work, and what finished. */
export function WorkHome() {
  const space = workRoute.useLoaderData();
  const { transport } = rootRoute.useRouteContext();
  const router = useRouter();
  const { pages } = useHomeSpace(space);
  const now = space.readAt;
  const [project, setProject] = useProject();
  const [period, setPeriod] = useState<Period>('week');
  const [only, setOnly] = useState<OverviewStatus>();
  const [cell, setCell] = useState<number>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
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
  const chosen = cell === undefined ? undefined : chart.cells[cell];
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
                  setProject(name);
                  setCell(undefined);
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
                    onClick={() => setOnly(only === status ? undefined : status)}
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
                    onClick={() => {
                      setPeriod(choice);
                      setCell(undefined);
                    }}
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
                    onClick={() => setCell(cell === index ? undefined : index)}
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
            <button type="button" className="work-home-clear" onClick={() => setOnly(undefined)}>
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
                  <WorkRow key={item.key} item={item} now={now} />
                ))}
              </div>
              {rows.length > SHOWN ? (
                <button
                  type="button"
                  className="work-home-more"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (open) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  {open ? t.showFewer : t.showMore(rows.length - SHOWN)}
                </button>
              ) : null}
            </section>
          );
        })}

        <h2 className="work-home-heading">
          {chosen ? t.recentIn(cellLabel(cell!)) : t.recent}{' '}
          {!chosen ? <span>{t.recentCount(doneToday)}</span> : null}
          {chosen ? (
            <button type="button" className="work-home-clear" onClick={() => setCell(undefined)}>
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

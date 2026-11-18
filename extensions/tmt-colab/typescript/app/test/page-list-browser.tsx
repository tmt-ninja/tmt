/** The page list with project writes recorded in the window: deterministic data, no real transport. */
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { hostInShell } from '../src/entry.js';
import { createAppRouter } from '../src/router.js';
import type { PageWorkRow } from '../src/bootstrap.js';
import {
  ManagementError,
  type ManagementPort,
  type NewPageRequest,
  type Selection,
} from '../src/management.js';
import type { TemplateEntry } from '../src/templates.js';
import { AdmissionRefusedError } from '../src/registration.js';
import { SessionEndedError } from '../src/ask-remote.js';
import type { ProjectChange, ProjectManage } from '../src/projects.js';
import { localTransport, type PageSnapshot, type PageSummary } from '../src/transport.js';

export const listNow = Date.UTC(2026, 9, 9, 0, 0);
declare global {
  interface Window {
    __projectRequests: { page: string; changes: ProjectChange[] }[];
    /** Work home's activity reads (#6474): each answers every owner working, with a newer time. */
    __activityReads: number;
    /** Every `project.manage` request, in order. */
    __projectManage: ProjectManage[];
    /** Fail the page request with this index (0-based) once, as a lost connection. */
    __failProjectRequest?: number;
    /** Fail the next `project.manage` request once. */
    __failManage?: boolean;
    /** Every `page.pin` request, in order; `__pinRefusal` makes the next one fail with that code. */
    __pinRequests: { pageId: string; pinned: boolean }[];
    __pinRefusal?: string;
    /** Hold the next `project.manage` request until `__releaseManage` runs. */
    __holdManage?: boolean;
    __releaseManage?: () => void;
    /** Every lifecycle statement the owner accepted, in order. */
    __pageOperations: { operation: string; pageId: string }[];
    /** `refuse`: the owner refuses the next statement; `refuse-second`: the one after the first it
     * accepts; `unverified`: its log cannot be read back. */
    __operationMode?: 'refuse' | 'refuse-second' | 'unverified';
    /** What `window.open` was asked for, since the fixture replaces it. */
    __opened: { url: string; target: string; features: string }[];
    /** How many times the router has read the list. */
    __listReads: number;
    /** The owner's fold finishing: every page without a summary gets one (the first in progress),
     * and the next list read returns them. */
    __reportTasks?: () => void;
    /** Every `page.new` request (#5076); `__newPageRefusal` fails the next one with that code. */
    __newPages: NewPageRequest[];
    __newPageRefusal?: string;
    /** Remote cannot list this machine's agents for the next New page (#5076). */
    __agentsUnavailable?: boolean;
    /** Every `template.default` request (#5077), in order. */
    __templateDefaults: (string | null)[];
  }
}
/** The templates of the fixture space, as the owner lists them (#5077): TMT's six and two of the
 * space's own, more than the six that bring the picker's filter and scroll area. */
export function fixtureTemplates(): TemplateEntry[] {
  const builtIn: [string, TemplateEntry['layout'], string][] = [
    ['starter', 'column', 'Title, summary, sections and questions'],
    ['report', 'column', 'Summary, findings table and next steps'],
    ['review', 'column', 'Parts for the reader to confirm, and questions'],
    ['compare', 'column', 'Now and after, side by side'],
    ['board', 'full', 'A full-bleed status board'],
    ['gallery', 'column', 'A grid of pictures with captions'],
  ];
  const space: [string, string, string][] = [
    ['design-proposal', 'Options with mocks, spec table, questions', 'tmt-gui-lead'],
    ['weekly-review', 'Shipped, open, risks, next week', 'ben'],
  ];
  return [
    ...builtIn.map(([name, layout, summary]) => ({
      name,
      layout,
      summary,
      source: 'builtIn' as const,
      default: name === 'starter',
      usedBy: 0,
    })),
    ...space.map(([name, summary, author], n) => ({
      name,
      id: `d${String(n + 1).padStart(7, '0')}-1111-4111-8111-000000000001`,
      layout: 'column' as const,
      summary,
      source: 'space' as const,
      default: false,
      usedBy: name === 'weekly-review' ? 4 : 2,
      author,
    })),
  ];
}
export const pageListSpace = 'a0000000-0000-4000-8000-000000000001';
let root: Root | undefined;
const id = (n: number) => `c${String(n).padStart(7, '0')}-1111-4111-8111-000000000001`;
function page(n: number, title: string, projects: string[], changes: Partial<PageSummary> = {}) {
  return {
    id: id(n),
    title,
    sharing: 'private' as const,
    archived: false,
    lastUpdateAtMs: listNow - n * 3600_000,
    retentionDays: 30,
    expiresAtMs: null,
    warnings: [],
    projects,
    ...changes,
  };
}

/** The stage a fixture page's summary reports: its direct sub-pages done of all. */
function work(stage: PageWorkRow['stage'], done: number, total: number): PageWorkRow {
  return { stage, done, total };
}
const idle = { comments: 0, waiting: false, needsYou: 0 };

/** Work home's fixture (#6474): the spec mockup's projects and items, read at `listNow`. */
function workHomePages(): PageSummary[] {
  const agents: Record<string, string> = {};
  const agent = (name: string) => ({
    id: (agents[name] ??=
      `20000000-0000-4000-8000-${String(Object.keys(agents).length + 100).padStart(12, '0')}`),
    name,
  });
  const minutes = (count: number) => listNow - count * 60_000;
  let n = 0;
  const item = (
    title: string,
    project: string | undefined,
    number: string,
    status: string,
    fields: Record<string, unknown>,
    age: number,
    extra: Record<string, unknown> = {},
  ) => {
    n += 1;
    return page(n, title, project ? [project] : [], {
      workNumber: number,
      lastUpdateAtMs: minutes(age),
      summary: { ...idle, status, fields, ...extra } as PageSummary['summary'],
    });
  };
  return [
    item(
      'Batch reads for large design pages',
      'Colab',
      'COLAB-119',
      'blocked',
      {
        owner: agent('gui-2'),
        priority: 'high',
        blocked: 'Waiting for Core to decide the protocol',
      },
      24 * 60,
      { blockedSinceMs: minutes(26 * 60) },
    ),
    item(
      'A Colab page is the work',
      'Colab',
      'COLAB-140',
      'needs-you',
      { owner: agent('tmt-gui-lead'), priority: 'high', next: 'Answer 4 questions' },
      10,
    ),
    item(
      'Mockup toolbar has no spacing',
      'Colab',
      'COLAB-143',
      'working',
      { owner: agent('gui-3'), next: 'PR #6470 in review' },
      3,
    ),
    item(
      'Page field data format',
      'Colab',
      'COLAB-141',
      'working',
      { owner: agent('gui-2'), next: 'Writing the spec' },
      60,
    ),
    item(
      'Delete the timing-only tests',
      'Web Ops',
      'OPS-37',
      'possibly-stalled',
      { owner: agent('gui-3'), next: 'Idle 3 hours, asked once' },
      180,
    ),
    item(
      'Ops channel round 6',
      'Web Ops',
      'OPS-26',
      'working',
      { owner: agent('gui-4'), priority: 'high', next: 'Fix the thread layout on phones' },
      5,
    ),
    item(
      'The You tag on messages',
      'Web Ops',
      'OPS-33',
      'waiting-ci',
      { owner: agent('gui-2'), next: 'Waiting for CI · PR #6461' },
      20,
    ),
    item(
      'Pi becomes a full driver',
      'Core',
      'CORE-88',
      'waiting-release',
      { owner: agent('core-2'), next: 'Waiting for release · PR #6459' },
      40,
    ),
    item(
      'Fix the mockup that would not open',
      'Colab',
      'COLAB-128',
      'done',
      { owner: agent('gui-3') },
      120,
      { doneAtMs: minutes(120), release: 'alpha.453' },
    ),
    item(
      'Agents default to block pages',
      'Colab',
      'COLAB-125',
      'done',
      { owner: agent('tmt-gui-lead') },
      200,
      { doneAtMs: minutes(200), release: 'alpha.453' },
    ),
    item('Ops channel round 5', 'Web Ops', 'OPS-25', 'done', { owner: agent('gui-4') }, 500, {
      doneAtMs: minutes(500),
      release: 'alpha.297',
    }),
    item(
      'Digest price table update',
      'Core',
      'CORE-86',
      'done',
      { owner: agent('core-3') },
      26 * 60,
      { doneAtMs: minutes(26 * 60), release: 'alpha.616' },
    ),
    ...[2, 3, 4, 5].flatMap((day) =>
      Array.from({ length: day }, (_, k) =>
        item(
          `Earlier work ${day}.${k}`,
          'Colab',
          `COLAB-${90 + day * 5 + k}`,
          'done',
          { owner: agent('gui-2') },
          day * 24 * 60,
          { doneAtMs: minutes(day * 24 * 60 + k) },
        ),
      ),
    ),
  ];
}

/** The owner's default list, as the owner computes it: the five projects whose newest active page was updated last. */
function automaticPins(pages: readonly PageSummary[]): string[] {
  const newest = new Map<string, number>();
  for (const page of pages)
    if (!page.archived)
      for (const name of page.projects ?? [])
        newest.set(name, Math.max(newest.get(name) ?? 0, page.lastUpdateAtMs ?? 0));
  return [...newest]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([name]) => name);
}

/** Holds the space home's list read until `releaseHome`: a slow load the router waits on. */
let homeGate: Promise<void> | undefined;
let openHome = () => {};
export function holdHome() {
  homeGate = new Promise((resolve) => (openHome = resolve));
}
export function releaseHome() {
  openHome();
  homeGate = undefined;
}
export async function mountPageList(
  size:
    | 'groups'
    | 'few'
    | 'bulk'
    | 'none'
    | 'unmanaged'
    | 'long'
    | 'full'
    /** Pages at every stage, one that has not reported, and an archived one that was in progress. */
    | 'stages'
    /** Every page is in discussion: nothing in progress, nothing done. */
    | 'quiet'
    /** A working space: 75 active pages over the stages and projects, one that needs you, one archived. */
    | 'work'
    | 'work-pinned'
    /** No page has reported its tasks yet, as after a cold start. */
    | 'cold'
    /** A dashboard (shell page). */
    | 'shells'
    /** Work home (#6474): the spec mockup's items, with owners, statuses and done times. */
    | 'owner-activity'
    | 'work-home'
    /** Twenty-two projects of one page each; page n is n hours old, so Project 01 is the newest. */
    | 'projects' = 'few',
  hash = '/',
  /**
   * The owner's pinned projects. Left out, the source reports none (every project is in the menu);
   * `'automatic'` is the owner's default until it writes a list; names are a list the owner wrote.
   */
  pinned?: 'automatic' | readonly string[],
  withSpace = true,
  failure?: 'network' | 'admission' | 'session',
) {
  // Keep the boot app connected for its own cleanup, but its hidden shell must not affect :has()
  // when this fixture renders a standalone root error.
  const boot = document.getElementById('root');
  if (boot) {
    boot.style.display = 'none';
    boot
      .querySelectorAll('.tmt-ui-shell')
      .forEach((shell) => shell.classList.remove('tmt-ui-shell'));
  }
  let host = document.getElementById('list-fixture');
  if (!host) {
    host = document.createElement('div');
    host.id = 'list-fixture';
    document.body.append(host);
  }
  root?.unmount();
  root = createRoot(host);
  window.__projectRequests = [];
  window.__activityReads = 0;
  window.__projectManage = [];
  window.__failProjectRequest = undefined;
  window.__failManage = undefined;
  window.__pinRequests = [];
  window.__newPages = [];
  window.__agentsUnavailable = undefined;
  window.__templateDefaults = [];
  window.__pinRefusal = undefined;
  window.__pageOperations = [];
  window.__operationMode = undefined;
  window.__opened = [];
  window.__listReads = 0;
  window.open = (url, target, features) => {
    window.__opened.push({ url: String(url), target: target ?? '', features: features ?? '' });
    return null;
  };
  const state: {
    pages: PageSummary[];
    projects: Set<string>;
    pins?: { chosen: boolean; names: string[] };
  } = {
    projects: new Set(),
    pages:
      size === 'stages'
        ? [
            page(1, 'Alpha plan', ['design'], {
              summary: {
                ...idle,
                work: work('in-progress', 7, 10),
              },
            }),
            page(2, 'Beta review', ['design'], {
              summary: {
                ...idle,
                work: work('in-progress', 1, 9),
              },
            }),
            page(3, 'Gamma notes', [], { summary: idle }),
            page(4, 'Delta ops', ['ops'], { summary: { ...idle, work: work('done', 4, 4) } }),
            // No summary yet: it is at no stage, so it is only in All.
            page(5, 'Epsilon draft', []),
            page(6, 'Archived spec', ['design'], {
              archived: true,
              summary: { ...idle, work: work('in-progress', 0, 2) },
            }),
          ]
        : size === 'work-home'
          ? workHomePages()
          : size === 'work' || size === 'work-pinned'
            ? [
                ...Array.from({ length: 75 }, (_, n) => {
                  const stage = (['discussion', 'in-progress', 'done'] as const)[n % 3];
                  return page(
                    n + 1,
                    // CJK is necessary fixture data for the requested mixed-script visual check.
                    size === 'work-pinned' && n === 0
                      ? '夜のレビュー：共有ページと進捗'
                      : size === 'work-pinned' && n === 2
                        ? 'A deliberately long page title that must truncate cleanly without pushing other columns outside the list'
                        : `${['Spec', 'Review', 'Plan', 'Notes', 'Report'][n % 5]} ${n + 1}`,
                    size === 'work-pinned' && n === 2
                      ? ['pm', 'spec', 'blog']
                      : n % 4
                        ? [['spec', 'blog', 'pm'][n % 3]]
                        : [],
                    {
                      ...(size === 'work-pinned' && n < 3 ? { pinned: true } : {}),
                      ...(size === 'work-pinned' && n === 0 ? { sharing: 'link' as const } : {}),
                      ...(size === 'work' && n === 0 ? { workNumber: 'COLAB-128' } : {}),
                      summary: {
                        comments: n % 6,
                        waiting: n === 1,
                        needsYou: n === 1 ? (size === 'work-pinned' ? 3 : 1) : 0,
                        author: n % 2 ? 'Ada' : 'feat-1',
                        ...(size === 'work' && n === 0
                          ? {
                              fields: {
                                owner: {
                                  id: '20000000-0000-4000-8000-000000000088',
                                  name: 'gui-3',
                                },
                                priority: 'high' as const,
                                next: 'Review the mockup',
                                blocked: 'Waiting for Core',
                              },
                            }
                          : {}),
                        ...(size === 'work-pinned' && (n === 0 || n === 2)
                          ? {}
                          : { work: work(stage, stage === 'done' ? 4 : n % 4, 4) }),
                      },
                    },
                  );
                }),
                page(76, 'Archived spec', ['spec'], { archived: true, summary: idle }),
              ]
            : size === 'quiet'
              ? [
                  page(1, 'Gamma notes', ['design'], { summary: idle }),
                  page(2, 'Zeta notes', [], { summary: idle }),
                ]
              : size === 'cold'
                ? [page(1, 'Gamma notes', ['design']), page(2, 'Zeta notes', [])]
                : size === 'bulk'
                  ? [
                      ...Array.from({ length: 130 }, (_, n) =>
                        page(n + 1, `Bulk ${String(n + 1).padStart(3, '0')}`, ['old']),
                      ),
                      page(131, 'Bulk archived', ['old', 'z'], { archived: true }),
                    ]
                  : size === 'none'
                    ? []
                    : [
                        // The longest names the owner admits: 32 wide characters, 32 letters, a long creator.
                        ...(size === 'long'
                          ? [
                              page(6, 'Long names', ['漢'.repeat(32), 'W'.repeat(32)], {
                                summary: {
                                  comments: 0,
                                  waiting: false,
                                  needsYou: 0,
                                  author: 'W'.repeat(120),
                                },
                              }),
                            ]
                          : []),
                        // A page already in the most projects it can be, and one project it is not in.
                        ...(size === 'full'
                          ? [
                              page(
                                7,
                                'Full page',
                                Array.from({ length: 8 }, (_, n) => `p${n + 1}`),
                              ),
                              page(8, 'Extra page', ['extra']),
                            ]
                          : []),
                        ...(size === 'shells'
                          ? [page(9, 'Reading shell', [], { pageType: 'shell' })]
                          : []),
                        page(
                          1,
                          'Alpha plan',
                          size === 'groups'
                            ? ['design', 'q4 plan', 'research', 'ops']
                            : ['design', 'q4 plan'],
                          {
                            summary: {
                              comments: 3,
                              waiting: true,
                              needsYou: 1,
                              author: 'Studio agent',
                            },
                          },
                        ),
                        page(2, 'Beta review', ['design'], {
                          summary: { comments: 1, waiting: false, needsYou: 0, author: 'Ada' },
                        }),
                        // No summary yet: the row shows only what the list already knows.
                        page(3, 'Gamma notes', []),
                        page(4, 'Delta ops', ['ops'], {
                          summary: { comments: 0, waiting: false, needsYou: 0 },
                        }),
                        page(5, 'Archived spec', ['design'], { archived: true }),
                      ],
  };
  window.__reportTasks = () => {
    state.pages = state.pages.map((p, index) =>
      p.summary
        ? p
        : {
            ...p,
            summary: { ...idle, ...(index === 0 ? { work: work('in-progress', 1, 3) } : {}) },
          },
    );
  };
  if (size === 'projects')
    state.pages = Array.from({ length: 22 }, (_, n) =>
      page(n + 1, `Page ${n + 1}`, [`Project ${String(n + 1).padStart(2, '0')}`]),
    );
  if (pinned !== undefined)
    state.pins = {
      chosen: pinned !== 'automatic',
      names: pinned === 'automatic' ? [] : [...pinned],
    };
  if (size === 'owner-activity') {
    state.pages = [
      page(1, 'Owner activity page', [], {
        summary: {
          ...idle,
          status: 'unchecked',
          fields: { owner: { id: id(201), name: 'gui-5' } },
        },
      }),
    ];
  }
  for (const p of state.pages) for (const name of p.projects ?? []) state.projects.add(name);
  const snapshots: PageSnapshot[] = state.pages.map((p) => ({ ...p, source: '<h1>Fixture</h1>' }));
  const transport = localTransport('Studio pages', snapshots);
  let templates = fixtureTemplates();
  const management: ManagementPort = {
    newPage: async (request) => {
      window.__newPages.push(request);
      if (window.__newPageRefusal) {
        const code = window.__newPageRefusal;
        window.__newPageRefusal = undefined;
        throw new ManagementError(code);
      }
      return `e${request.operationId.slice(1)}`;
    },
    setDefaultTemplate: async (template) => {
      window.__templateDefaults.push(template);
      // The owner answers the default's name, whether the request named it or its page.
      const name =
        template === null
          ? 'starter'
          : (templates.find((t) => t.id === template || t.name === template)?.name ?? template);
      templates = templates.map((t) => ({ ...t, default: t.name === name }));
      return name;
    },
    agents: async () => {
      if (window.__agentsUnavailable) throw new Error('Remote is not running');
      return [
        { id: 'agent-gui-lead', name: 'tmt-gui-lead' },
        { id: 'agent-gui-4', name: 'gui-4' },
      ];
    },
    readTemplates: async () => ({
      default: templates.find((t) => t.default)!.name,
      templates,
    }),
    // The list's archive and delete run the real four steps; the fixture answers each in memory.
    read: async (pageId) => ({ page: { pageId } }) as never,
    prepare: async (_view, selection) => ({ selection }) as never,
    send: async (pending) => {
      const { operation, value } = (pending as never as { selection: Selection }).selection as {
        operation: string;
        value: { pageId: string };
      };
      if (
        window.__operationMode === 'refuse' ||
        (window.__operationMode === 'refuse-second' && window.__pageOperations.length === 1)
      ) {
        window.__operationMode = undefined;
        throw new ManagementError('DENIED');
      }
      window.__pageOperations.push({ operation, pageId: value.pageId });
      state.pages =
        operation === 'page.delete'
          ? state.pages.filter((p) => p.id !== value.pageId)
          : state.pages.map((p) =>
              p.id === value.pageId ? { ...p, archived: operation === 'page.archive' } : p,
            );
      return {} as never;
    },
    verify: async (_pending, _ack) => {
      if (window.__operationMode === 'unverified') {
        window.__operationMode = undefined;
        throw new Error('The signed log is not readable yet');
      }
      return {} as never;
    },
    setProjects: async (changes) => {
      const index = window.__projectRequests.length;
      window.__projectRequests.push({ page: changes[0].pageId, changes: [...changes] });
      if (window.__failProjectRequest === index) {
        window.__failProjectRequest = undefined;
        throw new ManagementError('UNKNOWN');
      }
      for (const change of changes) for (const name of change.projects) state.projects.add(name);
      state.pages = state.pages.map((p) => {
        const change = changes.find((c) => c.pageId === p.id);
        return change ? { ...p, projects: [...change.projects] } : p;
      });
    },
    setPinned: async (pageId, pinned) => {
      window.__pinRequests.push({ pageId, pinned });
      if (window.__pinRefusal) {
        const code = window.__pinRefusal;
        window.__pinRefusal = undefined;
        throw new ManagementError(code);
      }
      // The owner lists pinned pages first, in pin order; a new pin goes last among them.
      const rest = state.pages.filter((p) => p.id !== pageId);
      const target = state.pages.find((p) => p.id === pageId)!;
      const pins = rest.filter((p) => p.pinned);
      const others = rest.filter((p) => !p.pinned);
      state.pages = pinned
        ? [...pins, { ...target, pinned: true }, ...others]
        : [...pins, { ...target, pinned: false }, ...others];
    },
    manageProject: async (change) => {
      window.__projectManage.push(change);
      if (window.__holdManage) {
        window.__holdManage = undefined;
        await new Promise<void>((resolve) => {
          window.__releaseManage = resolve;
        });
      }
      if (window.__failManage) {
        window.__failManage = undefined;
        throw new ManagementError('UNKNOWN');
      }
      if (change.action === 'pins') {
        state.pins = { chosen: true, names: [...change.names] };
        return;
      }
      // The owner moves a pin with a rename, and a delete takes it out.
      if (state.pins && change.action !== 'create')
        state.pins.names =
          change.action === 'rename'
            ? [
                ...new Set(
                  state.pins.names.map((name) => (name === change.name ? change.to : name)),
                ),
              ]
            : state.pins.names.filter((name) => name !== change.name);
      if (change.action === 'create') state.projects.add(change.name);
      else {
        const target = change.action === 'rename' ? change.to : undefined;
        state.projects.delete(change.name);
        if (target !== undefined) state.projects.add(target);
        state.pages = state.pages.map((p) =>
          p.projects?.includes(change.name)
            ? {
                ...p,
                projects: [
                  ...new Set(
                    p.projects.flatMap((name) =>
                      name !== change.name ? [name] : target === undefined ? [] : [target],
                    ),
                  ),
                ].sort(),
              }
            : p,
        );
      }
    },
  };
  // Set before the router reads its history, so a redirect in the first load is not overwritten.
  if (hash.startsWith('/colab/')) {
    hostInShell(null);
    history.replaceState(history.state, '', hash);
  } else location.hash = hash;
  let remainingFailure = failure;
  const router = createAppRouter({
    ...transport,
    ...(size === 'unmanaged' ? {} : { management }),
    ...(size === 'owner-activity'
      ? {
          workActivity: async (owners: readonly string[]) => {
            window.__activityReads += 1;
            if (owners.length !== 1 || owners[0] !== id(201)) throw new Error('Unexpected owners');
            state.pages = state.pages.map((page) => ({
              ...page,
              summary: { ...page.summary!, status: 'working' },
            }));
            return {
              [id(201)]: {
                state: 'working' as const,
                lastActivityMs: listNow,
                observedAtMs: listNow,
              },
            };
          },
        }
      : {}),
    ...(size === 'work-home'
      ? {
          // A page's facts as its owner reads them when a row's details open (#6474).
          workFacts: async (pageId: string) => ({
            asOfMs: listNow,
            state: (state.pages.find((page) => page.id === pageId)?.summary?.status ??
              'unknown') as import('../src/reading-details.js').WorkFactView['state'],
            known: true,
            pulls: [
              {
                url: 'https://github.com/o/r/pull/6470',
                fact: {
                  state: 'open' as const,
                  checks: 'PENDING' as const,
                  released: null,
                  tag: null,
                  observedAtMs: listNow - 120_000,
                },
              },
            ],
            activity: null,
          }),
          workActivity: async (owners: readonly string[]) => {
            window.__activityReads += 1;
            const at = listNow + window.__activityReads * 1000;
            return Object.fromEntries(
              owners.map((owner) => [
                owner,
                { state: 'working', lastActivityMs: at, observedAtMs: at },
              ]),
            );
          },
        }
      : {}),
    spaceHome: async () => {
      await homeGate;
      window.__listReads += 1;
      const fail = remainingFailure;
      remainingFailure = undefined;
      if (fail === 'network') throw new TypeError('Failed to fetch');
      if (fail === 'admission') throw new AdmissionRefusedError(403, '', 'DENIED');
      if (fail === 'session') throw new SessionEndedError('REMOTE_SESSION_ENDED');
      return {
        title: 'Studio pages',
        projects: [...state.projects].sort(),
        ...(state.pins
          ? {
              projectPins: state.pins.chosen
                ? { names: state.pins.names, automatic: false }
                : { names: automaticPins(state.pages), automatic: true },
            }
          : {}),
        pages: state.pages,
      };
    },
  });
  root.render(
    <RouterProvider router={router} context={{ space: withSpace ? pageListSpace : undefined }} />,
  );
}

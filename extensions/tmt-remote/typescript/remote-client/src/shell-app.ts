/**
 * The one TMT web app the door serves at every TMT route (#3937): one document, one shell, one
 * router. Remote's own pages are route modules here; Colab is loaded lazily from its own mount.
 */
import {
  appHref,
  appRail,
  startShellHost,
  type ShellHost,
  type ShellMounted,
  type ShellRoute,
  type ShellRouteModule,
  type ShellSlot,
} from '@tmt/browser-ui/shell-host';
import { mountShell, rememberedShellAnswer, type ShellAnswer } from '@tmt/browser-ui/shell';
import home from '../../../rust/tmt-remote/assets/home.html?raw';
import landing from '../../../rust/tmt-remote/assets/landing.html?raw';
import settings from '../../../rust/tmt-remote/assets/settings.html?raw';
import tmtSettings from '../../../rust/tmt-remote/assets/tmt-settings.html?raw';
import digest from '../../../rust/tmt-remote/assets/digest.html?raw';
import { digestPage } from './digest-page.js';
import {
  extraModuleLoad,
  moduleLoad,
  rootAppFamily,
  rootModules,
  type ModuleLoad,
} from './module-entry.js';
import { remoteApp } from './remote-app.js';
import { REMOTE_PATHS, remoteItem } from './remote-routes.js';
import { homePage, hostRemote, remoteShell, setRouteTitle } from './remote-shell.js';
import { tmtSettingsPage } from './tmt-settings-page.js';
import { applyStoredTheme } from '@tmt/browser-ui/theme';
import { navigationSnapshot, RootSearch, type SearchModule } from './root-search.js';
import { channelFor } from './session-channel.js';
import type { Session } from './device.js';

/** Root-private cancellation; modules still consume the existing shared slot contract. */
interface RootSlot extends ShellSlot {
  readonly routeSignal: AbortSignal;
}

/**
 * Put a page's markup into the slot: route identity into the common bar, actions and content into
 * the main area, and its document title and page name onto the shell. The page files stay the one source of each
 * page's markup; the door no longer serves them as documents.
 */
async function adopt(slot: ShellSlot, html: string): Promise<() => void> {
  const page = new DOMParser().parseFromString(html, 'text/html');
  // A page's own stylesheet loads before its markup shows, and goes with the route.
  const release = await pageStyles(page);
  if (!slot.topBarReady()) {
    release();
    return () => {};
  }
  const bar = page.querySelector('.tmt-ui-shell-bar');
  const main = page.querySelector('.tmt-ui-shell-main');
  slot.main.replaceChildren(
    ...(main ? [...main.childNodes].map((node) => document.adoptNode(node)) : []),
  );
  adoptBar(slot, bar);
  document.documentElement.dataset.tmtPage = page.documentElement.dataset.tmtPage ?? '';
  setRouteTitle(slot, page.title.replace(/ · TMT$/, ''));
  return release;
}

/** Page actions remain in the content sub-header; route identity belongs to the left bar. */
function adoptBar(slot: ShellSlot, source: Element | null): void {
  const header = source?.querySelector('header');
  const title = header?.querySelector('.header-title')?.textContent;
  if (title) setRouteTitle(slot, title);
  const actions = header?.querySelector('.header-actions,.tmt-ui-header-actions');
  if (actions) {
    const row = document.createElement('div');
    row.className = 'tmt-page root-page-actions';
    row.append(document.adoptNode(actions));
    slot.main.prepend(row);
  }
}

/**
 * The door's own stylesheets a page names beyond the shell's `/sdk/pages.css` (Remote settings has
 * `/sdk/settings.css`): linked once the route mounts, removed when it unmounts. Resolves when each
 * has loaded or failed, so the markup never shows unstyled.
 */
async function pageStyles(page: Document): Promise<() => void> {
  const added: HTMLLinkElement[] = [];
  const loading: Promise<void>[] = [];
  for (const source of page.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const href = source.getAttribute('href');
    if (
      !href?.startsWith('/sdk/') ||
      href === '/sdk/pages.css' ||
      [...document.head.querySelectorAll('link')].some((link) => link.getAttribute('href') === href)
    )
      continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    loading.push(
      new Promise((resolve) => {
        link.onload = link.onerror = () => resolve();
      }),
    );
    document.head.append(link);
    added.push(link);
  }
  await Promise.all(loading);
  return () => added.forEach((link) => link.remove());
}

/**
 * Remote's connection check and settings forms as one document of views: both pages' markup in the
 * slot (each page's `main` marked `data-page`), with route identity in the shared top bar. The
 * page's own code decides which view shows (`remote-app.ts`). The settings stylesheet loads with
 * the first settings view, not with the route: the connection check stays a page that asks the
 * door for nothing. `settingsStyles` resolves once it has loaded.
 */
async function adoptRemote(
  slot: ShellSlot,
  status: string,
  forms: string,
  settingsStyles: { load?: () => Promise<void> },
): Promise<() => void> {
  const parser = new DOMParser();
  const landingPage = parser.parseFromString(status, 'text/html');
  const settingsPage = parser.parseFromString(forms, 'text/html');
  const releaseLanding = await pageStyles(landingPage);
  if (!slot.topBarReady()) {
    releaseLanding();
    return () => {};
  }
  let settingsSheets: Promise<() => void> | undefined;
  settingsStyles.load = async () => {
    settingsSheets ??= pageStyles(settingsPage);
    await settingsSheets;
  };
  const bar = landingPage.querySelector('.tmt-ui-shell-bar');
  slot.main.replaceChildren(
    ...(
      [
        ['landing', landingPage],
        ['settings', settingsPage],
      ] as const
    ).flatMap(([name, page]) =>
      [...(page.querySelector('.tmt-ui-shell-main')?.childNodes ?? [])].map((node) => {
        if (node instanceof Element && node.localName === 'main')
          (node as HTMLElement).dataset.page = name;
        return document.adoptNode(node);
      }),
    ),
  );
  adoptBar(slot, bar);
  setRouteTitle(slot, remoteItem(location.pathname)?.title ?? 'Remote', ['Remote']);
  document.documentElement.dataset.tmtPage = 'landing';
  return () => {
    releaseLanding();
    void settingsSheets?.then((release) => release());
  };
}

/** A Remote page as a route module: its markup, then its page code, released on unmount. */
function remotePage(
  html: string | ((slot: ShellSlot) => Promise<() => void>),
  run: (slot: ShellSlot) => void | (() => void) | Promise<void>,
): ShellRouteModule {
  return {
    async mount(slot) {
      const unstyle = await (typeof html === 'string' ? adopt(slot, html) : html(slot));
      const routeSignal = (slot as Partial<RootSlot>).routeSignal;
      if (routeSignal?.aborted || !slot.topBarReady()) {
        unstyle();
        return;
      }
      const lifetime = new AbortController();
      hostRemote(slot, lifetime.signal, observedSession, (reason) => (heldBy = reason), {
        get: rootSession,
        forget: forgetSession,
      });
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        routeSignal?.removeEventListener('abort', end);
        // The page's own code ends on its route's signal; nothing else in the document hears it.
        lifetime.abort();
        unstyle();
        hostRemote(undefined);
        heldBy = undefined;
      };
      routeSignal?.addEventListener('abort', end, { once: true });
      let release: void | (() => void);
      try {
        release = await run(slot);
      } catch (error) {
        // A page that fails to start still gives back its styles, listeners and slot.
        end();
        throw error;
      }
      return () => {
        release?.();
        end();
      };
    },
  };
}

/** The script an older Colab, which names no `entry`, is loaded from under its own mount. */
const COLAB_ENTRY = 'assets/colab-module.js';

/** Colab as the composed answer describes it: its own link, and its entry only if confined. */
function colabLoad(answer: ShellAnswer | undefined): ModuleLoad | undefined {
  const colab = answer?.modules.find(
    (module) => module.extension === 'colab' && !('module' in module),
  );
  if (!colab) return undefined;
  return moduleLoad(
    colab.rail.path,
    (colab as { entry?: string }).entry,
    location.href,
    COLAB_ENTRY,
  );
}

function message(
  slot: ShellSlot,
  title: string,
  text: string,
  link?: { href: string; label: string },
  status?: string,
): void {
  // The shell's main area is the one main landmark; a message is a section inside it.
  const main = document.createElement('section');
  main.className = 'tmt-page';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = text;
  main.append(heading, body);
  if (status) {
    // What the page is doing on its own, said politely; focus stays where the person left it.
    const line = document.createElement('p');
    line.className = 'usage-note';
    line.setAttribute('role', 'status');
    line.textContent = status;
    main.append(line);
  }
  if (link) {
    const open = document.createElement('p');
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    open.append(anchor);
    main.append(open);
  }
  slot.main.replaceChildren(main);
  setRouteTitle(slot, title);
}

/** The first wait before a card tries its module again, and the longest (#6810). */
export const RETRY_FIRST_MS = 2_000;
export const RETRY_CAP_MS = 30_000;

/**
 * Try `attempt` again while the page is visible until it returns true or `signal` aborts: one
 * attempt at a time, first after `RETRY_FIRST_MS`, the wait doubling to `RETRY_CAP_MS`. A hidden
 * page tries nothing; showing it again tries at once. No attempt limit: the cap keeps the cost
 * at one small read a half minute per tab.
 */
export function retryWhileVisible(attempt: () => Promise<boolean>, signal: AbortSignal): void {
  let wait = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const schedule = () => {
    clearTimeout(timer);
    if (!signal.aborted) timer = setTimeout(run, wait);
  };
  const run = async () => {
    clearTimeout(timer);
    if (running || signal.aborted || document.visibilityState !== 'visible') return;
    running = true;
    let done = false;
    try {
      done = await attempt();
    } catch {
      done = false;
    } finally {
      running = false;
    }
    if (done || signal.aborted) return;
    wait = Math.min(wait * 2, RETRY_CAP_MS);
    schedule();
  };
  document.addEventListener(
    'visibilitychange',
    () => (document.visibilityState === 'visible' ? void run() : clearTimeout(timer)),
    { signal },
  );
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  schedule();
}

type Select = (answer: ShellAnswer | undefined) => ModuleLoad | undefined;

/** Entries whose import failed in this document. Chromium keeps a failed module import for its
 * URL, so the same document never loads one again; only a new document can (#6810). */
const failedEntries = new Set<string>();
/** Entries this document loaded: a module that ran here may hold what a reload would drop. */
const loadedEntries = new Set<string>();
/** The entry this tab reloaded for once it answered again: a failure right after it is final. */
const RELOADED_KEY = 'tmt-module-reloaded';

function reloadedFor(entry: string): boolean {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === entry;
  } catch {
    return false;
  }
}

function markReload(entry: string | undefined): boolean {
  try {
    if (entry) sessionStorage.setItem(RELOADED_KEY, entry);
    else sessionStorage.removeItem(RELOADED_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Whether the entry answers now, read past every cache. */
async function answers(entry: string): Promise<boolean> {
  try {
    return (await fetch(entry, { cache: 'no-store' })).ok;
  } catch {
    return false;
  }
}

/** The answer read now, never a remembered one: a door that restarted is reopened first. */
async function describedNow(select: Select) {
  let answer = await started?.redescribe();
  if (!answer && (await reopened())) answer = await started?.redescribe();
  return { answer, load: select(answer) };
}

/** The card for a route that cannot load its module, and whether it waits for the module. */
function card(title: string, answer: ShellAnswer | undefined, load: ModuleLoad | undefined) {
  const link = load?.link ? { href: load.link, label: `Open ${title}` } : undefined;
  if (load?.entry)
    // An older Colab has no module to load here; its own mounted app is still the way in.
    return {
      retry: true,
      text:
        title === 'Colab'
          ? 'Colab could not start here. It may have stopped on your machine.'
          : `${title} could not start here. Its extension may have stopped on your machine.`,
      status: `${title} is not answering yet. Trying again…`,
      link,
    };
  if (load)
    // Described, but not loadable from here: the module's own link is the way in.
    return { retry: false, text: `${title} could not be opened here.`, link, status: undefined };
  if (answer)
    return {
      retry: true,
      text:
        title === 'Colab'
          ? 'Colab is not running on your machine. Run tmt colab serve there.'
          : `${title} is not available from its extension. Start or update it on your machine.`,
      status: `Waiting for ${title} to start. Trying again…`,
      link: undefined,
    };
  return {
    retry: false,
    text: `Pair this browser with Remote to open ${title}. On the machine that runs Remote, run tmt remote pair.`,
    link: { href: '/remote/', label: 'Pair this browser' },
    status: undefined,
  };
}

/**
 * #6810: a card that waits for its module. While the page is visible it reads the answer again,
 * then imports the entry, and the module mounts in the card's place. An entry that already failed
 * in this document is only fetched: when it answers, the document reloads once and loads it anew.
 * A card that needs a person (pairing, a module not loadable here) stops.
 */
function waitingCard(
  title: string,
  select: Select,
  shown: ReturnType<typeof card>,
): ShellRouteModule {
  return {
    mount(slot) {
      const stop = new AbortController();
      let inner: ShellMounted | undefined;
      let released = false;
      const mounted: ShellMounted = {
        release() {
          released = true;
          stop.abort();
          inner?.release();
        },
      };
      let painted = '';
      // A card is drawn again only when what it says changes, so its status is not re-announced.
      const paint = (view: ReturnType<typeof card>) => {
        if (painted === view.text) return;
        painted = view.text;
        message(slot, title, view.text, view.link, view.status);
      };
      paint(shown);
      retryWhileVisible(async () => {
        const { answer, load } = await describedNow(select);
        if (stop.signal.aborted) return true;
        const view = card(title, answer, load);
        if (!view.retry) {
          paint(view);
          return true;
        }
        const entry = load!.entry!;
        if (failedEntries.has(entry)) {
          // This document keeps the failed import: once the entry answers, a new one loads it.
          if (!(await answers(entry))) {
            // Stopped again: a reload that follows is not the one that came before.
            markReload(undefined);
            return false;
          }
          if (stop.signal.aborted) return true;
          if (reloadedFor(entry)) {
            // It answers, yet failed right after the reload: waiting will not start it.
            markReload(undefined);
            paint({
              retry: false,
              text: `${title} could not start here, even after this page reloaded once.`,
              link: view.link,
              status: undefined,
            });
            return true;
          }
          // Only a document in which no module of this kind ever loaded reloads: then nothing
          // typed into one can be lost. Otherwise the person reloads when ready.
          if (loadedEntries.size || !markReload(entry)) {
            paint({
              retry: false,
              text: `${title} is answering again. Reload this page to open it.`,
              link: view.link,
              status: undefined,
            });
            return true;
          }
          location.reload();
          return true;
        }
        let module: ShellRouteModule;
        try {
          module = (await import(/* @vite-ignore */ entry)) as ShellRouteModule;
          loadedEntries.add(entry);
        } catch {
          failedEntries.add(entry);
          if (!stop.signal.aborted) paint(view);
          return false;
        }
        if (stop.signal.aborted) return true;
        stop.abort();
        let given: Awaited<ReturnType<ShellRouteModule['mount']>>;
        try {
          given = await module.mount(slot);
        } catch {
          // A module that loads but cannot start will not start by waiting: its own page is left.
          painted = '';
          paint({
            retry: false,
            text: `${title} could not start here.`,
            link: view.link,
            status: undefined,
          });
          return true;
        }
        inner = typeof given === 'function' ? { release: given } : (given ?? undefined);
        // The route was left while the module mounted: it goes as the card did.
        if (released) {
          inner?.release();
          return true;
        }
        // A module the host may keep is kept through this card, which then only passes it on.
        if (inner?.location) mounted.location = () => inner!.location!();
        if (inner?.suspend) {
          mounted.suspend = () => inner!.suspend!();
          mounted.resume = (next) => inner!.resume?.(next);
        }
        return true;
      }, stop.signal);
      return mounted;
    },
  };
}

/** The same owner-session/reopen lifetime loads Colab and its described Design module. */
function colabRouteLoad(
  title: string,
  select: (answer: ShellAnswer | undefined) => ModuleLoad | undefined,
): ShellRoute['load'] {
  return async (_remembered, settled) => {
    // Colab loads only from what this page's own read describes: never unpaired.
    let answer = await settled();
    // A paired browser whose door restarted has no session yet: reopen it (an unpaired browser
    // fails on its local record, before any request) and read the shell again.
    if (!answer && (await reopened())) answer = await started?.redescribe();
    const load = select(answer);
    if (load?.entry)
      try {
        const module = (await import(/* @vite-ignore */ load.entry)) as ShellRouteModule;
        loadedEntries.add(load.entry);
        markReload(undefined);
        return module;
      } catch {
        // Its entry did not load (Colab stopped on the machine): the card waits for it.
        failedEntries.add(load.entry);
      }
    const shown = card(title, answer, load);
    return shown.retry
      ? waitingCard(title, select, shown)
      : { mount: (slot) => message(slot, title, shown.text, shown.link) };
  };
}

export const routes: ShellRoute[] = [
  {
    id: 'home',
    paths: ['/'],
    rail: 'home',
    load: async () =>
      remotePage(home, () => homePage(remoteShell()!, (href) => appHref(routes, href))),
  },
  {
    id: 'remote',
    paths: REMOTE_PATHS,
    rail: 'remote',
    // The connection check reads nothing from the door until its own check connects; the settings
    // views ask for the composed shell themselves when they first show.
    quiet: true,
    load: async () => {
      const sheets: { load?: () => Promise<void> } = {};
      return remotePage(
        (slot) => adoptRemote(slot, landing, settings, sheets),
        (slot) =>
          remoteApp(
            remoteShell()!,
            slot.main,
            slot.bar,
            () => sheets.load!(),
            async () => ({
              landing: async (lifetime, registry, connected) => {
                const { landingPage } = await import('./browser.js');
                await landingPage(lifetime, registry, connected, () => rootSession(lifetime));
              },
              settings: async (shell, registry, initial) => {
                const { settingsPage } = await import(/* @vite-ignore */ settingsEntry);
                return settingsPage(shell, registry, initial);
              },
            }),
          ),
      );
    },
  },
  {
    id: 'digest',
    paths: ['/digest', '/digest/'],
    rail: 'digest',
    load: async () => remotePage(digest, () => digestPage(undefined, remoteShell()!.signal)),
  },
  {
    id: 'settings',
    paths: ['/settings', '/settings/'],
    rail: 'settings',
    load: async () => remotePage(tmtSettings, () => tmtSettingsPage(remoteShell()!)),
  },
  {
    id: 'colab',
    paths: ['/colab', '/colab/'],
    rail: 'colab',
    // Colab is kept while another route shows: its session, pages and frames stay (#5954).
    keep: true,
    load: colabRouteLoad('Colab', colabLoad),
  },
];

/** Extra routes come from declarations; the visual rail retains its existing policy. */
function extraRoute(family: string, title: string, rail: string): ShellRoute {
  return {
    id: `extra:${family}`,
    paths: [family, `${family}/`],
    rail,
    load: colabRouteLoad(title, (answer) => {
      const load = extraModuleLoad(answer, family, location.href);
      return load.link ? load : undefined;
    }),
  };
}

function declaredRoutes(answer: ShellAnswer | undefined): ShellRoute[] {
  return rootModules(answer).map((module) =>
    extraRoute(
      module.rootAppFamily as string,
      module.rail.label,
      module.extension === 'colab' && module.module === 'design'
        ? 'design'
        : `${module.extension}:${module.module}`,
    ),
  );
}

/** Whether this browser's pairing reopened a door session. */
async function reopened(): Promise<boolean> {
  try {
    const { reopenSession } = await import('./browser.js');
    await reopenSession();
    return true;
  } catch {
    return false;
  }
}

/** Remote's settings page code, served beside the SDK. */
const settingsEntry = '/sdk/settings-v1.js';

let started: ShellHost | undefined;
let search: RootSearch | undefined;
let session: object | undefined;
let answer: ShellAnswer | undefined;
let observed = false;
let publishSearch: (() => void) | undefined;
let heldBy: (() => string) | undefined;

/** The session is about to change: modules the shell keeps suspended hold the old one, so release
 * them first. */
function sessionChanging(): void {
  started?.sessionChanging();
}

/** A verified replacement retires the old search transport/providers; it grants no access. */
function observedSession(next: object): void {
  if (session === next) return;
  if (session) sessionChanging();
  session = next;
  search?.replace();
  publishSearch?.();
}

let sessionAdmission: { signal: AbortSignal; result: Promise<Session> } | undefined;
/** One root-owned signer, reused by owner reads and DM reads rather than reopened per poll. */
function rootSession(signal?: AbortSignal): Promise<Session> {
  if (!signal && sessionAdmission) return sessionAdmission.result;
  signal ??= new AbortController().signal;
  signal.throwIfAborted();
  if (session && channelFor(session as Session)?.ended === false)
    return Promise.resolve(session as Session);
  if (sessionAdmission?.signal === signal) return sessionAdmission.result;
  const result = import('./browser.js').then(async ({ reopenSession }) => {
    const next = await reopenSession(undefined, { signal });
    signal.throwIfAborted();
    observedSession(next);
    return next;
  });
  const admitted = { signal, result };
  sessionAdmission = admitted;
  void result
    .finally(() => {
      if (sessionAdmission === admitted) sessionAdmission = undefined;
    })
    .catch(() => {});
  return result;
}
function forgetSession(previous: Session): void {
  if (session !== previous) return;
  sessionChanging();
  session = undefined;
  search?.replace();
  publishSearch?.();
}

/** Start the app once in the served shell document. */
export function shellApp(): ShellHost | undefined {
  const root = document.querySelector<HTMLElement>('.tmt-ui-shell');
  if (!root || started || root.dataset.tmtRail) return started;
  applyStoredTheme();
  if (document.documentElement.dataset.tmtPage === 'pair') {
    // Pairing stays its own document (its bootstrap erases the code before any other script), so
    // it shows the rail only; its links load the app's routes.
    root.dataset.tmtRail = 'static';
    const place = { origin: location.origin, href: location.href.split(/[?#]/)[0]! };
    const remote = routes.find((route) => route.id === 'remote');
    mountShell(root, { rail: appRail(rememberedShellAnswer(), routes, place, remote) });
    return undefined;
  }
  const status = document.createElement('p');
  status.className = 'root-search-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  root.append(status);
  search = new RootSearch({
    session: { open: rootSession, forget: (previous) => forgetSession(previous as Session) },
    load: (entry) => import(/* @vite-ignore */ entry) as Promise<SearchModule>,
    container: () => document.body.appendChild(document.createElement('div')),
    failed: (message) => {
      status.textContent = message;
      status.hidden = false;
    },
    navigate: (href) => {
      const destination = new URL(href, location.href);
      const reason = heldBy?.();
      if (reason && started?.route(destination.pathname) !== started?.route(location.pathname)) {
        status.textContent = reason;
        status.hidden = false;
        return;
      }
      started?.navigate(href);
    },
  });
  for (const route of declaredRoutes(rememberedShellAnswer()))
    if (!routes.some((current) => current.id === route.id)) routes.push(route);
  // A cold document knows only its path. The live description must select its script.
  const family = `/${location.pathname.split('/')[1] ?? ''}`;
  if (rootAppFamily(family) && !routes.some((route) => route.paths.includes(family))) {
    // Before the live description arrives, use only the product's existing rail items.
    const known = appRail(undefined, routes, {
      origin: location.origin,
      href: location.href,
    }).main.find((item) => item.id === family.slice(1));
    routes.push(
      extraRoute(
        family,
        family.slice(1).replace(/^./, (letter) => letter.toUpperCase()),
        known?.id ?? 'home',
      ),
    );
  }
  /** The instance still loading or mounting: a later route load ends it before it draws. */
  let mounting: AbortController | undefined;
  const ownedRoutes: ShellRoute[] = [];
  const own = (route: ShellRoute): ShellRoute => ({
    ...route,
    async load(remembered, settled) {
      // Each mounted instance has its own lifetime, ended only by its release, so a module the
      // shell keeps suspended keeps its signal (#5954); one superseded while it mounts ends here.
      mounting?.abort();
      const lifetime = new AbortController();
      mounting = lifetime;
      status.hidden = true;
      // The first read is the live description, never a remembered answer used for the rail.
      void settled().then((read) => {
        if (!observed) {
          observed = true;
          answer = read;
        }
        installRoutes(read);
        publishSearch?.();
      });
      const module = await route.load(remembered, settled);
      return {
        async mount(slot) {
          if (lifetime.signal.aborted) return;
          // The live read can replace a cold route's rail identity. Paint it before the module.
          if (route.id.startsWith('extra:')) slot.setMenu(undefined);
          let active = true;
          let adopted = false;
          let current = slot;
          const publish = () => {
            if (!active || !adopted || !current.topBarReady()) return;
            const place = { origin: location.origin, href: location.href };
            const rail = appRail(answer, routes, place);
            search!.update(
              colabLoad(answer)?.entry,
              navigationSnapshot(answer, [...rail.main, ...rail.bottom], location.href, (path) =>
                appHref(routes, path),
              ),
            );
          };
          const hosted = (slot: ShellSlot): RootSlot => ({
            ...slot,
            routeSignal: lifetime.signal,
            setTopBar() {
              const bar = slot.setTopBar();
              adopted = true;
              publish();
              return bar;
            },
          });
          publishSearch = publish;
          let remotePath = location.pathname;
          const rememberRemotePath = () => {
            if (route.id === 'remote' && remoteItem(location.pathname))
              remotePath = location.pathname;
          };
          window.addEventListener('popstate', rememberRemotePath, { signal: lifetime.signal });
          let given: Awaited<ReturnType<typeof module.mount>>;
          try {
            given = await module.mount(hosted(slot));
          } finally {
            if (mounting === lifetime) mounting = undefined;
          }
          const mounted = typeof given === 'function' ? { release: given } : given;
          const quiet = () => {
            active = false;
            if (publishSearch === publish) publishSearch = undefined;
          };
          const release = () => {
            quiet();
            lifetime.abort();
            mounted?.release();
          };
          const ownedLocation =
            route.id === 'remote' ? () => remotePath : mounted?.location?.bind(mounted);
          if (!mounted?.suspend)
            return ownedLocation ? { release, location: ownedLocation } : release;
          const { suspend, resume } = mounted;
          return {
            release,
            location: ownedLocation,
            suspend() {
              quiet();
              suspend.call(mounted);
            },
            resume(next) {
              current = next;
              active = true;
              publishSearch = publish;
              resume?.call(mounted, hosted(next));
              publish();
            },
          };
        },
      };
    },
  });
  const installRoutes = (read: ShellAnswer | undefined) => {
    if (!read) return;
    const extras = declaredRoutes(read);
    // A changed description replaces its routes; old root claims must not accumulate.
    for (const list of [routes, ownedRoutes])
      for (let index = list.length - 1; index >= 0; index--)
        if (
          list[index]!.id.startsWith('extra:') &&
          !extras.some((extra) => extra.id === list[index]!.id)
        )
          list.splice(index, 1);
    for (const extra of extras) {
      const current = routes.find((route) => route.id === extra.id);
      if (current) {
        current.rail = extra.rail;
        const owned = ownedRoutes.find((route) => route.id === extra.id);
        if (owned) owned.rail = extra.rail;
      } else {
        routes.push(extra);
        ownedRoutes.push(own(extra));
      }
    }
  };
  ownedRoutes.push(...routes.map(own));
  const host = startShellHost(root, ownedRoutes, {
    // Every module shares this tab's one session (#5954); none opens its own.
    sessions: {
      open: rootSession,
      forget: (previous) => forgetSession(previous as Session),
    },
    failed: (main) =>
      main.replaceChildren(
        Object.assign(document.createElement('p'), {
          className: 'page',
          textContent: 'This page could not load. Reload to try again.',
        }),
      ),
  });
  host.setCommonControls({
    openSearch: (opener) => {
      status.hidden = true;
      return search?.open(opener);
    },
    remote: { kind: 'unconfirmed', href: '/remote/' },
  });
  const dispose = () => {
    session = undefined;
    search?.dispose();
    host.dispose();
    status.remove();
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', restore);
    window.removeEventListener('popstate', changed);
    window.removeEventListener('hashchange', changed);
  };
  // Navigation only refreshes what search describes; its Colab transport is replaced only when
  // the session changes or the shell is read again (#5954).
  const changed = () => {
    publishSearch?.();
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) location.reload();
  };
  const hide = () => {
    dispose();
    // A BFCache document has ended sessions and listeners: reopen through its normal entry.
    window.addEventListener('pageshow', restore, { once: true });
  };
  started = {
    ...host,
    async redescribe() {
      search?.replace();
      const read = await host.redescribe();
      answer = read;
      observed = true;
      installRoutes(read);
      publishSearch?.();
      return read;
    },
    dispose,
  };
  window.addEventListener('pagehide', hide, { once: true });
  window.addEventListener('popstate', changed);
  window.addEventListener('hashchange', changed);
  return started;
}

import {
  loadShellAnswer,
  mountShell,
  rememberedShellAnswer,
  shellAddress,
  shellRail,
  underModuleMount,
  type ShellAnswer,
  type ShellControls,
  type ShellMenu,
  type ShellModule,
  type ShellTools,
  type ShellCommonControls,
  type ShellTopBar,
} from './shell.js';
import { createBusyMark } from './static.js';

/**
 * The one TMT web app (#3937, spec c5ccd17a): one document, one `mountShell` instance and one
 * History-API router for every TMT route. Each route is a module that mounts into the shell's
 * main area and header slot through a `ShellSlot` and gives them back when the route changes.
 */

/** What a route module receives: its part of the one shell. */
export interface ShellSlot {
  /** True while this route is current and the root has installed common controls. */
  topBarReady(): boolean;
  /** Adopt the root's common bar; only this route's action slot is exposed. */
  setTopBar(): ShellTopBar;
  /** The content area; the module owns its children until it unmounts. */
  readonly main: HTMLElement;
  /** The header slot (`.tmt-ui-shell-bar`); the module renders its one header here. */
  readonly bar: HTMLElement;
  /** The bar's right-hand cluster: a module with a search or a status chip renders it here. */
  readonly tools: ShellTools;
  /** The route's path prefix, such as `/colab/`; `/` for Home. */
  readonly basePath: string;
  /** The composed shell this page read, if any (display data only). */
  answer(): ShellAnswer | undefined;
  /** The module menu; `select` may take over a plain click on one of its items. */
  setMenu(menu: ShellMenu | undefined, select?: (id: string, href: string) => boolean): void;
  /** The document title; ` · TMT` is appended. */
  setTitle(title: string): void;
  /** Go to a TMT URL without reloading; another module's route unmounts this one. */
  navigate(href: string, options?: { replace?: boolean }): void;
  /** Read the composed shell now, for a route that waits (Remote's landing waits for pairing);
   * `address` is a mount address the page already verified. */
  describe(address?: string): void;
  /** Called once the read settles: the answer, or undefined without an owner session. */
  described(listener: (answer: ShellAnswer | undefined) => void): void;
  /** The tab's one Remote session, opened once and shared by every module; opaque to the shell. */
  session(signal?: AbortSignal): Promise<unknown>;
  /** Forget `previous` (an ended or evicted session) if it is still the current one; a later
   * caller can never drop a newer session. Suspended modules are released first. */
  forgetSession(previous: unknown): void;
}

/** What a mounted module gives back. `release` ends everything it started (sockets, timers,
 * listeners, React roots). A module that also gives `suspend` is kept when its route is left:
 * the host calls `suspend` and holds its main and header nodes aside, and on return puts them
 * back and calls `resume` with a fresh slot instead of mounting again. Suspended means a hidden
 * document: no module-started timers, polling, animation frames or visibility work, and no title,
 * URL or focus changes; data-driven updates may still render into its hidden, inert area, and its
 * sockets and state stay. Focus inside it moves to the new main area before it goes inert, and
 * goes back only on a keyboard return through the rail. If `suspend` or `resume` throws, the host
 * releases it and the next visit mounts afresh. The host
 * keeps one suspended instance per route and at most `KEPT` in all (least recently used goes
 * first), and releases one after `KEPT_FOR` ms, on `pagehide`, on a session change (before the
 * session is forgotten) and on `dispose`. */
export interface ShellMounted {
  release(): void;
  /** The route-owned location to remember when leaving, including after a history traversal. */
  location?(): string;
  suspend?(): void;
  resume?(slot: ShellSlot): void;
}

/** The tab's one session, owned by the app root (Remote's shell) and lent to every module. */
export interface ShellSessions {
  open(signal?: AbortSignal): Promise<unknown>;
  /** Compare-and-forget: forgets only while `previous` is still current. */
  forget(previous: unknown): void;
}

/** Suspended modules kept in all, and how long one is kept. */
export const KEPT = 2;
export const KEPT_FOR = 10 * 60_000;

/** A lazily loaded route module. `mount` may return the function that releases everything it
 * started (sockets, timers, listeners, React roots), which the host calls before the next module,
 * or a `ShellMounted` that may also be suspended and resumed. */
export interface ShellRouteModule {
  mount(
    slot: ShellSlot,
  ): void | (() => void) | ShellMounted | Promise<void | (() => void) | ShellMounted>;
}

export interface ShellRoute {
  id: string;
  /** Path prefixes this route owns, such as `['/colab', '/colab/']`; `'/'` alone matches Home only. */
  paths: readonly string[];
  /** The rail item this route lights: a module's extension, or `home` / `settings`. */
  rail: string;
  /** Leave the composed shell unread until the module calls `describe` (unpaired pages). */
  quiet?: boolean;
  /** Keep its module when the route is left, if the module can be suspended: its main area then
   * stays in place, hidden and inert, so its frames never reload. */
  keep?: boolean;
  /** `settled` resolves with the composed shell once it is read (or undefined without one). */
  load(
    answer: ShellAnswer | undefined,
    settled: () => Promise<ShellAnswer | undefined>,
  ): Promise<ShellRouteModule>;
}

export interface ShellHost {
  /** Common controls belong to the app root, not its route modules. */
  setCommonControls(options: ShellCommonControls | undefined): void;
  navigate(href: string, options?: { replace?: boolean }): void;
  /** Read the composed shell again (after the page reopened its session) and repaint the rail. */
  redescribe(): Promise<ShellAnswer | undefined>;
  /** The route that owns `pathname`, if any. */
  route(pathname: string): ShellRoute | undefined;
  /** The root's session is about to change: release every suspended module first. */
  sessionChanging(): void;
  dispose(): void;
}

export function matchRoute(routes: readonly ShellRoute[], pathname: string) {
  let best: ShellRoute | undefined;
  let length = -1;
  for (const route of routes)
    for (const path of route.paths) {
      const hit =
        path === '/'
          ? pathname === '/'
          : pathname === path || (path.endsWith('/') && pathname.startsWith(path));
      if (hit && path.length > length) {
        best = route;
        length = path.length;
      }
    }
  return best;
}

/** The rail as this app shows it: `route`'s module lit, every item linking to the app's own route
 * for it rather than to a module's mount. */
export function appRail(
  answer: ShellAnswer | undefined,
  routes: readonly ShellRoute[],
  place: { origin: string; href: string },
  route?: ShellRoute,
) {
  const host: ShellModule | undefined =
    route && route.rail !== 'home' && route.rail !== 'settings'
      ? {
          extension: route.rail,
          rail: {
            label: route.rail,
            icon: 'box',
            path: `${place.origin}${route.paths.at(-1)}`,
            order: 0,
          },
          menu: [],
          settings: [],
        }
      : undefined;
  const rail = shellRail(answer, place, host);
  for (const item of [...rail.main, ...rail.bottom])
    if (item.id !== 'home') item.href = appHref(routes, item.href, item.id);
  return rail;
}

/** `href` as a link in this document resolves it: origin, path, query and fragment, as on a click. */
function linkTo(href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  return link;
}

/**
 * Where this app opens `href`: a path under a module's mount opens the same path under that
 * module's route (`…/x/colab/pages/<id>` is `/colab/pages/<id>`), and a rail item `id` the app
 * has a route for opens that route. Anything else is left as it is.
 */
export function appHref(routes: readonly ShellRoute[], href: string, id?: string): string {
  // A described path may be relative to this page.
  const url = linkTo(href);
  const mounted = underModuleMount(url.pathname);
  const owner = routes.find((route) => route.rail === (mounted?.module ?? id));
  const base = owner?.paths.at(-1);
  if (!base) return href;
  if (!mounted) return `${url.origin}${base}`;
  return `${url.origin}${base.replace(/\/?$/, '/')}${mounted.rest}${url.search}${url.hash}`;
}

/**
 * Start the one app in `root`, a `.tmt-ui-shell` element holding `.tmt-ui-shell-content` with
 * `.tmt-ui-shell-bar` and `.tmt-ui-shell-main`. A route the host does not own is a full load.
 */
export function startShellHost(
  root: HTMLElement,
  routes: readonly ShellRoute[],
  options: {
    failed?(main: HTMLElement, route: ShellRoute, error: unknown): void;
    sessions?: ShellSessions;
  } = {},
): ShellHost {
  const document = root.ownerDocument;
  const window = document.defaultView!;
  const bar = root.querySelector<HTMLElement>(
    ':scope > .tmt-ui-shell-content > .tmt-ui-shell-bar',
  )!;
  /** The shown main area. A kept module keeps the element it was drawn in, renamed
   * `.tmt-ui-shell-kept` and hidden in place, and a fresh main takes its place. */
  let main = root.querySelector<HTMLElement>(
    ':scope > .tmt-ui-shell-content > .tmt-ui-shell-main',
  )!;
  // While the main area has no content of its own (a route loading, or a module that mounts an
  // empty root and fills it later), the busy mark holds its place, centred (shell.css). It sits
  // beside the main area, so a module that clears the main area keeps it.
  const loading = document.createElement('div');
  loading.className = 'tmt-ui-shell-loading';
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-label', 'Loading');
  loading.append(createBusyMark(document));
  main.after(loading);
  let answer: ShellAnswer | undefined = rememberedShellAnswer();
  let current: { route: ShellRoute; mounted?: ShellMounted; generation: number } | undefined;
  /** Suspended modules by route, least recently used first. */
  const kept = new Map<
    string,
    {
      route: ShellRoute;
      mounted: ShellMounted;
      generation: number;
      area: HTMLElement;
      /** What had focus in the module when it was left, for a keyboard return through the rail. */
      focus?: HTMLElement;
      nodes: [HTMLElement, Node[]][];
      /** It had adopted the common top bar, which the host adopts again before its nodes return. */
      topBar: boolean;
      menu: ShellMenu | undefined;
      select: ((id: string, href: string) => boolean) | undefined;
      title: string;
      timer: number;
    }
  >();
  let menu: ShellMenu | undefined;
  let select: ((id: string, href: string) => boolean) | undefined;
  let asked = false;
  let settled = false;
  const listeners: ((answer: ShellAnswer | undefined) => void)[] = [];
  let generation = 0;
  let disposed = false;
  const lastLocation = new Map<string, string>();
  const rememberLocation = (route: ShellRoute, href: string) => {
    const url = linkTo(href);
    if (url.origin !== window.location.origin || matchRoute(routes, url.pathname) !== route) return;
    // Remote URLs can contain invitation or pairing material; its rail keeps only the route path.
    lastLocation.set(route.id, route.rail === 'remote' ? url.origin + url.pathname : url.href);
  };

  const place = () => ({
    origin: window.location.origin,
    href: window.location.href.split(/[?#]/)[0]!,
  });
  /** The rail links to this app's routes, not to a module's own mount. */
  const view = () => {
    const rail = appRail(answer, routes, place(), current?.route);
    for (const item of [...rail.main, ...rail.bottom]) {
      const route = routes.find((candidate) => candidate.rail === item.id);
      if (route && route !== current?.route) item.href = lastLocation.get(route.id) ?? item.href;
    }
    return { rail, menu };
  };
  const controls: ShellControls = mountShell(root, view(), (id, href) => {
    if (select?.(id, href)) return true;
    return go(href);
  });
  const paint = () => controls.update(view());

  const describe = (known?: string) => {
    if (asked) return;
    asked = true;
    void (known === undefined ? shellAddress() : Promise.resolve(known)).then(async (address) => {
      const read = address === undefined ? undefined : await loadShellAnswer(address);
      if (read) {
        answer = read;
        paint();
      }
      settled = true;
      for (const listener of listeners.splice(0)) listener(read);
    });
  };

  const slot = (route: ShellRoute, mine: number): ShellSlot => ({
    main,
    bar,
    tools: controls.tools,
    topBarReady: () => !disposed && current?.generation === mine && controls.topBarReady(),
    setTopBar: () =>
      current?.generation === mine
        ? controls.setTopBar()
        : {
            title: document.createElement('div'),
            actions: document.createElement('div'),
            status: document.createElement('div'),
          },
    basePath: route.paths.at(-1)!,
    answer: () => answer,
    setMenu(next, handler) {
      if (current?.generation !== mine) return;
      menu = next;
      select = handler;
      paint();
    },
    setTitle(title) {
      if (current?.generation === mine) document.title = `${title} · TMT`;
    },
    navigate: (href, options) => void go(href, options),
    describe,
    described(listener) {
      if (settled) listener(answer);
      else listeners.push(listener);
    },
    session: (signal) =>
      options.sessions
        ? options.sessions.open(signal)
        : Promise.reject(new Error('This shell has no Remote session')),
    forgetSession(previous) {
      if (!options.sessions) return;
      releaseKept();
      options.sessions.forget(previous);
    },
  });

  const release = (mounted: ShellMounted | undefined) => {
    try {
      mounted?.release();
    } catch {
      // A module that fails to release has nothing more the host can do for it.
    }
  };
  /** The header and tool nodes a kept module drew, held aside while it is suspended. They hold
   * no frames; its main area, which may, never moves. */
  const areas = () => [bar, controls.tools.search, controls.tools.chip];
  /** Make `next` the shown main area, with the loading mark right after it (shell.css reads it). */
  function showMain(next: HTMLElement) {
    main = next;
    next.className = 'tmt-ui-shell-main';
    next.hidden = false;
    next.inert = false;
    next.after(loading);
  }
  function drop(id: string) {
    const held = kept.get(id);
    if (!held) return;
    kept.delete(id);
    window.clearTimeout(held.timer);
    release(held.mounted);
    held.area.remove();
  }
  function releaseKept() {
    for (const id of kept.keys()) drop(id);
  }
  /** Leave the current module: suspend it when it can be kept, else release it. */
  function leave() {
    const leaving = current;
    if (leaving) {
      try {
        const owned = leaving.mounted?.location?.();
        if (owned) rememberLocation(leaving.route, owned);
        else rememberLocation(leaving.route, window.location.href);
      } catch {
        // A location failure must not prevent the route from being released or suspended.
      }
    }
    try {
      // The module suspends while its slot is still current, so it sees the shell it was drawn in.
      if (leaving) keep(leaving);
    } finally {
      current = undefined;
    }
  }
  function keep(leaving: NonNullable<typeof current>) {
    const { mounted, route } = leaving;
    if (!mounted?.suspend || !route.keep || disposed) return release(mounted);
    try {
      mounted.suspend();
    } catch {
      return release(mounted);
    }
    // Its main area stays where it is, hidden and inert, so its frames never unload; a fresh
    // main, a shallow copy of it, takes its place.
    const area = main;
    const active = document.activeElement;
    const focus =
      active instanceof window.HTMLElement && area.contains(active) ? active : undefined;
    showMain(area.cloneNode(false) as HTMLElement);
    area.after(main, loading);
    // Focus inside the module moves to the new route's main area before the module goes inert,
    // so it never falls to the page body.
    if (focus) {
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
    area.className = 'tmt-ui-shell-kept';
    area.hidden = true;
    area.inert = true;
    drop(route.id);
    kept.set(route.id, {
      route,
      mounted,
      generation: leaving.generation,
      area,
      focus,
      // The common top bar is the shell's, not the module's: it is disposed now and adopted anew.
      nodes: areas().map((place) => [
        place,
        [...place.childNodes].filter((node) => !(node as Element).matches?.('.tmt-ui-topbar')),
      ]),
      topBar: !!bar.querySelector(':scope > .tmt-ui-topbar'),
      menu,
      select,
      title: document.title,
      timer: window.setTimeout(() => drop(route.id), KEPT_FOR),
    });
    for (const place of areas().slice(1)) place.replaceChildren();
    while (kept.size > KEPT) drop(kept.keys().next().value!);
  }
  /** Put a suspended module back; false when it could not be resumed (it is then released). */
  function revive(route: ShellRoute): boolean {
    const held = kept.get(route.id);
    if (!held) return false;
    kept.delete(route.id);
    window.clearTimeout(held.timer);
    ++generation;
    current = { route, mounted: held.mounted, generation: held.generation };
    // Adopting the top bar replaces the bar's children, so it comes first and the module's own
    // header nodes follow it, as when the module adopted it while mounting.
    if (held.topBar && controls.topBarReady()) controls.setTopBar();
    else bar.replaceChildren();
    for (const [place, nodes] of held.nodes)
      if (place === bar) bar.append(...nodes);
      else place.replaceChildren(...nodes);
    // The main a released module used goes; the kept area is the main again, where it was.
    const spare = main;
    showMain(held.area);
    spare.remove();
    main.dataset.route = route.id;
    // Focus goes back into the module only when the user came back with the keyboard through the
    // rail; a pointer return leaves it where the user put it.
    const via = document.activeElement;
    if (
      held.focus?.isConnected &&
      via instanceof window.HTMLElement &&
      root.contains(via) &&
      !via.closest('.tmt-ui-shell-content') &&
      via.matches(':focus-visible')
    )
      held.focus.focus({ preventScroll: true });
    menu = held.menu;
    select = held.select;
    document.title = held.title;
    paint();
    try {
      held.mounted.resume?.(slot(route, held.generation));
      return true;
    } catch {
      current = undefined;
      for (const place of areas().slice(1)) place.replaceChildren();
      release(held.mounted);
      // A fresh main for the visit that now mounts the module again.
      const fresh = main.cloneNode(false) as HTMLElement;
      main.after(fresh);
      main.remove();
      showMain(fresh);
      return false;
    }
  }
  const pagehide = () => releaseKept();
  window.addEventListener('pagehide', pagehide);

  /** The path a full load was last asked for, so a route the door serves but this app does not
   * know reloads once, then lands on Home instead of reloading forever. */
  const RELOADED = 'tmt-shell-reloaded';
  const remember = (path: string | undefined): boolean => {
    try {
      if (path === undefined) window.sessionStorage.removeItem(RELOADED);
      else window.sessionStorage.setItem(RELOADED, path);
      return true;
    } catch {
      return false;
    }
  };
  let reloaded: string | null = null;
  try {
    reloaded = window.sessionStorage.getItem(RELOADED);
  } catch {
    reloaded = null;
  }
  function elsewhere() {
    const path = window.location.pathname;
    // Without storage there is no way to tell a second load, so it goes Home at once.
    if (reloaded !== path && remember(path)) return window.location.reload();
    remember(undefined);
    window.history.replaceState(null, '', '/');
    return void show();
  }

  async function show() {
    if (disposed) return;
    const route = matchRoute(routes, window.location.pathname);
    if (!route) return elsewhere();
    remember(undefined);
    if (current?.route === route) {
      rememberLocation(route, window.location.href);
      return paint();
    }
    leave();
    rememberLocation(route, window.location.href);
    controls.clearTopBar();
    menu = undefined;
    select = undefined;
    if (revive(route)) return;
    const mine = ++generation;
    current = { route, generation: mine };
    // The bar names the module at once, as a title; the module's own header replaces it when it
    // arrives (shell.css), so the header row never waits for a module to load.
    const label = [...view().rail.main, ...view().rail.bottom].find((item) => item.current)?.label;
    const placeholder = document.createElement('header');
    placeholder.className = 'tmt-ui-header';
    placeholder.dataset.shellPlaceholder = '';
    if (label && route.rail !== 'home') {
      const title = document.createElement('span');
      title.className = 'tmt-ui-title';
      title.textContent = label;
      placeholder.append(title);
    }
    bar.replaceChildren(placeholder);
    main.replaceChildren();
    main.dataset.route = route.id;
    paint();
    if (!route.quiet) describe();
    try {
      const module = await route.load(
        answer,
        () => new Promise((resolve) => (settled ? resolve(answer) : listeners.push(resolve))),
      );
      if (current?.generation !== mine) return;
      const given = await module.mount(slot(route, mine));
      const mounted = typeof given === 'function' ? { release: given } : (given ?? undefined);
      if (current?.generation !== mine) return release(mounted);
      current.mounted = mounted;
    } catch (error) {
      if (current?.generation !== mine) return;
      main.replaceChildren();
      options.failed?.(main, route, error);
    }
  }

  /** Same-origin URL this app owns: change the history entry and show its route. */
  function go(href: string, { replace = false } = {}): boolean {
    if (disposed) return false;
    const url = linkTo(href);
    if (url.origin !== window.location.origin || !matchRoute(routes, url.pathname)) return false;
    // A fragment on the same page is the page's own (a module section): the browser moves it and
    // fires hashchange, as for any in-page link.
    const here = window.location;
    if (url.hash && url.pathname === here.pathname && url.search === here.search) {
      if (url.hash !== here.hash) window.location.hash = url.hash;
      return true;
    }
    // A module that is left is suspended or released before the URL changes, so its own router
    // never follows a location that is not its own (#5954).
    if (matchRoute(routes, url.pathname) !== current?.route) leave();
    if (url.href !== window.location.href)
      window.history[replace ? 'replaceState' : 'pushState'](null, '', url.href);
    // A module's own router (Colab's) follows history through popstate, as on Back.
    if (matchRoute(routes, url.pathname) === current?.route)
      window.dispatchEvent(new PopStateEvent('popstate'));
    else void show();
    return true;
  }

  // Links anywhere in the page that point at another of this app's routes stay in the app.
  // A module's own in-module links (Colab's router) handle the click first.
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey) return;
    if (event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (
      !(anchor instanceof window.HTMLAnchorElement) ||
      anchor.target ||
      anchor.hasAttribute('download')
    )
      return;
    const url = anchor;
    const route = matchRoute(routes, url.pathname);
    if (url.origin !== window.location.origin || !route) return;
    if (route === current?.route) return;
    event.preventDefault();
    go(url.href);
  };
  const popstate = () => void show();
  document.addEventListener('click', click);
  window.addEventListener('popstate', popstate);
  void show();
  return {
    setCommonControls: controls.setCommonControls,
    navigate: (href, options) => void go(href, options),
    redescribe: () =>
      new Promise((resolve) => {
        if (disposed) return resolve(undefined);
        asked = false;
        settled = false;
        listeners.push(resolve);
        describe();
      }),
    route: (pathname) => matchRoute(routes, pathname),
    sessionChanging: releaseKept,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      loading.remove();
      document.removeEventListener('click', click);
      window.removeEventListener('popstate', popstate);
      window.removeEventListener('pagehide', pagehide);
      release(current?.mounted);
      current = undefined;
      releaseKept();
      for (const listener of listeners.splice(0)) listener(undefined);
      controls.dispose();
    },
  };
}

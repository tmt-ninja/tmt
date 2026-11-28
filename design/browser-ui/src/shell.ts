import { brandMarkSvg } from './brand-mark-svg.js';
import { claimIconActionTooltip } from './icon-action-tooltip.js';
import { moduleIcon, shellIconNodes, type ShellIcon } from './shell-icons.js';
import {
  createShellMenuInteractions,
  type ShellMenuInteractions,
} from './shell-menu-interactions.js';
import { countText } from './static.js';
import { keyTurn } from './trusted-activation.js';
import { createShellTopBar, type ShellCommonControls, type ShellTopBar } from './topbar.js';
import { mountBrowserMenu, type BrowserMenuHostItem } from './menu-host.js';
import { railCollapsed, setRailCollapsed, subscribeRail } from './rail-state.js';
export type { ShellCommonControls, ShellRemoteStatus, ShellTopBar } from './topbar.js';
export { railCollapsed, railStorageKey, setRailCollapsed, subscribeRail } from './rail-state.js';

/**
 * The one TMT web shell (#3937, Colab page c5ccd17a): a full-width global rail,
 * an optional module menu, then the host's own header and content. One framework-free renderer
 * serves the static Remote pages and, through `BrowserShell`, React hosts; labels are always
 * text nodes. The rail is one fixed list, filled from Remote's composed module descriptions.
 */

/** `GET <address>/x/-/shell`, version 1 (contracts/remote-channel-v1.md). Paths are absolute. */
export interface ShellAnswer {
  version: 1;
  modules: ShellModule[];
}
export interface ShellModule {
  extension: string;
  /** An extension's extra module (#5811/#5819), such as Colab's `design`; absent on its primary. */
  module?: string;
  rail: { label: string; icon: string; path: string; order: number };
  menu: { id: string; label: string; path: string; group?: string; count?: ShellAnswerCount }[];
  settings: { id: string; label: string; path: string }[];
  needsYou?: number;
  home?: { id: string; title: string; path: string }[];
  /** The page this module offers as Home (#6474), an absolute URL under its own mount. */
  homePage?: string;
}

/**
 * The page that replaces Remote's Home (#6474): the one module that claims it, when its claim is
 * a URL under that module's own mount. No claim, an invalid one or two claims keep Remote's Home.
 */
export function claimedHome(answer: ShellAnswer | undefined): string | undefined {
  const claims = (answer?.modules ?? []).filter((module) => module.homePage !== undefined);
  const module = claims.length === 1 ? claims[0] : undefined;
  if (!module) return undefined;
  const home = module.homePage;
  const mount = module.rail.path.replace(/\/?$/, '/');
  return !module.module &&
    typeof home === 'string' &&
    home.startsWith(mount) &&
    !/[?#]/.test(home) &&
    !home.slice(mount.length).split('/').includes('..')
    ? home
    : undefined;
}
interface ShellAnswerCount {
  value: number;
  kind: 'needs-you' | 'plain';
}

export interface ShellCount {
  text: string;
  needsYou: boolean;
}
export interface ShellItem {
  id: string;
  label: string;
  icon: ShellIcon;
  href: string;
  count?: ShellCount;
  current: boolean;
  /** An unavailable module stays in the rail, dimmed, with `note` saying why. */
  disabled?: boolean;
  note?: string;
}
export interface ShellMenuItem {
  id: string;
  label: string;
  href: string;
  count?: ShellCount;
  current: boolean;
  /** Up to two short neutral trailing badges, in place of the row's counts. */
  badges?: readonly string[];
  /** Host-owned decorative node in the glyph slot, with its accessible description. */
  leading?: { node: Node; label: string };
  /** Plain total beside an attention dot; zero is hidden. */
  total?: number;
  /** Decorative host-selected icon; omitted on ordinary text rows. */
  icon?: ShellIcon;
  /** Up to two host-owned commands, shown on hover/focus without activating this link. */
  actions?: readonly ShellMenuIconAction[];
  /** Shown but not followed; `note` says why (its tooltip and description). */
  disabled?: boolean;
  note?: string;
  /** Bold label, never a colour; the count slot is unchanged. */
  emphasis?: 'unread';
  /** One nested level (a child's own children are not drawn), shown while `expanded`. */
  children?: readonly ShellMenuItem[];
  /** Host-owned disclosure state; the rail never flips it itself. */
  expanded?: boolean;
  /** Requests the opposite `expanded`; the host answers with a new view. */
  toggle?(): void;
}
/** A host-owned command, never a navigation destination or current row. */
export interface ShellMenuAction {
  label: string;
  onActivate(): void;
  /** Explain an unavailable command without removing it from the menu. */
  disabledReason?: string;
}
export interface ShellMenuIconAction extends ShellMenuAction {
  icon: ShellIcon;
}
export interface ShellMenuGroup {
  label?: string;
  /** Decorative icon for rows without their own icon, independent of the heading. */
  fallbackIcon?: ShellIcon;
  /** At most one command beside the heading; omitting the icon renders its label as text. */
  action?: ShellMenuAction & { icon?: ShellIcon };
  items: ShellMenuItem[];
  /** Inline read failure and a host-owned retry command. */
  alert?: { message: string; retry: ShellMenuAction };
  /** Visible and accessible label; the rail adds the decorative plus icon. */
  add?: ShellMenuAction;
  /** Request moving fromId to the current index of toId; the host supplies the resulting order. */
  reorder?(fromId: string, toId: string): void;
}
/** One CSS pixel in layout units: the rail is measured in Chromium's own layout unit, so a row's
 * height (14px at a 1.3 line height is 18.2px) is kept exactly and never adds up rounding. */
export const LAYOUT_UNIT = 64;
/** A drawn module menu's geometry, in layout units (#6757): per group the height of its heading
 * (null: it has none), per row its height above any children and its depth (1: a child of the
 * last row of depth 0), and the settings row's height (null: none). Nothing else: no label, glyph
 * or kind of row, so it matches every present and future row by construction. */
export interface ShellMenuGeometry {
  groups: { head: number | null; rows: { height: number; depth: 0 | 1 }[] }[];
  settings: number | null;
}
export interface ShellMenu {
  title: string;
  groups: ShellMenuGroup[];
  /** Host-drawn stand-in for the menu this route set last (#6750): blank, inert rows of exactly its
   * drawn geometry, hidden from assistive technology until the module's own menu replaces it. */
  placeholder?: ShellMenuGeometry;
  /** Module settings, always last after a hairline. */
  settings?: ShellMenuItem;
}
export interface ShellView {
  rail: { main: ShellItem[]; bottom: ShellItem[] };
  menu?: ShellMenu;
}
export interface ShellPlace {
  origin: string;
  /** Current URL without query or fragment. */
  href: string;
}

/** Bounded count values, omitting zero and unknown. The renderer draws attention as a dot
 * before the plain total and retains its count in the accessible description. */
export function entryCounts(item: { total?: number; count?: ShellCount }): ShellCount[] {
  return [
    ...(item.total && item.total > 0 ? [shellCount(item.total, 'plain')] : []),
    ...(item.count && item.count.text !== '0' ? [item.count] : []),
  ];
}

/** Count text is bounded at `99+`; the renderer uses attention as a dot and spoken count. */
export function shellCount(value: number, kind: 'needs-you' | 'plain' = 'needs-you'): ShellCount {
  return { text: countText(value), needsYou: kind === 'needs-you' };
}

/** The answer this browser read last, shared by every page so each paints the same rail first. */
const ANSWER_KEY = 'tmt-shell-answer-v1';
export function rememberedShellAnswer(): ShellAnswer | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(ANSWER_KEY) ?? 'null') as ShellAnswer | null;
    return stored?.version === 1 && Array.isArray(stored.modules) ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** The door's mount of one module: `/r/<prefix>/x/<module>/`, the prefix being the machine's 16
 * lowercase base32 letters. The one definition of that shape for every product. */
/** A module mount, `/r/<prefix>/x/<module>/`, at the start of a path. */
const MODULE_MOUNT = /^(\/r\/[a-z2-7]{16})\/x\/([a-z0-9][a-z0-9-]{0,31})\//;

/** The module a mount path names, or undefined when `pathname` is not exactly a module mount. */
export function moduleMount(pathname: string): string | undefined {
  const mount = MODULE_MOUNT.exec(pathname);
  return mount?.[0] === pathname ? mount[2] : undefined;
}

/** The module whose mount `pathname` lies under, and the rest of the path below that mount. */
export function underModuleMount(pathname: string): { module: string; rest: string } | undefined {
  const mount = MODULE_MOUNT.exec(pathname);
  return mount ? { module: mount[2]!, rest: pathname.slice(mount[0].length) } : undefined;
}

/**
 * Where this page reads the composed shell: the `/r/<prefix>` mount it sits under, else the door's
 * answer for its path (`POST /sdk/mount`). Undefined when neither answers.
 */
export async function shellAddress(): Promise<string | undefined> {
  const mounted = MODULE_MOUNT.exec(location.pathname);
  if (mounted) return `${location.origin}${mounted[1]}`;
  try {
    const response = await fetch('/sdk/mount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: location.pathname }),
    });
    if (response.status !== 200) return undefined;
    const { address } = (await response.json()) as { address?: unknown };
    return typeof address === 'string' ? address : undefined;
  } catch {
    return undefined;
  }
}

/** Fetch the owner's composed shell once per page; any failure leaves the remembered answer. */
export async function loadShellAnswer(address: string): Promise<ShellAnswer | undefined> {
  try {
    const response = await fetch(`${address}/x/-/shell`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    const answer = (await response.json()) as ShellAnswer;
    if (answer?.version !== 1 || !Array.isArray(answer.modules)) return undefined;
    try {
      sessionStorage.setItem(ANSWER_KEY, JSON.stringify(answer));
    } catch {
      // Without storage each page still reads its own answer.
    }
    return answer;
  } catch {
    return undefined;
  }
}

/**
 * The one rail (spec c5ccd17a): the same items in the same order on every page, whatever module
 * hosts it. A module the composed answer does not describe stays, dimmed, with the reason.
 */
const RAIL: readonly { id: string; label: string; icon: ShellIcon; path: string }[] = [
  { id: 'colab', label: 'Colab', icon: 'file-text', path: '/colab/' },
  // Design is Colab's extra module, a peer beside it (#5873).
  { id: 'design', label: 'Design', icon: 'palette', path: '/colab/design/' },
  { id: 'remote', label: 'Remote', icon: 'monitor-smartphone', path: '/remote/' },
  { id: 'digest', label: 'Digest', icon: 'chart-column', path: '/digest/' },
];
/**
 * A described module's key (#5819): the extension for its primary, `<extension>:<module>` for an
 * extra, so an extra sits beside its primary. Rail item ids use the same key, except Colab's
 * Design extra, which is the fixed `design` item.
 */
export const shellModuleKey = (module: Pick<ShellModule, 'extension' | 'module'>) =>
  module.module ? `${module.extension}:${module.module}` : module.extension;
/** Served by the TMT host itself, so always reachable from the rail. */
const HOST_SERVED = new Set(['remote', 'digest']);

/**
 * Home, the fixed modules (Colab, Design, Remote, Digest), any other described module in Remote's
 * order, then TMT settings at the bottom. Colab is available
 * when the answer describes it or it hosts the page; without an answer (not paired) it is dimmed.
 * The current item is the host's module, else the longest matching path.
 */
export function shellRail(
  answer: ShellAnswer | undefined,
  place: ShellPlace,
  host?: ShellModule,
): ShellView['rail'] {
  const active = host?.extension;
  const keyOf = shellModuleKey;
  const owner = (id: string) => (id === 'design' ? 'colab' : id.split(':')[0]);
  const described = new Map((answer?.modules ?? []).map((module) => [keyOf(module), module]));
  const primaries = (answer?.modules ?? []).filter((module) => !module.module);
  // The host page's own module is available even when the answer does not describe it.
  const hosted = (id: string) => host?.extension === id;
  const path = place.href.slice(place.origin.length);
  const settings = path === '/settings' || path.startsWith('/settings/');
  const unavailable = answer
    ? 'Not installed on this machine'
    : 'Pair this browser with Remote to open it';
  const modules = [
    ...RAIL.map((fixed) => {
      // Design is Colab's extra module: its own destination and no duplicate attention count.
      // Before Colab describes it, the rail keeps Colab's own Design route.
      if (fixed.id === 'design') {
        const module = described.get('colab:design');
        return {
          id: fixed.id,
          label: module?.rail.label ?? fixed.label,
          icon: module ? moduleIcon(module.rail.icon) : fixed.icon,
          href: module?.rail.path ?? `${place.origin}${fixed.path}`,
          needsYou: undefined,
          available: described.has('colab') || hosted('colab'),
        };
      }
      const module = described.get(fixed.id);
      return {
        id: fixed.id,
        label: module?.rail.label ?? fixed.label,
        icon: module ? moduleIcon(module.rail.icon) : fixed.icon,
        href:
          module?.rail.path ??
          (hosted(fixed.id) ? host!.rail.path : `${place.origin}${fixed.path}`),
        needsYou: module?.needsYou,
        available: Boolean(module) || hosted(fixed.id) || HOST_SERVED.has(fixed.id),
      };
    }),
    ...[...described.values(), ...(host && !described.has(keyOf(host)) ? [host] : [])]
      .filter((module) =>
        module.module
          ? keyOf(module) !== 'colab:design'
          : !RAIL.some((fixed) => fixed.id === module.extension),
      )
      .sort((a, b) => a.rail.order - b.rail.order)
      .map((module) => ({
        id: keyOf(module),
        label: module.rail.label,
        icon: moduleIcon(module.rail.icon),
        href: module.rail.path,
        needsYou: module.module ? undefined : module.needsYou,
        available: true,
      })),
  ];
  const longest = modules
    .filter((module) => module.available && place.href.startsWith(module.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.id;
  // A host's extra module (Colab's Design) wins within that host by its longer path.
  const matched = longest && owner(longest) === active ? longest : (active ?? longest);
  // Attention counts come from each extension's primary module only.
  const counts = primaries.map((module) => module.needsYou);
  const total =
    answer && counts.every((count) => count !== undefined)
      ? counts.reduce<number>((sum, count) => sum + count!, 0)
      : undefined;
  // A claimed Home opens the claiming module's page and is current there, not the module.
  const home = claimedHome(answer);
  const atHome = home !== undefined && place.href.split(/[?#]/)[0] === home;
  const main: ShellItem[] = [
    {
      id: 'home',
      label: 'Home',
      icon: 'house',
      href: home ?? `${place.origin}/`,
      count: total ? shellCount(total) : undefined,
      current: (path === '/' && !active) || atHome,
    },
    ...modules.map((module) => ({
      id: module.id,
      label: module.label,
      icon: module.icon,
      href: module.href,
      count: module.needsYou ? shellCount(module.needsYou) : undefined,
      current: !settings && !atHome && module.id === matched,
      ...(module.available ? {} : { disabled: true, note: unavailable }),
    })),
  ];
  const bottom: ShellItem[] = [
    {
      id: 'settings',
      label: 'TMT settings',
      icon: 'settings',
      href: `${place.origin}/settings/`,
      current: settings,
    },
  ];
  return { main, bottom };
}

/** A described module's own menu: entries in order, grouped, then its settings pages. */
export function describedMenu(module: ShellModule, place: ShellPlace): ShellMenu {
  const groups: ShellMenu['groups'] = [];
  for (const entry of module.menu) {
    const last = groups.at(-1);
    const item = {
      id: entry.id,
      label: entry.label,
      href: entry.path,
      count:
        entry.count && entry.count.value > 0
          ? shellCount(entry.count.value, entry.count.kind)
          : undefined,
      current: false,
    };
    if (last && last.label === entry.group) last.items.push(item);
    else groups.push({ label: entry.group, items: [item] });
  }
  if (module.settings.length)
    groups.push({
      items: module.settings.map((page) => ({
        id: page.id,
        label: page.label,
        href: page.path,
        current: false,
      })),
    });
  const items = groups.flatMap((group) => group.items);
  const current = items
    .filter((item) => place.href.startsWith(item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (current) current.current = true;
  return { title: module.rail.label, groups };
}

const SVG = 'http://www.w3.org/2000/svg';

function icon(document: Document, name: ShellIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'tmt-ui-shell-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of shellIconNodes[name]) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}
function count(document: Document, text: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'tmt-ui-shell-count';
  // The number alone: the colour and the item's accessible name say what it counts.
  badge.textContent = text;
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

function attention(document: Document): HTMLElement {
  const dot = document.createElement('span');
  dot.className = 'tmt-ui-attention-dot';
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/** The bar's right-hand cluster: a module fills `search` and `chip`; an empty slot takes no room. */
export interface ShellTools {
  readonly search: HTMLElement;
  readonly chip: HTMLElement;
}

/** Explicit nested layer host; omitted for the product's viewport and browser top layer. */
export interface ShellLayerHost {
  root: HTMLElement;
  portal: HTMLElement;
}

export interface ShellControls {
  readonly tools: ShellTools;
  /** Root-only common bindings; route modules never receive this method. */
  setCommonControls(options: ShellCommonControls | undefined): void;
  /** True while common controls are installed and the shell is not disposed. */
  topBarReady(): boolean;
  setTopBar(): ShellTopBar;
  /** The route owner releases the active action slot and transient common UI. */
  clearTopBar(): void;
  update(view: ShellView): void;
  /** The drawn module menu's geometry; undefined when there is nothing new to keep: none is drawn,
   * the rail is hidden (a closed phone drawer), or the rows are the ones measured last (an update
   * that kept every element only changed text and attributes, never a one-line row's height). */
  menuGeometry(): ShellMenuGeometry | undefined;
  dispose(): void;
}

/**
 * The one selected row a menu shows: the first current entry, where a current child selects
 * itself while its parent is expanded and selects its parent while collapsed.
 */
export function visibleCurrent(menu: ShellMenu | undefined): ShellMenuItem | undefined {
  if (!menu) return undefined;
  for (const item of [
    ...menu.groups.flatMap((group) => group.items),
    ...(menu.settings ? [menu.settings] : []),
  ]) {
    const child = item.children?.find((entry) => entry.current);
    if (child) return item.expanded ? child : item;
    if (item.current) return item;
  }
  return undefined;
}

let branchIds = 0;

/**
 * Render the rail and module menu into `root`, the `.tmt-ui-shell` element that holds
 * `.tmt-ui-shell-content` with the host's `.tmt-ui-shell-bar` (its one header) and
 * `.tmt-ui-shell-main`. On wide screens the TMT mark and the bar form one header row
 * (TMT, then the host's `<module> / <page>`), over the rail, the module menu column and the main
 * area; phones show the same nested tree inside the navigation drawer. `select` may take over a plain click
 * on an item (an SPA route or Colab's search); it returns true when it handled the click.
 */
export function mountShell(
  root: HTMLElement,
  view: ShellView,
  select?: (id: string, href: string) => boolean,
  layerHost?: ShellLayerHost,
): ShellControls {
  const document = root.ownerDocument;
  root.classList.add('tmt-ui-shell');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'tmt-ui-shell-open';
  open.setAttribute('aria-label', 'Open navigation');
  open.setAttribute('aria-expanded', 'false');
  open.append(icon(document, 'menu'));
  // The rail's head: the TMT mark and wordmark. It is the one place the brand sits; pages carry
  // no breadcrumb.
  const brand = document.createElement('div');
  brand.className = 'tmt-ui-shell-brand';
  brand.innerHTML = brandMarkSvg({ size: 32 });
  const text = document.createElement('span');
  text.className = 'tmt-ui-shell-brand-text';
  const word = document.createElement('span');
  word.className = 'tmt-ui-shell-brand-word';
  word.textContent = 'tmt';
  const sub = document.createElement('span');
  sub.className = 'tmt-ui-shell-brand-sub';
  sub.textContent = 'terminal team';
  text.append(word, sub);
  // The wide screen's side menu collapses from its head (#6833); a phone keeps its drawer.
  const apple = /Mac|iPhone|iPad|iPod/.test(document.defaultView!.navigator.platform);
  const keys = apple ? 'Meta+Backslash' : 'Control+Backslash';
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.className = 'tmt-ui-rail-collapse';
  collapse.setAttribute('aria-keyshortcuts', keys);
  brand.append(text, collapse);
  const rail = document.createElement('nav');
  rail.className = 'tmt-ui-rail';
  rail.setAttribute('aria-label', 'TMT');
  const syncRailScroll = () => rail.toggleAttribute('data-scrolled', rail.scrollTop > 0);
  rail.addEventListener('scroll', syncRailScroll, { passive: true });
  const menu = document.createElement('nav');
  menu.className = 'tmt-ui-module-menu';
  root.prepend(open, rail);
  const bar = root.querySelector<HTMLElement>(
    ':scope > .tmt-ui-shell-content > .tmt-ui-shell-bar',
  )!;
  const shellContent = bar.parentElement!;
  const railSearch = document.createElement('div');
  railSearch.className = 'tmt-ui-rail-search-section';
  // While the side menu is collapsed, the bar's controls reach the rail's places (#6833).
  const goTo = document.createElement('span');
  goTo.className = 'tmt-ui-shell-goto';
  const topBar = createShellTopBar(root, bar, open, railSearch, layerHost, goTo);
  bar.after(menu);
  // The cluster is the bar's second layer: it sits over the bar's right end and tells the host
  // header how much room to leave (`--tmt-ui-shell-tools-width`). A React shell draws the element
  // itself, so its modules can portal into the slots on their first render.
  const slotOf = (parent: HTMLElement, name: 'search' | 'chip') => {
    const existing = parent.querySelector<HTMLElement>(`:scope > .tmt-ui-shell-tools-${name}`);
    if (existing) return existing;
    const created = document.createElement('div');
    created.className = `tmt-ui-shell-tools-${name}`;
    parent.append(created);
    return created;
  };
  const drawn = root.querySelector<HTMLElement>(
    ':scope > .tmt-ui-shell-content > .tmt-ui-shell-tools',
  );
  const toolsRoot = drawn ?? document.createElement('div');
  if (!drawn) {
    toolsRoot.className = 'tmt-ui-shell-tools';
    bar.after(toolsRoot);
  }
  const tools: ShellTools = {
    search: slotOf(toolsRoot, 'search'),
    chip: slotOf(toolsRoot, 'chip'),
  };
  const reserve = () => {
    // An empty cluster reserves nothing: the stylesheet's 0px default stands and the root keeps no
    // inline style.
    const width = toolsRoot.offsetWidth;
    if (width > 0) root.style.setProperty('--tmt-ui-shell-tools-width', `${width}px`);
    else root.style.removeProperty('--tmt-ui-shell-tools-width');
  };
  const watchTools = typeof ResizeObserver === 'function' ? new ResizeObserver(reserve) : undefined;
  watchTools?.observe(toolsRoot);
  reserve();

  // A nested (docs) shell keeps its own collapsed state; the product's shell keeps the device's.
  let localCollapsed = false;
  const local = new Set<() => void>();
  const rail$ = layerHost
    ? {
        get: () => localCollapsed,
        set: (next: boolean) => {
          localCollapsed = next;
          for (const listener of local) listener();
        },
        subscribe: (listener: () => void) => (local.add(listener), () => local.delete(listener)),
      }
    : { get: railCollapsed, set: setRailCollapsed, subscribe: subscribeRail };
  const win = document.defaultView!;
  const wide = win.matchMedia('(min-width: 901px)');
  const icons = {
    menu: icon(document, 'menu'),
    expand: icon(document, 'panel-left-open'),
    pin: icon(document, 'panel-left-open'),
    collapse: icon(document, 'panel-left-close'),
  };
  const hint = (label: string) => `${label} (${apple ? '⌘\\' : 'Ctrl+\\'})`;
  const syncOpen = () => {
    const expand = wide.matches && rail$.get();
    open.setAttribute('aria-label', expand ? 'Expand side menu' : 'Open navigation');
    const collapseLabel = expand ? 'Expand side menu' : 'Collapse side menu';
    collapse.setAttribute('aria-label', collapseLabel);
    collapse.title = hint(collapseLabel);
    collapse.replaceChildren(expand ? icons.pin : icons.collapse);
    if (expand) {
      open.setAttribute('aria-keyshortcuts', keys);
      open.title = hint('Expand side menu');
      open.setAttribute('aria-expanded', 'false');
    } else {
      open.removeAttribute('aria-keyshortcuts');
      open.removeAttribute('title');
      open.setAttribute('aria-expanded', String(root.dataset.drawer === 'open'));
    }
    open.replaceChildren(expand ? icons.expand : icons.menu);
  };
  const setDrawer = (shown: boolean) => {
    root.dataset.drawer = shown ? 'open' : 'closed';
    open.setAttribute('aria-expanded', String(shown && !(wide.matches && rail$.get())));
  };
  // The floating rail closes once the pointer is past its edge, whatever element the pointer was
  // over when it appeared, unless focus is inside it.
  const away = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || rail.contains(document.activeElement)) return;
    if (event.clientX > rail.getBoundingClientRect().right) setPeek(false);
  };
  const setPeek = (shown: boolean) => {
    if (shown === 'railPeek' in root.dataset) return;
    if (shown) root.dataset.railPeek = '';
    else delete root.dataset.railPeek;
    if (shown) document.addEventListener('pointermove', away);
    else document.removeEventListener('pointermove', away);
  };
  const wideRail = () => wide.matches && rail$.get();
  const pillWidth = () =>
    Number.parseFloat(win.getComputedStyle(root).getPropertyValue('--tmt-ui-rail-pill-width'));
  const pill = () => root.hasAttribute('data-rail-pill');
  const activeToggle = () => (wide.matches && (!wideRail() || pill()) ? collapse : open);
  const laneProperty = '--tmt-ui-rail-lane';
  let main: HTMLElement | null = null;
  let column: HTMLElement | null = null;
  const syncPill = () => {
    const focused = document.activeElement;
    const wasPill = pill();
    const width = pillWidth();
    const show = wideRail() && Number.isFinite(width);
    root.toggleAttribute('data-rail-pill', show);
    if (show) {
      // Measure the natural gutter before the shell takes any space. This also lets a
      // centered column recover its full main width as soon as the window permits.
      root.style.removeProperty(laneProperty);
      let gutter = 0;
      if (main && column?.getClientRects().length) {
        gutter = column.getBoundingClientRect().left - main.getBoundingClientRect().left;
        if (column.dataset.shellContentColumn === 'padded')
          gutter += Number.parseFloat(win.getComputedStyle(column).paddingLeft);
      }
      const need = width + 32;
      if (gutter < need) root.style.setProperty(laneProperty, `${need}px`);
    } else if (!root.hasAttribute('data-rail-from-pill')) {
      root.style.removeProperty(laneProperty);
    }
    if (show !== wasPill && (focused === open || rail.contains(focused))) {
      activeToggle().focus({ preventScroll: true });
    }
  };
  const geometry = new ResizeObserver(syncPill);
  geometry.observe(root);
  const findColumn = () => {
    const shown = shellContent.querySelector<HTMLElement>(':scope > .tmt-ui-shell-main');
    const routeChanged = main !== shown;
    if (routeChanged) {
      if (main) geometry.unobserve(main);
      main = shown;
      if (main) geometry.observe(main);
    }
    const next =
      [...(main?.querySelectorAll<HTMLElement>('[data-shell-content-column]') ?? [])].find(
        (element) => element.getClientRects().length > 0,
      ) ?? null;
    if (!routeChanged && column === next) return;
    if (column) geometry.unobserve(column);
    column = next;
    if (column) geometry.observe(column);
    syncPill();
  };
  const content = new MutationObserver(findColumn);
  content.observe(shellContent, {
    childList: true,
    subtree: true,
    attributeFilter: ['data-shell-content-column', 'hidden'],
  });
  findColumn();

  // Apply the stored layout before enabling motion. A user's toggle animates between two layouts;
  // the main column uses its final width throughout the shift.
  const applyRail = () => {
    root.dataset.rail = wideRail() ? 'collapsed' : 'expanded';
    if (!wideRail()) setPeek(false);
    syncOpen();
    syncPill();
  };
  const stopRail = rail$.subscribe(applyRail);
  const stopMotion = () => {
    root.removeAttribute('data-rail-motion');
    root.removeAttribute('data-rail-from-pill');
    root.style.removeProperty('--tmt-ui-rail-pill-height');
    if (!wideRail()) root.style.removeProperty(laneProperty);
  };
  const onWidth = () => {
    stopMotion();
    applyRail();
  };
  const completeMotion = (event: TransitionEvent) => {
    if (event.target === root && event.propertyName === '--tmt-ui-rail-progress') stopMotion();
  };
  root.addEventListener('transitionend', completeMotion);
  wide.addEventListener('change', onWidth);
  const animate = win.matchMedia('(prefers-reduced-motion: no-preference)');
  const toggleRail = (next: boolean, keyboard: boolean) => {
    const hadFocus = rail.contains(document.activeElement) || open === document.activeElement;
    const measurePill = () => {
      root.style.removeProperty('--tmt-ui-rail-pill-height');
      root.style.setProperty('--tmt-ui-rail-pill-height', `${rail.offsetHeight}px`);
    };
    const moving = animate.matches && Number.isFinite(pillWidth());
    root.toggleAttribute('data-rail-motion', moving);
    const fromPill = moving && !next && pill();
    if (fromPill) measurePill();
    root.toggleAttribute('data-rail-from-pill', fromPill);
    rail$.set(next);
    if (moving && pill()) measurePill();
    if (!hadFocus && !keyboard) return;
    activeToggle().focus({ focusVisible: keyboard } as FocusOptions);
  };
  collapse.onclick = (event) => toggleRail(!rail$.get(), event.detail === 0);
  const shortcut = (event: KeyboardEvent) => {
    if (
      event.code !== 'Backslash' ||
      event.altKey ||
      event.shiftKey ||
      !(apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) ||
      !wide.matches ||
      event.defaultPrevented
    )
      return;
    if (layerHost && (!(event.target instanceof Node) || !layerHost.root.contains(event.target)))
      return;
    event.preventDefault();
    toggleRail(!rail$.get(), true);
  };
  document.addEventListener('keydown', shortcut);
  // Authored Shell stages keep the existing edge peek. The app replaces it with the pill and
  // a top-bar fallback, which do not cover the content.
  const edge = document.createElement('div');
  edge.className = 'tmt-ui-rail-edge';
  edge.setAttribute('aria-hidden', 'true');
  edge.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch' && wideRail() && !Number.isFinite(pillWidth())) setPeek(true);
  });
  rail.addEventListener('focusout', (event) => {
    if ('railPeek' in root.dataset && !rail.contains(event.relatedTarget as Node | null))
      setPeek(false);
  });
  // Unavailable items keep their reason beside the hovered or focused item, in the top layer.
  const tip = document.createElement('div');
  tip.className = 'tmt-ui-rail-tip';
  tip.setAttribute('role', 'tooltip');
  tip.popover = 'manual';
  (layerHost?.portal ?? root).append(tip);
  let release = () => {};
  // The row the tip stands beside, and a row a press is on: a click never pops its tip (#5911).
  let tipAnchor: HTMLElement | undefined;
  let pressed: HTMLElement | undefined;
  const hideTip = () => {
    release();
    tipAnchor = undefined;
    if (tip.matches(':popover-open')) tip.hidePopover();
    if (tip.hasAttribute('data-tmt-ds-open')) {
      tip.hidden = true;
      tip.removeAttribute('data-tmt-ds-open');
    }
  };
  const showTip = (anchor: HTMLElement) => {
    const text =
      anchor.dataset.note ??
      (pill() ? anchor.querySelector('.tmt-ui-rail-label')?.textContent : undefined);
    if (!text || root.dataset.drawer === 'open') return hideTip();
    release();
    const scope = layerHost?.root;
    release = claimIconActionTooltip(scope ?? document, hideTip);
    tipAnchor = anchor;
    tip.textContent = text;
    if (scope) {
      tip.removeAttribute('popover');
      tip.hidden = false;
      tip.setAttribute('data-tmt-ds-open', '');
    } else {
      if (!tip.hasAttribute('popover')) {
        tip.hidden = false;
        tip.popover = 'manual';
      }
      if (!tip.matches(':popover-open')) tip.showPopover();
    }
    const box = anchor.getBoundingClientRect();
    const bounds = scope?.getBoundingClientRect();
    const origin = scope ? (tip.offsetParent?.getBoundingClientRect() ?? bounds) : undefined;
    const left = bounds
      ? Math.max(bounds.left, Math.min(box.right, bounds.right - tip.offsetWidth))
      : box.right;
    const top = bounds
      ? Math.max(
          bounds.top,
          Math.min(box.top + (box.height - tip.offsetHeight) / 2, bounds.bottom - tip.offsetHeight),
        )
      : box.top + (box.height - tip.offsetHeight) / 2;
    tip.style.left = `${left - (origin?.left ?? 0)}px`;
    tip.style.top = `${top - (origin?.top ?? 0)}px`;
  };
  // Tips are the rail's, by delegation: a row only names its note, so a row kept across updates
  // keeps working, and the tip follows the pointer or keyboard focus, never a press or a focus
  // the shell restores.
  const noted = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLElement>('[data-note], .tmt-ui-rail-item, .tmt-ui-rail-search')
      : null;
  rail.addEventListener('pointerover', (event) => {
    const anchor = noted(event.target);
    if (anchor && anchor !== tipAnchor && anchor !== pressed) showTip(anchor);
  });
  rail.addEventListener('pointerout', (event) => {
    const from = noted(event.target);
    if (from && from === noted(event.relatedTarget)) return;
    if (from === pressed) pressed = undefined;
    if (from && from === tipAnchor) hideTip();
  });
  rail.addEventListener('pointerdown', (event) => {
    pressed = noted(event.target) ?? undefined;
    hideTip();
  });
  rail.addEventListener('focusin', (event) => {
    const anchor = noted(event.target);
    if (anchor && anchor === event.target && anchor.matches(':focus-visible')) showTip(anchor);
  });
  rail.addEventListener('focusout', (event) => {
    if (noted(event.target) === tipAnchor) hideTip();
  });
  const tipFor = (anchor: HTMLElement, text: string) => {
    anchor.dataset.note = text;
  };
  // Opening the drawer takes focus to the current item, since the drawer covers its button;
  // Escape returns it to the button. A keyboard opening (a click with no pointer detail) shows
  // that focus; a tap or click does not, so the row stays at rest (shell.css).
  open.onclick = (event) => {
    if (wide.matches && rail$.get()) return toggleRail(false, event.detail === 0);
    const shown = root.dataset.drawer !== 'open';
    setDrawer(shown);
    if (shown)
      (
        rail.querySelector<HTMLElement>('[aria-current="page"]') ??
        rail.querySelector<HTMLElement>('a[href]')
      )?.focus({ focusVisible: event.detail === 0 } as FocusOptions);
  };
  const close = (event: KeyboardEvent) => {
    if (layerHost && (!(event.target instanceof Node) || !layerHost.root.contains(event.target)))
      return;
    if (event.key === 'Escape' && root.dataset.drawer === 'open') {
      setDrawer(false);
      open.focus();
    }
    if (event.key === 'Escape' && 'railPeek' in root.dataset) {
      const inside = rail.contains(document.activeElement);
      setPeek(false);
      if (inside) open.focus();
    }
  };
  document.addEventListener('keydown', close);
  // A press outside the open drawer closes it, as an overlay does.
  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    if (layerHost && !layerHost.root.contains(target)) return;
    if (root.dataset.drawer === 'open' && !rail.contains(target) && !open.contains(target))
      setDrawer(false);
  };
  document.addEventListener('pointerdown', outside);

  const link = (className: string, item: ShellItem | ShellMenuItem, selected: boolean) => {
    const anchor = document.createElement('a');
    anchor.className = className;
    anchor.href = item.href;
    anchor.dataset.id = item.id;
    if (selected) anchor.setAttribute('aria-current', 'page');
    const disabled = 'disabled' in item && item.disabled;
    if (disabled) anchor.setAttribute('aria-disabled', 'true');
    // The element's own attributes, not this item: an update may keep the row and patch them.
    anchor.onclick = (event) => {
      if (anchor.getAttribute('aria-disabled') === 'true') return event.preventDefault();
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      setDrawer(false);
      setPeek(false);
      if (select?.(anchor.dataset.id!, anchor.getAttribute('href')!)) event.preventDefault();
    };
    return anchor;
  };
  // One child tree serves the wide rail and phone drawer.
  const menuEntry = (
    className: string,
    item: ShellMenuItem,
    selected: ShellMenuItem | undefined,
    fallbackIcon?: ShellIcon,
  ) => {
    const anchor = link(className, item, item === selected);
    if (item.note) anchor.title = item.note;
    const label = document.createElement('span');
    label.className = 'tmt-ui-module-menu-label';
    label.textContent = item.label;
    if (!item.note) label.title = item.label;
    const mark = item.icon ?? fallbackIcon;
    if (item.leading) {
      const slot = document.createElement('span');
      slot.className = 'tmt-ui-shell-icon';
      slot.style.display = 'inline-grid';
      slot.style.placeItems = 'center';
      slot.setAttribute('aria-hidden', 'true');
      slot.append(item.leading.node.cloneNode(true));
      anchor.append(slot);
    } else if (mark) anchor.append(icon(document, mark));
    anchor.append(label);
    if (item.emphasis === 'unread') {
      anchor.dataset.emphasis = 'unread';
      const spoken = document.createElement('span');
      spoken.className = 'tmt-ui-visually-hidden';
      spoken.textContent = ' unread';
      anchor.append(spoken);
    }
    const badges =
      item.badges?.slice(0, 2).map((badge) => Array.from(badge).slice(0, 24).join('')) ?? [];
    const shown = badges.length ? [] : entryCounts(item);
    const total = shown.find((value) => !value.needsYou);
    const waiting = shown.find((value) => value.needsYou);
    if (badges.length || shown.length || item.actions?.length) {
      const counts = document.createElement('span');
      counts.className = 'tmt-ui-shell-counts';
      for (const badge of badges) counts.append(count(document, badge));
      if (waiting) counts.append(attention(document));
      if (total) counts.append(count(document, total.text));
      anchor.append(counts);
    }
    if (item.leading || badges.length || shown.length) {
      const summary = badges.length
        ? badges.join(', ')
        : [total && `${item.total ?? total.text} total`, waiting && `${waiting.text} need you`]
            .filter(Boolean)
            .join(', ');
      const details = [item.leading?.label, summary, item.note].filter(Boolean).join(' · ');
      anchor.setAttribute(
        'aria-label',
        `${item.label}${item.emphasis === 'unread' ? ' unread' : ''} · ${details}`,
      );
      anchor.title = details;
      tipFor(anchor, `${item.label} · ${anchor.title}`);
    }
    return anchor;
  };
  const command = (
    className: string,
    action: ShellMenuAction,
    activate: () => void,
    mark?: ShellIcon,
  ) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = action.disabledReason ?? action.label;
    button.disabled = action.disabledReason !== undefined;
    if (mark) {
      button.setAttribute('aria-label', action.label);
      button.append(icon(document, mark));
      tipFor(button, action.label);
    } else button.textContent = action.label;
    // Plain DOM listeners: the key turn lasts until the next task (see keyTurn).
    const turn = keyTurn('task');
    const recordKey = (event: KeyboardEvent) => {
      if (
        (event.key === 'Enter' && event.type === 'keydown') ||
        (event.key === ' ' && event.type === 'keyup')
      )
        turn.record(event);
    };
    button.addEventListener('keydown', recordKey);
    button.addEventListener('keyup', recordKey);
    button.onclick = (event) => {
      const admitted = turn.admit(event);
      if (event.defaultPrevented || !admitted || button.disabled) return;
      setDrawer(false);
      activate();
    };
    return button;
  };
  const announcement = document.createElement('div');
  announcement.className = 'tmt-ui-visually-hidden';
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  let menuInteractions: ShellMenuInteractions[] = [];
  const interactions = (current: () => ShellMenuGroup | undefined) => {
    const controls = createShellMenuInteractions(
      current,
      (name) => icon(document, name),
      (action) => {
        setDrawer(false);
        action.onActivate();
      },
      (message) => {
        announcement.textContent = message;
      },
    );
    menuInteractions.push(controls);
    return controls;
  };
  // A parent row: its link, a disclosure beside it and, while expanded, one level of children.
  const disclose = (
    row: HTMLLIElement,
    anchor: HTMLAnchorElement,
    item: ShellMenuItem,
    index: number,
    selected: ShellMenuItem | undefined,
  ) => {
    const live = () => latest.menu?.groups[index]?.items.find((entry) => entry.id === item.id);
    const expanded = item.expanded === true;
    row.classList.add('tmt-ui-rail-menu-row');
    row.dataset.menuItem = item.id;
    row.dataset.disclosure = expanded ? 'open' : 'closed';
    anchor.dataset.railPart = 'link';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tmt-ui-rail-group-action tmt-ui-rail-disclosure';
    button.dataset.railPart = 'disclosure';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} ${item.label}`);
    button.append(icon(document, 'chevron-right'));
    // Opening or closing a branch is not navigation: the phone drawer stays open.
    button.onclick = () => live()?.toggle?.();
    row.append(button);
    if (!expanded) return;
    const children = document.createElement('ul');
    children.className = 'tmt-ui-rail-sub-children';
    children.id = `tmt-ui-rail-children-${++branchIds}`;
    children.setAttribute('aria-label', item.label);
    button.setAttribute('aria-controls', children.id);
    for (const child of item.children!) {
      const childRow = document.createElement('li');
      const link = menuEntry('tmt-ui-module-menu-item tmt-ui-rail-sub-item', child, selected);
      childRow.classList.add('tmt-ui-rail-menu-row');
      childRow.dataset.menuItem = child.id;
      childRow.dataset.menuGroup = String(index);
      link.dataset.railPart = 'link';
      childRow.append(link);
      if (child.actions?.length)
        interactions(() => {
          const branch = live()?.children;
          return branch ? { items: [...branch] } : undefined;
        }).decorate(childRow, link, child);
      children.append(childRow);
    }
    row.append(children);
  };
  // Up/Down walk the visible rows; Right/Left open, enter, close or leave a branch. Alt+Up/Down
  // stays the reorder request.
  const walk = (list: HTMLUListElement) =>
    list.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const row = (event.target as HTMLElement).closest('li');
      const link = row?.querySelector<HTMLAnchorElement>(':scope > a');
      if (!row || !link) return;
      const disclosure = row.querySelector<HTMLButtonElement>(':scope > .tmt-ui-rail-disclosure');
      const open = disclosure?.getAttribute('aria-expanded') === 'true';
      const branch = row.parentElement?.classList.contains('tmt-ui-rail-sub-children')
        ? row.parentElement.parentElement?.querySelector<HTMLAnchorElement>(':scope > a')
        : undefined;
      let next: HTMLElement | null | undefined;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const links = [...list.querySelectorAll<HTMLAnchorElement>('a.tmt-ui-rail-sub-item')];
        next = links[links.indexOf(link) + (event.key === 'ArrowUp' ? -1 : 1)];
        event.preventDefault();
      } else if (event.key === 'ArrowRight' && disclosure) {
        event.preventDefault();
        if (open) next = row.querySelector<HTMLAnchorElement>(':scope > ul a');
        else disclosure.click();
      } else if (event.key === 'ArrowLeft' && (open || branch)) {
        event.preventDefault();
        if (open) disclosure!.click();
        else next = branch;
      }
      next?.focus();
    });
  const nested = (menuView: ShellMenu, selected: ShellMenuItem | undefined) => {
    if (menuView.placeholder) return blankMenu(menuView.placeholder);
    const list = document.createElement('ul');
    list.className = 'tmt-ui-rail-sub';
    list.setAttribute('aria-label', menuView.title);
    walk(list);
    menuView.groups.forEach((group, index) => {
      const controls =
        group.reorder || group.items.some((item) => item.actions?.length)
          ? interactions(() => latest.menu?.groups[index])
          : undefined;
      let entries = list;
      if (group.label || group.action) {
        const section = document.createElement('li');
        const heading = document.createElement('div');
        heading.className = 'tmt-ui-rail-sub-group';
        const label = document.createElement('span');
        label.textContent = group.label ?? '';
        label.title = group.label ?? '';
        heading.append(label);
        if (group.action)
          heading.append(
            command(
              `tmt-ui-rail-group-action${group.action.icon ? '' : ' tmt-ui-rail-group-text-action'}`,
              group.action,
              () => latest.menu?.groups[index]?.action?.onActivate(),
              group.action.icon,
            ),
          );
        entries = document.createElement('ul');
        entries.className = 'tmt-ui-rail-sub-items';
        if (group.label) entries.setAttribute('aria-label', group.label);
        section.append(heading, entries);
        list.append(section);
      }
      if (group.alert) {
        const row = document.createElement('li');
        row.className = 'tmt-ui-rail-alert';
        row.setAttribute('role', 'alert');
        const message = document.createElement('span');
        message.textContent = group.alert.message;
        row.append(
          message,
          command('tmt-ui-rail-group-action', group.alert.retry, () =>
            latest.menu?.groups[index]?.alert?.retry.onActivate(),
          ),
        );
        entries.append(row);
      }
      for (const item of group.items) {
        const row = document.createElement('li');
        const anchor = menuEntry(
          'tmt-ui-module-menu-item tmt-ui-rail-sub-item',
          item,
          selected,
          group.fallbackIcon,
        );
        row.dataset.menuGroup = String(index);
        row.append(anchor);
        if (item.actions?.length || group.reorder) controls?.decorate(row, anchor, item);
        if (item.children?.length) disclose(row, anchor, item, index, selected);
        entries.append(row);
      }
      if (group.add) {
        const row = document.createElement('li');
        const add = command('tmt-ui-rail-sub-item tmt-ui-rail-add', group.add, () =>
          latest.menu?.groups[index]?.add?.onActivate(),
        );
        add.prepend(icon(document, 'plus'));
        row.append(add);
        entries.append(row);
      }
    });
    if (menuView.settings) {
      const row = document.createElement('li');
      row.className = 'tmt-ui-rail-settings';
      const anchor = menuEntry(
        'tmt-ui-module-menu-item tmt-ui-rail-sub-item',
        menuView.settings,
        selected,
      );
      row.dataset.menuGroup = 'settings';
      row.append(anchor);
      if (menuView.settings.actions?.length)
        interactions(() =>
          latest.menu?.settings ? { items: [latest.menu.settings] } : undefined,
        ).decorate(row, anchor, menuView.settings);
      list.append(row);
    }
    return list;
  };
  const railList = (
    items: ShellItem[],
    current: ShellItem | undefined,
    selected: ShellMenuItem | undefined,
    extra?: string,
    pages?: ShellMenu,
  ) => {
    const list = document.createElement('ul');
    list.className = extra ? `tmt-ui-rail-items ${extra}` : 'tmt-ui-rail-items';
    for (const item of items) {
      const anchor = link('tmt-ui-rail-item', item, item === current && !selected);
      if (item === current) anchor.dataset.moduleCurrent = '';
      const badge = item.count?.needsYou && item.count.text !== '0' ? item.count : undefined;
      if (badge)
        anchor.setAttribute(
          'aria-label',
          `${item.label}, ${badge.text}${badge.text === '1' ? ' needs you' : ' need you'}`,
        );
      anchor.title = item.note ?? item.label;
      if (item.note && !badge) tipFor(anchor, `${item.label}: ${item.note}`);
      const label = document.createElement('span');
      label.className = 'tmt-ui-rail-label';
      label.textContent = item.label;
      anchor.append(icon(document, item.icon), label);
      if (badge) {
        anchor.append(attention(document));
        tipFor(anchor, `${item.label}, ${badge.text} need you${item.note ? `: ${item.note}` : ''}`);
      }
      const row = document.createElement('li');
      row.append(anchor);
      // A module's menu belongs to its module: a claimed Home (#6474) is current on a module's page
      // and shows none of it.
      if (item === current && pages && item.id !== 'home') row.append(nested(pages, selected));
      list.append(row);
    }
    return list;
  };

  // Hosts repaint on every data refresh. An unchanged view keeps its nodes, and a view with the same
  // rows patches them in place, so a press in progress, hover, keyboard focus and an open tip survive.
  let shown = '';
  let latest = view;
  const render = (next: ShellView) => {
    latest = next;
    // Callback identity is not view state, but adding/removing a reorder affordance is.
    const key = JSON.stringify(
      [next, next.menu?.groups.map((group) => Boolean(group.reorder))],
      (_key, value: unknown) =>
        value instanceof Element
          ? value.outerHTML
          : value instanceof Node
            ? value.textContent
            : value,
    );
    if (key === shown) return;
    shown = key;
    const focused = rail.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : undefined;
    const owner = focused?.closest<HTMLElement>('[data-menu-item]');
    const focus = owner
      ? {
          id: owner.dataset.menuItem,
          group: owner.dataset.menuGroup,
          part: focused?.dataset.railPart,
        }
      : undefined;
    const previous = menuInteractions;
    menuInteractions = [];
    const current = [...next.rail.main, ...next.rail.bottom].find((item) => item.current);
    const selected = current ? visibleCurrent(next.menu) : undefined;
    const lists = [
      railList(next.rail.main, current, selected, undefined, next.menu),
      railList(next.rail.bottom, current, selected, 'tmt-ui-rail-bottom', next.menu),
    ];
    const live = [...rail.children].slice(2);
    const pairs = lists.flatMap((list, index) => {
      const shown = live[index];
      return shown ? [[shown, list] as const] : [];
    });
    // The same rows, links and controls: move the highlight and update the counts and labels in
    // place (#5911). Rebuilding would drop hover, focus and the open tip on every page change.
    if (
      live.length === lists.length &&
      pairs.length === lists.length &&
      pairs.every(([shown, list]) => sameShape(shown, list))
    ) {
      for (const [shown, list] of pairs) patchShape(shown, list);
      for (const controls of menuInteractions) controls.dispose();
      menuInteractions = previous;
      root.dataset.menu = next.menu ? 'shown' : 'none';
      if (tipAnchor?.isConnected) showTip(tipAnchor);
      return;
    }
    for (const controls of previous) controls.dispose();
    hideTip();
    const railTop = rail.scrollTop;
    rail.replaceChildren(brand, railSearch, ...lists);
    // Keep the same scroll owner across refreshes; shrinking content clamps its position.
    rail.scrollTop = railTop;
    syncRailScroll();
    root.dataset.menu = next.menu ? 'shown' : 'none';
    menu.replaceChildren();
    if (next.menu?.groups.some((group) => group.reorder)) {
      if (!announcement.isConnected) root.append(announcement);
    } else announcement.remove();
    if (focus) {
      const restored = [...rail.querySelectorAll<HTMLElement>('[data-rail-part]')].find(
        (element) => {
          const row = element.closest<HTMLElement>('[data-menu-item]');
          return (
            row !== null &&
            row.dataset.menuItem === focus.id &&
            row.dataset.menuGroup === focus.group &&
            element.dataset.railPart === focus.part
          );
        },
      );
      if (restored && restored.getClientRects().length) {
        restored.focus({ preventScroll: true });
        restored.scrollIntoView({ block: 'nearest' });
      }
    }
  };
  setDrawer(false);
  root.prepend(edge);
  applyRail();
  // The bar's Go to menu while the side menu is collapsed (#6833): the rail's places, then the
  // current module's own menu in the rail's order, built from the view the rail draws (one
  // source). Its trigger is an app switcher's grid, never the list icon the page outline uses; its
  // name is its tooltip. The rail keeps its read-failure alert and placeholder rows to itself.
  type GoToEntry =
    | { link: { id: string; href: string; disabled?: boolean } }
    | { action: ShellMenuAction };
  let goToEntries = new Map<string, GoToEntry>();
  const goToOptions = (next: ShellView) => {
    const entries = new Map<string, GoToEntry>();
    const items: BrowserMenuHostItem[] = [];
    // A row without its own icon keeps an empty glyph, so every label starts on one edge.
    const glyph = (name: ShellIcon | undefined) => {
      if (name) return icon(document, name);
      const blank = icon(document, 'list');
      blank.replaceChildren();
      return blank;
    };
    for (const place of [...next.rail.main, ...next.rail.bottom]) {
      entries.set(`place:${place.id}`, { link: place });
      items.push({
        key: `place:${place.id}`,
        label: place.label,
        leadingIcon: icon(document, place.icon),
        ...(place.disabled ? { disabled: true, disabledReason: place.note } : {}),
      });
    }
    const menu = next.menu?.placeholder ? undefined : next.menu;
    menu?.groups.forEach((group, index) => {
      // The module's title heads its first unnamed group; a named group keeps the rail's heading.
      let lead: Partial<BrowserMenuHostItem> =
        (group.label ?? (index === 0 ? menu.title : undefined))
          ? { heading: group.label ?? menu.title }
          : { separated: true };
      const push = (key: string, entry: GoToEntry, item: Omit<BrowserMenuHostItem, 'key'>) => {
        entries.set(key, entry);
        items.push({ key, ...item, ...lead });
        lead = {};
      };
      for (const item of group.items)
        push(
          `menu:${index}:${item.id}`,
          { link: item },
          {
            label: item.label,
            leadingIcon: glyph(item.icon ?? group.fallbackIcon),
            ...(item.disabled ? { disabled: true, disabledReason: item.note } : {}),
          },
        );
      for (const [kind, action] of [
        ['action', group.action],
        ['add', group.add],
      ] as const)
        if (action)
          push(
            `${kind}:${index}`,
            { action },
            {
              label: action.label,
              leadingIcon: glyph(kind === 'add' ? 'plus' : group.action?.icon),
              ...(action.disabledReason
                ? { disabled: true, disabledReason: action.disabledReason }
                : {}),
            },
          );
    });
    if (menu?.settings) {
      entries.set('settings', { link: menu.settings });
      items.push({
        key: 'settings',
        label: menu.settings.label,
        leadingIcon: glyph(menu.settings.icon),
        separated: true,
      });
    }
    goToEntries = entries;
    return {
      label: 'Go to',
      icon: icon(document, 'layout-grid'),
      items,
      onSelect: (key: string) => {
        const entry = goToEntries.get(key);
        if (!entry) return;
        if ('action' in entry) {
          if (!entry.action.disabledReason) entry.action.onActivate();
          return;
        }
        if (entry.link.disabled) return;
        if (!select?.(entry.link.id, entry.link.href)) win.location.assign(entry.link.href);
      },
    };
  };
  const goToMenu = mountBrowserMenu(goTo, goToOptions(view));
  const draw = (next: ShellView) => {
    render(next);
    goToMenu.update(goToOptions(next));
  };
  draw(view);
  /** The menu list measured last: an update that keeps it drew the same rows. */
  let measured: Element | undefined;
  return {
    tools,
    setCommonControls: topBar.setCommonControls,
    topBarReady: topBar.topBarReady,
    setTopBar: topBar.setTopBar,
    clearTopBar: topBar.clear,
    update: draw,
    menuGeometry() {
      const list = rail.querySelector('ul.tmt-ui-rail-sub:not([data-placeholder])');
      if (!list?.getClientRects().length || list === measured) return undefined;
      measured = list;
      return geometryOf(list);
    },
    dispose() {
      for (const controls of menuInteractions) controls.dispose();
      menuInteractions = [];
      announcement.remove();
      topBar.dispose();
      watchTools?.disconnect();
      root.style.removeProperty('--tmt-ui-shell-tools-width');
      if (!drawn) toolsRoot.remove();
      document.removeEventListener('keydown', close);
      document.removeEventListener('keydown', shortcut);
      document.removeEventListener('pointerdown', outside);
      root.removeEventListener('transitionend', completeMotion);
      wide.removeEventListener('change', onWidth);
      stopRail();
      goToMenu.dispose();
      goTo.remove();
      setPeek(false);
      edge.remove();
      content.disconnect();
      geometry.disconnect();
      stopMotion();
      root.removeAttribute('data-rail-pill');
      root.style.removeProperty(laneProperty);
      delete root.dataset.rail;
      hideTip();
      open.remove();
      tip.remove();
      rail.removeEventListener('scroll', syncRailScroll);
      rail.remove();
      menu.remove();
    },
  };
}

const units = (pixels: number) => Math.round(pixels * LAYOUT_UNIT);
const tall = (element: Element) => units(element.getBoundingClientRect().height);
/** The drawn menu `list` as `blankMenu` draws it back: its sections, each row's own height (above
 * any children) and depth, and the settings row. Heading-less groups draw their rows straight into
 * the list, so a run of them is one group here; it draws the same. */
function geometryOf(list: Element): ShellMenuGeometry {
  const rows = (items: Iterable<Element>) =>
    [...items].flatMap((row) => {
      const children = row.querySelector(':scope > .tmt-ui-rail-sub-children');
      if (!children) return [{ height: tall(row), depth: 0 as const }];
      const top =
        children.getBoundingClientRect().top - parseFloat(getComputedStyle(children).marginTop);
      return [
        { height: units(top - row.getBoundingClientRect().top), depth: 0 as const },
        ...[...children.children].map((child) => ({ height: tall(child), depth: 1 as const })),
      ];
    });
  const groups: ShellMenuGeometry['groups'] = [];
  let settings: number | null = null;
  let loose: ShellMenuGeometry['groups'][number] | undefined;
  for (const item of list.children) {
    const heading = item.querySelector(':scope > .tmt-ui-rail-sub-group');
    const entries = item.querySelector(':scope > .tmt-ui-rail-sub-items');
    if (item.classList.contains('tmt-ui-rail-settings')) settings = tall(item);
    else if (heading && entries) {
      loose = undefined;
      groups.push({ head: tall(heading), rows: rows(entries.children) });
    } else {
      if (!loose) groups.push((loose = { head: null, rows: [] }));
      loose.rows.push(...rows([item]));
    }
  }
  return { groups, settings };
}
/** A block exactly `height` layout units tall, padding and border included. */
function sized<K extends 'li' | 'div'>(tag: K, height: number, className?: string) {
  const block = document.createElement(tag);
  if (className) block.className = className;
  block.style.boxSizing = 'border-box';
  block.style.minHeight = '0';
  block.style.height = `${height / LAYOUT_UNIT}px`;
  return block;
}
/** Blank, inert rows of exactly `geometry`, in the real tree's lists so its gaps are the same. */
function blankMenu(geometry: ShellMenuGeometry) {
  const list = document.createElement('ul');
  list.className = 'tmt-ui-rail-sub';
  list.dataset.placeholder = '';
  list.setAttribute('aria-hidden', 'true');
  list.inert = true;
  for (const group of geometry.groups) {
    let entries = list;
    if (group.head !== null) {
      const section = document.createElement('li');
      entries = document.createElement('ul');
      entries.className = 'tmt-ui-rail-sub-items';
      section.append(sized('div', group.head, 'tmt-ui-rail-sub-group'), entries);
      list.append(section);
    }
    const branches: { height: number; children: number[] }[] = [];
    for (const { height, depth } of group.rows)
      if (depth === 1 && branches.length) branches.at(-1)!.children.push(height);
      else branches.push({ height, children: [] });
    for (const { height, children } of branches) {
      if (!children.length) {
        entries.append(sized('li', height));
        continue;
      }
      const row = document.createElement('li');
      const nested = document.createElement('ul');
      nested.className = 'tmt-ui-rail-sub-children';
      nested.append(...children.map((child) => sized('li', child)));
      row.append(sized('div', height), nested);
      entries.append(row);
    }
  }
  if (geometry.settings !== null)
    list.append(sized('li', geometry.settings, 'tmt-ui-rail-settings'));
  return list;
}

/** What an update may change on a kept rail node; anything else is a different rail. */
const PATCHED = new Set([
  'aria-current',
  'aria-label',
  'aria-disabled',
  'data-module-current',
  'data-note',
  'data-emphasis',
  'href',
  'title',
]);
/** Build-local names: a kept node keeps its own, which its partner already points at. */
const LOCAL = new Set(['id', 'aria-controls']);
const ownAttributes = (element: Element) =>
  element
    .getAttributeNames()
    .filter((name) => !PATCHED.has(name) && !LOCAL.has(name))
    .map((name) => `${name}=${element.getAttribute(name)}`)
    .join('\n');
/** Whether `next` has the live node's elements, in order, with the same fixed attributes. */
function sameShape(live: Node, next: Node): boolean {
  if (live.nodeType !== next.nodeType || live.childNodes.length !== next.childNodes.length)
    return false;
  if (live instanceof Element && next instanceof Element) {
    if (live.localName !== next.localName || ownAttributes(live) !== ownAttributes(next))
      return false;
  }
  return [...live.childNodes].every((child, index) => sameShape(child, next.childNodes[index]!));
}
/** Brings a same-shape live node to `next`: its changeable attributes and its text. */
function patchShape(live: Node, next: Node) {
  if (live instanceof Element && next instanceof Element) {
    for (const name of PATCHED) {
      const value = next.getAttribute(name);
      if (value === null) live.removeAttribute(name);
      else if (live.getAttribute(name) !== value) live.setAttribute(name, value);
    }
  } else if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
  live.childNodes.forEach((child, index) => patchShape(child, next.childNodes[index]!));
}

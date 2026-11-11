/**
 * Where the shell may load a module's code from. A composed shell answer names a module's mount
 * (`rail.path`) and optionally its `entry`; the shell imports the entry only when both are paths
 * of this same origin under `/r/<prefix>/x/<module>/`, compared by path segment, naming a script
 * (`.js`). Anything else is
 * refused, and the module's own link is the fallback.
 */
import { moduleMount, type ShellAnswer } from '@tmt/browser-ui/shell';

export interface ModuleLoad {
  /** The module's own mount path, ending in `/`, when the answer's `rail.path` is a valid mount. */
  link?: string;
  /** The entry to import, when it is confined to that mount. */
  entry?: string;
}

/** An entry has no escapes, backslashes, query, fragment, control characters or dot segments. */
function plain(entry: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\\%?#\u0000-\u001f\u007f]/.test(entry)) return false;
  return entry.split('/').every((segment) => segment !== '.' && segment !== '..');
}

/**
 * Confine a described module to its mount; `here` is the page's URL, the base of relative paths.
 * A module that names no `entry` loads `fallback` (an older Colab names none); without either it
 * has no entry and only its link.
 */
export function moduleLoad(
  rail: string,
  entry: string | undefined,
  here: string,
  fallback?: string,
): ModuleLoad {
  let page: URL;
  let mount: URL;
  try {
    page = new URL(here);
    mount = new URL(rail, page);
  } catch {
    return {};
  }
  // The rail path may omit the mount's trailing slash.
  const link = mount.pathname.endsWith('/') ? mount.pathname : `${mount.pathname}/`;
  if (mount.origin !== page.origin || mount.search || mount.hash || !moduleMount(link)) return {};
  const wanted = entry ?? fallback;
  if (wanted === undefined) return { link };
  if (!plain(wanted)) return { link };
  let target: URL;
  try {
    target = new URL(wanted, new URL(link, page));
  } catch {
    return { link };
  }
  // The trailing slash on the mount makes the prefix test a segment boundary.
  const inside =
    target.origin === page.origin &&
    target.pathname.startsWith(link) &&
    target.pathname.length > link.length &&
    target.pathname.endsWith('.js') &&
    !target.pathname.includes('//') &&
    !target.search &&
    !target.hash;
  return inside ? { link, entry: target.href } : { link };
}

/** One bounded root segment cannot shadow the door's route families. */
export function rootAppFamily(family: string): boolean {
  return (
    /^\/[a-z0-9-]{1,32}$/.test(family) &&
    ![
      'colab',
      'remote',
      'ops',
      'digest',
      'settings',
      'sdk',
      'x',
      'r',
      'read',
      'pair',
      'p',
      'join',
    ].includes(family.slice(1))
  );
}

export function appFamilyPath(path: string, family: string): boolean {
  if (!rootAppFamily(family)) return false;
  if (path === family || path === `${family}/`) return true;
  const rest = path.startsWith(`${family}/`) ? path.slice(family.length + 1) : undefined;
  return (
    rest !== undefined &&
    rest.length <= 160 &&
    rest.split('/').every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))
  );
}

type Extra = ShellAnswer['modules'][number] & { rootAppFamily?: unknown; entry?: string };

/** Root routes are display data; scripts still require the live description and primary mount. */
export function rootModules(answer: ShellAnswer | undefined): Extra[] {
  const modules = (answer?.modules ?? []) as Extra[];
  return modules.filter(
    (module) =>
      typeof module.module === 'string' &&
      /^[a-z0-9-]{1,32}$/.test(module.module) &&
      typeof module.rootAppFamily === 'string' &&
      rootAppFamily(module.rootAppFamily) &&
      modules.filter((other) => other.rootAppFamily === module.rootAppFamily).length === 1,
  );
}

export function extraModuleLoad(
  answer: ShellAnswer | undefined,
  family: string,
  here: string,
): ModuleLoad {
  const extra = rootModules(answer).find((module) => module.rootAppFamily === family);
  const primary = answer?.modules.find(
    (module) => module.extension === extra?.extension && !('module' in module),
  );
  if (!primary || !extra || !plain(extra.rail.path)) return {};
  let page: URL;
  let route: URL;
  try {
    page = new URL(here);
    route = new URL(extra.rail.path, page);
  } catch {
    return {};
  }
  if (
    route.origin !== page.origin ||
    route.search ||
    route.hash ||
    !appFamilyPath(route.pathname, family)
  )
    return {};
  const load = moduleLoad(primary.rail.path, extra.entry, here);
  if (!load.link || moduleMount(load.link) !== extra.extension) return {};
  // If the script is absent or cannot load, the paired alias can open the standalone
  // extension view; the root navigation link would only reopen this same fallback.
  return {
    link: `${load.link}${route.pathname.slice(1)}`,
    ...(load.entry ? { entry: load.entry } : {}),
  };
}

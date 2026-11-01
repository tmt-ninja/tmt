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

/** Only the admitted Design app family can leave a Colab extra's mount for navigation. */
export function designPath(path: string): boolean {
  if (path === '/design' || path === '/design/') return true;
  const rest = path.startsWith('/design/') ? path.slice('/design/'.length) : undefined;
  return (
    rest !== undefined &&
    rest.length <= 160 &&
    rest.split('/').every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))
  );
}

/** Navigation may use the owner route; script authority still comes from the primary mount. */
export function designModuleLoad(answer: ShellAnswer | undefined, here: string): ModuleLoad {
  const primary = answer?.modules.find(
    (module) => module.extension === 'colab' && !('module' in module),
  );
  if (!primary) return {};
  let page: URL;
  try {
    page = new URL(here);
  } catch {
    return {};
  }
  const extra = answer?.modules.find((module) => {
    if (
      module.extension !== 'colab' ||
      !('module' in module) ||
      typeof module.module !== 'string' ||
      !/^[a-z0-9-]{1,32}$/.test(module.module) ||
      !plain(module.rail.path)
    )
      return false;
    try {
      const route = new URL(module.rail.path, page);
      return (
        route.origin === page.origin && !route.search && !route.hash && designPath(route.pathname)
      );
    } catch {
      return false;
    }
  });
  if (!extra) return {};
  const load = moduleLoad(primary.rail.path, (extra as { entry?: string }).entry, here);
  if (!load.link) return {};
  const route = new URL(extra.rail.path, page);
  // If the script is absent or cannot load, the paired alias can open the standalone
  // Colab view; the root navigation link would only reopen this same fallback.
  return {
    link: `${load.link}${route.pathname.slice(1)}`,
    ...(load.entry ? { entry: load.entry } : {}),
  };
}

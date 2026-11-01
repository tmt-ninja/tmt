import { useSyncExternalStore, type MouseEvent } from 'react';

/**
 * The docs' location. On the dev server it is the URL path. When Design hosts the docs inside
 * Colab (#5866), the host owns the URL: it passes its path and a navigate function, and the docs'
 * own paths sit under the host's base (`/colab/design` + `/ds/gui/components/button`).
 */
export interface DocsHost {
  /** The host's path that holds the docs, without a trailing slash. */
  base: string;
  /** The host's current path and query. */
  path: string;
  navigate(href: string): void;
}
let host: DocsHost | undefined;
const listeners = new Set<() => void>();
/** Hand the location to a host, or back to the window with undefined. */
export function hostDocs(next: DocsHost | undefined) {
  host = next;
  for (const notify of listeners) notify();
}
/** Whether a host owns the location and the chrome around the docs. */
export const hosted = () => host !== undefined;

function parts(): { path: string; search: string } {
  if (!host) return { path: location.pathname, search: location.search };
  const inner = host.path.startsWith(host.base) ? host.path.slice(host.base.length) || '/' : '/';
  const query = inner.indexOf('?');
  return query < 0
    ? { path: inner, search: '' }
    : { path: inner.slice(0, query), search: inner.slice(query) };
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  addEventListener('popstate', notify);
  return () => {
    listeners.delete(notify);
    removeEventListener('popstate', notify);
  };
}
function write(href: string, replace: boolean) {
  if (host) return host.navigate(`${host.base}${href}`);
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  dispatchEvent(new PopStateEvent('popstate'));
}
/** A history-backed path, so links inside the docs and the mock never reload the page. */
export function navigate(href: string) {
  write(href, false);
  scrollTo(0, 0);
}
/** Replace the current entry, for redirects. */
export function replacePath(href: string) {
  write(href, true);
}
export function usePath() {
  return useSyncExternalStore(subscribe, () => parts().path);
}
/** The current path and query, for redirects that keep the query. */
export const currentLocation = parts;
/** An in-app link's click handler; modified clicks keep the browser's own behaviour. */
export function follow(event: MouseEvent<HTMLAnchorElement>) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute('href')!);
}

/** The mock's state lives in the query (#5821), so a capture and a shared link land on the same state. */
export function useQuery(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => parts().search);
  return new URLSearchParams(search);
}
export function setQuery(changes: Record<string, string | null>) {
  const { path, search } = parts();
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes))
    if (value === null) query.delete(key);
    else query.set(key, value);
  const next = query.toString();
  write(`${path}${next ? `?${next}` : ''}`, true);
}

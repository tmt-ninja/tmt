import { useSyncExternalStore, type MouseEvent } from 'react';

/**
 * The docs' location. On the dev server it is the URL path; embedded in Colab (#5866), the docs are
 * one asset document, `assets/design-docs.html`, so the path and query live in its hash
 * (`#/ds/gui/components/button?x=1`) and the host page follows them through messages.
 */
export const embedded = location.pathname.endsWith('/design-docs.html');

function parts(): { path: string; search: string } {
  if (!embedded) return { path: location.pathname, search: location.search };
  const hash = location.hash.slice(1) || '/';
  const query = hash.indexOf('?');
  return query < 0
    ? { path: hash, search: '' }
    : { path: hash.slice(0, query), search: hash.slice(query) };
}
function subscribe(notify: () => void) {
  addEventListener('popstate', notify);
  addEventListener('hashchange', notify);
  return () => {
    removeEventListener('popstate', notify);
    removeEventListener('hashchange', notify);
  };
}
/** Tell an embedding host where the docs are now, so its own URL can follow. */
function announce() {
  if (embedded && parent !== window) {
    const { path, search } = parts();
    parent.postMessage({ type: 'tmt-docs.path', path: `${path}${search}` }, location.origin);
  }
}
function write(href: string, replace: boolean) {
  if (embedded) {
    const url = new URL(location.href);
    url.hash = href;
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  } else history[replace ? 'replaceState' : 'pushState'](null, '', href);
  dispatchEvent(new PopStateEvent('popstate'));
  announce();
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
if (embedded)
  addEventListener('message', (event) => {
    const data = event.data as { type?: unknown; path?: unknown } | null;
    if (
      event.source === parent &&
      event.origin === location.origin &&
      data?.type === 'tmt-docs.go' &&
      typeof data.path === 'string' &&
      data.path.startsWith('/')
    )
      navigate(data.path);
  });
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

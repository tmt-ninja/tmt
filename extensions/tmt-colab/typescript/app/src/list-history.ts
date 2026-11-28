import type { RouterHistory } from '@tanstack/react-router';

/** The state key under which a history entry keeps the list's own search. */
const KEY = 'tmtColabList';
const MAX_SEARCH = 2048;
export const WORK_HOME_PATH = '/work';
export const WORK_LIST_PATH = '/work/list';
const WORK_TAB_KEY = 'tmt-colab-work-tab';
export type WorkTab = 'home' | 'list';

export function workTabPath(tab: WorkTab) {
  return tab === 'list' ? WORK_LIST_PATH : WORK_HOME_PATH;
}

export function storedWorkPath() {
  try {
    return workTabPath(localStorage.getItem(WORK_TAB_KEY) === 'list' ? 'list' : 'home');
  } catch {
    return WORK_HOME_PATH;
  }
}

/** Only the active Work tab records a visit. Reading or following a crumb does not write. */
export function rememberWorkTab(tab: WorkTab) {
  try {
    if (localStorage.getItem(WORK_TAB_KEY) === tab) return;
    localStorage.setItem(WORK_TAB_KEY, tab);
  } catch {
    // The current tab still works when storage is blocked.
    return;
  }
  window.dispatchEvent(new Event(WORK_TAB_KEY));
}

export function subscribeWorkTab(notify: () => void) {
  const change = (event: StorageEvent) => {
    if (event.key === WORK_TAB_KEY || event.key === null) notify();
  };
  window.addEventListener(WORK_TAB_KEY, notify);
  window.addEventListener('storage', change);
  return () => {
    window.removeEventListener(WORK_TAB_KEY, notify);
    window.removeEventListener('storage', change);
  };
}

/** Whether a router path is the page list, with or without its search. */
export function isListPath(path: string): boolean {
  const route = path.split('?', 1)[0];
  return route === WORK_LIST_PATH || route === '/';
}

/** The search part of a list path (`?stage=all`), or nothing for a bare list. */
function listSearch(path: string): string | undefined {
  const question = path.indexOf('?');
  return isListPath(path) && question >= 0 && question < path.length - 1
    ? path.slice(question)
    : undefined;
}

/** The search a history entry kept for the list; the list's own validation still reads it, so a
 * value that is not plain bounded text is no search at all. */
export function storedListSearch(state: unknown): string {
  const value = (state as Record<string, unknown> | null | undefined)?.[KEY];
  return typeof value === 'string' && value.length <= MAX_SEARCH && /^\?[^#]+$/.test(value)
    ? value
    : '';
}

/**
 * A mounted address names the list as `/colab/` and no more, so its tab and filters have no place
 * in it. Each entry keeps them in its own state instead: Back, Forward and a reload return to the
 * list as it was left, and a fresh visit to the bare list still opens the default tab.
 */
export function keepListSearch(history: RouterHistory): RouterHistory {
  const withSearch = (path: string, state: Record<string, unknown> | undefined) => {
    const search = listSearch(path);
    return search === undefined ? state : { ...state, [KEY]: search };
  };
  const { push, replace } = history;
  history.push = (path, state, options) => push(path, withSearch(path, state), options);
  history.replace = (path, state, options) => replace(path, withSearch(path, state), options);
  return history;
}

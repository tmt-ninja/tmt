import { useSyncExternalStore } from 'react';

/** The page-level preview settings (#5821). The viewer theme is the document's own: the Colab
 * shell's theme toggle when Design hosts the docs (#5866), and on the docs site the stored
 * browser-ui choice or the device. The docs never pick a theme of their own. The settings apply
 * to the preview root: the document on the docs site, the docs' own element when Design hosts them. */
export type Theme = 'dark' | 'light';
let root: HTMLElement | undefined;
const listeners = new Set<() => void>();
/** The document's theme: a pinned `data-theme`, else the device's colour scheme. */
function documentTheme(): Theme {
  const pinned = document.documentElement.getAttribute('data-theme');
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
let theme: Theme = 'dark';
let reduced = false;
let stopFollowing: (() => void) | undefined;
function follow() {
  const update = () => {
    theme = documentTheme();
    apply();
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const scheme = matchMedia('(prefers-color-scheme: light)');
  scheme.addEventListener('change', update);
  theme = documentTheme();
  return () => {
    observer.disconnect();
    scheme.removeEventListener('change', update);
  };
}
function apply() {
  if (!root) return;
  // The document's own attribute stays the shell's; a hosted root mirrors the resolved theme.
  if (root !== document.documentElement) root.dataset.theme = theme;
  if (reduced) root.dataset.tmtReducedMotion = '';
  else delete root.dataset.tmtReducedMotion;
  for (const listener of listeners) listener();
}
/** Where the settings apply; a hosted surface passes undefined when it unmounts. */
export function previewRoot(element: HTMLElement | undefined) {
  if (root && root !== element) {
    delete root.dataset.tmtReducedMotion;
    if (root !== document.documentElement) delete root.dataset.theme;
  }
  root = element;
  stopFollowing?.();
  stopFollowing = element ? follow() : undefined;
  apply();
}

/** The Motion page's reduced-motion simulation; never stored, so a reload restores real motion. */
export function setReducedMotion(next: boolean) {
  reduced = next;
  apply();
}
export function usePreview(): { theme: Theme; reduced: boolean } {
  const subscribe = (notify: () => void) => {
    listeners.add(notify);
    return () => listeners.delete(notify);
  };
  const read = () => `${theme}|${reduced}`;
  // The server render (the design-system template's doc pages, #5866) reads the same defaults.
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const [t, m] = snapshot.split('|') as [Theme, string];
  return { theme: t, reduced: m === 'true' };
}

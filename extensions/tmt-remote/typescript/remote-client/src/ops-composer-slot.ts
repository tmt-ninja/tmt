/** The Ops message box slot (#5704): loads the composer island on first use and holds its place
 * with a still box of the same height until it arrives. */
import { el } from './ops-parts.js';
import type { ComposerHandle, ComposerOptions } from './ops-composer-types.js';

/** The composer's own module, served beside the SDK (see vite.composer.config.ts). */
const COMPOSER = '/sdk/ops-composer-v1.js';
/** Where this tab keeps unsent words, so a reload brings them back (#6757): plain text in this
 * tab's sessionStorage, like the members page's unsent names, gone when the tab closes, never sent
 * anywhere, and cleared when the session changes or the browser is no longer paired. */
const STORE = 'tmt-ops-drafts-v1';
/** At most this many places keep their words; past it, the one typed in longest ago goes... */
export const DRAFT_PLACES = 50;
/** ...each up to this many UTF-8 bytes; a longer draft stays in its box until the tab goes. */
export const DRAFT_BYTES = 64 * 1024;
const utf8 = new TextEncoder();
const keepable = (text: string) => text.trim() !== '' && utf8.encode(text).length <= DRAFT_BYTES;

function readStore(): Map<string, string> {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? '[]');
    if (!Array.isArray(data)) return new Map();
    const rows = data.filter(
      (item): item is [string, string] =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string' &&
        keepable(item[1]),
    );
    return new Map(rows.slice(-DRAFT_PLACES));
  } catch {
    return new Map();
  }
}
function writeStore() {
  const kept = [...drafts].filter(([, text]) => keepable(text));
  try {
    if (kept.length) sessionStorage.setItem(STORE, JSON.stringify(kept));
    else sessionStorage.removeItem(STORE);
  } catch {
    // Storage refused (private mode, quota): the words stay in their box until the tab goes.
  }
}

/** The unsent words of each place (`channel:<squad>` or a member id), for the rail's draft mark
 * and for the box after a reload; every box on the page reports here. */
const drafts = readStore();
const draftListeners = new Set<() => void>();
export const hasDraft = (key: string) => drafts.has(key);
/** Calls `listener` whenever a place gains or loses its draft; returns the unsubscribe. */
export function onDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}
/** The unsent words of the place `key` now; blank when it holds none. */
export function keepDraft(key: string, text: string) {
  const had = drafts.has(key);
  // The latest typed place goes last, so the bound lets the oldest go first.
  drafts.delete(key);
  if (text.trim() !== '') drafts.set(key, text);
  const dropped = [...drafts.keys()].slice(0, Math.max(0, drafts.size - DRAFT_PLACES));
  for (const old of dropped) drafts.delete(old);
  writeStore();
  if (had === drafts.has(key) && !dropped.length) return;
  for (const listener of draftListeners) listener();
}
/** The session changed, or this browser is no longer paired: no unsent words stay for the next
 * one to see. */
export function forgetDrafts() {
  const had = drafts.size > 0;
  drafts.clear();
  writeStore();
  if (had) for (const listener of draftListeners) listener();
}

/** The composer is a lazily loaded React island, so pages that never open a channel skip it. */
export function composerSlot(host: HTMLElement) {
  let handle: ComposerHandle | undefined;
  let wanted: ComposerOptions | undefined;
  let loading = false;
  return {
    show(shown: ComposerOptions) {
      const options: ComposerOptions = {
        ...shown,
        saved: drafts.get(shown.key),
        onDraft: keepDraft,
      };
      wanted = options;
      if (handle) return handle.update(options);
      if (loading) return;
      loading = true;
      // Until the module arrives, a still box of the same height holds the place, so nothing jumps.
      const still = el('div', 'ops-composer-still');
      still.setAttribute('aria-hidden', 'true');
      still.append(el('span', 'ops-composer-still-text', options.placeholder));
      host.replaceChildren(still);
      void import(/* @vite-ignore */ COMPOSER).then(
        ({
          mountComposer,
        }: {
          mountComposer: (host: HTMLElement, options: ComposerOptions) => ComposerHandle;
        }) => {
          handle = mountComposer(host, wanted!);
        },
        () => {
          host.replaceChildren(
            el('p', 'ops-empty', 'The message box could not load. Reload the page to try again.'),
          );
        },
      );
    },
  };
}

/** The Ops message box slot (#5704): loads the composer island on first use and holds its place
 * with a still box of the same height until it arrives. */
import { el } from './ops-parts.js';
import type { ComposerHandle, ComposerOptions } from './ops-composer-types.js';

/** The composer's own module, served beside the SDK (see vite.composer.config.ts). */
const COMPOSER = '/sdk/ops-composer-v1.js';
/** Where this tab keeps unsent words, so a reload brings them back (#6757): plain text in this
 * tab's sessionStorage, like the members page's unsent names, gone when the tab closes and never
 * sent anywhere. The words are tagged with this browser's device (its Remote client id): after a
 * reload they show only once the page has read the same device, so a reload under another pairing
 * shows none. They are cleared when the session changes or the browser is no longer paired. */
const STORE = 'tmt-ops-drafts-v2';
const OLD_STORES = ['tmt-ops-drafts-v1'];
/** At most this many places keep their words; past it, the one typed in longest ago goes... */
export const DRAFT_PLACES = 50;
/** ...each up to this many UTF-8 bytes; a longer draft stays in its box until the tab goes. */
export const DRAFT_BYTES = 64 * 1024;
const utf8 = new TextEncoder();
const keepable = (text: string) => text.trim() !== '' && utf8.encode(text).length <= DRAFT_BYTES;

interface Kept {
  device: string;
  drafts: [string, string][];
}
function readStore(): Kept | undefined {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(STORE) ?? 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    const { device, drafts: rows } = data as Record<string, unknown>;
    if (typeof device !== 'string' || !device || device.length > 128 || !Array.isArray(rows))
      return undefined;
    const kept = rows.filter(
      (item): item is [string, string] =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string' &&
        keepable(item[1]),
    );
    return { device, drafts: kept.slice(-DRAFT_PLACES) };
  } catch {
    return undefined;
  }
}

/** The words kept from before a reload, held unshown until the page knows this browser's device. */
let held = readStore();
/** This browser's device once the page has read it; until then words stay in their boxes only. */
let device: string | undefined;
/** The unsent words of each place (`channel:<squad>` or a member id), for the rail's draft mark
 * and for the box after a reload; every box on the page reports here. */
const drafts = new Map<string, string>();
const draftListeners = new Set<() => void>();
const changed = () => {
  for (const listener of draftListeners) listener();
};

/** Saves the words for this device. A refused write (the tab's quota) drops the place typed in
 * longest ago and tries again, so the newest words that fit are kept. */
function writeStore() {
  if (device === undefined) return;
  const kept = [...drafts].filter(([, text]) => keepable(text));
  try {
    for (const old of OLD_STORES) sessionStorage.removeItem(old);
  } catch {
    // No storage at all: the words stay in their boxes until the tab goes.
  }
  for (let from = 0; from <= kept.length; from++)
    try {
      if (from === kept.length) sessionStorage.removeItem(STORE);
      else sessionStorage.setItem(STORE, JSON.stringify({ device, drafts: kept.slice(from) }));
      return;
    } catch {
      // Over the quota, or storage refused: try again without the oldest place.
    }
}

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
  if (had !== drafts.has(key) || dropped.length) changed();
}
/** The page has read this browser's device: words kept for it come back (never over words typed
 * since), and words kept for another device are dropped. `null` is no pairing at all. */
export function draftsFor(id: string | null) {
  if (id === null) return forgetDrafts();
  device = id;
  const restored = held?.device === id ? held.drafts.filter(([key]) => !drafts.has(key)) : [];
  held = undefined;
  // Words from before the reload are older than words typed since.
  const now = [...drafts];
  drafts.clear();
  for (const [key, text] of [...restored, ...now].slice(-DRAFT_PLACES)) drafts.set(key, text);
  writeStore();
  if (restored.length) changed();
}
/** The session changed, or this browser is no longer paired: no unsent words stay for the next
 * one to see, and new words stay in their boxes until the page reads the device again. */
export function forgetDrafts() {
  const had = drafts.size > 0;
  drafts.clear();
  held = undefined;
  device = undefined;
  try {
    for (const key of [STORE, ...OLD_STORES]) sessionStorage.removeItem(key);
  } catch {
    // Nothing was kept.
  }
  if (had) changed();
}

/** The composer is a lazily loaded React island, so pages that never open a channel skip it. */
export function composerSlot(host: HTMLElement) {
  let handle: ComposerHandle | undefined;
  let wanted: ComposerOptions | undefined;
  let loading = false;
  // Words that come back once the page knows this browser's device reach a box already shown; the
  // box keeps any words typed since (`saved` gives way to its own).
  onDrafts(() => {
    if (!wanted) return;
    wanted = { ...wanted, saved: drafts.get(wanted.key) };
    handle?.update(wanted);
  });
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

import { entryHash, entryMount, entryOpenTarget, publicEntry } from './entry.js';
import {
  binary,
  decimal,
  deriveSpaceId,
  equal,
  exactKeys,
  generatedId,
  requireValue,
  spaceId,
} from '@tmt/colab-client';
import { hintFragment, ownerPageHint } from './reading-link.js';
import { record } from './storage.js';
import { shortPageId, validPagePrefix } from './short-links.js';
import { jsonResponse } from './registration.js';
import { SUBPAGES } from './work.js';

import type { ExpiryInfo } from './expiry.js';

/** Project limits; `limits.rs` and the contract's Projects section hold the same numbers. */
export const PROJECT_POINTS = 32;
export const PROJECTS_PER_PAGE = 8;
/** Most projects the owner pins to the side menu (`SPACE_PROJECT_PINS` in `limits.rs`). */
export const PROJECT_PINS = 20;
/** Most names one space lists: creation stops at 256, and a space migrated from labels may hold up to its 1,000 assignments. */
const PROJECTS_PER_SPACE = 1000;

/** Page summary limits; the contract's Page summary section holds the same numbers. */
export const AUTHOR_BYTES = 128;
/** 50 readings + 50 answer blocks + 50 reviews. */
export const NEEDS_YOU_MAX = 150;
const COMMENTS_MAX = 4_294_967_295;
/** The complete `/api/pages` reply: 1,000 pages with the longest labels, summaries, work rows and
 * parents (about 1.9 MB) fit. */
export const DISCOVERY_BYTES = 2 * 1024 * 1024;
/** The longest local page title the owner serves, in UTF-8 bytes (`PAGE_TITLE_BYTES` in `limits.rs`). */
export const PAGE_TITLE_BYTES = 512;

/** Project names are display-only text: unique, 1 to 32 code points, no control character. The owner enforces the full grammar; the browser refuses what it could not render safely. */
function projectNames(names: readonly unknown[]): boolean {
  return (
    new Set(names).size === names.length &&
    names.every(
      (name) =>
        typeof name === 'string' &&
        [...name].length >= 1 &&
        [...name].length <= PROJECT_POINTS &&
        !/\p{Cc}/u.test(name),
    )
  );
}

/** A page's direct sub-pages counted by their own state, the same count its work panel shows;
 * omitted for a page without sub-pages (contract: Page summary). */
export interface PageWorkRow {
  stage: 'discussion' | 'in-progress' | 'done';
  done: number;
  total: number;
}
export type PageState = 'todo' | 'in-progress' | 'done';
export interface PageProgress {
  done: number;
  inProgress: number;
  todo: number;
  unknown: number;
  total: number;
}

/** An owner-derived direct sub-page count, bounded by the sub-page limit. */
export function pageProgress(value: unknown): asserts value is PageProgress {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  exactKeys(value, ['done', 'inProgress', 'todo', 'unknown', 'total']);
  for (const field of ['done', 'inProgress', 'todo', 'unknown', 'total'] as const)
    requireValue(
      Number.isSafeInteger(value[field]) &&
        Number(value[field]) >= 0 &&
        Number(value[field]) <= SUBPAGES,
    );
  requireValue(
    Number(value.total) ===
      Number(value.done) + Number(value.inProgress) + Number(value.todo) + Number(value.unknown),
  );
}

/** What the owner derives for the list: comment count, waiting items and the creator. */
export interface PageActivity {
  comments: number;
  /** At least one reading, answer block or review awaits the owner. */
  waiting: boolean;
  /** Pending readings, answer blocks and reviews; one count per target ID. */
  needsYou: number;
  /** The page's creation label (`meta.originalAuthor`); omitted when it has none. */
  author?: string;
  /** The page's sub-pages; omitted for a page with none, so a fresh summary without it is in
   * discussion. */
  work?: PageWorkRow;
  /** The page this one is a sub-page of, and its position in that page's list; omitted when it
   * has no parent. */
  parent?: { page: string; index: number };
}
export interface PageInfo extends ExpiryInfo {
  state?: PageState | null;
  stateError?: 'page-unavailable';
  pageId: string;
  epoch: string;
  sharing: 'private' | 'link' | 'public';
  history: 'shared' | 'current';
  archived: boolean;
  /** Display-only projects the page is in; sorted by the owner store, at most 8. */
  projects: readonly string[];
  /** Display-only pin (contract: Pins): present and true for a pinned page; the owner lists pinned
   * pages first, in pin order. */
  pinned?: true;
  /** Display-only page kind (contract: Page kinds): present only on a design-system page (#5866). */
  kind?: 'design-system';
  /** The page's revision token, the one `page read` returns (contract: Live page list). */
  revision?: string;
  /** Display-only and unsigned; absent until the owner has derived it for the page's current state. */
  summary?: PageActivity;
  /** The owner's local plaintext title, current for the page's state; absent until the owner has folded it
   * (or when the reply had no room for it): the browser then keeps its own hint. */
  title?: string;
}
export interface PageId {
  pageId: string;
  deleted: boolean;
}
/** The side menu's projects in order: the owner's list, or until it writes one the owner's automatic default. */
export interface ProjectPins {
  readonly names: readonly string[];
  readonly automatic: boolean;
}
export interface Bootstrap {
  space: string;
  owner: Uint8Array;
  revision: string;
  /** Every project of the space, including those with no page; sorted by the owner store. */
  projects: readonly string[];
  /** The owner's pinned projects, in order (display-only, untrusted text). */
  projectPins: ProjectPins;
  pages: PageInfo[];
  pageIds: PageId[];
}
/** A work row is untrusted text too: closed values, and counts that agree with the stage. */
function workRow(value: unknown): asserts value is PageWorkRow {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  exactKeys(value, ['stage', 'done', 'total']);
  const count = (n: unknown): n is number =>
    Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= SUBPAGES;
  requireValue(count(value.done) && count(value.total) && value.done <= value.total);
  // The stage follows the counts, as `waiting` follows `needsYou`.
  requireValue(
    value.stage ===
      (value.total === 0 ? 'discussion' : value.done === value.total ? 'done' : 'in-progress'),
  );
}
/** The owner's display-only summary is untrusted text: bounded and typed, never trusted for more. */
export function activity(value: unknown): asserts value is PageActivity {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  exactKeys(value, [
    'comments',
    'waiting',
    'needsYou',
    ...('author' in value ? ['author'] : []),
    ...('work' in value ? ['work'] : []),
    ...('parent' in value ? ['parent'] : []),
  ]);
  requireValue(
    Number.isSafeInteger(value.comments) &&
      Number(value.comments) >= 0 &&
      Number(value.comments) <= COMMENTS_MAX &&
      typeof value.waiting === 'boolean' &&
      Number.isSafeInteger(value.needsYou) &&
      Number(value.needsYou) >= 0 &&
      Number(value.needsYou) <= NEEDS_YOU_MAX &&
      value.waiting === Number(value.needsYou) > 0,
  );
  if ('author' in value)
    requireValue(
      typeof value.author === 'string' &&
        value.author.length >= 1 &&
        new TextEncoder().encode(value.author).length <= AUTHOR_BYTES &&
        !/\p{Cc}/u.test(value.author),
    );
  if ('work' in value) workRow(value.work);
  if ('parent' in value) {
    const parent = value.parent;
    requireValue(parent !== null && typeof parent === 'object' && !Array.isArray(parent));
    exactKeys(parent, ['page', 'index']);
    requireValue(typeof parent.page === 'string');
    generatedId(parent.page);
    requireValue(
      Number.isSafeInteger(parent.index) &&
        Number(parent.index) >= 0 &&
        Number(parent.index) < SUBPAGES,
    );
  }
}
export function mountUrl(): URL {
  if (publicEntry()) return entryMount();
  const url = new URL(location.href);
  requireValue(/^\/r\/[a-z0-9]+\/x\/colab\/$/.test(url.pathname) && url.search === '');
  url.hash = '';
  return url;
}
/** Owner-only paired mount discovery is the sole TOFU exception. Later discovery
 * must match the durable origin/mount pin and fragment, with no silent re-pin. It also keeps the
 * document's location canonical for Colab's own routes; a caller whose document belongs to another
 * module (`locate: false`, the global search) neither reads nor writes the location. */
export async function discover(
  mount: URL,
  verify?: (space: string, owner: Uint8Array) => Promise<unknown>,
  signal?: AbortSignal,
  { locate = true }: { locate?: boolean } = {},
): Promise<Bootstrap> {
  const value = await jsonResponse(
    await fetch(new URL('api/pages', mount), {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    }),
    DISCOVERY_BYTES,
  );
  exactKeys(value, [
    'spaceId',
    'ownerKey',
    'revision',
    'projects',
    'projectPins',
    'pages',
    'pageIds',
    // The live list's token (contract: Live page list); read by `listRevisions`, not here.
    ...(value !== null && typeof value === 'object' && 'listToken' in value ? ['listToken'] : []),
  ]);
  if ('listToken' in value)
    requireValue(typeof value.listToken === 'string' && LIST_TOKEN.test(value.listToken));
  requireValue(typeof value.spaceId === 'string' && typeof value.revision === 'string');
  spaceId(value.spaceId);
  decimal(value.revision);
  const owner = binary(value.ownerKey, 32, 32);
  requireValue((await deriveSpaceId(owner)) === value.spaceId);
  requireValue(Array.isArray(value.pages) && value.pages.length <= 1000);
  requireValue(
    Array.isArray(value.projects) &&
      value.projects.length <= PROJECTS_PER_SPACE &&
      projectNames(value.projects),
  );
  const known = new Set<unknown>(value.projects);
  exactKeys(value.projectPins, ['names', 'automatic']);
  requireValue(
    typeof value.projectPins.automatic === 'boolean' &&
      Array.isArray(value.projectPins.names) &&
      value.projectPins.names.length <= PROJECT_PINS &&
      projectNames(value.projectPins.names) &&
      value.projectPins.names.every((name: unknown) => known.has(name)),
  );
  const visibleIds = new Set<string>();
  for (const page of value.pages) {
    exactKeys(page, [
      'pageId',
      'epoch',
      'sharing',
      'history',
      'archived',
      'retentionDays',
      'lastUpdateAtMs',
      'expiresAtMs',
      'warnings',
      'projects',
      ...(page !== null && typeof page === 'object' && 'pinned' in page ? ['pinned'] : []),
      ...(page !== null && typeof page === 'object' && 'kind' in page ? ['kind'] : []),
      ...(page !== null && typeof page === 'object' && 'summary' in page ? ['summary'] : []),
      ...(page !== null && typeof page === 'object' && 'state' in page ? ['state'] : []),
      ...(page !== null && typeof page === 'object' && 'stateError' in page ? ['stateError'] : []),
      ...(page !== null && typeof page === 'object' && 'title' in page ? ['title'] : []),
      ...(page !== null && typeof page === 'object' && 'revision' in page
        ? ['revision', 'contentRevision']
        : []),
    ]);
    if ('revision' in page)
      requireValue(
        typeof page.revision === 'string' &&
          PAGE_REVISION.test(page.revision) &&
          typeof page.contentRevision === 'string' &&
          CONTENT_REVISION.test(page.contentRevision),
      );
    if ('pinned' in page) requireValue(page.pinned === true && page.archived === false);
    if ('kind' in page) requireValue(page.kind === 'design-system');
    if ('summary' in page) activity(page.summary);
    if ('state' in page)
      requireValue(
        page.state === null ||
          page.state === 'todo' ||
          page.state === 'in-progress' ||
          page.state === 'done',
      );
    if ('stateError' in page)
      requireValue(page.stateError === 'page-unavailable' && page.state === null);

    // Untrusted display text: one line of plain text, as the owner's store keeps it.
    if ('title' in page)
      requireValue(
        typeof page.title === 'string' &&
          page.title.length >= 1 &&
          new TextEncoder().encode(page.title).length <= PAGE_TITLE_BYTES &&
          !/\p{Cc}/u.test(page.title),
      );
    requireValue(
      page.retentionDays === null ||
        (Number.isSafeInteger(page.retentionDays) && Number(page.retentionDays) > 0),
    );
    for (const key of ['lastUpdateAtMs', 'expiresAtMs'])
      requireValue(
        page[key] === null || (Number.isSafeInteger(page[key]) && Number(page[key]) >= 0),
      );
    requireValue(
      Array.isArray(page.warnings) &&
        page.warnings.length <= 1 &&
        page.warnings.every(
          (w) => typeof w === 'string' && ['expires-soon', 'not-in-cloud'].includes(w),
        ),
    );
    // Projects are display-only text from the owner store; the owner enforces the full grammar, the
    // browser only refuses what it could not render safely or what the store never writes.
    requireValue(
      Array.isArray(page.projects) &&
        page.projects.length <= PROJECTS_PER_PAGE &&
        projectNames(page.projects) &&
        page.projects.every((name: unknown) => known.has(name)),
    );
    requireValue(typeof page.pageId === 'string' && typeof page.epoch === 'string');
    generatedId(page.pageId);
    decimal(page.epoch);
    requireValue(
      !visibleIds.has(page.pageId) &&
        ['private', 'link', 'public'].includes(String(page.sharing)) &&
        ['shared', 'current'].includes(String(page.history)) &&
        typeof page.archived === 'boolean',
    );
    visibleIds.add(page.pageId);
  }
  requireValue(Array.isArray(value.pageIds) && value.pageIds.length <= 1000);
  let previousId = '';
  const liveIds: string[] = [];
  for (const page of value.pageIds) {
    exactKeys(page, ['pageId', 'deleted']);
    requireValue(typeof page.pageId === 'string' && typeof page.deleted === 'boolean');
    generatedId(page.pageId);
    requireValue(page.pageId > previousId);
    previousId = page.pageId;
    if (!page.deleted) liveIds.push(page.pageId);
  }
  // Display order is pins first in pin order, not global ID order. The historical catalog stays
  // sorted; compare membership separately without changing the owner's display order.
  requireValue(liveIds.length === visibleIds.size && liveIds.every((id) => visibleIds.has(id)));
  await verify?.(value.spaceId, owner);
  await navigator.locks.request(`colab-pin:${mount.href}`, async () => {
    const pin = await record<{ space: string; owner: Uint8Array }>(`pin:${mount.href}`),
      fragment = locate ? new URLSearchParams(location.hash.slice(1)).get('space') : null;
    requireValue(
      (!fragment || fragment === value.spaceId) &&
        (!pin || (pin.space === value.spaceId && equal(pin.owner, owner))),
    );
    // The location keeps only the canonical fragment of its display target: a plain #id becomes
    // #anchor=<id>, and a fragment that names none is dropped, so nothing downstream (a copied
    // link, an Ask's page link) carries it.
    if (locate && publicEntry()) {
      const canonical = entryHash(entryOpenTarget());
      if (location.hash !== canonical)
        history.replaceState(history.state, '', location.pathname + location.search + canonical);
    }
    let path: string | null = null;
    if (locate && !fragment && !publicEntry()) {
      const incoming = new URLSearchParams(location.hash.slice(1));
      path = incoming.get('path');
      requireValue(
        [...incoming.keys()].every((key) => key === 'path') && incoming.getAll('path').length <= 1,
      );
      // A short link's prefix, or a page's full ID from its native deep link (`<mount>/pages/<id>`).
      requireValue(
        path === null ||
          (path.startsWith('/short/') && validPagePrefix(path.slice(7))) ||
          path.startsWith('/pages/'),
      );
      if (path?.startsWith('/pages/')) generatedId(path.slice(7));
    }
    if (!pin) await record(`pin:${mount.href}`, { space: value.spaceId, owner });
    if (locate && !fragment && !publicEntry()) {
      history.replaceState(
        history.state,
        '',
        `${mount.pathname}#space=${value.spaceId}${path ? `&path=${encodeURIComponent(path)}` : ''}`,
      );
    }
  });
  if (
    locate &&
    !publicEntry() &&
    typeof location.pathname === 'string' &&
    location.pathname.startsWith('/r/')
  ) {
    const target = new URLSearchParams(location.hash.slice(1)).get('path');
    const hint = ownerPageHint(new URL(location.href), value.spaceId);
    const ids = (value.pageIds as PageId[]).map((row) => row.pageId);
    let destination = '/colab/';
    if (target?.startsWith('/pages/')) {
      const page = target.slice(7);
      generatedId(page);
      destination = `/p/${shortPageId(page, ids)}`;
    } else if (target?.startsWith('/short/') && validPagePrefix(target.slice(7))) {
      destination = `/p/${target.slice(7)}`;
    } else requireValue(target === null || target === '/');
    // The owner's cosmetic reading or shell-anchor hint rides the short location.
    const tail = hint && destination !== '/colab/' ? hintFragment(hint) : '';
    history.replaceState(history.state, '', destination + tail);
  }
  return {
    space: value.spaceId,
    owner,
    revision: value.revision,
    projects: value.projects as unknown as readonly string[],
    projectPins: value.projectPins as unknown as ProjectPins,
    pages: value.pages as unknown as PageInfo[],
    pageIds: value.pageIds as unknown as PageId[],
  };
}

export const LIST_TOKEN = /^[0-9a-f]{64}$/;
const PAGE_REVISION = /^v1:[0-9a-f]{64}$/;
/** A held list read waits on the serve at most 10 s (`limits::PAGE_LIST_HOLD`); this bound only
 * catches a serve that never answers: past Remote's 15 s mounted-reply deadline plus transit. */
const HELD_LIST_TIMEOUT_MS = 20_000;
/** A listed page's content revision: 64 lowercase hex digits, opaque (contract: Live page list). */
export const CONTENT_REVISION = /^[0-9a-f]{64}$/;
/** What one held list read learned: the list moved or did not. A moved list names each page's
 * revision, the write fence that also moves on any membership change, and its content revision,
 * which moves only when the page's own content does. */
export type PageListChange =
  | { unchanged: true; listToken: string }
  | {
      unchanged: false;
      listToken: string;
      revisions: ReadonlyMap<string, string>;
      contents: ReadonlyMap<string, string>;
    };
/** The pages' revisions from a list reply. Only IDs and opaque tokens are read: the list's display
 * fields stay with `discover`, which validates them for display. */
export function listRevisions(value: unknown): PageListChange {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  const list = value as Record<string, unknown>;
  requireValue(typeof list.listToken === 'string' && LIST_TOKEN.test(list.listToken));
  if (list.unchanged === true) {
    exactKeys(list, ['listToken', 'unchanged']);
    return { unchanged: true, listToken: list.listToken };
  }
  requireValue(Array.isArray(list.pages) && list.pages.length <= 1000);
  const revisions = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const page of list.pages as unknown[]) {
    requireValue(page !== null && typeof page === 'object');
    const { pageId, revision, contentRevision } = page as Record<string, unknown>;
    requireValue(typeof pageId === 'string');
    generatedId(pageId);
    // A row names both or neither: a frozen page has no revision and no content revision.
    requireValue((revision === undefined) === (contentRevision === undefined));
    if (revision === undefined) continue;
    requireValue(typeof revision === 'string' && PAGE_REVISION.test(revision));
    requireValue(typeof contentRevision === 'string' && CONTENT_REVISION.test(contentRevision));
    revisions.set(pageId, revision);
    contents.set(pageId, contentRevision);
  }
  return { unchanged: false, listToken: list.listToken, revisions, contents };
}
/** One plain owner list read, for its revisions only (the feed's first read and its fallback). */
export async function pageList(mount: URL, signal: AbortSignal): Promise<PageListChange> {
  const value = await jsonResponse(
    await fetch(new URL('api/pages', mount), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    }),
    DISCOVERY_BYTES,
  );
  return listRevisions(value);
}
/** One held owner list read (contract: Live page list): it answers once the list no longer has
 * `after` as its token, or unchanged after the serve's hold. A serve already holding its cap
 * refuses with `AdmissionRefusedError` code CAPACITY. */
export async function heldPageList(
  mount: URL,
  after: string,
  signal: AbortSignal,
): Promise<PageListChange> {
  requireValue(LIST_TOKEN.test(after));
  const value = await jsonResponse(
    await fetch(new URL(`api/pages/after/${after}`, mount), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(HELD_LIST_TIMEOUT_MS)]),
    }),
    DISCOVERY_BYTES,
  );
  return listRevisions(value);
}

import { decodeText, text } from '@tmt/colab-client';
import { tableColumns } from './block-model.js';
import { blockTree } from './block-projection.js';
import { BLOCK_TEXT_BYTES, type BlockEntry } from './blocks.js';
import type { TableCell } from './block-text-sync.js';
import { draftKey, ownerBlockDraftKey, readDraftKey } from './keyring.js';
import { open, seal, type Sealed } from './local-seal.js';
import { readAdmittedRecord, record, recordKeys, writeAdmittedRecord } from './storage.js';

export interface BlockDraft {
  /** Stable for one editing session. Two tabs must not replace each other's recovery. */
  target: string;
  generation: string;
  id: string;
  cell?: TableCell;
  base: string;
  value: string;
}

/** Only bounded, usable entries can become a recovery action. */
function validBlockDraft(value: unknown): value is BlockDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  const identifier = (field: unknown) =>
    typeof field === 'string' && field.length > 0 && text(field).length <= 256;
  if (!identifier(draft.target) || !identifier(draft.generation) || !identifier(draft.id))
    return false;
  if (typeof draft.base !== 'string' || typeof draft.value !== 'string') return false;
  if (text(draft.base).length > BLOCK_TEXT_BYTES || text(draft.value).length > BLOCK_TEXT_BYTES)
    return false;
  if (draft.cell !== undefined) {
    if (!draft.cell || typeof draft.cell !== 'object' || Array.isArray(draft.cell)) return false;
    const cell = draft.cell as Record<string, unknown>;
    if (!identifier(cell.table) || !identifier(cell.column)) return false;
  }
  return true;
}

const MAX_DRAFT_BYTES = 3 * 1024 * 1024;
const MAX_DRAFTS = 32;
const legacyPrefix = (space: string) => `block-drafts:${space}:`;
const legacyName = (space: string, device: string, page: string) =>
  `${legacyPrefix(space)}${device}:${page}`;
const legacyScope = (space: string, device: string, page: string) => [
  'tmt-colab-block-drafts-v1',
  space,
  device,
  page,
];

async function readDrafts(
  key: CryptoKey,
  scope: string[],
  stored: Sealed,
  strict = false,
): Promise<BlockDraft[]> {
  const parsed: unknown = JSON.parse(decodeText(await open(key, scope, stored, MAX_DRAFT_BYTES)));
  if (!Array.isArray(parsed)) throw new Error('Invalid block drafts');
  const seen = new Set<string>();
  const drafts = parsed.filter((entry): entry is BlockDraft => {
    if (!validBlockDraft(entry) || seen.has(entry.target) || seen.size >= MAX_DRAFTS) return false;
    seen.add(entry.target);
    return true;
  });
  if (strict && drafts.length !== parsed.length) throw new Error('Invalid block draft entry');
  return drafts;
}

function draftBytes(drafts: BlockDraft[]) {
  const bytes = text(JSON.stringify(drafts));
  return bytes.length <= MAX_DRAFT_BYTES && drafts.length <= MAX_DRAFTS ? bytes : undefined;
}

type DraftEdit = (drafts: BlockDraft[]) => BlockDraft[] | false | undefined;
function draftOperations(change: (page: string, edit: DraftEdit) => Promise<boolean>) {
  const at = (drafts: BlockDraft[], target: string) =>
    drafts.findIndex((draft) => draft.target === target);
  return {
    save: (page: string, edit: BlockDraft) =>
      change(page, (drafts) => {
        if ([edit.base, edit.value].some((s) => text(s).length > BLOCK_TEXT_BYTES)) return false;
        const index = at(drafts, edit.target);
        drafts.splice(index < 0 ? drafts.length : index, index < 0 ? 0 : 1, edit);
        return drafts;
      }),
    /** Drops exactly this generation of a draft (a restored one the person dismissed). */
    clear: (page: string, edit: BlockDraft) =>
      change(page, (drafts) => {
        const index = at(drafts, edit.target);
        if (drafts[index]?.generation !== edit.generation) return undefined;
        drafts.splice(index, 1);
        return drafts;
      }),
    /** Drops what a place keeps unless it is generation `keep`: text that landed, and anything
     * older, goes; only a newer draft on its way stays. */
    settle: (page: string, target: string, keep?: string) =>
      change(page, (drafts) => {
        const index = at(drafts, target);
        if (index < 0 || drafts[index]!.generation === keep) return undefined;
        drafts.splice(index, 1);
        return drafts;
      }),
  };
}

/** Same sealed device store as composers. Older bundles continue to use these record names. */
export function blockDraftStore(space: string, device: string) {
  const scope = (page: string) => legacyScope(space, device, page);
  const name = (page: string) => legacyName(space, device, page);
  const load = async (page: string): Promise<BlockDraft[]> => {
    const stored = await record<Sealed>(name(page));
    if (stored === undefined) return [];
    try {
      return await readDrafts(await readDraftKey(device), scope(page), stored);
    } catch {
      // An unreadable, damaged or future record cannot supply recovery; a new save replaces it.
      return [];
    }
  };
  /** Changes the page's record in its one queue: `edit` returns the drafts to write, `false` to
   * refuse, or nothing when there is nothing to write. */
  async function change(page: string, edit: DraftEdit) {
    try {
      return await navigator.locks.request(name(page), async () => {
        const drafts = edit(await load(page));
        if (drafts === undefined) return true;
        if (!drafts) return false;
        const bytes = draftBytes(drafts);
        if (!bytes) return false;
        await record(name(page), await seal(await draftKey(device), scope(page), bytes));
        return true;
      });
    } catch {
      return false;
    }
  }
  return { load, ...draftOperations(change) };
}
export type BlockDraftStore = ReturnType<typeof blockDraftStore> & {
  recover?(page: string): Promise<{ drafts: BlockDraft[]; unavailable: boolean }>;
  recoverySession?(): object | undefined;
};

export interface BlockDraftAdmission {
  root: string;
  session: object;
}

const MIGRATION_BATCH = 8;
const MIGRATION_SCAN = 256;

/** A Live binding supplies current owner admission at each use. Typing during a disconnect
 * still uses the device store, and those drafts join the owner record upon readmission. */
export function ownerBlockDraftStore(
  space: string,
  device: string,
  admission: () => BlockDraftAdmission | undefined,
): BlockDraftStore {
  const local = blockDraftStore(space, device);

  function access(owner: BlockDraftAdmission) {
    const { root, session } = owner;
    const check = () => {
      const current = admission();
      if (current?.root !== root || current.session !== session)
        throw new Error('Owner block draft admission ended');
    };
    const name = (page: string) => `owner-block-drafts:${space}:${root}:${page}`;
    const scope = (page: string) => ['tmt-colab-owner-block-drafts-v1', space, root, page];
    const key = (create: boolean) => ownerBlockDraftKey(space, root, check, create);
    const unlock = async (page: string) => {
      const existingKey = await key(false);
      const retained = await readAdmittedRecord<Sealed>(name(page), check);
      if (retained === undefined) return { drafts: [], existingKey };
      if (!existingKey) throw new Error('Owner block draft key unavailable');
      const drafts = await readDrafts(existingKey, scope(page), retained, true);
      check();
      return { drafts, existingKey };
    };
    const change = (page: string, from: string, edit?: DraftEdit) =>
      navigator.locks.request(name(page), () =>
        navigator.locks.request(legacyName(space, from, page), async () => {
          const own = await unlock(page);
          const oldName = legacyName(space, from, page);
          const old = await readAdmittedRecord<Sealed>(oldName, check);
          let legacy: BlockDraft[] = [];
          if (old !== undefined) {
            try {
              const oldKey = await readDraftKey(from, check);
              check();
              legacy = await readDrafts(oldKey, legacyScope(space, from, page), old, true);
              check();
            } catch {
              check();
              if (!edit) return false;
            }
          }
          const targets = new Set(legacy.map((draft) => draft.target));
          const combined = [...own.drafts.filter((draft) => !targets.has(draft.target)), ...legacy];
          const next = edit?.(combined);
          if (next === false) return false;
          if (next === undefined && !legacy.length) return true;
          const bytes = draftBytes(next ?? combined);
          if (!bytes) return false;
          const writeKey = own.existingKey ?? (await key(true));
          if (!writeKey) return false;
          const sealed = await seal(writeKey, scope(page), bytes);
          await writeAdmittedRecord(name(page), sealed, check, legacy.length ? oldName : undefined);
          return true;
        }),
      );
    return { check, unlock, change };
  }

  const recover = async (page: string) => {
    const owner = admission();
    if (!owner) return { drafts: await local.load(page), unavailable: false };
    const { check, unlock, change } = access(owner);
    const cursor = `owner-block-draft-migration:${space}:${owner.root}:${page}`;
    const prefix = legacyPrefix(space);
    const unavailable = await navigator.locks.request(cursor, async () => {
      // This also checks the owner key before looking for any legacy records.
      let missing = !(await change(page, device));
      const saved = await readAdmittedRecord<string>(cursor, check);
      const after = typeof saved === 'string' && saved.startsWith(prefix) ? saved : undefined;
      const names = await recordKeys(prefix, after, MIGRATION_SCAN, check);
      let migrated = 0;
      let next = names.length === MIGRATION_SCAN ? names.at(-1) : null;
      for (const name of names) {
        check();
        if (typeof name !== 'string') continue;
        const [from, otherPage, extra] = name.slice(prefix.length).split(':');
        if (!from || from === device || otherPage !== page || extra !== undefined) continue;
        if (!(await change(page, from))) missing = true;
        if (++migrated === MIGRATION_BATCH) {
          next = name;
          break;
        }
      }
      if (next !== (saved ?? null)) await writeAdmittedRecord(cursor, next, check);
      return missing;
    });
    return { drafts: (await unlock(page)).drafts, unavailable };
  };

  const ops = draftOperations(async (page, edit) => {
    const owner = admission();
    if (!owner) return false;
    try {
      return await access(owner).change(page, device, edit);
    } catch {
      return false;
    }
  });
  return {
    recover,
    recoverySession: () => admission()?.session,
    load: async (page) => (await recover(page)).drafts,
    save: (page, draft) => (admission() ? ops.save(page, draft) : local.save(page, draft)),
    clear: (page, draft) => (admission() ? ops.clear(page, draft) : local.clear(page, draft)),
    settle: (page, target, keep) =>
      admission() ? ops.settle(page, target, keep) : local.settle(page, target, keep),
  };
}

/** The drafts whose text landed, by generation, in this tab's sessionStorage: written at once when
 * a batch lands, so a reload before the device store drops them never offers them back (#6749).
 * Ids only, never text; the newest `LANDED` are kept. */
const landedKey = (page: string) => `tmt-colab-block-landed-v1:${page}`;
const LANDED = 256;
function landedIn(page: string): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(landedKey(page)) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function bury(page: string, generations: readonly string[]) {
  try {
    const kept = [...landedIn(page), ...generations].slice(-LANDED);
    sessionStorage.setItem(landedKey(page), JSON.stringify(kept));
  } catch {
    // Without session storage the device store's own clearing is all there is.
  }
}
/** `value` made from `base` by one insertion (typing at one place): where, and what. */
function insertion(base: string, value: string): { at: number; text: string } | undefined {
  const from = [...base];
  const to = [...value];
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head++;
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  )
    tail++;
  if (from.length - head - tail !== 0) return undefined;
  return { at: head, text: to.slice(head, to.length - tail).join('') };
}

/** The page already holds what `draft` would restore: its text, or more of the same typing. A
 * draft saved early in a run of typing, whose later saves a reload cut off while the whole run
 * landed, adds nothing, so it is not offered (#6795). */
export function heldByPage(draft: Pick<BlockDraft, 'base' | 'value'>, present: string): boolean {
  if (present === draft.value) return true;
  const typed = insertion(draft.base, draft.value);
  const page = insertion(draft.base, present);
  return (
    !!typed &&
    !!page &&
    typed.text !== '' &&
    typed.at === page.at &&
    page.text.startsWith(typed.text)
  );
}

/** The stored drafts a reload offers: none whose text this tab saw land. */
export function restorable(page: string, drafts: readonly BlockDraft[]): BlockDraft[] {
  const landed = new Set(landedIn(page));
  return drafts.filter((draft) => !landed.has(draft.generation));
}

/** Plain text in the page's reading order. Drafts with no visible address follow in store order. */
export function blockDraftClipboardText(
  drafts: readonly BlockDraft[],
  blocks: Readonly<Record<string, BlockEntry>>,
): string {
  const { tree } = blockTree(blocks);
  const order = new Map(tree.flat().map((block, index) => [block.id, index]));
  const afterPage = order.size;
  const ranked = drafts.map((draft) => {
    const cell = draft.cell;
    if (!cell) return { draft, block: order.get(draft.id) ?? afterPage, row: -1, column: -1 };
    const table = tree.get(cell.table);
    const block = order.get(cell.table);
    const row = tree.rows(cell.table).findIndex((entry) => entry.id === draft.id);
    const column = table ? tableColumns(table.props).findIndex(({ id }) => id === cell.column) : -1;
    if (block === undefined || row < 0 || column < 0)
      return { draft, block: afterPage, row: -1, column: -1 };
    return { draft, block, row, column };
  });
  return ranked
    .sort((a, b) => a.block - b.block || a.row - b.row || a.column - b.column)
    .map(({ draft }) => draft.value)
    .join('\n\n');
}

export class BlockDraftSession {
  readonly latest = new Map<string, BlockDraft>();
  readonly targets = new Map<string, string>();
  readonly writes = new Map<string, Promise<boolean>>();
  readonly durable = new Set<string>();
  /** Each draft's own save while it is on its way. */
  private readonly saving = new WeakMap<BlockDraft, Promise<boolean>>();
  /** Drafts whose batch landed: none is saved from then on. */
  private readonly landed = new WeakSet<BlockDraft>();
  /** This tab's drafts in the order it made them, and each place's saved ones, oldest first. */
  private readonly order = new WeakMap<BlockDraft, number>();
  private made = 0;
  private readonly saved = new Map<string, BlockDraft[]>();
  constructor(
    readonly store: BlockDraftStore,
    readonly page: string,
  ) {}
  remember(id: string, cell: TableCell | undefined, base: string, value: string) {
    const address = JSON.stringify([id, cell?.table, cell?.column]);
    const target = this.targets.get(address) ?? crypto.randomUUID();
    this.targets.set(address, target);
    const draft = { id, cell, base, value, target, generation: crypto.randomUUID() };
    this.order.set(draft, ++this.made);
    this.latest.set(target, draft);
    this.durable.delete(target);
    if (!this.writes.has(target)) {
      const writing = this.writeLatest(target);
      this.writes.set(target, writing);
      void writing.finally(() => this.writes.delete(target));
    }
  }
  private async writeLatest(target: string): Promise<boolean> {
    while (true) {
      const draft = this.latest.get(target);
      if (!draft || this.landed.has(draft)) return true;
      const saving = this.store.save(this.page, draft).catch(() => false);
      this.saving.set(draft, saving);
      const ok = await saving;
      if (ok) this.saved.set(target, [...(this.saved.get(target) ?? []), draft].slice(-16));
      if (this.latest.get(target) !== draft) continue;
      if (ok) {
        this.durable.add(target);
        if (typeof window !== 'undefined')
          window.dispatchEvent(
            new CustomEvent('colab:block-draft-durable', { detail: { id: draft.id } }),
          );
      }
      if (this.latest.get(target) !== draft) continue;
      return ok;
    }
  }
  matching(id: string, cell: TableCell | undefined, value: string) {
    const target = this.targets.get(JSON.stringify([id, cell?.table, cell?.column]));
    const draft = target && this.latest.get(target);
    return draft && draft.value === value ? draft : undefined;
  }
  /** `draft`'s batch landed (or its text needs no recovery): the store drops it and anything older
   * for its place, after its own save if one is on its way, and never waits for a newer draft's
   * save. A newer draft typed meanwhile (a join right after a split) stays; until it is saved a
   * reload restores nothing that landed (#6749). */
  async admitted(draft: BlockDraft): Promise<boolean> {
    this.landed.add(draft);
    // At once: this text and every older one saved for its place are never a reload's to offer.
    const at = this.order.get(draft) ?? Infinity;
    const older = (this.saved.get(draft.target) ?? []).filter(
      (saved) => (this.order.get(saved) ?? 0) <= at,
    );
    bury(
      this.page,
      [draft, ...older].map((buried) => buried.generation),
    );
    this.saved.set(
      draft.target,
      (this.saved.get(draft.target) ?? []).filter((saved) => !older.includes(saved)),
    );
    await this.saving.get(draft);
    const newer = this.latest.get(draft.target);
    const keep = newer && newer !== draft && !this.landed.has(newer) ? newer.generation : undefined;
    if (!(await this.store.settle(this.page, draft.target, keep))) return false;
    if (this.latest.get(draft.target) !== draft) return false;
    this.latest.delete(draft.target);
    this.durable.delete(draft.target);
    return true;
  }
  async forget(id: string, cell: TableCell | undefined): Promise<boolean> {
    const target = this.targets.get(JSON.stringify([id, cell?.table, cell?.column]));
    const draft = target && this.latest.get(target);
    return draft ? this.admitted(draft) : true;
  }
  unsafe() {
    return [...this.latest.keys()].some((target) => !this.durable.has(target));
  }
  async waitForStorage() {
    await Promise.all(this.writes.values());
    return !this.unsafe();
  }
}

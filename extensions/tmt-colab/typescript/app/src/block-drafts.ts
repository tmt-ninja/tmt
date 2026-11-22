import { decodeText, text } from '@tmt/colab-client';
import { BLOCK_TEXT_BYTES } from './blocks.js';
import type { TableCell } from './block-text-sync.js';
import { draftKey } from './keyring.js';
import { open, seal, type Sealed } from './local-seal.js';
import { record } from './storage.js';

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

/** Same sealed device store as composers. Its v1 reader rejects a whole page on an unknown edit. */
export function blockDraftStore(space: string, device: string) {
  const scope = (page: string) => ['tmt-colab-block-drafts-v1', space, device, page];
  const name = (page: string) => `block-drafts:${space}:${device}:${page}`;
  const maxBytes = 3 * 1024 * 1024;
  const load = async (page: string): Promise<BlockDraft[]> => {
    const stored = await record<Sealed>(name(page));
    if (stored === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(
        decodeText(await open(await draftKey(device), scope(page), stored, maxBytes)),
      );
      if (!Array.isArray(parsed)) return [];
      const seen = new Set<string>();
      return parsed.filter((entry): entry is BlockDraft => {
        if (!validBlockDraft(entry) || seen.has(entry.target) || seen.size >= 32) return false;
        seen.add(entry.target);
        return true;
      });
    } catch {
      // An unreadable, damaged or future record cannot supply recovery; a new save replaces it.
      return [];
    }
  };
  /** Changes the page's record in its one queue: `edit` returns the drafts to write, `false` to
   * refuse, or nothing when there is nothing to write. */
  async function change(
    page: string,
    edit: (drafts: BlockDraft[]) => BlockDraft[] | false | undefined,
  ) {
    try {
      return await navigator.locks.request(name(page), async () => {
        const drafts = edit(await load(page));
        if (drafts === undefined) return true;
        if (!drafts) return false;
        const bytes = text(JSON.stringify(drafts));
        if (bytes.length > maxBytes || drafts.length > 32) return false;
        await record(name(page), await seal(await draftKey(device), scope(page), bytes));
        return true;
      });
    } catch {
      return false;
    }
  }
  const at = (drafts: BlockDraft[], target: string) =>
    drafts.findIndex((draft) => draft.target === target);
  return {
    load,
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
export type BlockDraftStore = ReturnType<typeof blockDraftStore>;

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
/** The stored drafts a reload offers: none whose text this tab saw land. */
export function restorable(page: string, drafts: readonly BlockDraft[]): BlockDraft[] {
  const landed = new Set(landedIn(page));
  return drafts.filter((draft) => !landed.has(draft.generation));
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

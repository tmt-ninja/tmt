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

/** Same sealed device store as composers. Its v1 reader rejects a whole page on an unknown edit. */
export function blockDraftStore(space: string, device: string) {
  const scope = (page: string) => ['tmt-colab-block-drafts-v1', space, device, page];
  const name = (page: string) => `block-drafts:${space}:${device}:${page}`;
  const maxBytes = 3 * 1024 * 1024;
  const load = async (page: string): Promise<BlockDraft[]> => {
    const stored = await record<Sealed>(name(page));
    if (stored === undefined) return [];
    return JSON.parse(
      decodeText(await open(await draftKey(device), scope(page), stored, maxBytes)),
    );
  };
  async function change(page: string, edit: BlockDraft, remove: boolean) {
    try {
      return await navigator.locks.request(name(page), async () => {
        const drafts = await load(page);
        const index = drafts.findIndex((draft) => draft.target === edit.target);
        if (remove) {
          if (drafts[index]?.generation !== edit.generation) return true;
          drafts.splice(index, 1);
        } else {
          if ([edit.base, edit.value].some((s) => text(s).length > BLOCK_TEXT_BYTES)) return false;
          drafts.splice(index < 0 ? drafts.length : index, index < 0 ? 0 : 1, edit);
        }
        const bytes = text(JSON.stringify(drafts));
        if (bytes.length > maxBytes || drafts.length > 32) return false;
        await record(name(page), await seal(await draftKey(device), scope(page), bytes));
        return true;
      });
    } catch {
      return false;
    }
  }
  return {
    load,
    save: (page: string, edit: BlockDraft) => change(page, edit, false),
    clear: (page: string, edit: BlockDraft) => change(page, edit, true),
  };
}
export type BlockDraftStore = ReturnType<typeof blockDraftStore>;

export class BlockDraftSession {
  readonly latest = new Map<string, BlockDraft>();
  readonly targets = new Map<string, string>();
  readonly writes = new Map<string, Promise<boolean>>();
  readonly durable = new Set<string>();
  constructor(
    readonly store: BlockDraftStore,
    readonly page: string,
  ) {}
  remember(id: string, cell: TableCell | undefined, base: string, value: string) {
    const address = JSON.stringify([id, cell?.table, cell?.column]);
    const target = this.targets.get(address) ?? crypto.randomUUID();
    this.targets.set(address, target);
    const draft = { id, cell, base, value, target, generation: crypto.randomUUID() };
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
      if (!draft) return true;
      const ok = await this.store.save(this.page, draft).catch(() => false);
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
  async admitted(draft: BlockDraft): Promise<boolean> {
    // A pending save must settle before its generation can be removed.
    await this.writes.get(draft.target);
    if (this.latest.get(draft.target) !== draft) return false;
    if (!(await this.store.clear(this.page, draft))) return false;
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

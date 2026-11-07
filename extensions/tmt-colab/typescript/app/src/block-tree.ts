import { type BlockRecord, CONTAINER_TYPES, PAGE_PARENT, type Parent } from './block-model.js';

/**
 * The blocks of a structured page in drawing order (#6005), from the fold's flat block map. Each
 * block sits under its parent in `pos` order (ties by ID, so two writers' equal keys still order
 * the same everywhere). A deleted block is hidden with everything under it. Two merged moves never
 * lose a block:
 * - a block whose parent is not in the map, or is not a container, is drawn at the top level;
 * - blocks that two moves put inside each other (a cycle) are drawn at the top level from the
 *   cycle's lowest ID, so each is drawn exactly once.
 */
export class BlockTree {
  readonly #blocks: ReadonlyMap<string, BlockRecord>;
  /** Visible children by effective parent (the page is `PAGE_PARENT`), in order. */
  readonly #children = new Map<Parent, BlockRecord[]>();
  /** Each visible block's effective parent. */
  readonly #parent = new Map<string, Parent>();

  constructor(blocks: Iterable<BlockRecord>) {
    this.#blocks = new Map([...blocks].map((block) => [block.id, block]));
    const top = this.#topLevel();
    const effective = (block: BlockRecord): Parent =>
      top.has(block.id) ? PAGE_PARENT : block.parent;
    // Hidden: deleted, or drawn under a hidden block.
    const hidden = new Map<string, boolean>();
    const isHidden = (block: BlockRecord): boolean => {
      const known = hidden.get(block.id);
      if (known !== undefined) return known;
      const parent = effective(block);
      const value =
        block.deleted || (parent !== PAGE_PARENT && isHidden(this.#blocks.get(parent)!));
      hidden.set(block.id, value);
      return value;
    };
    for (const block of this.#blocks.values()) {
      if (isHidden(block)) continue;
      const parent = effective(block);
      this.#parent.set(block.id, parent);
      const list = this.#children.get(parent) ?? [];
      list.push(block);
      this.#children.set(parent, list);
    }
    for (const list of this.#children.values())
      list.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : a.id < b.id ? -1 : 1));
  }

  /** The blocks drawn at the top level whatever their own parent says: a parent that is not in the
   * map or cannot hold blocks, and the lowest ID of each cycle of parents. */
  #topLevel(): Set<string> {
    const top = new Set<string>();
    const holder = (block: BlockRecord): string | undefined => {
      if (block.parent === PAGE_PARENT) return undefined;
      const parent = this.#blocks.get(block.parent);
      return parent && CONTAINER_TYPES.has(parent.type) ? parent.id : undefined;
    };
    const done = new Set<string>();
    for (const start of this.#blocks.keys()) {
      const walk: string[] = [];
      const walking = new Set<string>();
      let at: string | undefined = start;
      while (at !== undefined && !done.has(at)) {
        if (walking.has(at)) {
          const cycle = walk.slice(walk.indexOf(at));
          top.add(cycle.reduce((a, b) => (a < b ? a : b)));
          break;
        }
        walking.add(at);
        walk.push(at);
        const next = holder(this.#blocks.get(at)!);
        if (next === undefined && this.#blocks.get(at)!.parent !== PAGE_PARENT) top.add(at);
        at = next;
      }
      for (const id of walk) done.add(id);
    }
    return top;
  }

  /** A block by ID, drawn or not (a deleted block is still known, so it can be restored). */
  get(id: string): BlockRecord | undefined {
    return this.#blocks.get(id);
  }
  /** Whether the block is drawn. */
  visible(id: string): boolean {
    return this.#parent.has(id);
  }
  /** The drawn children of a block, or of the page, in order. */
  children(parent: Parent = PAGE_PARENT): readonly BlockRecord[] {
    return this.#children.get(parent) ?? [];
  }
  /** Where a drawn block is drawn: its parent, or the page. */
  parentOf(id: string): Parent | undefined {
    return this.#parent.get(id);
  }
  /** A drawn block's index among its drawn siblings. */
  indexOf(id: string): number {
    const parent = this.#parent.get(id);
    if (parent === undefined) return -1;
    return this.children(parent).findIndex((block) => block.id === id);
  }
  /** Whether `id` is `ancestor` or drawn somewhere under it. */
  within(id: string, ancestor: string): boolean {
    for (let at: Parent | undefined = id; at !== undefined && at !== PAGE_PARENT;) {
      if (at === ancestor) return true;
      at = this.#parent.get(at);
    }
    return false;
  }
  /** Every drawn block in reading order (depth first), as selection and keyboard moves walk it. */
  flat(parent: Parent = PAGE_PARENT): BlockRecord[] {
    return this.children(parent).flatMap((block) => [block, ...this.flat(block.id)]);
  }
}

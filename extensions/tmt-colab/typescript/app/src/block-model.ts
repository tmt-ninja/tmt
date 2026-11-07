/**
 * The structured page's block shape as the browser editor sees it (#6005), from the accepted spec
 * (Colab 838644c2, 區塊資料和操作). The names here are provisional until #6004 (the block data model
 * and the agent `tmt colab block` ops) fixes them; every other editor module takes them from this
 * one module, so a rename is one edit.
 */

/** The block types a structured page holds; a type is fixed once a block is made. */
export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list-item',
  'todo',
  'table',
  'card',
  'question',
  'callout',
  'code',
  'image',
  'mockup',
  'work-bundle',
  'page-list',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Types whose blocks hold other blocks (a card or section). */
export const CONTAINER_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['card']);
/** Types with a text body (`text`, a Y.Text in the page document). */
export const TEXT_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'heading',
  'paragraph',
  'list-item',
  'todo',
  'callout',
  'code',
]);

/** The page itself as a parent: a block at the top level. */
export const PAGE_PARENT = null;
export type Parent = string | typeof PAGE_PARENT;

/** One block as the fold gives it: the editor reads only these fields. */
export interface BlockRecord {
  readonly id: string;
  readonly type: BlockType;
  /** The block that holds it, or the page. */
  readonly parent: Parent;
  /** Its fractional order among its siblings (`block-pos.ts`); ties order by `id`. */
  readonly pos: string;
  /** The type's settings; the serve checks them against the type's schema. */
  readonly props: Readonly<Record<string, unknown>>;
  /** The plain text of a text block. */
  readonly text?: string;
  /** Deleted is only a mark: history and comments stay, and `restore` brings it back. */
  readonly deleted: boolean;
}

/** One block operation, as the browser sends it in a batch and as `tmt colab block batch` takes it. */
export type BlockOp =
  | {
      readonly op: 'insert';
      readonly id: string;
      readonly type: BlockType;
      readonly parent: Parent;
      readonly pos: string;
      readonly props?: Readonly<Record<string, unknown>>;
      readonly text?: string;
    }
  | { readonly op: 'move'; readonly id: string; readonly parent: Parent; readonly pos: string }
  | {
      readonly op: 'props';
      readonly id: string;
      readonly set: Readonly<Record<string, unknown>>;
      readonly unset: readonly string[];
    }
  /** The whole text, with the text it was edited from as the merge base. */
  | { readonly op: 'text'; readonly id: string; readonly base: string; readonly text: string }
  | { readonly op: 'delete'; readonly id: string }
  | { readonly op: 'restore'; readonly id: string };

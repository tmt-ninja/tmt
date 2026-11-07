/**
 * The structured page's block shape as the browser editor sees it (#6005), from the accepted spec
 * (Colab 838644c2, 區塊資料和操作), named as #6004's plan names them (issue comment 6705971958: the
 * block data model and the agent `tmt colab block` ops). Every other editor module takes the names
 * from this one module, so a rename is one edit.
 */

import { BLOCK_TYPES, MARKS, ROOT, ROW, type BlockType, type Mark } from './blocks.js';

// The block types, the row type and the page parent are the fold's own (`blocks.ts`, #6004), so
// the editor and the validator never hold two lists.
export { BLOCK_TYPES, type BlockType };
/** A table row: an entry with the table as its parent, drawn by its table and never as a block. */
export const ROW_TYPE: typeof ROW = ROW;
/** What an entry in the page's `blocks` map is: a block, or a table's row. */
export type EntryType = BlockType | typeof ROW_TYPE;
/** Whether an entry is a block, not a table's row. */
export const isBlockType = (type: EntryType): type is BlockType => type !== ROW_TYPE;

/** Types whose blocks hold other blocks (a card or section). */
export const CONTAINER_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(['card']);
/** Whether a block of `parent`'s type may hold one of `child`'s: a card holds blocks, never another
 * card. */
export const canHold = (parent: EntryType, child: EntryType) =>
  parent !== ROW_TYPE &&
  child !== ROW_TYPE &&
  CONTAINER_TYPES.has(parent) &&
  !CONTAINER_TYPES.has(child);
/** Types with a text body (`text`, a Y.Text in the page document). */
export const TEXT_TYPES: ReadonlySet<EntryType> = new Set<EntryType>([
  'heading',
  'paragraph',
  'list',
  'todo',
  'callout',
  'code',
]);

/** The block type each insert-menu entry makes, by the design system's catalog ID (browser-ui
 * `insertGroups`). A question joins once the editor draws it and registers it on insert (#6005,
 * a later step). */
export const INSERT_TYPES: Readonly<Record<string, BlockType>> = {
  text: 'paragraph',
  heading: 'heading',
  table: 'table',
  todo: 'todo',
  code: 'code',
};

/** The page itself as a parent: a block at the top level. */
export const PAGE_PARENT = ROOT;
/** `root`, or the card that holds the block. */
export type Parent = string;

/** One block as the fold gives it: the editor reads only these fields. */
export interface BlockRecord {
  readonly id: string;
  readonly type: EntryType;
  /** The block that holds it, or the page (a row: its table). */
  readonly parent: Parent;
  /** Its fractional order among its siblings (`block-pos.ts`); ties order by `id`. */
  readonly pos: string;
  /** The type's settings; the serve checks them against the type's schema. */
  readonly props: Readonly<Record<string, unknown>>;
  /** The plain text of a text block. */
  readonly text?: string;
  /** The text's inline marks, on scalar offsets, as the fold projects them. */
  readonly marks?: readonly Mark[];
  /** Deleted is only a mark: history and comments stay, and `restore` brings it back. */
  readonly deleted: boolean;
  /** A table row's cells by column ID, as plain text. */
  readonly cells?: Readonly<Record<string, string>>;
}

/** A table's columns from its props (`columns: [{id, name}]`, #6004's table schema). */
export function tableColumns(
  props: Readonly<Record<string, unknown>>,
): { id: string; name: string }[] {
  const columns = props.columns;
  if (!Array.isArray(columns)) return [];
  return columns.flatMap((column: unknown) => {
    const value = column as { id?: unknown; name?: unknown } | null;
    return value && typeof value.id === 'string' && typeof value.name === 'string'
      ? [{ id: value.id, name: value.name }]
      : [];
  });
}

/** The marks a block's text may carry. */
/** The marks a block's text may carry: the fold's own list (`blocks.ts`). */
export const TEXT_MARKS = MARKS;
export type TextMark = (typeof MARKS)[number];

/** A table's row and column actions. The action names are #6004's (plan (a)); the field names are
 * provisional until its table schema is posted. Rows and columns keep stable IDs. */
export type TableAction =
  | { readonly action: 'add-row'; readonly row: string; readonly after: string | null }
  | { readonly action: 'remove-row'; readonly row: string }
  | {
      readonly action: 'set-cell';
      readonly row: string;
      readonly column: string;
      readonly text: string;
    }
  | {
      readonly action: 'add-column';
      readonly column: string;
      readonly name: string;
      readonly after: string | null;
    }
  | { readonly action: 'rename-column'; readonly column: string; readonly name: string }
  | { readonly action: 'move-column'; readonly column: string; readonly after: string | null }
  | { readonly action: 'remove-column'; readonly column: string };

/** The serve's refusal of an `after` that does not name a child of `parent`. */
export const BAD_AFTER = 'COLAB_BLOCK_BAD_AFTER';

/** One block operation, as the browser sends it in a `blocks.batch` and as `tmt colab block batch`
 * takes it. The caller makes new IDs; the serve computes `pos` from `after` (`null` is first in
 * `parent`). */
export type BlockOp =
  | {
      readonly op: 'insert';
      readonly id: string;
      readonly type: BlockType;
      readonly parent: Parent;
      readonly after: string | null;
      readonly props?: Readonly<Record<string, unknown>>;
      readonly text?: string;
    }
  /** Moves the block with everything under it; the last move wins. */
  | {
      readonly op: 'move';
      readonly id: string;
      readonly parent: Parent;
      readonly after: string | null;
    }
  | {
      readonly op: 'props';
      readonly id: string;
      readonly set: Readonly<Record<string, unknown>>;
      readonly unset: readonly string[];
    }
  /** The whole text, with the text it was edited from as the merge base (`textMerge.merge`).
   * `overlap: 'both'` keeps the page's text and then this text where they overlap; the default,
   * `remote`, keeps only the page's (#6004, lead decision 11-07). The browser always sends `both`, so
   * a person's keystrokes are never dropped. */
  | {
      readonly op: 'text';
      readonly id: string;
      readonly set: string;
      readonly base: string;
      readonly overlap?: 'both' | 'remote';
    }
  /** One exact passage replaced; refused when it is not there once. */
  | {
      readonly op: 'text';
      readonly id: string;
      readonly replace: { readonly find: string; readonly with: string };
    }
  /** A mark set on scalar offsets `from..to` (`value` false or null removes it). */
  | {
      readonly op: 'text';
      readonly id: string;
      readonly format: {
        readonly from: number;
        readonly to: number;
        readonly mark: TextMark;
        readonly value: unknown;
      };
    }
  | ({ readonly op: 'table'; readonly id: string } & TableAction)
  | { readonly op: 'delete'; readonly id: string }
  | { readonly op: 'restore'; readonly id: string };

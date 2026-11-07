import { BLOCK_TYPES, type BlockRecord, type EntryType, ROW_TYPE } from './block-model.js';
import { BlockTree } from './block-tree.js';

/**
 * The editor's blocks from a structured page's fold projection (#6005): the `blocks` root the fold
 * projects (`projectBlocks`), a map from block ID to `{type, parent, pos, props, text?, cells?,
 * deleted?}`, where `text` and each cell are rich text (`{s, marks}`) and `deleted` is the time of
 * the delete.
 * The fold has already checked every entry against the shared validator; this keeps only what the
 * editor reads and refuses, by entry, anything it cannot draw, so a newer type never reaches the
 * tree half-read. A block under an entry it cannot read is drawn at the top level, never lost.
 */
export function blockRecords(blocks: Readonly<Record<string, unknown>>): {
  records: BlockRecord[];
  /** IDs of entries this editor cannot read (a newer type, say); the page names them. */
  unreadable: string[];
} {
  const records: BlockRecord[] = [];
  const unreadable: string[] = [];
  const types = new Set<string>([...BLOCK_TYPES, ROW_TYPE]);
  for (const [id, value] of Object.entries(blocks)) {
    const entry = value as Record<string, unknown> | null;
    const ok =
      entry !== null &&
      typeof entry === 'object' &&
      typeof entry.type === 'string' &&
      types.has(entry.type) &&
      typeof entry.parent === 'string' &&
      typeof entry.pos === 'string' &&
      entry.props !== null &&
      typeof entry.props === 'object' &&
      !Array.isArray(entry.props) &&
      (entry.text === undefined || plainOf(entry.text) !== undefined) &&
      (entry.deleted === undefined || typeof entry.deleted === 'number') &&
      (entry.cells === undefined || cellsOf(entry.cells) !== undefined);
    if (!ok) {
      unreadable.push(id);
      continue;
    }
    records.push({
      id,
      type: entry.type as EntryType,
      parent: entry.parent as string,
      pos: entry.pos as string,
      props: entry.props as Record<string, unknown>,
      ...(entry.text !== undefined && { text: plainOf(entry.text)! }),
      deleted: entry.deleted !== undefined,
      ...(entry.cells !== undefined && { cells: cellsOf(entry.cells)! }),
    });
  }
  return { records, unreadable };
}

/** A rich text's characters (`s`); its marks are drawn by a later step. */
const plainOf = (value: unknown): string | undefined =>
  value !== null && typeof value === 'object' && typeof (value as { s?: unknown }).s === 'string'
    ? (value as { s: string }).s
    : undefined;
const cellsOf = (value: unknown): Record<string, string> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const cells: Record<string, string> = {};
  for (const [column, cell] of Object.entries(value)) {
    const text = plainOf(cell);
    if (text === undefined) return undefined;
    cells[column] = text;
  }
  return cells;
};

/** The tree the editor draws from a fold projection's `blocks` root. */
export function blockTree(blocks: Readonly<Record<string, unknown>>): {
  tree: BlockTree;
  unreadable: string[];
} {
  const { records, unreadable } = blockRecords(blocks);
  return { tree: new BlockTree(records), unreadable };
}

import { BLOCK_TYPES, type BlockRecord, type EntryType, ROW_TYPE } from './block-model.js';
import type { BlockEntry } from './blocks.js';
import { BlockTree } from './block-tree.js';

const READABLE = new Set<string>([...BLOCK_TYPES, ROW_TYPE]);

/**
 * The editor's blocks from a structured page's fold projection (#6005): the `blocks` root the fold
 * projects and `validateBlocks` has checked, typed by the fold's own `BlockEntry`, so a schema
 * change breaks the build here rather than every block at run time. Rich text is read as its
 * characters and its marks (a cell as its characters), and `deleted`, the time of the delete, as a
 * mark.
 * An entry of a type this editor does not draw (a newer one) is named, never half-read; a block
 * under it is drawn at the top level, never lost.
 */
export function blockRecords(blocks: Readonly<Record<string, BlockEntry>>): {
  records: BlockRecord[];
  /** IDs of entries this editor cannot read (a newer type, say); the page names them. */
  unreadable: string[];
} {
  const records: BlockRecord[] = [];
  const unreadable: string[] = [];
  for (const [id, entry] of Object.entries(blocks)) {
    if (!READABLE.has(entry.type)) {
      unreadable.push(id);
      continue;
    }
    records.push({
      id,
      type: entry.type as EntryType,
      parent: entry.parent,
      pos: entry.pos,
      props: entry.props,
      ...(entry.text !== undefined && { text: entry.text.s }),
      ...(entry.text?.marks.length && { marks: entry.text.marks }),
      deleted: entry.deleted !== undefined,
      ...(entry.cells !== undefined && {
        cells: Object.fromEntries(
          Object.entries(entry.cells).map(([column, cell]) => [column, cell.s]),
        ),
      }),
    });
  }
  return { records, unreadable };
}

/** The tree the editor draws from a fold projection's `blocks` root. */
export function blockTree(blocks: Readonly<Record<string, BlockEntry>>): {
  tree: BlockTree;
  unreadable: string[];
} {
  const { records, unreadable } = blockRecords(blocks);
  return { tree: new BlockTree(records), unreadable };
}

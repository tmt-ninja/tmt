import { textMerge } from '@tmt/colab-client';
import { type BlockOp, type BlockRecord, ROW_TYPE, tableColumns } from './block-model.js';
import { formatMarks, marksThrough } from './block-marks.js';
import { posBetween } from './block-pos.js';
import { BlockTree } from './block-tree.js';

/** `entry` with `marks`, which a record leaves out when there are none (as the reader does). */
function marked({ marks: _was, ...entry }: BlockRecord, marks: BlockRecord['marks']): BlockRecord {
  return marks?.length ? { ...entry, marks } : entry;
}

/**
 * `ops` applied to `blocks` as the serve applies a batch (#6005): a new or moved block lands after
 * `after` (first with `null`), a whole-text op merges from its base with `textMerge` (marks kept
 * on the characters it keeps), a format op marks its range, a delete
 * is only a mark, and a table op edits its rows, cells or columns. The editor draws the page with this tab's batches on their way applied, so a
 * gesture shows at once. A batch the serve would refuse (an op on a block it does not hold, an
 * `after` that is not a child of the parent) throws, and the caller draws without it.
 */
export function applyOps(blocks: readonly BlockRecord[], ops: readonly BlockOp[]): BlockRecord[] {
  const map = new Map(blocks.map((entry) => [entry.id, entry]));
  const posAfter = (parent: string, after: string | null, moving: string) => {
    const siblings = new BlockTree(map.values()).children(parent).filter((b) => b.id !== moving);
    const at = after === null ? 0 : siblings.findIndex((b) => b.id === after) + 1;
    if (after !== null && at === 0) throw new Error(`${after} is not in ${parent}`);
    return posBetween(siblings[at - 1]?.pos, siblings[at]?.pos);
  };
  const held = (id: string) => {
    const current = map.get(id);
    if (!current) throw new Error(`${id} is not on the page`);
    return current;
  };
  for (const op of ops) {
    switch (op.op) {
      case 'insert':
        if (map.has(op.id)) throw new Error(`${op.id} is already on the page`);
        map.set(op.id, {
          id: op.id,
          type: op.type,
          parent: op.parent,
          pos: posAfter(op.parent, op.after, op.id),
          props: op.props ?? {},
          ...(op.text !== undefined && { text: op.text }),
          deleted: false,
        });
        break;
      case 'move':
        map.set(op.id, {
          ...held(op.id),
          parent: op.parent,
          pos: posAfter(op.parent, op.after, op.id),
        });
        break;
      case 'props': {
        const current = held(op.id);
        const props = { ...current.props, ...op.set };
        for (const key of op.unset) delete props[key];
        map.set(op.id, { ...current, props });
        break;
      }
      case 'text': {
        const current = held(op.id);
        const was = current.text ?? '';
        if ('format' in op) {
          map.set(op.id, marked(current, formatMarks(was, current.marks, op.format)));
          break;
        }
        if (!('set' in op)) throw new Error('Only whole-text and format edits are applied here.');
        const text = textMerge.merge(op.base, was, op.set, op.overlap).text;
        map.set(op.id, marked({ ...current, text }, marksThrough(was, text, current.marks)));
        break;
      }
      case 'delete':
      case 'restore':
        map.set(op.id, { ...held(op.id), deleted: op.op === 'delete' });
        break;
      case 'table':
        tableOp(map, held, op);
        break;
    }
  }
  return [...map.values()];
}

/** A row op on `map`: a row lands after `after` among the table's rows (last when left out), and a
 * cell merges from its base as text does. */
function tableOp(
  map: Map<string, BlockRecord>,
  held: (id: string) => BlockRecord,
  op: Extract<BlockOp, { op: 'table' }>,
) {
  const table = held(op.id);
  if (table.type !== 'table') throw new Error(`${op.id} is not a table`);
  const row = (id: string) => {
    const current = held(id);
    if (current.type !== ROW_TYPE || current.parent !== op.id)
      throw new Error(`${id} is not a row of ${op.id}`);
    return current;
  };
  const columns = tableColumns(table.props);
  const column = (id: string) => {
    if (!columns.some((c) => c.id === id)) throw new Error(`${id} is not a column of ${op.id}`);
  };
  switch (op.action) {
    case 'add-row': {
      if (map.has(op.row)) throw new Error(`${op.row} is already on the page`);
      const rows = new BlockTree(map.values()).rows(op.id);
      const at =
        op.after === undefined
          ? rows.length
          : op.after === null
            ? 0
            : rows.findIndex((r) => r.id === op.after) + 1;
      if (op.after && at === 0) throw new Error(`${op.after} is not a row of ${op.id}`);
      const cells = { ...op.cells };
      for (const id of Object.keys(cells)) column(id);
      map.set(op.row, {
        id: op.row,
        type: ROW_TYPE,
        parent: op.id,
        pos: posBetween(rows[at - 1]?.pos, rows[at]?.pos),
        props: {},
        cells,
        deleted: false,
      });
      break;
    }
    case 'remove-row':
      map.set(op.row, { ...row(op.row), deleted: true });
      break;
    case 'set-cell': {
      const current = row(op.row);
      column(op.column);
      const was = current.cells?.[op.column] ?? '';
      const text = textMerge.merge(op.base ?? was, was, op.text, op.overlap).text;
      map.set(op.row, { ...current, cells: { ...current.cells, [op.column]: text } });
      break;
    }
    default:
      // This tab never sends column edits; they come from agents and arrive on the page.
      throw new Error('Column edits are applied by the serve.');
  }
}

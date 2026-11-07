import { textMerge } from '@tmt/colab-client';
import type { BlockOp, BlockRecord } from './block-model.js';
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
 * on the characters it keeps), a format op marks its range, and a delete
 * is only a mark. The editor draws the page with this tab's batches on their way applied, so a
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
        throw new Error('Table edits are applied by their table.');
    }
  }
  return [...map.values()];
}

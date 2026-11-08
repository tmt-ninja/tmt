import { describe, expect, it } from 'vite-plus/test';
import { applyOps } from '../src/block-apply.js';
import {
  type BlockOp,
  type BlockRecord,
  PAGE_PARENT,
  type Parent,
  ROW_TYPE,
} from '../src/block-model.js';
import {
  addRow,
  deleteBlocks,
  duplicateBlock,
  insertBlock,
  indentBlock,
  inverseOps,
  joinBlock,
  listNumber,
  moveBlock,
  nudgeBlock,
  splitBlock,
} from '../src/block-ops.js';
import { dropTarget } from '../src/block-drop.js';
import { BlockHistory, UNDO_DEPTH } from '../src/block-history.js';
import { filterInsert, insertType, opensInsert } from '../src/block-insert.js';
import { blockTree } from '../src/block-projection.js';
import { posBetween, posRun, validPos } from '../src/block-pos.js';
import {
  extendSelection,
  extendTo,
  selectBlock,
  selectedIds,
  settleSelection,
} from '../src/block-selection.js';
import { BlockTree } from '../src/block-tree.js';

const block = (
  id: string,
  pos: string,
  parent: Parent = PAGE_PARENT,
  extra: Partial<BlockRecord> = {},
): BlockRecord => ({
  id,
  type: 'paragraph',
  parent,
  pos,
  props: {},
  text: id,
  deleted: false,
  ...extra,
});
const card = (id: string, pos: string, parent: Parent = PAGE_PARENT) =>
  block(id, pos, parent, { type: 'card', text: undefined });
const ids = (list: readonly BlockRecord[]) => list.map((entry) => entry.id);

/** Apply ops the way the serve does to the flat block map, for round-trip checks: `after` becomes a
 * `pos` between that sibling and the next. */
const apply = applyOps;
/** The ops, then their inverse, leave every block as it was; a block the ops made is left only as a
 * deleted mark, as the data model keeps it. */
function roundTrip(blocks: BlockRecord[], ops: BlockOp[]) {
  const before = new BlockTree(blocks);
  const back = apply(apply(blocks, ops), inverseOps(before, ops));
  const byId = new Map(back.map((entry) => [entry.id, entry]));
  // A moved block is back in its place, with a new pos there.
  const placeless = ({ pos: _pos, ...rest }: BlockRecord) => rest;
  for (const original of blocks)
    expect(placeless(byId.get(original.id)!)).toEqual(placeless(original));
  for (const entry of back)
    if (!blocks.some((original) => original.id === entry.id)) expect(entry.deleted).toBe(true);
  expect(ids(new BlockTree(back).flat())).toEqual(ids(before.flat()));
}

describe('block positions', () => {
  it('makes a key between any two, at either open end, and keeps order', () => {
    const first = posBetween();
    expect(validPos(first)).toBe(true);
    const keys = [first];
    // Repeatedly between the first two, and at both ends: always strictly in order and valid.
    for (let index = 0; index < 200; index++) {
      const where = index % 3;
      const next =
        where === 0
          ? posBetween(keys[0], keys[1])
          : where === 1
            ? posBetween(undefined, keys[0])
            : posBetween(keys.at(-1));
      expect(validPos(next), next).toBe(true);
      keys.push(next);
      keys.sort();
    }
    expect(new Set(keys).size).toBe(keys.length);
    for (const [index, key] of keys.entries())
      if (index > 0) expect(key > keys[index - 1]!).toBe(true);
  });
  it('fits between keys that differ only past a shared prefix', () => {
    for (const [before, after] of [
      ['1', '2'],
      ['A', 'A1'],
      ['A0V', 'A1'],
      [undefined, '1'],
      ['zzz', undefined],
    ] as const) {
      const key = posBetween(before, after);
      if (before !== undefined) expect(key > before, `${before} < ${key}`).toBe(true);
      if (after !== undefined) expect(key < after, `${key} < ${after}`).toBe(true);
      expect(validPos(key)).toBe(true);
    }
  });
  it('refuses bounds out of order and keys it never makes', () => {
    expect(() => posBetween('B', 'A')).toThrow('out of order');
    expect(() => posBetween('A', 'A')).toThrow('out of order');
    expect(() => posBetween('A0')).toThrow('Not a block position');
    expect(() => posBetween('a-b')).toThrow('Not a block position');
  });
  it('makes a run of ordered keys for a batch', () => {
    const run = posRun(5, 'A', 'B');
    expect(run).toHaveLength(5);
    expect([...run].sort()).toEqual(run);
    expect(run.every((key) => key > 'A' && key < 'B')).toBe(true);
  });
});

describe('the block tree', () => {
  it('orders siblings by pos, then by ID for equal keys from two writers', () => {
    const tree = new BlockTree([block('c', 'V'), block('a', 'k'), block('b', 'V')]);
    expect(ids(tree.children())).toEqual(['b', 'c', 'a']);
  });
  it('hides a deleted block and everything under it, and still knows it for restore', () => {
    const tree = new BlockTree([
      card('box', 'V'),
      block('inside', 'V', 'box'),
      block('after', 'k'),
      { ...card('gone', 'Z'), deleted: true },
      block('under-gone', 'V', 'gone'),
    ]);
    expect(ids(tree.flat())).toEqual(['box', 'inside', 'after']);
    expect(tree.visible('under-gone')).toBe(false);
    expect(tree.get('gone')?.deleted).toBe(true);
  });
  it('keeps table rows out of the drawn blocks and gives each table its rows in order', () => {
    const row = (id: string, pos: string, table: string, deleted = false) =>
      block(id, pos, table, { type: 'row', text: undefined, deleted });
    const tree = new BlockTree([
      block('table', 'V', PAGE_PARENT, { type: 'table', text: undefined }),
      row('r2', 'k', 'table'),
      row('r1', 'F', 'table'),
      row('gone', 'Z', 'table', true),
      block('para', 'k'),
      // A row whose table is missing, or is not a table, is not drawn at all.
      row('stray', 'V', 'nowhere'),
      row('odd', 'V', 'para'),
    ]);
    expect(ids(tree.flat())).toEqual(['table', 'para']);
    expect(ids(tree.rows('table'))).toEqual(['r1', 'r2']);
    expect(tree.visible('r1')).toBe(false);
    // A deleted table takes its rows with it.
    const deleted = new BlockTree([
      block('table', 'V', PAGE_PARENT, { type: 'table', text: undefined, deleted: true }),
      row('r1', 'F', 'table'),
    ]);
    expect(deleted.rows('table')).toEqual([]);
  });
  it('draws a block whose parent is missing or cannot hold blocks at the top level', () => {
    const tree = new BlockTree([
      block('para', 'V'),
      block('lost', 'k', 'nowhere'),
      block('under-para', 'Z', 'para'),
    ]);
    expect(ids(tree.children())).toEqual(['para', 'under-para', 'lost']);
    expect(tree.parentOf('lost')).toBe(PAGE_PARENT);
  });
  it('draws cards that two merged moves put inside each other at the top level, each once', () => {
    // Two writers moved card b into card a and a into b at once: neither card can hold the other.
    const tree = new BlockTree([card('a', 'V', 'b'), card('b', 'k', 'a'), block('x', 'k', 'b')]);
    expect(ids(tree.flat())).toEqual(['a', 'b', 'x']);
    expect(tree.parentOf('a')).toBe(PAGE_PARENT);
    expect(tree.parentOf('b')).toBe(PAGE_PARENT);
    // A block that is its own parent.
    expect(ids(new BlockTree([card('self', 'V', 'self')]).flat())).toEqual(['self']);
  });
});

describe('gestures to ops, and undo', () => {
  const page = () => [
    block('one', 'F'),
    card('box', 'V'),
    block('in-a', 'V', 'box'),
    block('in-b', 'k', 'box'),
    block('two', 'k'),
  ];
  it('duplicates a block right after it, and a card with copies of its blocks', () => {
    let next = 0;
    const id = () => `copy-${++next}`;
    const tree = new BlockTree(page());
    const card = duplicateBlock(tree, 'box', id);
    expect(card.map((op) => op.op === 'insert' && [op.id, op.parent, op.after])).toEqual([
      ['copy-1', PAGE_PARENT, 'box'],
      ['copy-2', 'copy-1', null],
      ['copy-3', 'copy-1', 'copy-2'],
    ]);
    const after = new BlockTree(apply(page(), card));
    expect(ids(after.children())).toEqual(['one', 'box', 'copy-1', 'two']);
    expect(ids(after.children('copy-1'))).toEqual(['copy-2', 'copy-3']);
    roundTrip(page(), card);
  });
  it('inserts after a block, first in a card, and refuses a parent that cannot hold blocks', () => {
    const tree = new BlockTree(page());
    const after = insertBlock(tree, { id: 'new', type: 'paragraph', after: 'one' });
    expect(after).toMatchObject({ op: 'insert', parent: PAGE_PARENT });
    expect(ids(new BlockTree(apply(page(), [after])).children())).toEqual([
      'one',
      'new',
      'box',
      'two',
    ]);
    const first = insertBlock(tree, { id: 'top', type: 'todo', parent: 'box' });
    expect(ids(new BlockTree(apply(page(), [first])).children('box'))).toEqual([
      'top',
      'in-a',
      'in-b',
    ]);
    expect(() => insertBlock(tree, { id: 'x', type: 'paragraph', parent: 'one' })).toThrow(
      'cannot hold',
    );
    roundTrip(page(), [after]);
  });
  it('moves by drop: into a card, out of it, a drop in place is nothing, never into itself', () => {
    const tree = new BlockTree(page());
    const into = moveBlock(tree, 'two', 'box', 1);
    expect(ids(new BlockTree(apply(page(), into)).children('box'))).toEqual([
      'in-a',
      'two',
      'in-b',
    ]);
    roundTrip(page(), into);
    const out = moveBlock(tree, 'in-b', PAGE_PARENT, 0);
    expect(ids(new BlockTree(apply(page(), out)).children())).toEqual([
      'in-b',
      'one',
      'box',
      'two',
    ]);
    roundTrip(page(), out);
    expect(moveBlock(tree, 'one', PAGE_PARENT, 0)).toEqual([]);
    expect(moveBlock(tree, 'one', PAGE_PARENT, 1)).toEqual([]);
    // A block never goes inside itself, and a card never inside a card.
    expect(() => moveBlock(tree, 'box', 'box', 0)).toThrow('inside itself');
    const pair = new BlockTree([...page(), card('other', 'z')]);
    expect(() => moveBlock(pair, 'other', 'box', 0)).toThrow('card cannot hold a card');
    expect(() => insertBlock(tree, { id: 'c', type: 'card', parent: 'box' })).toThrow(
      'card cannot hold a card',
    );
    expect(() => moveBlock(tree, 'one', 'two', 0)).toThrow('cannot hold');
  });
  it('nudges within siblings, leaves a card at its edge, and stays at the page edge', () => {
    const tree = new BlockTree(page());
    const order = (ops: BlockOp[], parent: Parent = PAGE_PARENT) =>
      ids(new BlockTree(apply(page(), ops)).children(parent));
    expect(order(nudgeBlock(tree, 'two', 'up'))).toEqual(['one', 'two', 'box']);
    expect(order(nudgeBlock(tree, 'one', 'down'))).toEqual(['box', 'one', 'two']);
    expect(order(nudgeBlock(tree, 'in-a', 'up'))).toEqual(['one', 'in-a', 'box', 'two']);
    expect(order(nudgeBlock(tree, 'in-b', 'down'))).toEqual(['one', 'box', 'in-b', 'two']);
    expect(nudgeBlock(tree, 'one', 'up')).toEqual([]);
    expect(nudgeBlock(tree, 'two', 'down')).toEqual([]);
    roundTrip(page(), nudgeBlock(tree, 'in-a', 'up'));
  });
  it('deletes each selected block once, in reading order, and undo restores them', () => {
    const tree = new BlockTree(page());
    const ops = deleteBlocks(tree, ['two', 'in-a', 'box', 'two']);
    expect(ops).toEqual([
      { op: 'delete', id: 'box' },
      { op: 'delete', id: 'two' },
    ]);
    expect(ids(new BlockTree(apply(page(), ops)).flat())).toEqual(['one']);
    roundTrip(page(), ops);
  });
  it('splits at the caret and joins back into the text block before it', () => {
    const blocks = [block('one', 'F', PAGE_PARENT, { text: 'Hello world' }), block('two', 'V')];
    const tree = new BlockTree(blocks);
    const split = splitBlock(tree, 'one', 5, 'tail');
    expect(split).toEqual([
      { op: 'text', id: 'one', set: 'Hello', base: 'Hello world', overlap: 'both' },
      expect.objectContaining({ op: 'insert', id: 'tail', type: 'paragraph', text: ' world' }),
    ]);
    // The focused block's typing not sent yet goes in the same batch, from its base; offsets
    // count scalar values.
    expect(splitBlock(tree, 'one', 2, 'cut', { text: '😀a b', base: 'Hello world' })).toEqual([
      { op: 'text', id: 'one', set: '😀a', base: 'Hello world', overlap: 'both' },
      expect.objectContaining({ op: 'insert', id: 'cut', text: ' b' }),
    ]);
    const after = apply(blocks, split);
    expect(ids(new BlockTree(after).children())).toEqual(['one', 'tail', 'two']);
    roundTrip(blocks, split);
    // Backspace at the start of the new block puts it back.
    const join = joinBlock(new BlockTree(after), 'tail');
    expect(new BlockTree(apply(after, join)).get('one')?.text).toBe('Hello world');
    expect(new BlockTree(apply(after, join)).visible('tail')).toBe(false);
    // At the end of a block, Enter makes an empty block and changes no text.
    expect(splitBlock(tree, 'one', 11, 'empty')).toEqual([
      expect.objectContaining({ op: 'insert', id: 'empty', text: '' }),
    ]);
    // The joined block's unsent typing is what moves.
    expect(joinBlock(new BlockTree(after), 'tail', ' there')[0]).toEqual({
      op: 'text',
      id: 'one',
      set: 'Hello there',
      base: 'Hello',
      overlap: 'both',
    });
    // Nothing text-like before it: no join.
    expect(joinBlock(new BlockTree(page()), 'in-a')).toEqual([]);
  });
  it('undoes a props change key by key, unsetting keys that were not there', () => {
    const blocks = [block('todo', 'V', PAGE_PARENT, { type: 'todo', props: { done: false } })];
    const ops: BlockOp[] = [
      { op: 'props', id: 'todo', set: { done: true, due: '11-08' }, unset: [] },
    ];
    expect(inverseOps(new BlockTree(blocks), ops)).toEqual([
      { op: 'props', id: 'todo', set: { done: false }, unset: ['due'] },
    ]);
    roundTrip(blocks, ops);
  });
});

describe('undo history', () => {
  it('undoes and redoes gestures in order, and a new gesture clears redo', () => {
    const blocks = [block('one', 'F'), block('two', 'V')];
    const history = new BlockHistory();
    const tree = new BlockTree(blocks);
    const moved = moveBlock(tree, 'two', PAGE_PARENT, 0);
    history.record(tree, moved);
    const after = apply(blocks, moved);
    const removed = deleteBlocks(new BlockTree(after), ['one']);
    history.record(new BlockTree(after), removed);
    expect(history.undo()).toEqual([{ op: 'restore', id: 'one' }]);
    expect(history.undo()).toEqual([{ op: 'move', id: 'two', parent: PAGE_PARENT, after: 'one' }]);
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toEqual(moved);
    expect(history.canRedo()).toBe(true);
    history.record(tree, [{ op: 'delete', id: 'two' }]);
    expect(history.canRedo()).toBe(false);
    // A gesture that changed nothing is not an undo step.
    history.record(tree, []);
    expect(history.undo()).toEqual([{ op: 'restore', id: 'two' }]);
  });
  it('keeps at most UNDO_DEPTH gestures', () => {
    const tree = new BlockTree([block('one', 'F')]);
    const history = new BlockHistory();
    for (let index = 0; index < UNDO_DEPTH + 5; index++)
      history.record(tree, [
        { op: 'text', id: 'one', set: String(index + 1), base: String(index) },
      ]);
    let count = 0;
    while (history.undo()) count++;
    expect(count).toBe(UNDO_DEPTH);
  });
});

describe('block selection', () => {
  const tree = new BlockTree([
    block('one', 'F'),
    card('box', 'V'),
    block('in-a', 'V', 'box'),
    block('two', 'k'),
  ]);
  it('Esc selects one block; Shift+arrows extend in reading order and stop at the ends', () => {
    let selection = selectBlock('box');
    expect(selectedIds(tree, selection)).toEqual(['box']);
    selection = extendSelection(tree, selection, 'down');
    expect(selectedIds(tree, selection)).toEqual(['box', 'in-a']);
    selection = extendSelection(tree, extendSelection(tree, selection, 'down'), 'down');
    expect(selectedIds(tree, selection)).toEqual(['box', 'in-a', 'two']);
    selection = extendTo(selection, 'one');
    expect(selectedIds(tree, selection)).toEqual(['one', 'box']);
    expect(selectedIds(tree, extendSelection(tree, selection, 'up'))).toEqual(['one', 'box']);
  });
  it('a selection follows the page: an end another writer deleted leaves it', () => {
    const selection = extendTo(selectBlock('one'), 'two');
    const changed = new BlockTree([
      block('one', 'F'),
      card('box', 'V'),
      block('in-a', 'V', 'box'),
      { ...block('two', 'k'), deleted: true },
    ]);
    expect(settleSelection(changed, selection)).toEqual(selectBlock('one'));
    expect(settleSelection(new BlockTree([]), selection)).toBeUndefined();
    expect(settleSelection(tree, selection)).toBe(selection);
    // Deleting the selection deletes the card with what is in it, once.
    expect(deleteBlocks(tree, selectedIds(tree, extendTo(selectBlock('box'), 'in-a')))).toEqual([
      { op: 'delete', id: 'box' },
    ]);
  });
});

describe('the insert menu', () => {
  // The design system's catalog rows (browser-ui insertGroups), as the menu passes them.
  const catalog = [
    { id: 'text', label: 'Paragraph', shortcut: '/text' },
    { id: 'heading', label: 'Heading', shortcut: '##' },
    { id: 'table', label: 'Table', shortcut: '/table' },
    { id: 'todo', label: 'To-do', shortcut: '[]' },
    { id: 'question', label: 'Question', shortcut: '/q' },
    { id: 'code', label: 'Code', shortcut: '```' },
    { id: 'someday', label: 'Something new', shortcut: '/new' },
  ];
  const shown = (query: string) => filterInsert(catalog, query).map((entry) => entry.id);
  it('filters as the person types, label starts first, and leaves out what it cannot make', () => {
    expect(shown('')).toEqual(['text', 'heading', 'table', 'todo', 'code']);
    expect(shown('/ta')).toEqual(['table']);
    expect(shown('do')).toEqual(['todo']);
    expect(shown('q')).toEqual([]);
    expect(shown('text')).toEqual(['text']);
    expect(shown('PARA')).toEqual(['text']);
    expect(shown('new')).toEqual([]);
    expect(shown('zz')).toEqual([]);
  });
  it('maps each entry to the block it makes, and opens on / in an empty paragraph only', () => {
    expect(insertType('text')).toBe('paragraph');
    expect(() => insertType('someday')).toThrow('cannot make');
    expect(opensInsert('/', { type: 'paragraph', text: '' })).toBe(true);
    expect(opensInsert('/', { type: 'paragraph', text: 'a' })).toBe(false);
    expect(opensInsert('/', { type: 'heading', text: '' })).toBe(false);
    expect(opensInsert('a', { type: 'paragraph', text: '' })).toBe(false);
  });
});

describe('the drop target', () => {
  // one 0-40, box 40-240 (in-a 60-100, in-b 100-140), two 240-280.
  const tree = new BlockTree([
    block('one', 'F'),
    card('box', 'V'),
    block('in-a', 'V', 'box'),
    block('in-b', 'k', 'box'),
    block('two', 'k'),
  ]);
  const boxes = [
    { id: 'one', top: 0, bottom: 40 },
    { id: 'box', top: 40, bottom: 240 },
    { id: 'in-a', top: 60, bottom: 100 },
    { id: 'in-b', top: 100, bottom: 140 },
    { id: 'two', top: 240, bottom: 280 },
  ];
  it('drops before or after a block by its half, and past the last at the end', () => {
    expect(dropTarget(tree, boxes, 5, 'two')).toEqual({
      parent: PAGE_PARENT,
      index: 0,
      lineBefore: 'one',
    });
    expect(dropTarget(tree, boxes, 30, 'two')).toEqual({
      parent: PAGE_PARENT,
      index: 1,
      lineBefore: 'box',
    });
    expect(dropTarget(tree, boxes, 500, 'one')).toEqual({ parent: PAGE_PARENT, index: 3 });
  });
  it('drops into a card over its middle, beside it near its edges', () => {
    expect(dropTarget(tree, boxes, 70, 'two')).toEqual({
      parent: 'box',
      index: 0,
      lineBefore: 'in-a',
      into: 'box',
    });
    expect(dropTarget(tree, boxes, 180, 'two')).toEqual({ parent: 'box', index: 2, into: 'box' });
    expect(dropTarget(tree, boxes, 45, 'two')).toEqual({
      parent: PAGE_PARENT,
      index: 1,
      lineBefore: 'box',
    });
    expect(dropTarget(tree, boxes, 235, 'two')).toEqual({
      parent: PAGE_PARENT,
      index: 2,
      lineBefore: 'two',
    });
    // The drop moves the block where the line showed.
    const drop = dropTarget(tree, boxes, 70, 'two');
    expect(
      ids(
        new BlockTree(apply(tree.flat(), moveBlock(tree, 'two', drop.parent, drop.index))).children(
          'box',
        ),
      ),
    ).toEqual(['two', 'in-a', 'in-b']);
  });
  it('a card never takes itself, and a dragged card never drops into a card', () => {
    const withCard = new BlockTree([...tree.flat(), card('other', 'z')]);
    const more = [...boxes, { id: 'other', top: 280, bottom: 320 }];
    expect(dropTarget(withCard, more, 180, 'other')).toEqual({
      parent: PAGE_PARENT,
      index: 2,
      lineBefore: 'two',
    });
    expect(dropTarget(tree, boxes, 140, 'box')).toEqual({
      parent: PAGE_PARENT,
      index: 2,
      lineBefore: 'two',
    });
  });
});

describe('the tree from a fold projection', () => {
  it('reads the blocks root: parent and pos order, tombstones hidden, rows with their table', () => {
    // The shape the fold projects: rich text as `{s, marks}`, `deleted` as the time of the delete.
    const rich = (s: string) => ({ s, marks: [] });
    const { tree, unreadable } = blockTree({
      b: { type: 'paragraph', parent: 'root', pos: 'k', props: {}, text: rich('second') },
      a: { type: 'heading', parent: 'root', pos: 'F', props: { level: 2 }, text: rich('first') },
      gone: {
        type: 'paragraph',
        parent: 'root',
        pos: 'V',
        props: {},
        text: rich('x'),
        deleted: 1_794_000_000_000,
      },
      box: { type: 'card', parent: 'root', pos: 'z', props: {} },
      inner: { type: 'todo', parent: 'box', pos: 'V', props: { checked: false }, text: rich('do') },
      table: {
        type: 'table',
        parent: 'root',
        pos: 'zz',
        props: { columns: [{ id: 'c1', name: 'Name' }] },
      },
      r1: { type: 'row', parent: 'table', pos: 'V', props: {}, cells: { c1: rich('Ada') } },
    });
    expect(unreadable).toEqual([]);
    expect(ids(tree.flat())).toEqual(['a', 'b', 'box', 'inner', 'table']);
    expect(tree.get('a')).toEqual({
      id: 'a',
      type: 'heading',
      parent: PAGE_PARENT,
      pos: 'F',
      props: { level: 2 },
      text: 'first',
      deleted: false,
    });
    expect(tree.get('gone')?.deleted).toBe(true);
    expect(ids(tree.rows('table'))).toEqual(['r1']);
    expect(tree.rows('table')[0]!.cells).toEqual({ c1: 'Ada' });
  });
  it('names entries of a type it does not draw and still draws what is under them', () => {
    const { tree, unreadable } = blockTree({
      future: { type: 'hologram', parent: 'root', pos: 'F', props: {} },
      child: {
        type: 'paragraph',
        parent: 'future',
        pos: 'V',
        props: {},
        text: { s: 'kept', marks: [] },
      },
    });
    expect(unreadable).toEqual(['future']);
    expect(ids(tree.flat())).toEqual(['child']);
  });
});

describe('list numbering and indent (#6005)', () => {
  const item = (id: string, pos: string, style: string, indent = 0) =>
    block(id, pos, PAGE_PARENT, {
      type: 'list',
      props: { style, ...(indent && { indent }) },
    });
  it('numbers each run at its indent; deeper items do not end it, other blocks do', () => {
    const tree = new BlockTree([
      item('a', 'a1', 'number'),
      item('b', 'a2', 'number'),
      item('b1', 'a3', 'number', 1),
      item('b2', 'a4', 'number', 1),
      item('c', 'a5', 'number'),
      item('d', 'a6', 'bullet'),
      item('e', 'a7', 'number'),
      block('p', 'a8'),
      item('f', 'a9', 'number'),
    ]);
    expect(['a', 'b', 'b1', 'b2', 'c', 'e', 'f'].map((id) => listNumber(tree, id))).toEqual([
      1, 2, 1, 2, 3, 1, 1,
    ]);
  });
  it('Tab and Shift+Tab move the indent one step within 0..2, and undo puts it back', () => {
    const tree = new BlockTree([item('a', 'a1', 'bullet', 2), block('p', 'a2')]);
    expect(indentBlock(tree, 'a', 1)).toEqual([]);
    expect(indentBlock(tree, 'p', 1)).toEqual([]);
    const out = indentBlock(tree, 'a', -1);
    expect(out).toEqual([{ op: 'props', id: 'a', set: { indent: 1 }, unset: [] }]);
    const back = applyOps(applyOps(tree.flat(), out), inverseOps(tree, out));
    expect(back.find((b) => b.id === 'a')!.props).toEqual({ style: 'bullet', indent: 2 });
    const flat = new BlockTree([item('z', 'a1', 'bullet', 1)]);
    expect(indentBlock(flat, 'z', -1)).toEqual([
      { op: 'props', id: 'z', set: {}, unset: ['indent'] },
    ]);
  });
});

describe('table rows and cells (#6005)', () => {
  const columns = [
    { id: 'a', name: 'Ticket' },
    { id: 'b', name: 'State' },
  ];
  const row = (id: string, pos: string, cells: Record<string, string>, table = 't') =>
    block(id, pos, table, { type: ROW_TYPE, text: undefined, cells });
  const table = (): BlockRecord[] => [
    block('one', 'V'),
    block('t', 'X', PAGE_PARENT, { type: 'table', text: undefined, props: { columns } }),
    row('r1', 'V', { a: '#1', b: 'open' }),
    row('r2', 'X', { a: '#2' }),
  ];
  const cells = (blocks: readonly BlockRecord[], id = 't') =>
    new BlockTree(blocks).rows(id).map((entry) => entry.cells);

  it('adds a row after another, first, or last, and refuses one the table does not hold', () => {
    const after = apply(table(), [addRow('t', 'r3', 'r1')]);
    expect(new BlockTree(after).rows('t').map((entry) => entry.id)).toEqual(['r1', 'r3', 'r2']);
    const last = apply(table(), [addRow('t', 'r3')]);
    expect(new BlockTree(last).rows('t').map((entry) => entry.id)).toEqual(['r1', 'r2', 'r3']);
    const first = apply(table(), [
      { op: 'table', id: 't', action: 'add-row', row: 'r3', after: null },
    ]);
    expect(new BlockTree(first).rows('t').map((entry) => entry.id)).toEqual(['r3', 'r1', 'r2']);
    expect(() => apply(table(), [addRow('t', 'r3', 'one')])).toThrow();
    expect(() => apply(table(), [addRow('one', 'r3')])).toThrow();
    expect(() =>
      apply(table(), [{ op: 'table', id: 't', action: 'add-row', row: 'r3', cells: { zzz: 'x' } }]),
    ).toThrow();
  });
  it('merges a cell from its base as text does, and only on a column the table has', () => {
    // Another writer changed the cell after this tab read "open": both edits are kept.
    const theirs = apply(table(), [
      { op: 'table', id: 't', action: 'set-cell', row: 'r1', column: 'b', text: 'open now' },
    ]);
    const merged = apply(theirs, [
      {
        op: 'table',
        id: 't',
        action: 'set-cell',
        row: 'r1',
        column: 'b',
        text: 'Open',
        base: 'open',
        overlap: 'both',
      },
    ]);
    expect(cells(merged)[0]!.b).toBe('Open now');
    expect(() =>
      apply(table(), [
        { op: 'table', id: 't', action: 'set-cell', row: 'r1', column: 'zzz', text: 'x' },
      ]),
    ).toThrow();
    expect(() =>
      apply(table(), [
        { op: 'table', id: 't', action: 'set-cell', row: 'one', column: 'a', text: 'x' },
      ]),
    ).toThrow();
  });
  it('undoes an added row, a removed row and a cell edit', () => {
    roundTrip(table(), [addRow('t', 'r3', 'r2')]);
    roundTrip(table(), [{ op: 'table', id: 't', action: 'remove-row', row: 'r1' }]);
    roundTrip(table(), [
      {
        op: 'table',
        id: 't',
        action: 'set-cell',
        row: 'r1',
        column: 'b',
        text: 'done',
        base: 'open',
        overlap: 'both',
      },
    ]);
  });
  it('duplicates a table with copies of its rows, alone or in a card', () => {
    let next = 0;
    const id = () => `copy-${++next}`;
    const ops = duplicateBlock(new BlockTree(table()), 't', id);
    const after = apply(table(), ops);
    const tree = new BlockTree(after);
    expect(ids(tree.children())).toEqual(['one', 't', 'copy-1']);
    expect(tree.get('copy-1')!.props).toEqual({ columns });
    expect(tree.rows('copy-1').map((entry) => entry.id)).toEqual(['copy-2', 'copy-3']);
    expect(cells(after, 'copy-1')).toEqual(cells(after, 't'));
    // The copy's rows leave with it on undo: the table goes, and a row is drawn only by its table.
    expect(inverseOps(new BlockTree(table()), ops)).toEqual([{ op: 'delete', id: 'copy-1' }]);
    const undone = new BlockTree(apply(after, inverseOps(new BlockTree(table()), ops)));
    expect(ids(undone.children())).toEqual(['one', 't']);
    expect(undone.rows('copy-1')).toEqual([]);
    const boxed = [
      card('box', 'V'),
      block('t', 'V', 'box', { type: 'table', text: undefined, props: { columns } }),
      row('r1', 'V', { a: '#1' }),
    ];
    const copied = apply(boxed, duplicateBlock(new BlockTree(boxed), 'box', id));
    const inner = new BlockTree(copied).children('copy-4')[0]!;
    expect(cells(copied, inner.id)).toEqual([{ a: '#1' }]);
  });
});

import { describe, expect, it } from 'vite-plus/test';
import type { BlockRecord } from '../src/block-model.js';
import { BlockTree } from '../src/block-tree.js';
import { mentionEntries, mentionLabel, mentionQuery } from '../src/block-mention.js';

const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
const block = (n: number, type: string, text?: string, props = {}): BlockRecord =>
  ({ id: id(n), type, parent: 'root', pos: `a${n}`, props, text, deleted: false }) as BlockRecord;
const tree = new BlockTree([
  block(1, 'table', undefined, { label: 'Ticket status' }),
  block(2, 'paragraph', 'Ship   the stack before the review starts, then write the notes.'),
  block(3, 'todo', 'First blocks'),
]);

describe('the @ picker (#6203)', () => {
  it('opens on an @ at a word start, and follows the caret until a space', () => {
    expect(mentionQuery('@', 1)).toEqual({ from: 0, query: '' });
    expect(mentionQuery('see @tab', 8)).toEqual({ from: 4, query: 'tab' });
    expect(mentionQuery('see @tab', 6)).toEqual({ from: 4, query: 't' });
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    expect(mentionQuery('see @tab now', 12)).toBeNull();
    expect(mentionQuery('表格 @表', 5)).toEqual({ from: 3, query: '表' });
  });

  it('names a block by its type and opening text', () => {
    expect(mentionLabel(tree.get(id(1))!)).toBe('Table: Ticket status');
    expect(mentionLabel(tree.get(id(2))!)).toBe(
      'Paragraph: Ship the stack before the review starts,',
    );
  });

  it('offers agents first, then the other blocks in reading order, filtered by the query', () => {
    const all = mentionEntries(tree, ['tmt-gui-lead', 'tmt-gui-lead', 'bad name'], '', id(2));
    expect(all.map((entry) => entry.label)).toEqual([
      '@tmt-gui-lead',
      'Table: Ticket status',
      'To-do: First blocks',
    ]);
    expect(mentionEntries(tree, ['tmt-gui-lead'], 'tab').map((entry) => entry.id)).toEqual([
      `block:${id(1)}`,
    ]);
    expect(mentionEntries(tree, ['tmt-gui-lead'], 'gui').map((entry) => entry.mark)).toEqual([
      'agent',
    ]);
    expect(mentionEntries(tree, [], 'first b')[0]).toMatchObject({ mark: 'block', value: id(3) });
  });
});

describe('other pages in the @ picker (#6208)', () => {
  const pages = [
    { id: 'b1000000-0000-4000-8000-000000000001', title: 'Release checklist' },
    { id: id(9), title: 'This page' },
  ];
  it('lists the matching pages after this page, never this page itself', () => {
    expect(mentionEntries(tree, [], 'rel', id(9), { pages }).map((entry) => entry.id)).toEqual([
      'page:b1000000-0000-4000-8000-000000000001',
    ]);
  });
  it('an opened page offers the way back and its blocks, marked with the page', () => {
    const open = { id: pages[0]!.id, title: 'Release checklist' };
    const rows = mentionEntries(tree, ['tmt-gui-lead'], 'tick', id(2), {
      open,
      state: 'ready',
      blocks: [block(1, 'table', undefined, { label: 'Ticket status' })],
    });
    expect(rows.map((entry) => [entry.mark, entry.value])).toEqual([
      ['back', ''],
      ['block', `${open.id}/${id(1)}`],
    ]);
    expect(
      mentionEntries(tree, [], '', undefined, { open, state: 'failed' }).map((entry) => entry.mark),
    ).toEqual(['back', 'retry']);
  });
});

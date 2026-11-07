import { describe, expect, it } from 'vite-plus/test';
import { linkHref } from '@tmt/browser-ui/blocks';
import { applyOps } from '../src/block-apply.js';
import { formatMarks, marked, marksThrough, typedMarks } from '../src/block-marks.js';
import { type BlockOp, type BlockRecord, PAGE_PARENT } from '../src/block-model.js';
import { inverseOps, joinBlock, splitBlock } from '../src/block-ops.js';
import { posBetween } from '../src/block-pos.js';
import { BlockTree } from '../src/block-tree.js';
import { type Mark, validMarkValue } from '../src/blocks.js';

const bold = (from: number, to: number): Mark => ({ from, to, mark: 'bold' });
const link = (from: number, to: number, value: string): Mark => ({ from, to, mark: 'link', value });
const record = (id: string, _pos: string, text: string, marks: Mark[] = []): BlockRecord => ({
  id,
  type: 'paragraph',
  parent: PAGE_PARENT,
  pos: posBetween(),
  props: {},
  text,
  ...(marks.length && { marks }),
  deleted: false,
});

describe('inline marks as the serve keeps them (#6005)', () => {
  it('a kept character keeps its marks; a new one has none', () => {
    expect(marksThrough('hello world', 'hello big world', [bold(0, 5), bold(6, 11)])).toEqual([
      bold(0, 5),
      bold(10, 15),
    ]);
    // Typing inside a run splits it: the serve's splice gives new characters no marks.
    expect(marksThrough('abcd', 'abXcd', [bold(0, 4)])).toEqual([bold(0, 2), bold(3, 5)]);
    expect(marksThrough('a😀b', 'a😀', [bold(1, 3)])).toEqual([bold(1, 2)]);
  });

  it('a format sets or clears a range, in scalar offsets and canonical runs', () => {
    expect(formatMarks('a😀bc', [bold(0, 1)], { from: 1, to: 3, mark: 'bold', value: true })).toEqual([
      bold(0, 3),
    ]);
    expect(formatMarks('abcd', [bold(0, 4)], { from: 1, to: 2, mark: 'bold', value: false })).toEqual([
      bold(0, 1),
      bold(2, 4),
    ]);
    expect(
      formatMarks('abcd', [], { from: 0, to: 2, mark: 'link', value: 'https://example.com/a' }),
    ).toEqual([link(0, 2, 'https://example.com/a')]);
    // The serve refuses an empty range or one past the end, so the batch is never drawn.
    expect(() => formatMarks('ab', [], { from: 1, to: 1, mark: 'bold', value: true })).toThrow();
    expect(() => formatMarks('ab', [], { from: 1, to: 3, mark: 'bold', value: true })).toThrow();
  });

  it('a range is marked only when all of it is, across touching runs', () => {
    expect(marked([bold(0, 2), bold(2, 5)], 1, 4, 'bold')).toBe(true);
    expect(marked([bold(0, 2), bold(3, 5)], 1, 4, 'bold')).toBe(false);
    expect(marked([link(0, 3, 'https://a.example/')], 0, 3, 'link', 'https://b.example/')).toBe(false);
  });

  it('typed characters take the marks of the text they were typed into', () => {
    expect(typedMarks('p', 'abcd', 'abXYcd', [bold(0, 4)])).toEqual([
      { op: 'text', id: 'p', format: { from: 2, to: 4, mark: 'bold', value: true } },
    ]);
    // A replacement takes the first replaced character's marks; one after a run, the run's.
    expect(typedMarks('p', 'ab cd', 'ab Zd!', [bold(3, 4)])).toEqual([
      { op: 'text', id: 'p', format: { from: 3, to: 4, mark: 'bold', value: true } },
    ]);
    expect(typedMarks('p', 'ab', 'ab', [bold(0, 2)])).toEqual([]);
  });

  it('a text op and its format ops draw as the serve applies them', () => {
    const page = [record('p', 'a0', 'abcd', [bold(0, 4)])];
    const ops: BlockOp[] = [
      { op: 'text', id: 'p', set: 'abXcd', base: 'abcd', overlap: 'both' },
      ...typedMarks('p', 'abcd', 'abXcd', [bold(0, 4)]),
      { op: 'text', id: 'p', format: { from: 0, to: 1, mark: 'italic', value: true } },
    ];
    const [drawn] = applyOps(page, ops);
    expect(drawn).toMatchObject({
      text: 'abXcd',
      marks: [{ from: 0, to: 1, mark: 'italic' }, bold(0, 5)],
    });
  });

  it('Enter carries the rest marks to the new block; Backspace carries them back', () => {
    const tree = new BlockTree([record('p', 'a0', 'hello world', [bold(3, 8)])]);
    const split = splitBlock(tree, 'p', 5, 'n');
    expect(split.filter((op) => op.op === 'text' && 'format' in op)).toEqual([
      { op: 'text', id: 'n', format: { from: 0, to: 3, mark: 'bold', value: true } },
    ]);
    const after = new BlockTree(applyOps(tree.flat(), split));
    expect(after.get('p')).toMatchObject({ text: 'hello', marks: [bold(3, 5)] });
    expect(after.get('n')).toMatchObject({ text: ' world', marks: [bold(0, 3)] });
    const joined = new BlockTree(applyOps(after.flat(), joinBlock(after, 'n')));
    expect(joined.get('p')).toMatchObject({ text: 'hello world', marks: [bold(3, 8)] });
  });

  it('undoing a format sets the mark back as it was on the range', () => {
    const before = new BlockTree([record('p', 'a0', 'abcdef', [bold(1, 2), bold(4, 6)])]);
    const op: BlockOp = { op: 'text', id: 'p', format: { from: 0, to: 5, mark: 'bold', value: true } };
    const done = applyOps(before.flat(), [op]);
    expect(done[0]!.marks).toEqual([bold(0, 6)]);
    const undone = applyOps(done, inverseOps(before, [op]));
    expect(undone[0]!.marks).toEqual([bold(1, 2), bold(4, 6)]);
  });
});

describe('link schemes (#6005)', () => {
  const urls = [
    'https://example.com/a',
    'http://example.com/',
    'mailto:a@example.com',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://a b/',
    'https://',
    ' https://example.com/',
    'vbscript:msgbox(1)',
  ];
  it('the drawing opens only what the page admits: http, https and mailto', () => {
    for (const url of urls) expect(linkHref(url) !== undefined, url).toBe(validMarkValue('link', url));
    expect(urls.filter((url) => linkHref(url))).toEqual([
      'https://example.com/a',
      'http://example.com/',
      'mailto:a@example.com',
    ]);
  });
});

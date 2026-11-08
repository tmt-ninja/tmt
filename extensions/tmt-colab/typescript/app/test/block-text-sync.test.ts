import { textMerge } from '@tmt/colab-client';
import { describe, expect, it } from 'vite-plus/test';
import vectors from '../../../contracts/vectors/block-text-merge-v1.json';
import { BlockTextSync, caretThrough } from '../src/block-text-sync.js';

describe('the editor uses the one text merge', () => {
  it('runs the shared vectors through the merge it imports', () => {
    for (const vector of vectors.merges)
      expect(textMerge.merge(vector.base, vector.remote, vector.local), vector.name).toEqual({
        text: vector.merged,
        dropped: vector.dropped,
      });
    for (const vector of vectors.mergesBoth)
      expect(
        textMerge.merge(vector.base, vector.remote, vector.local, 'both'),
        vector.name,
      ).toEqual({ text: vector.merged, dropped: vector.dropped });
  });
});

describe('a focused block while the page changes', () => {
  it('sends typing as one whole-text op with the text it started from', () => {
    const sync = new BlockTextSync('b', 'Ship the stack');
    sync.typed('Ship the stack today');
    expect(sync.flush()).toEqual({
      op: 'text',
      id: 'b',
      set: 'Ship the stack today',
      base: 'Ship the stack',
      overlap: 'both',
    });
    // One op at a time; nothing new is nothing to send.
    expect(sync.flush()).toBeUndefined();
    expect(new BlockTextSync('c', 'x').flush()).toBeUndefined();
  });
  it('keeps unsent typing when an agent changes another part, and moves the caret with it', () => {
    const sync = new BlockTextSync('b', 'one two three');
    sync.typed('one two three four');
    // An agent changed "one" to "ONE" before the typing was sent; the caret is at the end.
    const shown = sync.remote('ONE two three', 18);
    expect(shown).toEqual({ text: 'ONE two three four', caret: 18, dropped: false });
    expect(sync.flush()).toEqual({
      op: 'text',
      id: 'b',
      set: 'ONE two three four',
      base: 'ONE two three',
      overlap: 'both',
    });
  });
  it('never takes its own sent edit, seen before the save settles, for a conflict', () => {
    const sync = new BlockTextSync('b', 'hello');
    sync.typed('hello world');
    sync.flush();
    // The page shows the sent edit and an agent's change, while the person keeps typing there.
    expect(sync.remote('Hello world', 11)).toEqual({
      text: 'hello world',
      caret: 11,
      dropped: false,
    });
    sync.typed('hello world, again');
    const settled = sync.settled(true, 18);
    expect(settled).toEqual({ text: 'Hello world, again', caret: 18, dropped: false });
    expect(sync.flush()).toEqual({
      op: 'text',
      id: 'b',
      set: 'Hello world, again',
      base: 'Hello world',
      overlap: 'both',
    });
  });
  it('keeps a refused edit local and sends it again from the old base', () => {
    const sync = new BlockTextSync('b', 'draft');
    sync.typed('draft one');
    sync.flush();
    expect(sync.settled(false, 9)).toEqual({ text: 'draft one', caret: 9, dropped: false });
    expect(sync.flush()).toEqual({
      op: 'text',
      id: 'b',
      set: 'draft one',
      base: 'draft',
      overlap: 'both',
    });
  });
  it("keeps both writers' text where typing overlapped another change at the same place", () => {
    const sync = new BlockTextSync('b', 'the cat sat');
    sync.typed('the dog sat');
    const shown = sync.remote('the bird sat', 7);
    // The same merge as the serve applies to the browser's ops: the page's text, then the typing.
    expect(shown.text).toBe(
      textMerge.merge('the cat sat', 'the bird sat', 'the dog sat', 'both').text,
    );
    expect(shown.text).toContain('bird');
    expect(shown.text).toContain('dog');
  });
  it('drops a view held from before the commit when the op settles', () => {
    const sync = new BlockTextSync('b', 'Ship');
    sync.typed('Ship it');
    sync.flush();
    // While the op is out, a view made before the commit (order 4) still shows the old text.
    expect(sync.remote('Ship', 7, 4).text).toBe('Ship it');
    // The commit shows from order 5 on: the held view predates it and is not merged as a revert.
    expect(sync.settled(true, 7, 5)).toEqual({ text: 'Ship it', caret: 7, dropped: false });
    expect(sync.pending).toBe(false);
  });
  it('drops any number of views older than the commit that arrive after it settled', () => {
    const sync = new BlockTextSync('b', 'Ship');
    sync.typed('Ship it');
    sync.flush();
    sync.settled(true, 7, 9);
    // Two late views from before the commit: neither moves the text or the caret.
    expect(sync.remote('Ship', 7, 7)).toEqual({ text: 'Ship it', caret: 7, dropped: false });
    expect(sync.remote('Sh', 7, 8)).toEqual({ text: 'Ship it', caret: 7, dropped: false });
    expect(sync.pending).toBe(false);
    // A view from the commit on merges as usual.
    expect(sync.remote('Ship it now', 7, 10).text).toBe('Ship it now');
  });
  it('merges a view held from after the commit when the op settles', () => {
    const sync = new BlockTextSync('b', 'Ship');
    sync.typed('Ship it');
    sync.flush();
    // The page showed the commit and then an agent's change (order 6) while the op was out.
    sync.remote('Merge it', 7, 6);
    expect(sync.settled(true, 8, 5).text).toBe('Merge it');
  });
  it('shows the page text at once when nothing is typed', () => {
    const sync = new BlockTextSync('b', 'a');
    // Text inserted at the caret goes before it, as the merge keeps the page's insertion first at
    // one point (vector "insertions at one point keep the page's first").
    expect(sync.remote('ab', 1)).toEqual({ text: 'ab', caret: 2, dropped: false });
    expect(sync.pending).toBe(false);
  });
});

describe('the caret through a change', () => {
  it('stays before an insertion after it, moves past one before it, and counts scalar values', () => {
    expect(caretThrough('abc', 'abXc', 1)).toBe(1);
    expect(caretThrough('abc', 'Xabc', 1)).toBe(2);
    // An astral character is one scalar value, not two UTF-16 units.
    expect(caretThrough('a😀b', '😀a😀b', 2)).toBe(3);
    // Where the change replaced the caret's place, it stays within the new text.
    expect(caretThrough('abcdef', 'ab', 5)).toBe(2);
  });
});

describe('a focused table cell (#6005)', () => {
  it('sends its typing as set-cell with its merge base, then merges the page as a block does', () => {
    const cell = new BlockTextSync('r1', 'open', { table: 't', column: 'b' });
    cell.typed('opened');
    expect(cell.flush()).toEqual({
      op: 'table',
      id: 't',
      action: 'set-cell',
      row: 'r1',
      column: 'b',
      text: 'opened',
      base: 'open',
      overlap: 'both',
    });
    // Nothing more goes while that op is on its way.
    cell.typed('opened!');
    expect(cell.flush()).toBeUndefined();
    cell.settled(true, 7);
    expect(cell.flush()).toMatchObject({ text: 'opened!', base: 'opened' });
  });
});

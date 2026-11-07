import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import { textMerge } from '../src/index.js';

type Hunk = { from: number; to: number; text: string };
const vectors = JSON.parse(
  readFileSync(
    new URL('../../../contracts/vectors/block-text-merge-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  diffLimit: number;
  hunks: { name: string; base: string; local: string; hunks: Hunk[] }[];
  merges: {
    name: string;
    base: string;
    remote: string;
    local: string;
    merged: string;
    dropped: Hunk[];
  }[];
};

it('uses the limit the vectors pin', () => {
  expect(textMerge.DIFF_LIMIT).toBe(vectors.diffLimit);
});

it.each(vectors.hunks)('diff: $name', ({ base, local, hunks }) => {
  expect(textMerge.hunks(Array.from(base), Array.from(local))).toEqual(hunks);
});

it.each(vectors.merges)('merge: $name', ({ base, remote, local, merged, dropped }) => {
  expect(textMerge.merge(base, remote, local)).toEqual({ text: merged, dropped });
});

it('a script replays to the local text for inputs the vectors do not name', () => {
  const samples: [string, string][] = [
    ['kitten sitting', 'sitting kitten'],
    ['aaaa', 'aaaaaaaa'],
    ['abcabba', 'cbabac'],
    ['', ''],
    ['same', 'same'],
    ['line one\nline two\n', 'line two\nline one\nline three\n'],
  ];
  for (const [base, local] of samples) {
    const a = Array.from(base);
    let rebuilt = '';
    let cursor = 0;
    for (const hunk of textMerge.hunks(a, Array.from(local))) {
      rebuilt += a.slice(cursor, hunk.from).join('') + hunk.text;
      cursor = hunk.to;
    }
    rebuilt += a.slice(cursor).join('');
    expect(rebuilt).toBe(local);
  }
});

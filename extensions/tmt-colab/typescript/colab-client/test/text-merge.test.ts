import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';
import { textMerge } from '../src/index.js';

type Hunk = { from: number; to: number; text: string };
type Merge = {
  name: string;
  base: string;
  remote: string;
  local: string;
  merged: string;
  dropped: Hunk[];
};
const vectors = JSON.parse(
  readFileSync(
    new URL('../../../contracts/vectors/block-text-merge-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  diffLimit: number;
  hunks: { name: string; base: string; local: string; hunks: Hunk[] }[];
  merges: Merge[];
  mergesBoth: Merge[];
};

const generated = JSON.parse(
  readFileSync(
    new URL('../../../contracts/vectors/block-text-merge-generated-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  count: number;
  cases: {
    base: string;
    remote: string;
    local: string;
    results: Record<'remote' | 'both', { merged: string; dropped: Hunk[] }>;
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
  expect(textMerge.merge(base, remote, local, 'remote')).toEqual({ text: merged, dropped });
});

it.each(vectors.mergesBoth)('merge both: $name', ({ base, remote, local, merged, dropped }) => {
  expect(textMerge.merge(base, remote, local, 'both')).toEqual({ text: merged, dropped });
});

it('matches the seeded generated vectors under both overlap modes', () => {
  expect(generated.cases).toHaveLength(generated.count);
  for (const { base, remote, local, results } of generated.cases) {
    for (const mode of ['remote', 'both'] as const) {
      const got = textMerge.merge(base, remote, local, mode);
      expect(
        { text: got.text, dropped: got.dropped },
        JSON.stringify({ base, remote, local, mode }),
      ).toEqual({
        text: results[mode].merged,
        dropped: results[mode].dropped,
      });
    }
  }
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

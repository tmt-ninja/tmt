import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vite-plus/test';
import { createRepositorySources } from '../support/repository-sources.js';
import { imports } from '../support/source-imports.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'repository-sources-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

it('walks and reads each immutable checkout input once across overlapping scans', () => {
  const root = path.join(home, 'checkout');
  mkdirSync(root);
  writeFileSync(path.join(root, 'a.ts'), 'export {};');
  writeFileSync(path.join(root, 'empty.ts'), '');
  const calls = { entries: 0, text: 0 };
  const source = createRepositorySources(root, {
    entries: (directory) => {
      calls.entries += 1;
      return readdirSync(directory, { withFileTypes: true });
    },
    text: (file) => {
      calls.text += 1;
      return readFileSync(file, 'utf8');
    },
  });
  for (let scan = 0; scan < 2; scan += 1) {
    expect(
      source
        .entries(root)
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['a.ts', 'empty.ts']);
    expect(source.text(path.join(root, './a.ts'))).toBe('export {};');
    expect(source.text(path.join(root, 'empty.ts'))).toBe('');
  }
  expect(calls).toEqual({ entries: 1, text: 2 });
});

it('observes fixture writes and new files outside the immutable checkout, including prefix siblings', () => {
  const root = path.join(home, 'checkout');
  const fixture = path.join(home, 'checkout-fixture');
  mkdirSync(root);
  mkdirSync(fixture);
  const file = path.join(fixture, 'a.ts');
  writeFileSync(file, 'before');
  const source = createRepositorySources(root);
  expect(source.text(file)).toBe('before');
  expect(source.entries(fixture)).toHaveLength(1);
  writeFileSync(file, 'after');
  writeFileSync(path.join(fixture, 'b.ts'), 'new');
  expect(source.text(file)).toBe('after');
  expect(source.entries(fixture)).toHaveLength(2);
});

it('keeps separate checkout snapshots isolated and does not cache a failed read', () => {
  const first = path.join(home, 'first'),
    second = path.join(home, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const a = createRepositorySources(first),
    b = createRepositorySources(second);
  expect(() => a.text(path.join(first, 'a.ts'))).toThrow();
  writeFileSync(path.join(first, 'a.ts'), 'first');
  writeFileSync(path.join(second, 'a.ts'), 'second');
  expect(a.text(path.join(first, 'a.ts'))).toBe('first');
  expect(b.text(path.join(second, 'a.ts'))).toBe('second');
});

it('refreshes cached module edges when a mutation fixture changes text', () => {
  const file = path.join(home, 'fixture.ts');
  expect(imports(file, "export * from './before';")).toEqual(['./before']);
  expect(imports(file, "export * from './after';")).toEqual(['./after']);
});

it('keeps caller mutations out of cached edges and preserves file syntax', () => {
  const file = path.join(home, 'fixture.tsx');
  const source = "const View=()=> <div />; export * from './first'; export * from './second';";
  imports(file, source).reverse().push('foreign');
  expect(imports(file, source)).toEqual(['./first', './second']);
});

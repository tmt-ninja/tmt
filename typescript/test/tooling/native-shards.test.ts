import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { splitWeightedFiles } from '../../scripts/e2e-shards.mjs';
import {
  FULL_NATIVE_SHARDS,
  listNativeFiles,
  loadNativeShardWeights,
  nativeShardFiles,
  splitNativeFiles,
} from '../../scripts/native-shards.mjs';

const { runPackedCommand } = await import(
  new URL('../../scripts/packed-command.mjs', import.meta.url).href
);
const repository = fileURLToPath(new URL('../../../', import.meta.url));

describe('Native process shards', () => {
  const files = listNativeFiles();
  const weights = loadNativeShardWeights();
  const sorted = (list: readonly string[]) => [...list].sort();

  it('puts every native test file in exactly one shard, for any shard count', () => {
    expect(files.length).toBeGreaterThan(40);
    for (const count of [1, 2, 3, 5]) {
      const shards = splitNativeFiles(files, count, weights);
      expect(shards, `count ${count}`).toHaveLength(count);
      expect(sorted(shards.flatMap((shard) => shard.files)), `count ${count}`).toEqual(files);
    }
    // The split CI actually runs: no file in no shard, none in two.
    const [first, second] = nativeShardFiles('full', [], files);
    expect(first.filter((file) => second.includes(file))).toEqual([]);
    expect(sorted([...first, ...second])).toEqual(files);
    expect(FULL_NATIVE_SHARDS).toBe(2);
  });

  it('finds every file the native suite would run, with none hidden in a subdirectory', () => {
    const tracked = runPackedCommand('git', ['ls-files', '-z', '--', 'typescript/test/native'], {
      cwd: repository,
      env: process.env,
    })
      .split('\0')
      .filter((file: string) => file.endsWith('.test.ts'));
    expect(
      tracked.map((file: string) => path.relative('typescript/test/native', file)).sort()
    ).toEqual(files);
  });

  it('shares the E2E split and keeps each shard sorted by name', () => {
    const seconds = (file: string) => weights.files[file] ?? weights.defaultSeconds;
    const once = splitNativeFiles(files, 2, weights);
    expect(once).toEqual(splitWeightedFiles(files, 2, seconds));
    expect(splitNativeFiles([...files].reverse(), 2, weights)).toEqual(once);
    for (const shard of once) expect(shard.files).toEqual(sorted(shard.files));
  });

  it('balances the current inventory within ten percent', () => {
    const [first, second] = splitNativeFiles(files, 2, weights);
    expect(
      Math.max(first.seconds, second.seconds) / Math.min(first.seconds, second.seconds)
    ).toBeLessThan(1.1);
  });

  it('gives a file with no weight the default weight and still places it', () => {
    const withNew = [...files, 'brand-new.test.ts'];
    const shards = splitNativeFiles(withNew, 2, weights);
    expect(sorted(shards.flatMap((shard) => shard.files))).toEqual(sorted(withNew));
  });

  it('keeps the weight file honest: no weight names a missing file, and every weight is positive', () => {
    for (const [file, seconds] of Object.entries(weights.files)) {
      expect(files, `${file} has a weight but does not exist`).toContain(file);
      expect(seconds).toBeGreaterThan(0);
    }
    expect(() => loadNativeShardWeights('{"defaultSeconds":1,"files":{"a":0}}')).toThrow(
      'positive numbers'
    );
    expect(() => loadNativeShardWeights('{"defaultSeconds":0,"files":{}}')).toThrow(
      'positive numbers'
    );
    expect(() => loadNativeShardWeights('{"defaultSeconds":1}')).toThrow('positive numbers');
  });

  it('runs one shard for a scoped component, none when nothing native is selected', () => {
    expect(nativeShardFiles('ops', ['ops.test.ts'], files)).toEqual([['ops.test.ts'], []]);
    expect(nativeShardFiles('none', [], files)).toEqual([[], []]);
    expect(nativeShardFiles('', [], files)).toEqual([[], []]);
  });

  it('prints a shard for the workflow and refuses an empty or unknown shard', () => {
    const script = path.join(repository, 'typescript/scripts/native-shards.mjs');
    const run = (...args: string[]) =>
      runPackedCommand(process.execPath, [script, ...args], { cwd: repository, env: process.env });
    const [first, second] = nativeShardFiles('full', [], files);
    expect(run('1', 'full')).toBe(`${first.join(' ')}\n`);
    expect(run('2', 'full')).toBe(`${second.join(' ')}\n`);
    expect(run('1', 'ops', 'ops.test.ts', 'extension-install.test.ts')).toBe(
      'ops.test.ts extension-install.test.ts\n'
    );
    for (const args of [
      ['2', 'ops', 'ops.test.ts'],
      ['3', 'full'],
      ['1', 'none'],
    ]) {
      expect(() => run(...args), args.join(' ')).toThrow();
    }
  });
});

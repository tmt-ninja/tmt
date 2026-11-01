import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitWeightedFiles } from './e2e-shards.mjs';

const NATIVE_DIRECTORY = new URL('../test/native/', import.meta.url);
const WEIGHTS = new URL('./native-shard-weights.json', import.meta.url);

/** Shards of the full native process run. The workflow declares one job per shard, so this is fixed. */
export const FULL_NATIVE_SHARDS = 2;

export function loadNativeShardWeights(text = readFileSync(WEIGHTS, 'utf8')) {
  const weights = JSON.parse(text);
  const positive = (value) => Number.isFinite(value) && value > 0;
  if (
    !positive(weights.defaultSeconds) ||
    typeof weights.files !== 'object' ||
    weights.files === null ||
    !Object.values(weights.files).every(positive)
  ) {
    throw new Error('The native shard weights must be positive numbers.');
  }
  return weights;
}

/** The native process test file names, sorted. */
export function listNativeFiles(directory = NATIVE_DIRECTORY) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
}

export function splitNativeFiles(files, count, weights = loadNativeShardWeights()) {
  return splitWeightedFiles(files, count, (file) => weights.files[file] ?? weights.defaultSeconds);
}

/**
 * The native test files each Native process shard runs for a native scope. `full`
 * splits every file; a scoped component runs only its own file list in the first
 * shard (the second is skipped); `none` runs nothing.
 */
export function nativeShardFiles(scope, scopedFiles, files = listNativeFiles()) {
  if (scope === 'full') {
    const [first, second] = splitNativeFiles(files, FULL_NATIVE_SHARDS);
    return [first.files, second.files];
  }
  if (scope === 'none' || scope === '') return [[], []];
  return [[...scopedFiles], []];
}

/** `native-shards.mjs <shard> <scope> [scoped file...]` prints that shard's plain file names. */
function main([shard, scope, ...scopedFiles]) {
  const index = ['1', '2'].indexOf(shard);
  if (index < 0) throw new Error('Expected shard 1 or 2.');
  const files = nativeShardFiles(scope ?? '', scopedFiles)[index];
  if (files.length === 0) throw new Error(`Native process shard ${shard} has no files.`);
  process.stdout.write(`${files.join(' ')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

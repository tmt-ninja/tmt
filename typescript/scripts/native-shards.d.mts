import type { FileShard } from './e2e-shards.mjs';

export interface NativeShardWeights {
  readonly defaultSeconds: number;
  readonly files: Readonly<Record<string, number>>;
}

export const FULL_NATIVE_SHARDS: number;
export function loadNativeShardWeights(text?: string): NativeShardWeights;
export function listNativeFiles(directory?: URL): string[];
export function splitNativeFiles(
  files: readonly string[],
  count: number,
  weights?: NativeShardWeights
): FileShard[];
export function nativeShardFiles(
  scope: string,
  scopedFiles: readonly string[],
  files?: readonly string[]
): [string[], string[]];

// Types for runtime-chunks.mjs, which the app's Vite config imports (#6085).
import type { Plugin } from 'vite-plus';
export function runtimeBuildOptions(appRoot: URL): {
  entry: Record<string, string>;
  groups: { name: string; test: (id: string) => boolean; priority: number }[];
};
export function runtimeChunksPlugin(options: { compiler: string }): Plugin;

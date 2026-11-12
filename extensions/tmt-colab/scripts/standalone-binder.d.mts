// Types for standalone-binder.mjs, which the app's Vite config imports (#6157).
import type { Plugin, build } from 'vite-plus';
export const BINDER_FILE: string;
export function standaloneBinderPlugin(options: { build: typeof build }): Plugin;

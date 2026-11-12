/**
 * The page runtime's base (#1693, #6077): every Colab page gets it, with the Tailwind browser
 * compiler the build appends after these modules. It holds no React. It owns the registry the lazy
 * chunks fill (#6085) and the seal that closes it; the `react` chunk publishes `window.tmt` over
 * the same registry. Nothing here talks to the parent; the frame stays an opaque sandbox.
 */
import type { ChunkParts } from './register.js';

/** `tmt.ui` and `tmt.sharedParts`: filled by the chunks the parent chose for this page, then sealed
 * before any author or design-system script runs. */
export const ui: Record<string, unknown> = {};
export const sharedParts: Record<string, unknown> = {};
const loadedChunks = new Set<string>();
window.__colabRuntimeChunk = (name: string, parts: ChunkParts) => {
  if (loadedChunks.has(name)) return;
  loadedChunks.add(name);
  Object.assign(ui, parts.ui);
  Object.assign(sharedParts, parts.parts);
};
window.__colabRuntimeSeal = () => {
  delete window.__colabRuntimeChunk;
  delete window.__colabRuntimeSeal;
  delete (window as { __colabDefine?: unknown }).__colabDefine;
  delete (window as { __colabRequire?: unknown }).__colabRequire;
  Object.freeze(ui);
  Object.freeze(sharedParts);
};

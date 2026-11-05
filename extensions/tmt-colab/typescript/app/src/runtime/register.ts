/**
 * How a lazy page-runtime chunk (#6085) joins the base: it hands its parts to the hook the base
 * installs, before the frame seals the runtime and any author or design-system script runs.
 */
export interface ChunkParts {
  /** `tmt.ui` names: the runtime 4 parts this chunk provides. */
  ui?: Record<string, unknown>;
  /** `tmt.sharedParts` names: the runtime 3 shared parts this chunk provides. */
  parts?: Record<string, unknown>;
}
export type RegisterChunk = (name: string, parts: ChunkParts) => void;
declare global {
  interface Window {
    __colabRuntimeChunk?: RegisterChunk;
    __colabRuntimeSeal?: () => void;
  }
}

/** Adds a chunk's parts to the runtime; the base must have run first. */
export function registerChunk(name: string, parts: ChunkParts) {
  const register = window.__colabRuntimeChunk;
  if (!register) throw new Error(`Page runtime chunk ${name} loaded without its base`);
  register(name, parts);
}

/**
 * The design systems' route roots (#5821): each system lives under /ds/<id>, its mocks under its
 * own Mocks entry. Old /docs and /mock URLs redirect here, so shared links keep working.
 */
export const guiRoot = '/ds/gui';
export const tuiRoot = '/ds/tui';
export const colabMockBase = `${guiRoot}/mocks/colab`;
export const tuiMockBase = `${tuiRoot}/mocks`;
/** Where a preview frame loads: this document with `?frame=`, embedded or not. */
export const frameDocument = () =>
  location.pathname.endsWith('/design-docs.html') ? location.pathname : guiRoot;

/** The current path for an old or bare URL, or null when the path is already current. */
export function canonicalPath(path: string): string | null {
  const moved = (from: string, to: string) =>
    path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : null;
  if (path === '/' || path === '' || path === '/ds' || path === '/ds/') return guiRoot;
  return (
    moved('/docs/tui', tuiRoot) ??
    moved('/docs', guiRoot) ??
    moved('/mock/colab', colabMockBase) ??
    moved('/mock/tui', tuiMockBase)
  );
}

/**
 * Whether the wide screen's side menu (the shell's rail) is collapsed (#6833): one value per
 * device and origin, the shell's to apply and any host's to read, so a page's outline can follow
 * it. A browser without storage keeps the menu expanded and remembers nothing.
 */
export const railStorageKey = 'tmt-shell-rail';

const listeners = new Set<() => void>();
let collapsed = read();

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(railStorageKey) === 'collapsed';
  } catch {
    return false;
  }
}

export function railCollapsed(): boolean {
  return collapsed;
}

/** Collapses or expands the side menu everywhere in this page, and remembers it. */
export function setRailCollapsed(next: boolean): void {
  if (next === collapsed) return;
  collapsed = next;
  try {
    if (next) localStorage.setItem(railStorageKey, 'collapsed');
    else localStorage.removeItem(railStorageKey);
  } catch {
    // Without storage the choice lasts for this page only.
  }
  for (const listener of listeners) listener();
}

export function subscribeRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab's choice applies here too.
globalThis.addEventListener?.('storage', (event: StorageEvent) => {
  if (event.key !== railStorageKey && event.key !== null) return;
  const next = read();
  if (next === collapsed) return;
  collapsed = next;
  for (const listener of listeners) listener();
});

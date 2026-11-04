/** Scoped modal ownership. Only siblings inside the scope are made inert; the host stays usable. */
interface ScopeState {
  stack: HTMLElement[];
  originalInert: Map<Element, string | null>;
  overflow: string;
  overflowPriority: string;
}
const states = new WeakMap<HTMLElement, ScopeState>();

function apply(scope: HTMLElement, state: ScopeState) {
  for (const [node, inert] of state.originalInert) {
    if (inert === null) node.removeAttribute('inert');
    else node.setAttribute('inert', inert);
  }
  state.originalInert.clear();
  const dialog = state.stack.at(-1);
  if (!dialog) return;
  for (let child: HTMLElement | null = dialog; child && child !== scope;) {
    const parent: HTMLElement | null = child.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling === child) continue;
      // Radix renders each portal child in a wrapper; only the top surface's adjacent scrim stays active.
      if (
        sibling === child.previousElementSibling &&
        (sibling.matches('[data-tmt-ds-scrim]') || sibling.querySelector('[data-tmt-ds-scrim]'))
      )
        continue;
      if (!state.originalInert.has(sibling))
        state.originalInert.set(sibling, sibling.getAttribute('inert'));
      sibling.setAttribute('inert', '');
    }
    child = parent;
  }
}

/** The returned cleanup restores the prior state and can safely be called more than once. */
export function enterScopedModal(scope: HTMLElement, dialog: HTMLElement): () => void {
  if (!scope.contains(dialog)) throw new Error('Scoped modal must belong to its scope');
  let state = states.get(scope);
  if (!state) {
    state = {
      stack: [],
      originalInert: new Map(),
      overflow: scope.style.getPropertyValue('overflow'),
      overflowPriority: scope.style.getPropertyPriority('overflow'),
    };
    states.set(scope, state);
    scope.style.setProperty('overflow', 'hidden');
  }
  const owner = state;
  owner.stack.push(dialog);
  apply(scope, owner);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = owner.stack.lastIndexOf(dialog);
    if (index >= 0) owner.stack.splice(index, 1);
    apply(scope, owner);
    if (!owner.stack.length) {
      if (owner.overflow)
        scope.style.setProperty('overflow', owner.overflow, owner.overflowPriority);
      else scope.style.removeProperty('overflow');
      states.delete(scope);
    }
  };
}

/** Keep Tab inside the active modal only while keyboard focus is already in its scope. */
export function trapScopedTab(event: KeyboardEvent, dialog: HTMLElement) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const scope = dialog.closest<HTMLElement>('[data-tmt-ds-scope]');
  if (scope && states.get(scope)?.stack.at(-1) !== dialog) return;
  const nodes = [
    ...dialog.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (node) =>
      node.tabIndex >= 0 &&
      !node.matches(':disabled') &&
      !node.closest('[inert]') &&
      node.getClientRects().length > 0 &&
      node.ownerDocument.defaultView?.getComputedStyle(node).visibility !== 'hidden',
  );
  if (!nodes.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = dialog.ownerDocument.activeElement;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const index = nodes.findIndex((node) => node === active);
  if (event.shiftKey && index <= 0) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) {
    event.preventDefault();
    first.focus();
  }
}

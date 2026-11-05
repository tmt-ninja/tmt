import { browserMenuPosition } from './menu-position.js';

const activePopups = new WeakMap<Document | HTMLElement, () => void>();

/** Menu and combobox surfaces share one replacement owner, without owning host commands. */
export function claimBrowserPopup(
  document: Document | HTMLElement,
  dismiss: () => void,
): () => void {
  activePopups.get(document)?.();
  activePopups.set(document, dismiss);
  return () => {
    if (activePopups.get(document) === dismiss) activePopups.delete(document);
  };
}

/** One scope owns its popup and outside-pointer listener for the same lifetime. */
export function claimScopedBrowserPopup(
  anchor: HTMLElement,
  surface: HTMLElement,
  dismiss: () => void,
): { scope: HTMLElement | null; release(): void } {
  const scope = anchor.closest<HTMLElement>('[data-tmt-ds-scope]');
  const release = claimBrowserPopup(scope ?? anchor.ownerDocument, dismiss);
  const outside = (event: PointerEvent) => {
    if (
      event.target instanceof Node &&
      !surface.contains(event.target) &&
      !anchor.contains(event.target)
    )
      dismiss();
  };
  scope?.addEventListener('pointerdown', outside, true);
  return {
    scope,
    release() {
      scope?.removeEventListener('pointerdown', outside, true);
      release();
    },
  };
}

export function placeBrowserPopup(
  anchor: HTMLElement,
  surface: HTMLElement,
  dismiss: () => void,
  scope: HTMLElement | null = anchor.closest?.<HTMLElement>('[data-tmt-ds-scope]') ?? null,
): () => void {
  const view = anchor.ownerDocument.defaultView!;
  const viewport = view.visualViewport;
  const place = () => {
    if (!anchor.isConnected || !anchor.getClientRects().length) return dismiss();
    const scopeBox = scope?.getBoundingClientRect();
    const bounds =
      scope && scopeBox
        ? {
            left: scopeBox.left + scope.clientLeft,
            top: scopeBox.top + scope.clientTop,
            width: scope.clientWidth,
            height: scope.clientHeight,
          }
        : {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            width: viewport?.width ?? view.innerWidth,
            height: viewport?.height ?? view.innerHeight,
          };
    surface.style.maxWidth = `${Math.max(0, bounds.width - 16)}px`;
    const box = surface.getBoundingClientRect();
    const position = browserMenuPosition(
      anchor.getBoundingClientRect(),
      box.width,
      Math.max(box.height, surface.scrollHeight + surface.offsetHeight - surface.clientHeight),
      bounds,
    );
    Object.assign(surface.style, {
      left: `${position.left - (scopeBox?.left ?? 0)}px`,
      top: `${position.top - (scopeBox?.top ?? 0)}px`,
      maxHeight: `${position.maxHeight}px`,
    });
  };
  place();
  let frame: number | undefined;
  const observer = new ResizeObserver(() => {
    if (frame !== undefined) return;
    // Closing/repositioning in a resize callback mutates the observed boxes in
    // the same delivery cycle. Defer the write and coalesce notifications.
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      place();
    });
  });
  observer.observe(anchor);
  observer.observe(surface);
  if (scope) observer.observe(scope);
  view.addEventListener('resize', place);
  view.addEventListener('scroll', place, true);
  viewport?.addEventListener('resize', place);
  viewport?.addEventListener('scroll', place);
  return () => {
    observer.disconnect();
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    view.removeEventListener('resize', place);
    view.removeEventListener('scroll', place, true);
    viewport?.removeEventListener('resize', place);
    viewport?.removeEventListener('scroll', place);
  };
}

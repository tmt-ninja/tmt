import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from 'react';
import { assignRefs } from './utils.js';
import { enterScopedModal, trapScopedTab } from '../scoped-modal.js';
import { useDsScope } from './theme.js';

export type LayerCloseReason =
  | 'escape'
  | 'outside'
  | 'scrim'
  | 'close'
  | 'selection'
  | 'tab'
  | 'programmatic';
export interface LayerCloseRequest {
  reason: LayerCloseReason;
  originalEvent?: Event;
}
export interface LayerControllerOptions {
  open: boolean;
  onOpenChange(open: boolean): void;
  canClose?(request: LayerCloseRequest): boolean;
}
export interface LayerController {
  open: boolean;
  requestOpen(): void;
  requestClose(reason?: LayerCloseReason, originalEvent?: Event): boolean;
}

/** The open hosted layers, bottom to top. Radix keeps a layer on its stack until its exit has played,
 * so a leaving layer hands its Escape to the top open one here instead of swallowing it. */
const openLayers = new Map<HTMLElement | null, Set<Pick<LayerController, 'requestClose'>>>();
const layerOwner = new WeakMap<LayerController['requestClose'], HTMLElement | null>();

/** Host state remains authoritative. Raw open=false/unmount bypasses this admission. */
export function useLayerController(options: LayerControllerOptions): LayerController {
  const scope = useDsScope();
  const owner = scope?.root ?? null;
  const waitingForScope = !!scope && !scope.root;
  const current = useRef(options);
  const closing = useRef(false);
  if (current.current.open !== options.open) closing.current = false;
  current.current = options;
  const requestClose = useCallback(
    (reason: LayerCloseReason = 'programmatic', originalEvent?: Event) => {
      if (!current.current.open || closing.current) return false;
      if (current.current.canClose?.({ reason, originalEvent }) === false) return false;
      closing.current = true;
      try {
        current.current.onOpenChange(false);
      } catch (error) {
        closing.current = false;
        throw error;
      }
      return true;
    },
    [],
  );
  const requestOpen = useCallback(() => {
    if (!current.current.open) current.current.onOpenChange(true);
  }, []);
  layerOwner.set(requestClose, owner);
  useLayoutEffect(() => {
    if (!options.open || waitingForScope) return;
    const entry = { requestClose };
    let layers = openLayers.get(owner);
    if (!layers) openLayers.set(owner, (layers = new Set()));
    layers.add(entry);
    return () => {
      layers.delete(entry);
      if (!layers.size) openLayers.delete(owner);
    };
  }, [options.open, requestClose, owner, waitingForScope]);
  return { open: options.open, requestOpen, requestClose };
}

// This context only carries the nearest host's admission; Radix owns its layer stack.
export const LayerAdmission = createContext<LayerController | undefined>(undefined);
export function useLayerAdmission(): LayerController | undefined {
  return useContext(LayerAdmission);
}

export function useMenuLayerHandoff({
  menu,
  layer,
  trigger,
}: {
  menu: LayerController;
  layer: LayerController;
  trigger(): HTMLElement | null;
}) {
  const transferring = useRef(false);
  const returning = useRef(false);
  return {
    onSelect(event: Event) {
      // Radix's item default cannot bypass the host's admission or open twice.
      event.preventDefault();
      if (!menu.requestClose('selection', event)) return;
      transferring.current = true;
      returning.current = true;
      layer.requestOpen();
    },
    onCloseAutoFocus(event: Event) {
      if (!transferring.current) return;
      transferring.current = false;
      event.preventDefault();
    },
    returnFocus() {
      if (!returning.current) return null;
      returning.current = false;
      return trigger();
    },
  };
}

export interface LayerFocusOptions {
  initialFocus?(): HTMLElement | null;
  returnFocus?(): HTMLElement | null;
  focusFallback?(): HTMLElement | null;
}

/** Shared with Dialog/Sheet/Popover/Menu; never overrides a consumed Radix focus event. */
export function focusLayerTarget(target: HTMLElement | null | undefined): boolean {
  if (
    !target?.isConnected ||
    target === target.ownerDocument.body ||
    target === target.ownerDocument.documentElement ||
    !target.getClientRects().length ||
    target.closest('[inert]') ||
    target.matches(':disabled')
  )
    return false;
  target.focus({ preventScroll: true });
  return target.ownerDocument.activeElement === target;
}

export function useLayerFocus(options: LayerFocusOptions, titleEntry = false) {
  const origin = useRef<HTMLElement | null>(null);
  const surfaceNode = useRef<HTMLElement | null>(null);
  const captureOrigin = useCallback((surface: HTMLElement) => {
    surfaceNode.current = surface;
    const active = surface.ownerDocument.activeElement;
    // Ref replay must not replace a persistent origin with focus already inside.
    if (
      active instanceof HTMLElement &&
      active !== surface.ownerDocument.body &&
      active !== surface.ownerDocument.documentElement &&
      !surface.contains(active)
    )
      origin.current = active;
  }, []);
  return {
    captureOrigin,
    onOpenAutoFocus(event: Event) {
      if (event.defaultPrevented) return;
      const surface = event.currentTarget;
      if (!(surface instanceof HTMLElement)) return;
      captureOrigin(surface);
      const target =
        options.initialFocus?.() ??
        (titleEntry ? surface.querySelector<HTMLElement>('[data-layer-title]') : null);
      if (focusLayerTarget(target)) event.preventDefault();
    },
    onCloseAutoFocus(event: Event) {
      if (event.defaultPrevented) return;
      // A pointer-opened menu can have no focused opener. Leave its trigger return
      // to Radix unless the host supplied an explicit persistent target.
      if (!options.returnFocus && !origin.current) return;
      const fallback = options.focusFallback?.();
      // The fallback is for lost focus. A layer whose exit outlasts its parent's close (a nested
      // Popover leaving while its Dialog closes) finds focus already returned to the parent's
      // target, and leaves it there rather than taking it to the fallback.
      const surface = surfaceNode.current;
      const active = surface?.ownerDocument.activeElement;
      const placed =
        !!surface &&
        active instanceof HTMLElement &&
        active !== surface.ownerDocument.body &&
        active !== surface.ownerDocument.documentElement &&
        active !== fallback &&
        !surface.contains(active);
      if (
        focusLayerTarget(options.returnFocus?.() ?? origin.current) ||
        (!placed && focusLayerTarget(fallback)) ||
        placed
      )
        event.preventDefault();
      origin.current = null;
    },
  };
}

export function admitLayerDismiss(
  event: Event,
  controller: LayerController | undefined,
  reason: LayerCloseReason,
): void {
  if (event.defaultPrevented || !controller) return;
  // One host request handles both accepted and vetoed paths; no second Radix close.
  event.preventDefault();
  if (!controller.open) {
    // A leaving layer takes no dismissal: its Escape goes to the open layer under it at once.
    if (reason === 'escape') {
      const layers = openLayers.get(layerOwner.get(controller.requestClose) ?? null);
      if (layers) [...layers].at(-1)?.requestClose('escape', event);
    }
    return;
  }
  const detail: unknown = 'detail' in event ? event.detail : undefined;
  const original =
    typeof detail === 'object' &&
    detail !== null &&
    'originalEvent' in detail &&
    detail.originalEvent instanceof Event
      ? detail.originalEvent
      : event;
  controller.requestClose(reason, original);
}

/** Radix collision padding of every floating layer: the 2-unit gutter, so none touches the viewport edge. */
export const layerCollisionPadding = 8;

/** The event a host dispatches on the document after it changes the visible band (#6090). */
export const HOST_VIEWPORT_EVENT = 'tmt-ui-viewport';

/** The visible band a host publishes on the root, as `data-tmt-ui-viewport` with
 * `--tmt-ui-viewport-top` and `--tmt-ui-viewport-height` in pixels (see dialog.css), or none. */
function hostBand(document: Document): { top: number; height: number } | undefined {
  const root = document.documentElement;
  if (!root.hasAttribute('data-tmt-ui-viewport')) return undefined;
  const top = Number.parseFloat(root.style.getPropertyValue('--tmt-ui-viewport-top'));
  const height = Number.parseFloat(root.style.getPropertyValue('--tmt-ui-viewport-height'));
  return Number.isFinite(top) && Number.isFinite(height) ? { top, height } : undefined;
}

/** Observe only a mounted Radix surface. Geometry uses the viewport, or the host's visible band
 * for a page-level layer, and styling uses tokens. */
export function observeLayerViewport(
  node: HTMLElement,
  update: (style: CSSProperties) => void,
): () => void {
  const view = node.ownerDocument.defaultView;
  if (!view) return () => {};
  const viewport = view.visualViewport;
  const scope = node.closest?.<HTMLElement>('[data-tmt-ds-scope]');
  const measure = () => {
    const spacing = Number.parseFloat(
      view.getComputedStyle(node).getPropertyValue('--tmt-foundation-spacing-unit'),
    );
    const gutter = Number.isFinite(spacing) ? spacing * 2 : 0;
    const band = scope ? undefined : hostBand(node.ownerDocument);
    const left = scope ? 0 : (viewport?.offsetLeft ?? 0);
    const top = scope ? 0 : (band?.top ?? viewport?.offsetTop ?? 0);
    const width = scope?.clientWidth ?? viewport?.width ?? view.innerWidth;
    const height = scope?.clientHeight ?? band?.height ?? viewport?.height ?? view.innerHeight;
    update({
      '--tmt-layer-left': `${left}px`,
      '--tmt-layer-top': `${top}px`,
      '--tmt-layer-width': `${Math.max(0, width)}px`,
      '--tmt-layer-height': `${Math.max(0, height)}px`,
      '--tmt-layer-available-width': `${Math.max(0, width - gutter * 2)}px`,
      '--tmt-layer-available-height': `${Math.max(0, height - gutter * 2)}px`,
      '--tmt-layer-gutter': `${gutter}px`,
    } as CSSProperties);
  };
  const observer = scope && view.ResizeObserver ? new view.ResizeObserver(measure) : undefined;
  if (scope) observer?.observe(scope);
  measure();
  view.addEventListener('resize', measure);
  view.addEventListener('scroll', measure, { capture: true });
  viewport?.addEventListener('resize', measure);
  viewport?.addEventListener('scroll', measure);
  node.ownerDocument.addEventListener(HOST_VIEWPORT_EVENT, measure);
  return () => {
    observer?.disconnect();
    node.ownerDocument.removeEventListener(HOST_VIEWPORT_EVENT, measure);
    view.removeEventListener('resize', measure);
    view.removeEventListener('scroll', measure, { capture: true });
    viewport?.removeEventListener('resize', measure);
    viewport?.removeEventListener('scroll', measure);
  };
}

export function useLayerSurface(
  forwardedRef?: Ref<HTMLDivElement>,
  onMount?: (node: HTMLElement) => void,
) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [viewportStyle, setViewportStyle] = useState<CSSProperties>({});
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) onMount?.(element);
      return assignRefs(element, setNode, forwardedRef);
    },
    [forwardedRef, onMount],
  );
  useLayoutEffect(() => (node ? observeLayerViewport(node, setViewportStyle) : undefined), [node]);
  return { ref, viewportStyle };
}

/** Bind a non-modal Radix surface to its nearest scope's local modal owner. */
export function useScopedLayer(forwardedRef: Ref<HTMLDivElement>) {
  const scope = useDsScope();
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      assignRefs(element, setNode, forwardedRef);
    },
    [forwardedRef],
  );
  useLayoutEffect(() => {
    if (scope?.root && node) return enterScopedModal(scope.root, node);
  }, [scope?.root, node]);
  return {
    ref,
    scope,
    onKeyDown(event: KeyboardEvent) {
      if (scope && node) trapScopedTab(event, node);
    },
    outsideScope(target: EventTarget | null) {
      return !!scope?.root && target instanceof Node && !scope.root.contains(target);
    },
  };
}

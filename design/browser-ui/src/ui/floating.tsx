import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { X } from 'lucide-react';
import { admitsOverlayEscape, restoreOverlayFocus } from '../overlay.js';
import { Button } from './button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.js';
import { cn } from './utils.js';

/**
 * The floating dock (#5821): a page's floating actions at the bottom end, and the one window an
 * action opens above them. The dock places both; the window sizes to its content up to the space
 * between `top` (the host's bar) and the actions. Under the compact width (760px, the header's) the
 * window spans the viewport between the gutters.
 */
export function FloatingDock({
  top = 0,
  className,
  style,
  children,
  ...props
}: ComponentProps<'div'> & {
  /** The host's top bar height in px, which the window stays below. */ top?: number;
}) {
  return (
    <div
      data-slot="floating-dock"
      className={cn(
        'tmt:pointer-events-none tmt:fixed tmt:right-(--tmt-foundation-floating-gutter) tmt:bottom-(--tmt-foundation-floating-gutter) tmt:z-(--tmt-foundation-z-floating) tmt:flex tmt:flex-col tmt:items-end tmt:gap-3 tmt:max-[760px]:left-(--tmt-foundation-floating-gutter) tmt:[&>*]:pointer-events-auto',
        className,
      )}
      style={{ '--tmt-floating-top': `${top}px`, ...style } as React.CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}

/** The capsule of floating actions: one surface, every action the same token-sized target. */
export function FloatingActions({
  label,
  className,
  ...props
}: ComponentProps<'div'> & { label: string }) {
  return (
    <div
      data-slot="floating-actions"
      role="toolbar"
      aria-label={label}
      className={cn(
        'tmt:box-border tmt:flex tmt:items-stretch tmt:gap-1 tmt:rounded-pill tmt:border-solid tmt:border-(length:--tmt-foundation-rule-width) tmt:border-layer-boundary tmt:bg-popover tmt:p-1 tmt:text-popover-foreground tmt:shadow-overlay',
        className,
      )}
      {...props}
    />
  );
}

/**
 * One floating action. An action that opens a window passes `expanded` (and the window's id as
 * `controls`); it reads as pressed while its window is open. `count` follows the icon; `attention`
 * adds the waiting dot, and the host names it in `label` (for example "Chat · Unread").
 */
export function FloatingAction({
  label,
  icon,
  count,
  attention = false,
  expanded,
  controls,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & {
  label: string;
  icon: ReactNode;
  count?: number;
  attention?: boolean;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={expanded ? controls : undefined}
          data-slot="floating-action"
          data-expanded={expanded || undefined}
          className={cn(
            'tmt:relative tmt:h-(--tmt-foundation-floating-action-size) tmt:min-w-(--tmt-foundation-floating-action-size) tmt:rounded-pill tmt:px-2.5 tmt:data-[expanded]:bg-accent tmt:data-[expanded]:text-accent-foreground',
            className,
          )}
          {...props}
        >
          {icon}
          {count !== undefined && (
            <span className="tmt:font-mono tmt:text-(length:--tmt-foundation-caption-size) tmt:tabular-nums">
              {count}
            </span>
          )}
          {attention && (
            <span
              aria-hidden="true"
              data-slot="attention-dot"
              className="tmt:absolute tmt:top-1.5 tmt:right-1.5 tmt:size-(--tmt-foundation-attention-dot-size) tmt:rounded-pill tmt:bg-waiting tmt:outline-solid tmt:outline-(length:--tmt-foundation-attention-dot-ring-width) tmt:outline-popover"
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export type FloatingWindowCloseReason = 'escape' | 'close';

/**
 * The window a floating action opens: non-modal, named by `label`, sized to its content up to the
 * space above the actions. Esc and the Close action share one path, `onClose`. A nested layer (menu,
 * select, tooltip) consumes its own Esc first, and a composing or modified Esc never closes it
 * (admitsOverlayEscape). On close, focus returns to what opened it, else to `returnFocus`. Key the
 * window by the action that opened it, so switching windows remembers the new opener.
 */
export function FloatingWindow({
  open,
  label,
  header,
  footer,
  children,
  closeLabel = 'Close (Esc)',
  onClose,
  returnFocus,
  className,
  ...props
}: Omit<ComponentProps<'section'>, 'children' | 'onKeyDown'> & {
  open: boolean;
  label: string;
  /** Controls before Close, in order; Close is always last and inside the header's end padding. */
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  closeLabel?: string;
  onClose(reason: FloatingWindowCloseReason, event: SyntheticEvent): void;
  returnFocus?(): HTMLElement | null;
}) {
  const surface = useRef<HTMLElement>(null);
  const fallback = useRef(returnFocus);
  fallback.current = returnFocus;
  useLayoutEffect(() => {
    const node = surface.current;
    if (!open || !node) return;
    const document = node.ownerDocument;
    const origin = document.activeElement;
    node.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      // A non-modal window does not take back focus the user already moved into the page.
      if (!active || active === document.body || node.contains(active))
        restoreOverlayFocus(origin, fallback.current);
    };
  }, [open]);
  if (!open) return null;
  return (
    <section
      {...props}
      ref={surface}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      data-slot="floating-window"
      className={cn(
        'tmt:box-border tmt:flex tmt:w-(--tmt-foundation-dock-width) tmt:max-w-full tmt:max-h-[calc(100dvh-var(--tmt-floating-top)-var(--tmt-foundation-floating-action-size)-var(--tmt-foundation-floating-gutter)*2-var(--tmt-foundation-spacing-unit)*5)] tmt:flex-col tmt:overflow-hidden tmt:rounded-surface tmt:border-solid tmt:border-(length:--tmt-foundation-rule-width) tmt:border-layer-boundary tmt:bg-popover tmt:font-body tmt:text-popover-foreground tmt:shadow-overlay tmt:outline-none tmt:max-[760px]:w-full tmt:origin-bottom-right tmt:animate-rise-in',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !admitsOverlayEscape(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onClose('escape', event);
      }}
    >
      <header
        data-slot="floating-window-header"
        className="tmt:box-border tmt:flex tmt:h-(--tmt-foundation-floating-header-height) tmt:flex-none tmt:items-center tmt:gap-0.5 tmt:border-b tmt:border-solid tmt:border-(length:--tmt-foundation-rule-width) tmt:border-border tmt:px-2 tmt:whitespace-nowrap"
      >
        <div className="tmt:flex tmt:min-w-0 tmt:flex-1 tmt:items-center tmt:gap-0.5">{header}</div>
        <FloatingWindowAction
          label={closeLabel}
          icon={<X />}
          onClick={(event) => onClose('close', event)}
        />
      </header>
      <div
        data-slot="floating-window-body"
        className="tmt:min-h-0 tmt:flex-1 tmt:overflow-auto tmt:p-4"
      >
        {children}
      </div>
      {footer && (
        <footer
          data-slot="floating-window-footer"
          className="tmt:flex-none tmt:border-t tmt:border-solid tmt:border-(length:--tmt-foundation-rule-width) tmt:border-border tmt:px-4 tmt:py-3"
        >
          {footer}
        </footer>
      )}
    </section>
  );
}

/** A header icon action with its tooltip, sized to sit inside the window header. */
export function FloatingWindowAction({
  label,
  icon,
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { label: string; icon: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          data-slot="floating-window-action"
          className={cn('tmt:size-(--tmt-foundation-floating-header-control)', className)}
          {...props}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

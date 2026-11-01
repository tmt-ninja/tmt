// Adapted from pinned shadcn/ui (MIT); see LICENSE.shadcn and provenance.json.
'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from './utils.js';

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        'tmt:font-body tmt:group/tabs tmt:flex tmt:gap-2 tmt:data-[orientation=horizontal]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'tmt:[border-radius:var(--tmt-foundation-radius)] tmt:group/tabs-list tmt:inline-flex tmt:w-fit tmt:items-center tmt:justify-center tmt:p-1 tmt:text-muted-foreground tmt:group-data-[orientation=horizontal]/tabs:h-9 tmt:group-data-[orientation=vertical]/tabs:h-fit tmt:group-data-[orientation=vertical]/tabs:flex-col',
  {
    variants: {
      variant: {
        default: 'tmt:bg-muted',
        line: 'tmt:relative tmt:gap-1 tmt:bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function TabsList({
  className,
  variant = 'default',
  children,
  ref,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const list = React.useRef<HTMLDivElement | null>(null);
  const [bar, setBar] = React.useState<{ style: React.CSSProperties; moved: boolean } | null>(null);
  // Line tabs (#5821): one underline that slides to the selected tab instead of jumping. It follows
  // the active trigger's box; the motion tokens time it, so reduced motion makes it jump.
  React.useLayoutEffect(() => {
    const node = list.current;
    if (variant !== 'line' || !node) return;
    const place = () => {
      const active = node.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      setBar((previous) => {
        if (!active) return null;
        const style: React.CSSProperties =
          node.dataset.orientation === 'vertical'
            ? { right: 0, height: active.offsetHeight, translate: `0 ${active.offsetTop}px` }
            : { bottom: 0, width: active.offsetWidth, translate: `${active.offsetLeft}px 0` };
        return { style, moved: previous !== null };
      });
    };
    place();
    const states = new MutationObserver(place);
    states.observe(node, { attributes: true, attributeFilter: ['data-state'], subtree: true });
    const sizes = new ResizeObserver(place);
    sizes.observe(node);
    return () => {
      states.disconnect();
      sizes.disconnect();
    };
  }, [variant]);
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      ref={(node) => {
        list.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
      {bar && (
        <span
          aria-hidden="true"
          data-slot="tabs-indicator"
          className={cn(
            'tmt:pointer-events-none tmt:absolute tmt:top-auto tmt:left-0 tmt:bg-primary tmt:h-(--tmt-foundation-focus-width) tmt:group-data-[orientation=vertical]/tabs:top-0 tmt:group-data-[orientation=vertical]/tabs:left-auto tmt:group-data-[orientation=vertical]/tabs:h-auto tmt:group-data-[orientation=vertical]/tabs:w-(--tmt-foundation-focus-width)',
            bar.moved &&
              'tmt:transition-[translate,width,height] tmt:duration-(--tmt-foundation-motion-base) tmt:ease-(--tmt-foundation-motion-ease-out)',
          )}
          style={bar.style}
        />
      )}
    </TabsPrimitive.List>
  );
}
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "tmt:bg-transparent tmt:appearance-none tmt:[border-radius:var(--tmt-foundation-radius)] tmt:font-body tmt:m-0 tmt:box-border tmt:relative tmt:inline-flex tmt:h-[calc(100%-var(--tmt-foundation-rule-width))] tmt:flex-1 tmt:items-center tmt:justify-center tmt:gap-1.5 tmt:border-solid tmt:border-(length:--tmt-foundation-rule-width) tmt:border-transparent tmt:px-2 tmt:py-1 tmt:text-(length:--tmt-foundation-command-size) tmt:font-(weight:--tmt-foundation-eyebrow-weight) tmt:whitespace-nowrap tmt:text-foreground tmt:group-data-[orientation=vertical]/tabs:w-full tmt:group-data-[orientation=vertical]/tabs:justify-start tmt:hover:text-foreground tmt:focus-visible:border-ring tmt:focus-visible:outline-none tmt:disabled:pointer-events-none tmt:disabled:opacity-50 tmt:[&_svg]:pointer-events-none tmt:[&_svg]:shrink-0 tmt:[&_svg:not([class*='size-'])]:size-4",
        'tmt:group-data-[variant=line]/tabs-list:bg-transparent tmt:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent',
        'tmt:data-[state=active]:bg-background tmt:data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('tmt:flex-1', className)}
      {...props}
    />
  );
}

/**
 * A tabs row with trailing actions (#5821 A5a): the tab list on the left, the actions pinned at the
 * right end, `space-l` apart. When the tabs do not fit they scroll sideways with a fade at the edge
 * that hides more, and the selected tab is kept in view. The scroller contains its inline size, so
 * the tabs never widen the row or the page around it.
 */
function TabsBar({
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { actions?: React.ReactNode }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [fade, setFade] = React.useState({ start: false, end: false });
  React.useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => {
      const end = node.scrollWidth - node.clientWidth - node.scrollLeft;
      setFade({ start: node.scrollLeft > 1, end: end > 1 });
    };
    const reveal = () => {
      const active = node.querySelector<HTMLElement>(
        '[data-slot="tabs-trigger"][data-state="active"]',
      );
      if (active) {
        const box = active.getBoundingClientRect();
        const left = box.left - node.getBoundingClientRect().left + node.scrollLeft;
        const right = left + box.width;
        if (left < node.scrollLeft) node.scrollLeft = left;
        else if (right > node.scrollLeft + node.clientWidth)
          node.scrollLeft = right - node.clientWidth;
      }
      measure();
    };
    reveal();
    node.addEventListener('scroll', measure, { passive: true });
    const states = new MutationObserver(reveal);
    states.observe(node, { attributes: true, attributeFilter: ['data-state'], subtree: true });
    const sizes = new ResizeObserver(reveal);
    sizes.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      states.disconnect();
      sizes.disconnect();
    };
  }, []);
  return (
    <div
      data-slot="tabs-bar"
      className={cn('tmt:flex tmt:min-w-0 tmt:items-center tmt:gap-4', className)}
      {...props}
    >
      <div
        ref={scroller}
        data-slot="tabs-bar-scroller"
        data-fade-start={fade.start || undefined}
        data-fade-end={fade.end || undefined}
        className="tmt:relative tmt:min-w-0 tmt:flex-1 tmt:[contain:inline-size] tmt:overflow-x-auto tmt:[scrollbar-width:none] tmt:data-[fade-end]:[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] tmt:data-[fade-start]:[mask-image:linear-gradient(to_right,transparent,black_32px)] tmt:data-[fade-start]:data-[fade-end]:[mask-image:linear-gradient(to_right,transparent,black_32px,black_calc(100%-32px),transparent)]"
      >
        {children}
      </div>
      {actions && (
        <div
          data-slot="tabs-bar-actions"
          className="tmt:flex tmt:flex-none tmt:items-center tmt:gap-2"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

export { Tabs, TabsBar, TabsList, TabsTrigger, TabsContent, tabsListVariants };

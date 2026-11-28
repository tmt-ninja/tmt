import { useEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { createSeriesChart } from './chart-series.js';
import type { SeriesChartOptions } from './chart-series-model.js';
import { browserUiClasses as c } from './static.js';

/** An editorial surface for authored long-form content. */
export function BrowserEditorial({ children, ...props }: ComponentProps<'article'>) {
  return (
    <article {...props} className="tmt-ui-prose">
      {children}
    </article>
  );
}

/** Text retained for assistive technology while visually hidden. */
export function BrowserVisuallyHidden({ children }: { children?: ReactNode }) {
  return <span className={c.visuallyHidden}>{children}</span>;
}

/** A shared card with a labelled read-only meter. */
export function BrowserCardMeter({
  heading,
  value,
  children,
}: {
  heading: string;
  value: number;
  children?: ReactNode;
}) {
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <section className={c.card}>
      <div className={c.cardHead}>
        <h3 className={c.cardTitle}>{heading}</h3>
      </div>
      <div
        className={c.meter}
        role="meter"
        aria-label={heading}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
      >
        <div className={c.meterFill} style={{ '--tmt-ui-meter-fill': bounded } as CSSProperties} />
      </div>
      {children}
    </section>
  );
}

export type BrowserSegmentState = 'done' | 'working' | 'waiting' | 'blocked' | 'todo';

/** One segment per part in order, each drawn by its state; `label` names the whole, such as
 * "4 of 9 sections done" (#6619). Without a label the segments are decorative beside a written
 * count. `size="s"` is the small size for a list row (#6953). */
export function BrowserSegments({
  label,
  states,
  size,
}: {
  label?: string;
  states: readonly BrowserSegmentState[];
  size?: 's';
}) {
  return (
    <span
      className="tmt-ui-segments"
      data-size={size}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {states.map((state, index) => (
        <span key={index} data-state={state} />
      ))}
    </span>
  );
}

/** A page overview heading followed by caller-owned facts. */
export function BrowserOverview({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section>
      <header className={c.pageHead}>
        <h2 className={c.pageTitle}>{heading}</h2>
        {description !== undefined && <p className={c.pageSubtitle}>{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** The shared chart painter with a React-owned observer lifetime. */
export function BrowserChart({ options }: { options: SeriesChartOptions }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dispose = () => {};
    const chart = createSeriesChart(options, (cleanup) => {
      dispose = cleanup;
    });
    host.current?.replaceChildren(chart);
    return () => {
      dispose();
      chart.remove();
    };
  }, [options]);
  return <div ref={host} />;
}

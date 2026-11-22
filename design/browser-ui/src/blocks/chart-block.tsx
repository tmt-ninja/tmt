import { useMemo, type CSSProperties } from 'react';
import { compactCount } from '../chart-math.js';
import type { SeriesChartOptions } from '../chart-series-model.js';
import { BrowserChart } from '../design-components.js';
import { browserUiClasses as c } from '../static.js';

/** The chart kinds a page's chart block draws (#6746). */
export type ChartBlockKind = 'bar' | 'stacked-bar' | 'meter';

export interface ChartBlockSeries {
  name: string;
  /** One value per category; `null` is no value: no bar is drawn, and it never reads as zero. */
  values: readonly (number | null)[];
}

export interface ChartBlockProps {
  kind: ChartBlockKind;
  title: string;
  categories: readonly string[];
  series: readonly ChartBlockSeries[];
  /** The top of the axis, or a meter's whole (100 when absent), in the values' own units. */
  max?: number;
  /** Values are whole numbers; one is shown divided by 10 to this power (0 to 3): 625 at 1 is
   * 62.5. */
  decimals?: number;
}

/** A stored whole number as shown: divided by 10^`decimals` with that many places, and 1K and up
 * compact as the chart's counts are. */
export function chartBlockValue(value: number, decimals = 0): string {
  const shown = value / 10 ** decimals;
  return Math.abs(shown) >= 1000 ? compactCount(shown) : shown.toFixed(decimals);
}

const SERIES_KIND = { bar: 'bars', 'stacked-bar': 'stacked-bars' } as const;

/**
 * A chart drawn from data alone: the shared series chart for bars or stacked bars, and one
 * labelled meter per category for a meter. A bar writes its value and a meter its percent.
 */
export function ChartBlock(props: ChartBlockProps) {
  const { kind, title, categories, series, max, decimals = 0 } = props;
  // The chart repaints only when its data changes, never on a host's unrelated render.
  const data = JSON.stringify(props);
  const options = useMemo(
    (): SeriesChartOptions | undefined =>
      kind === 'meter'
        ? undefined
        : {
            title,
            kind: SERIES_KIND[kind],
            // A page's categories are names: each is drawn when they fit, on round steps.
            axis: 'categories',
            x: categories,
            series: series.map((layer, at) => ({
              key: `s${at}`,
              label: layer.name,
              values: layer.values,
            })),
            format: (value: number) => chartBlockValue(value, decimals),
            ...(kind === 'bar' ? { labels: true } : {}),
            ...(max === undefined ? {} : { max }),
          },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  if (!options)
    return (
      <ChartMeters
        title={title}
        categories={categories}
        series={series}
        max={max}
        decimals={decimals}
      />
    );
  return (
    <div className="tmt-ui-chart-block">
      <BrowserChart options={options} />
    </div>
  );
}

/** A meter's row reads `<category>` beside `<series name> <percent>`, such as "Codex · Left 55%". */
function ChartMeters({
  title,
  categories,
  series,
  max = 100,
  decimals = 0,
}: Omit<ChartBlockProps, 'kind'>) {
  const layer = series[0];
  return (
    <figure className="tmt-ui-chart tmt-ui-chart-block" role="group" aria-label={title}>
      <figcaption className="tmt-ui-chart-title">{title}</figcaption>
      <ul className="tmt-ui-chart-block-meters">
        {categories.map((category, at) => {
          const value = layer?.values[at];
          const percent =
            value == null || !(max > 0) ? null : Math.max(0, Math.min(100, (value / max) * 100));
          // The percent keeps the values' places: 625 of 1000 at one place is 62.5%.
          const text = percent === null ? '—' : `${percent.toFixed(decimals)}%`;
          return (
            <li key={at} className="tmt-ui-chart-block-meter">
              <span className="tmt-ui-chart-block-meter-label">{category}</span>
              <span className="tmt-ui-chart-block-meter-value">
                {layer ? `${layer.name} ${text}` : text}
              </span>
              <div
                className={c.meter}
                role="meter"
                aria-label={layer ? `${category}: ${layer.name}` : category}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? 0}
                aria-valuetext={text}
              >
                <div
                  className={c.meterFill}
                  style={{ '--tmt-ui-meter-fill': percent ?? 0 } as CSSProperties}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

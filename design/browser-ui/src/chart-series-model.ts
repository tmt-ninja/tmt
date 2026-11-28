import {
  areaPath,
  compactCount,
  type Layer,
  linePath,
  monotonePath,
  fixedScale,
  niceMax,
  niceScale,
  stackLayers,
  ticks,
} from './chart-math.js';

export interface SeriesChartOptions {
  /** The chart's name: the figure caption, the plot's label and the data table's caption. */
  title: string;
  /**
   * `stack`: layers stacked in tokens; `share`: stacked to 100 % of each column; `bars`: one
   * series as columns; `stacked-bars`: the series stacked in each column; `line`: each series as
   * a line (a missing observation breaks the line).
   */
  kind: 'stack' | 'share' | 'bars' | 'stacked-bars' | 'line';
  /** Each bar's value written above it, where the column is wide enough. */
  labels?: boolean;
  /**
   * How the x axis reads. `time` (the default): a time series, labelled at its first, middle and
   * last positions, its axis topped at a nice number in four steps, and bars up to 24px.
   * `categories` (a page's chart block, #6746): the x values are names, so every one is drawn
   * when they fit their columns, else every second, third and so on, each kept inside the plot;
   * the axis steps are round (1, 2 or 5 × 10^k); and a bar takes about 60 % of its band up to 64px.
   */
  axis?: 'time' | 'categories';
  /** Shape-preserving interpolation through observed positions; default is linear. */
  curve?: 'monotone';
  /** One label per x position, oldest first (which are drawn: `axis`). */
  x: readonly string[];
  series: readonly Layer[];
  format?: (value: number) => string;
  /** A vertical mark at an x index: a window reset, now. */
  guides?: readonly { at: number; label: string }[];
  /** A dashed line over the same x positions: an even pace, a moving average. */
  reference?: { label: string; values: readonly (number | null)[] };
  /** A fixed top of the y axis (100 for a percent line); default is a readable step above data. */
  max?: number;
  /** Plot height in px. */
  height?: number;
  /** The hue step of the first series (0 to 6), so a provider keeps its colour across views. */
  style?: number;
  /** Shown instead of the plot when no series has an observation. */
  empty?: string;
}

/** Hue steps a chart uses, in order; the neutral step after them is the folded `other` layer. */
export const PALETTE = 7;
const OTHER_STYLE = PALETTE;
const styleOf = (layer: { key: string }, i: number, first = 0) =>
  layer.key === 'other' ? OTHER_STYLE : (first + i) % PALETTE;
const MARGIN = { left: 46, right: 10, top: 12, bottom: 22 };
/** A mono tick label of 11px is about 7px a character; it sits 6px left of its line and keeps an
 * 8px inset from the plot's edge. */
const TICK_CHARACTER = 7;
/** The least room between two x labels. */
const LABEL_GAP = 4;
const TICK_GAP = 6;
const TICK_INSET = 8;
const round = (value: number) => Math.round(value * 100) / 100;
/** A label's width in px at the 11px tick type: a wide (CJK) character is about 11px. */
const labelWidth = (label: string) =>
  [...label].reduce(
    (width, char) => width + (char.codePointAt(0)! >= 0x2e80 ? 11 : TICK_CHARACTER),
    0,
  );

type XLabel = SeriesModel['xLabels'][number];
/** The x labels as drawn, each centred under its column: each kept inside the plot, and one that
 * would touch the label before it left out, so a label never runs off the chart or into another;
 * the last column's stays (#6746). */
function xLabels(
  wanted: readonly { x: number; text: string; last: boolean }[],
  plot: { left: number; right: number },
): XLabel[] {
  const span = ({ x, text }: XLabel) => [x - labelWidth(text) / 2, x + labelWidth(text) / 2];
  const kept: XLabel[] = [];
  for (const { last, text, x } of wanted) {
    const w = labelWidth(text);
    const drawn: XLabel = {
      x: round(Math.min(plot.right - w / 2, Math.max(plot.left + w / 2, x))),
      text,
      anchor: 'middle',
    };
    const touches = () => {
      const before = kept.at(-1);
      return !!before && span(drawn)[0]! < span(before)[1]! + LABEL_GAP;
    };
    // The last column's label names where the series ends: it takes the place of those before it,
    // never of the first.
    if (last) while (kept.length > 1 && touches()) kept.pop();
    if (!touches()) kept.push(drawn);
  }
  return kept;
}

export interface SeriesMark {
  kind: 'area' | 'bar' | 'line';
  /** The palette step (`tmt-ui-chart-s<style>`). */
  style: number;
  d?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface SeriesModel {
  width: number;
  height: number;
  grid: { y: number; x1: number; x2: number; label: string }[];
  xLabels: { x: number; text: string; anchor: 'start' | 'middle' | 'end' }[];
  marks: SeriesMark[];
  /** Values written above bars (`labels`), centred on their column. */
  labels: { x: number; y: number; text: string }[];
  reference?: string;
  guides: { x: number; top: number; bottom: number; label: string; anchor: 'start' | 'end' }[];
  /** The x position of every column, for the cursor. */
  xs: number[];
  top: number;
  bottom: number;
  /** Distance between columns, and where the first one sits, to map a pointer to a column. */
  step: number;
  left: number;
  /** One value text per series at a column (`—` for a missing observation). */
  values: (at: number) => string[];
  readout: (at: number) => string;
  legend: { label: string; style: number }[];
  /** What the hover tip shows at a column: the x label and one row per series. */
  tip: (at: number) => { title: string; rows: { label: string; value: string; style: number }[] };
  table: { columns: string[]; rows: string[][] };
}

/** Everything a series chart paints, as plain data: the painter only maps it to elements. */
export function seriesModel(options: SeriesChartOptions, width: number): SeriesModel {
  const columns = options.x.length;
  const share = options.kind === 'share';
  const format = share ? (v: number) => `${Math.round(v)}%` : (options.format ?? compactCount);
  const stacked = options.kind === 'stacked-bars';
  const stack =
    options.kind === 'stack' || share || stacked
      ? stackLayers(options.series, { share })
      : undefined;
  const dataMax = stack
    ? stack.max
    : Math.max(
        0,
        ...options.series.flatMap((layer) => layer.values.map((v) => v ?? 0)),
        ...(options.reference?.values.map((v) => v ?? 0) ?? []),
      );
  const categories = options.axis === 'categories';
  const scale = !categories
    ? { max: options.max ?? (share ? 100 : niceMax(dataMax)), count: 4 }
    : options.max !== undefined || share
      ? fixedScale(options.max ?? 100)
      : niceScale(dataMax);
  const max = scale.max;
  const height = options.height ?? 200;
  const tickValues = ticks(max, scale.count);
  const tickLabels = tickValues.map(format);
  const left = Math.max(
    MARGIN.left,
    Math.max(...tickLabels.map((label) => label.length)) * TICK_CHARACTER + TICK_GAP + TICK_INSET,
  );
  const inner = {
    left,
    right: Math.max(left + 1, width - MARGIN.right),
    top: MARGIN.top,
    bottom: height - MARGIN.bottom,
  };
  // Bars sit in equal bands, so the first and last stay inside the plot, clear of the tick labels.
  const banded = options.kind === 'bars' || stacked;
  const step = banded
    ? (inner.right - inner.left) / Math.max(1, columns)
    : columns > 1
      ? (inner.right - inner.left) / (columns - 1)
      : 0;
  const xAt = (i: number) =>
    banded
      ? inner.left + (i + 0.5) * step
      : columns > 1
        ? inner.left + i * step
        : (inner.left + inner.right) / 2;
  const yAt = (v: number) => inner.bottom - (Math.min(v, max) / max) * (inner.bottom - inner.top);
  const xs = options.x.map((_, i) => xAt(i));
  const marks: SeriesMark[] = [];
  const labels: SeriesModel['labels'] = [];
  // A time series' bar is up to 24px. A category's takes about 60 % of its band up to 64px, never
  // thinner than that, so a few wide bands do not read as a row of sticks.
  const column = Math.min(24, step - 2);
  const bar = Math.max(1, categories ? Math.min(64, Math.max(step * 0.6, column)) : column);
  if (stacked) {
    stack!.layers.forEach((layer, i) =>
      layer.upper.forEach((top, at) => {
        if (layer.missing[at] || top <= layer.lower[at]!) return;
        const y = yAt(top);
        marks.push({
          kind: 'bar',
          style: styleOf(layer, i, options.style),
          rect: { x: xAt(at) - bar / 2, y, width: bar, height: yAt(layer.lower[at]!) - y },
        });
      }),
    );
  } else if (stack) {
    stack.layers.forEach((layer, i) =>
      marks.push({
        kind: 'area',
        style: styleOf(layer, i, options.style),
        d: areaPath(xs, layer.upper.map(yAt), layer.lower.map(yAt), options.curve),
      }),
    );
  } else if (options.kind === 'bars') {
    options.series[0]!.values.forEach((v, i) => {
      if (v == null) return;
      const y = yAt(v);
      marks.push({
        kind: 'bar',
        style: 0,
        rect: { x: xAt(i) - bar / 2, y, width: bar, height: Math.max(0, inner.bottom - y) },
      });
      const text = format(v);
      // A value wider than its column would run into the next one: it is left to the tip.
      if (options.labels && text.length * TICK_CHARACTER <= step - 2)
        labels.push({ x: xAt(i), y: y - 4, text });
    });
  } else {
    options.series.forEach((layer, i) => {
      let run: [number, number][] = [];
      const flush = () => {
        if (run.length)
          marks.push({
            kind: 'line',
            style: styleOf(layer, i, options.style),
            d: options.curve ? monotonePath(run) : linePath(run),
          });
        run = [];
      };
      layer.values.forEach((v, at) => {
        if (v == null) flush();
        else run.push([xAt(at), yAt(v)]);
      });
      flush();
    });
  }
  const run: [number, number][] = [];
  options.reference?.values.forEach((v, at) => {
    if (v != null) run.push([xAt(at), yAt(v)]);
  });
  const totals = options.x.map((_, at) =>
    options.series.reduce((sum, layer) => sum + (layer.values[at] ?? 0), 0),
  );
  const cell = (layer: Layer, at: number) => {
    const v = layer.values[at];
    if (v == null) return '—';
    // In share mode a column reads as the part of its own total, never as the raw count.
    return share ? format(totals[at] ? (v / totals[at]!) * 100 : 0) : format(v);
  };
  const widest = Math.max(0, ...options.x.map(labelWidth));
  const labelEvery =
    columns > 1 && step > 0
      ? Math.max(1, Math.ceil((widest + LABEL_GAP) / step))
      : Math.max(1, columns);
  const edge = (at: number): 'start' | 'middle' | 'end' =>
    columns > 1 && at === 0 ? 'start' : columns > 1 && at === columns - 1 ? 'end' : 'middle';
  return {
    width,
    height,
    grid: tickValues.map((tick, at) => ({
      y: yAt(tick),
      x1: inner.left,
      x2: inner.right,
      label: tickLabels[at]!,
    })),
    // Categories: every column is named when every name fits its column; else every second, third
    // and so on. A time series: its first, middle and last positions.
    xLabels: categories
      ? xLabels(
          options.x
            .map((_, at) => at)
            .filter((at) => at % labelEvery === 0)
            .map((at) => ({ x: xAt(at), text: options.x[at]!, last: at === columns - 1 })),
          inner,
        )
      : [...new Set([0, Math.floor((columns - 1) / 2), columns - 1])].map((at) => ({
          x: xAt(at),
          text: options.x[at]!,
          anchor: edge(at),
        })),
    marks,
    labels,
    reference: run.length > 1 ? linePath(run) : undefined,
    guides: (options.guides ?? []).map((guide) => ({
      x: xAt(guide.at),
      // A label at the far edge sits to the left of its line so it is never clipped.
      anchor: xAt(guide.at) > inner.right - 60 ? ('end' as const) : ('start' as const),
      top: inner.top,
      bottom: inner.bottom,
      label: guide.label,
    })),
    xs,
    top: inner.top,
    bottom: inner.bottom,
    step,
    // Where the first column sits: a pointer maps to the nearest column from here.
    left: xAt(0),
    values: (at) => options.series.map((layer) => cell(layer, at)),
    readout: (at) =>
      `${options.x[at]}: ${options.series.map((layer) => `${layer.label} ${cell(layer, at)}`).join(', ')}`,
    legend: options.series.map((layer, i) => ({
      label: layer.label,
      style: styleOf(layer, i, options.style),
    })),
    tip: (at) => ({
      title: options.x[at] ?? '',
      rows: options.series.map((layer, i) => ({
        label: layer.label,
        value: cell(layer, at),
        style: styleOf(layer, i, options.style),
      })),
    }),
    table: {
      columns: [...options.x],
      rows: options.series.map((layer) => [
        layer.label,
        ...options.x.map((_, at) => cell(layer, at)),
      ]),
    },
  };
}

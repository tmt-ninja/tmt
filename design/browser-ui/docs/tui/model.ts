import frozen from './data/oracle.json' with { type: 'json' };
export type Frame = {
  state: string;
  look: string;
  width: number;
  height: number;
  lines: string[];
  styles: string[];
};
export const oracle = {
  ...frozen,
  frames: frozen.frames.map((frame) => ({
    ...frame,
    lines: frame.lines.map((id) => frozen.lineDictionary[id]!),
    styles: frame.styles.map((id) => frozen.styleDictionary[id]!),
  })),
};
export const looks = ['tmt', 'tmt-light', 'terminal', 'NO_COLOR'] as const;
export const states = [...new Set(oracle.frames.map((frame) => frame.state))];
export const framesFor = (state: string, look: string) =>
  oracle.frames.filter((frame) => frame.state === state && frame.look === look);
export function selectFrame(state: string, look: string, size?: string): Frame | undefined {
  const frames = framesFor(state, look);
  return (
    frames.find((frame) => `${frame.width}x${frame.height}` === size) ??
    frames.find((frame) => frame.width === 100 && frame.height === 36) ??
    frames[0]
  );
}

/** Ratatui's debug style table, not a second theme. Unknown colors fail visibly. */
export function color(value: string, fallback: string): string {
  if (value === 'Reset') return fallback;
  const rgb = /^Rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  if (rgb) return `rgb(${rgb.slice(1).join(', ')})`;
  const indexed = /^Indexed\((\d+)\)$/.exec(value);
  const names = [
    'Black',
    'Red',
    'Green',
    'Yellow',
    'Blue',
    'Magenta',
    'Cyan',
    'Gray',
    'DarkGray',
    'LightRed',
    'LightGreen',
    'LightYellow',
    'LightBlue',
    'LightMagenta',
    'LightCyan',
    'White',
  ];
  const index = indexed ? Number(indexed[1]) : names.indexOf(value);
  const result = oracle.ansiRgb[index];
  if (!result) throw new Error(`Unsupported oracle color: ${value}`);
  return result;
}
export function styleFor(id: string, light: boolean) {
  const raw = (oracle.styles as Record<string, string>)[id];
  if (!raw) throw new Error(`Missing oracle style: ${id}`);
  const field = (name: string) => {
    const match = new RegExp(`\\b${name}: (Rgb\\([^)]*\\)|Indexed\\(\\d+\\)|\\w+)`).exec(raw);
    if (!match) throw new Error(`Missing ${name} in ${id}`);
    return match[1]!;
  };
  const defaults = oracle.defaults[light ? 'light' : 'dark'];
  let foreground = color(field('fg'), defaults.fg);
  let background = color(field('bg'), defaults.bg);
  const modifiers = /modifier: ([A-Z_ |]+)/.exec(raw)?.[1] ?? '';
  if (modifiers.includes('REVERSED')) [foreground, background] = [background, foreground];
  return {
    color: modifiers.includes('DIM')
      ? `color-mix(in srgb, ${foreground} 65%, ${background})`
      : foreground,
    backgroundColor: background,
    fontWeight: modifiers.includes('BOLD') ? '700' : '400',
    fontStyle: modifiers.includes('ITALIC') ? 'italic' : 'normal',
    textDecoration:
      [
        modifiers.includes('UNDERLINED') && 'underline',
        modifiers.includes('CROSSED_OUT') && 'line-through',
      ]
        .filter(Boolean)
        .join(' ') || 'none',
    visibility: modifiers.includes('HIDDEN') ? 'hidden' : 'visible',
  };
}

/** The oracle concatenates one symbol per buffer cell (including wide-symbol continuation blanks).
 * Graphemes each get an explicit one-cell box, so a wide glyph cannot shift the following columns. */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export function cells(frame: Frame, row: number): { text: string; style: string }[] {
  const symbols = [...segmenter.segment(frame.lines[row]!)].map((g) => g.segment);
  if (symbols.length > frame.width) throw new Error('Oracle row exceeds its cell width');
  const result = Array.from({ length: frame.width }, (_, i) => ({
    text: symbols[i] ?? ' ',
    style: '',
  }));
  let end = 0;
  for (const run of frame.styles[row]!.split(' ')) {
    const match = /^(\d+):(\d+)=(s\d+)$/.exec(run);
    if (!match || Number(match[1]) !== end) throw new Error('Non-contiguous oracle style runs');
    end += Number(match[2]);
    if (end > frame.width) throw new Error('Oracle style run exceeds its row');
    for (let i = Number(match[1]); i < end; i++) result[i]!.style = match[3]!;
  }
  if (end !== frame.width) throw new Error('Incomplete oracle style row');
  return result;
}

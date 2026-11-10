/** Browser adapter for the role-only portable terminal renderer. */
import * as React from 'react';
import { initSync, registry, render } from '../../terminal-frame-assets/tmt_tui_wasm.js';
import tokens from '../../../../../../design/tokens/tokens.json';

type Cell = {
  glyph: string;
  fg: string | null;
  bg: string | null;
  underlay: string | null;
  bold: boolean;
  chip_surface: 'idle' | 'hot' | 'disabled' | null;
  heat_level?: 0 | 1 | 2 | 3 | 4 | 5;
  continuation: boolean;
};
type Grid = {
  version: number;
  width: number;
  height: number;
  cells: Cell[];
  hits: { id: string; rect: { x: number; y: number; width: number; height: number } }[];
};
type Props = {
  component: string;
  width: number;
  height: number;
  look?: 'tmt' | 'tmt-light' | 'terminal' | 'NO_COLOR';
  onHit?: (id: string) => void;
  [prop: string]: unknown;
};
const take = (
  window as Window & {
    __colabTakeTerminalBytes?: () => ArrayBuffer;
  }
).__colabTakeTerminalBytes;
let state: 'ready' | 'unavailable' = 'unavailable';
try {
  const input = take?.();
  if (input) {
    initSync({ module: input });
    state = JSON.parse(registry()).version === 1 ? 'ready' : 'unavailable';
  }
} catch {
  // Missing or invalid optional renderer never prevents other page parts from loading.
}

const colors = tokens.color as Record<string, { dark: string; light: string; terminal: string }>;
// The terminal fallback's representative ANSI colors are the same as theme.rs ANSI_RGB.
const ansi: Record<string, string> = {
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3ebc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  'bright black': '#666666',
  'bright red': '#f14c4c',
  'bright green': '#23d18b',
  'bright yellow': '#f5f543',
  'bright blue': '#3b8eea',
  'bright magenta': '#d670d6',
  'bright cyan': '#29b8cd',
  'bright white': '#ffffff',
};
const backgrounds = new Set([
  'selection',
  'track',
  'keycap',
  'keycap-selected',
  'attachment',
  'conversation',
]);

/** Resolve the same role, chip and no-colour modifiers as the native grid adapter. */
function paintCell(cell: Cell, look: NonNullable<Props['look']>) {
  const light = look === 'tmt-light';
  const defaults = {
    fg: light ? tokens.color.text.light : tokens.color.text.dark,
    bg: light ? tokens.surface.paper.light : tokens.surface.term.dark,
  };
  let fg = defaults.fg;
  let bg = defaults.bg;
  let dim = false;
  let bold = cell.bold;
  let reverse = false;
  const roleColor = (role: string | null) => {
    if (!role || !colors[role] || look === 'NO_COLOR') return undefined;
    return look === 'terminal'
      ? ansi[colors[role].terminal]
      : colors[role][light ? 'light' : 'dark'];
  };
  const apply = (role: string | null) => {
    if (!role || !colors[role] || look === 'NO_COLOR') return;
    if (look === 'terminal') {
      dim ||= colors[role].terminal === 'dim';
      reverse ||= colors[role].terminal === 'reverse';
    }
    const color = roleColor(role);
    if (color) {
      if (backgrounds.has(role)) bg = color;
      else fg = color;
    }
  };
  if (cell.heat_level !== undefined) {
    if (look === 'terminal') {
      const step = cell.heat_level;
      bg = [
        ansi.black,
        ansi['bright black'],
        ansi['bright black'],
        ansi.white,
        ansi.white,
        ansi['bright white'],
      ][step]!;
      fg = step < 3 ? ansi['bright white']! : ansi.black!;
    } else if (look !== 'NO_COLOR') {
      // Match screen::neutral_ramp: interpolate the greys of Track and Text.
      const grey = (hex: string) =>
        Math.floor(
          (parseInt(hex.slice(1, 3), 16) +
            parseInt(hex.slice(3, 5), 16) +
            parseInt(hex.slice(5, 7), 16)) /
            3,
        );
      const end = light ? 'light' : 'dark';
      const value = Math.floor(
        (grey(colors.track![end]) * (5 - cell.heat_level) +
          grey(colors.text![end]) * cell.heat_level) /
          5,
      );
      bg = `rgb(${value}, ${value}, ${value})`;
      const channel = value / 255;
      const luminance = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      fg = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
    }
  } else if (cell.chip_surface) {
    const hot = cell.chip_surface === 'hot';
    if (look === 'NO_COLOR') {
      reverse = cell.chip_surface !== 'disabled';
      dim = cell.chip_surface === 'disabled';
      bold ||= hot;
    } else if (look === 'terminal') {
      apply(hot ? 'selection' : 'track');
      dim ||= cell.chip_surface === 'disabled';
      bold ||= hot;
    } else {
      bg = colors[hot ? 'selection' : 'track'][light ? 'light' : 'dark'];
      fg = light ? '#000000' : '#ffffff';
      dim = cell.chip_surface === 'disabled';
    }
  } else {
    apply(cell.underlay);
    apply(cell.fg);
  }
  if (look === 'NO_COLOR' && cell.underlay === 'selection') reverse = true;
  if (cell.bg) bg = backgrounds.has(cell.bg) ? defaults.bg : (roleColor(cell.bg) ?? defaults.bg);
  if (reverse) [fg, bg] = [bg, fg];
  return {
    color: dim ? `color-mix(in srgb, ${fg} 65%, ${bg})` : fg,
    backgroundColor: bg,
    fontWeight: bold ? '700' : '400',
  };
}
/** One immutable cell grid; hit IDs remain decimal strings for the caller. */
export function TerminalFrame({ component, width, height, look = 'tmt', onHit, ...props }: Props) {
  let grid: Grid;
  try {
    if (state !== 'ready') throw new Error('renderer unavailable');
    grid = JSON.parse(render(component, JSON.stringify(props), width, height)) as Grid;
    if (
      grid.version !== 2 ||
      grid.cells.some(
        (cell) =>
          cell.heat_level !== undefined &&
          (!Number.isInteger(cell.heat_level) || cell.heat_level < 0 || cell.heat_level > 5),
      ) ||
      grid.width !== width ||
      grid.height !== height ||
      grid.cells.length !== width * height
    )
      throw new Error('invalid renderer output');
  } catch {
    return React.createElement('span', { role: 'status' }, 'Part unavailable');
  }
  const light = look === 'tmt-light';
  const cells = grid.cells.flatMap((cell, index) => {
    if (cell.continuation) return [];
    const x = index % width;
    const y = Math.floor(index / width);
    const wide = x + 1 < width && grid.cells[index + 1]?.continuation;
    return [
      React.createElement(
        'span',
        {
          key: index,
          style: {
            gridColumn: `${x + 1} / span ${wide ? 2 : 1}`,
            gridRow: y + 1,
            ...paintCell(cell, look),
          },
        },
        cell.heat_level !== undefined && look !== 'NO_COLOR' ? ' ' : cell.glyph || ' ',
      ),
    ];
  });
  const hits = onHit
    ? grid.hits.map(({ id, rect }) =>
        React.createElement('button', {
          key: id,
          type: 'button',
          'aria-label': `Terminal control ${id}`,
          onClick: () => onHit(id),
          style: {
            position: 'absolute',
            left: `${rect.x}ch`,
            top: `${rect.y * 1.4}em`,
            width: `${rect.width}ch`,
            height: `${rect.height * 1.4}em`,
            opacity: 0,
            cursor: 'pointer',
          },
        }),
      )
    : [];
  return React.createElement(
    'span',
    {
      style: {
        display: 'grid',
        width: 'max-content',
        position: 'relative',
        gridTemplateColumns: `repeat(${width}, 1ch)`,
        gridTemplateRows: `repeat(${height}, 1.4em)`,
        fontFamily: 'var(--tmt-ui-font-mono, monospace)',
        fontVariantLigatures: 'none',
        lineHeight: 1.4,
        whiteSpace: 'pre',
        color: light ? tokens.color.text.light : tokens.color.text.dark,
        backgroundColor: light ? tokens.surface.paper.light : tokens.surface.term.dark,
      },
    },
    ...cells,
    ...hits,
  );
}

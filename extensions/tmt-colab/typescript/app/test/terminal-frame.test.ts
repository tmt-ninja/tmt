import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vite-plus/test';
import vector from '../../../../../rust/crates/tmt-tui-wasm/tests/vectors/v1.json';

const source = readFileSync(
  new URL('../terminal-frame-assets/tmt_tui_wasm_bg.wasm', import.meta.url),
);
const bytes = Uint8Array.from(source).buffer;
vi.stubGlobal('window', { __colabTakeTerminalBytes: () => bytes });
const { TerminalFrame } = await import('../src/runtime/terminal-frame.js');

test('the checked-in wasm draws the native section vector and keeps cells in columns', () => {
  const testCase = vector.cases.find((entry) => entry.name === 'section')!;
  const { component, props_json, width, height } = testCase.input;
  const html = renderToStaticMarkup(
    React.createElement(TerminalFrame, {
      component,
      width,
      height,
      ...JSON.parse(props_json),
    }),
  );
  expect(html).toContain('repeat(40, 1ch)');
  const text = html.replace(/<[^>]+>/g, '');
  const expected = testCase.expected
    .ok!.cells_rle.flatMap(([count, cell]) =>
      Array(Number(count)).fill((cell as { glyph: string }).glyph),
    )
    .join('');
  expect(text).toBe(expected);
  expect(html).not.toContain('Part unavailable');
});

test('unknown components visibly fail closed', () => {
  const html = renderToStaticMarkup(
    React.createElement(TerminalFrame, {
      component: 'unregistered',
      width: 40,
      height: 1,
    }),
  );
  expect(html).toContain('Part unavailable');
});

test('v2 heat cells follow the native neutral ramp and preserve glyphs without color', async () => {
  const glyphs = ['▁', '▂', '▃', '▄', '▆', '█'];
  const cells = glyphs.map((glyph, heat_level) => ({
    glyph,
    heat_level,
    fg: 'text',
    bg: null,
    underlay: null,
    bold: false,
    chip_surface: null,
    continuation: false,
  }));
  let version = 2;
  vi.resetModules();
  vi.doMock('../terminal-frame-assets/tmt_tui_wasm.js', () => ({
    initSync: () => {},
    registry: () => JSON.stringify({ version: 1 }),
    render: () => JSON.stringify({ version, width: 6, height: 1, cells, hits: [] }),
  }));
  try {
    const { TerminalFrame: Frame } = await import('../src/runtime/terminal-frame.js');
    const draw = (look: 'tmt' | 'tmt-light' | 'terminal' | 'NO_COLOR') =>
      renderToStaticMarkup(
        React.createElement(Frame, {
          component: 'activity-cells',
          width: 6,
          height: 1,
          look,
        }),
      );
    for (const [look, values] of [
      ['tmt', [56, 88, 120, 152, 184, 216]],
      ['tmt-light', [224, 183, 143, 103, 63, 23]],
    ] as const) {
      const html = draw(look);
      for (const value of values)
        expect(html).toContain(`background-color:rgb(${value}, ${value}, ${value})`);
      for (const glyph of glyphs) expect(html).not.toContain(glyph);
      expect(html).toContain('display:grid');
      expect(html).toContain('width:max-content');
    }
    const plain = draw('NO_COLOR');
    for (const glyph of glyphs) expect(plain).toContain(glyph);
    expect(plain).not.toContain('background-color:rgb(');
    const terminal = draw('terminal');
    expect(terminal).toContain('background-color:#000000');
    expect(terminal).toContain('background-color:#666666');
    expect(terminal).toContain('background-color:#e5e5e5');
    expect(terminal).toContain('background-color:#ffffff');
    version = 1;
    expect(draw('tmt')).toContain('Part unavailable');
  } finally {
    vi.doUnmock('../terminal-frame-assets/tmt_tui_wasm.js');
    vi.resetModules();
  }
});

test('the checked-in v2 wasm preserves activity glyphs without color', () => {
  const html = renderToStaticMarkup(
    React.createElement(TerminalFrame, {
      component: 'activity-cells',
      width: 8,
      height: 1,
      look: 'NO_COLOR',
      values: [null, '0', '1', '2', '3', '4', '5', '6'],
      selected: false,
    }),
  );
  for (const glyph of ['▁', '▂', '▃', '▄', '▆', '█']) expect(html).toContain(glyph);
  expect(html).not.toContain('Part unavailable');
});

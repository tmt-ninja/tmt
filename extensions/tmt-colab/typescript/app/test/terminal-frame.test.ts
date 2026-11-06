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

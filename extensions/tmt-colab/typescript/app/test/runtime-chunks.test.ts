import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import vector from '../../../contracts/vectors/page-runtime-chunks-v1.json';
import uiVector from '../../../contracts/vectors/design-runtime-4-ui.json';
import bundle from '../../../../../design/systems/tmt-gui/generated/bundle.json';
import { runtimeChunkNames, type ChunkDemand } from '../src/runtime-chunks.js';

// The page runtime's chunks (#6085): the vector, the chunk entries and the parent's choice agree.
const built = vector.chunks.filter((chunk) => !('reserved' in chunk && chunk.reserved));

test('the chunks provide exactly the runtime 4 UI parts and runtime 3 shared parts, once each', () => {
  const ui = built.flatMap((chunk) => chunk.ui);
  expect(new Set(ui).size).toBe(ui.length);
  expect([...ui].sort()).toEqual([...uiVector.parts, ...uiVector.blockParts].sort());
  expect(built.flatMap((chunk) => chunk.parts)).toEqual(['PageListTable']);
});

test("each chunk's entry registers exactly the names the vector gives it", () => {
  for (const chunk of built.filter(
    (entry) => entry.name !== 'base' && !('kind' in entry && entry.kind === 'wasm'),
  )) {
    const source = readFileSync(new URL(`../${chunk.entry}`, import.meta.url), 'utf8');
    const call = /registerChunk\('([^']+)', \{\s*ui: \{([^}]*)\},(?:\s*parts: \{([^}]*)\},)?/.exec(
      source,
    );
    expect(call?.[1]).toBe(chunk.name);
    const names = (list = '') =>
      list
        .split(',')
        .map((name) => name.trim().split(':')[0]!)
        .filter(Boolean);
    expect(names(call?.[2]).sort()).toEqual([...chunk.ui].sort());
    expect(names(call?.[3]).sort()).toEqual([...chunk.parts].sort());
  }
});

test('a chunk comes only after chunks listed before it, and the budget covers every cap', () => {
  const order = vector.chunks.map((chunk) => chunk.name);
  for (const chunk of vector.chunks)
    for (const before of chunk.after)
      expect(order.indexOf(before)).toBeLessThan(order.indexOf(chunk.name));
  expect(vector.chunks.reduce((sum, chunk) => sum + chunk.gzipCap, 0)).toBeLessThanOrEqual(
    vector.gzipBudget,
  );
});

const components = bundle.components as unknown as ChunkDemand[];
const pick = (...tags: string[]) => runtimeChunkNames(components, bundle.prefix, new Set(tags));

test('the parent picks a page’s chunks from the verified components it writes', () => {
  // No component: the base alone. A tag the bundle does not have adds nothing.
  expect(pick()).toEqual(['base']);
  expect(pick('p', 'acme-button', 'tmt-ui-unknown')).toEqual(['base']);
  // One button needs the shadcn parts only.
  expect(pick('tmt-ui-button')).toEqual(['base', 'ui']);
  // A page list needs the shared part and every chunk below it.
  expect(pick('tmt-ui-page-list')).toEqual(['base', 'ui', 'browser', 'blocks']);
  // A docs page draws every scene.
  expect(pick('tmt-ui-component-docs')).toEqual([
    'base',
    'ui',
    'browser',
    'blocks',
    'rich-input',
    'docs',
  ]);
});

test('only verified components using TerminalFrame select its wasm', () => {
  const demands: ChunkDemand[] = [{ tag: 'acme-frame', uiParts: ['TerminalFrame'] }];
  expect(runtimeChunkNames(demands, 'acme', new Set())).toEqual(['base']);
  expect(runtimeChunkNames([], 'acme', new Set(['acme-frame']))).toEqual(['base']);
  expect(runtimeChunkNames(demands, 'acme', new Set(['acme-frame']))).toEqual([
    'base',
    'ui',
    'terminal-frame',
  ]);
});

test('a component that requires another brings that component’s chunks', () => {
  const demands: ChunkDemand[] = [
    { tag: 'acme-card', requires: ['field'] },
    { tag: 'acme-field', uiParts: ['RichInput'] },
  ];
  expect(runtimeChunkNames(demands, 'acme', new Set(['acme-card']))).toEqual([
    'base',
    'ui',
    'rich-input',
  ]);
});

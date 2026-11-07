import { expect, it, vi } from 'vite-plus/test';
import * as Y from 'yjs';
import vectors from '../../../contracts/vectors/blocks-v1.json';
import pageVectors from '../../../contracts/vectors/blocks-page-v1.json';
import { canonical } from '../src/closed.js';
import { richFromRuns, validateBlocks } from '../src/blocks.js';
import { validateProjection, type DecoderCommand } from '../src/fold-protocol.js';

const page = (blocks: unknown) => ({
  source: '',
  title: 'Blocks',
  pageType: 'blocks' as const,
  blocks: blocks as Record<string, unknown>,
});

it.each(vectors.valid)('accepts: $name', ({ blocks }) => {
  expect(() => validateBlocks(blocks)).not.toThrow();
  expect(() => validateProjection(page(blocks))).not.toThrow();
});

it.each(vectors.invalid)('refuses: $name', ({ blocks }) => {
  expect(() => validateBlocks(blocks)).toThrow();
  expect(() => validateProjection(page(blocks))).toThrow();
});

it('a page of blocks has the root and no HTML, template, layout or dashboard value', () => {
  const base = page({});
  expect(() => validateProjection(base)).not.toThrow();
  // Questions, a creator, a state, work, attachments and what it was made from belong to it.
  expect(() => validateProjection({ ...base, pageState: 'done' })).not.toThrow();
  expect(() => validateProjection({ ...base, work: { version: 2, order: [] } })).not.toThrow();
  expect(() => validateProjection({ ...base, attachments: [] })).not.toThrow();
  expect(() => validateProjection({ ...base, fromTemplate: { name: 'report' } })).not.toThrow();
  expect(() =>
    validateProjection({ ...base, convertedFrom: '10000000-0000-4000-8000-000000000007' }),
  ).not.toThrow();
  for (const bad of [
    { ...base, source: '<p>html</p>' },
    { ...base, blocks: undefined },
    { ...base, shell: { version: 1, items: {}, order: [] } },
    { ...base, layout: 'column' },
    { ...base, template: { name: 'x', description: 'y' } },
    { ...base, convertedFrom: 'archive' },
    { source: '', title: 'T', blocks: {} },
    { source: '<p>x</p>', title: 'T', pageType: undefined, blocks: {} },
    { source: '', title: 'T', convertedFrom: '10000000-0000-4000-8000-000000000007' },
  ])
    expect(() => validateProjection(bad), JSON.stringify(bad)).toThrow();
});

it('the actual Worker accepts and refuses the metadata of a page of blocks as the page vectors say', async () => {
  const cases = pageVectors.cases as {
    name: string;
    meta: Record<string, unknown>;
    valid: boolean;
  }[];
  for (const { name, meta, valid } of cases) {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getText('html');
      const map = doc.getMap('meta');
      map.set('title', 'Page');
      for (const [key, value] of Object.entries(meta)) map.set(key, value);
    });
    vi.resetModules();
    const surface = {
      onmessage: null as unknown as (event: {
        data: { id: number; command: DecoderCommand };
      }) => Promise<void>,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', surface);
    try {
      await import('../src/fold.worker.js');
      await surface.onmessage({
        data: { id: 1, command: { type: 'apply', updates: [Y.encodeStateAsUpdate(doc)] } },
      });
      const reply = surface.postMessage.mock.calls[0][0];
      expect(reply.error === undefined, name).toBe(valid);
      if (valid)
        for (const [key, value] of Object.entries(meta)) expect(reply[key], name).toEqual(value);
    } finally {
      vi.unstubAllGlobals();
    }
  }
});

it('reads Y.Text runs into the canonical marks, in scalar values', () => {
  const runs = [
    { insert: 'a', attributes: { bold: true } },
    { insert: '🐈', attributes: { bold: true, italic: true } },
    { insert: 'b ' },
    { insert: 'link', attributes: { link: 'https://example.com/a' } },
  ];
  expect(richFromRuns(runs)).toEqual({
    s: 'a🐈b link',
    marks: [
      { from: 0, to: 2, mark: 'bold' },
      { from: 1, to: 2, mark: 'italic' },
      { from: 4, to: 8, mark: 'link', value: 'https://example.com/a' },
    ],
  });
  for (const bad of [
    [{ insert: { image: 'x' } }],
    [{ insert: 'a', attributes: { underline: true } }],
    [{ insert: 'a', attributes: { bold: 'yes' } }],
    [{ insert: 'a', attributes: { link: 'javascript:alert(1)' } }],
  ])
    expect(() => richFromRuns(bad as never)).toThrow();
});

it('the actual Worker projects a page of blocks from nested Yjs types and refuses a wrong shape', async () => {
  const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
  const build = (fill: (blocks: Y.Map<unknown>, meta: Y.Map<unknown>) => void) => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getText('html');
      const meta = doc.getMap('meta');
      meta.set('title', 'Blocks');
      fill(doc.getMap('blocks'), meta);
    });
    return Y.encodeStateAsUpdate(doc);
  };
  const props = (values: Record<string, unknown> = {}) => {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(values)) map.set(key, value);
    return map;
  };
  const block = (type: string, extra: Record<string, unknown> = {}) => {
    const map = new Y.Map<unknown>();
    map.set('type', type);
    map.set('parent', 'root');
    map.set('pos', 'V');
    map.set('props', props());
    for (const [key, value] of Object.entries(extra)) map.set(key, value);
    return map;
  };
  const open = async () => {
    vi.resetModules();
    const surface = {
      onmessage: null as unknown as (event: {
        data: { id: number; command: DecoderCommand };
      }) => Promise<void>,
      postMessage: vi.fn(),
    };
    vi.stubGlobal('self', surface);
    await import('../src/fold.worker.js');
    return async (command: DecoderCommand) => {
      surface.postMessage.mockClear();
      await surface.onmessage({ data: { id: 1, command } });
      return surface.postMessage.mock.calls[0][0];
    };
  };
  try {
    // An empty page of blocks has no root yet.
    const empty = await (
      await open()
    )({
      type: 'apply',
      updates: [build((_, meta) => meta.set('pageType', 'blocks'))],
    });
    expect(empty.error).toBeUndefined();
    expect(empty.pageType).toBe('blocks');
    expect(empty.blocks).toEqual({});

    const text = new Y.Text();
    const full = await (
      await open()
    )({
      type: 'apply',
      updates: [
        build((blocks, meta) => {
          meta.set('pageType', 'blocks');
          const paragraph = block('paragraph', { text });
          blocks.set(id(1), paragraph);
          text.insert(0, 'hello 🐈 world');
          text.format(0, 5, { bold: true });
          text.format(6, 2, { link: 'https://example.com/x' });
          blocks.set(
            id(2),
            block('table', { props: props({ columns: [{ id: 'a', name: 'A' }] }) }),
          );
          const cell = new Y.Text('one');
          const cells = new Y.Map<unknown>();
          cells.set('a', cell);
          const row = block('row', { cells });
          row.set('parent', id(2));
          blocks.set(id(3), row);
          blocks.set(id(4), block('paragraph', { text: new Y.Text(), deleted: 1700000000000 }));
        }),
      ],
    });
    expect(full.error).toBeUndefined();
    expect(canonical(full.blocks)).toBe(
      canonical({
        [id(1)]: {
          type: 'paragraph',
          parent: 'root',
          pos: 'V',
          props: {},
          text: {
            s: 'hello 🐈 world',
            marks: [
              { from: 0, to: 5, mark: 'bold' },
              { from: 6, to: 7, mark: 'link', value: 'https://example.com/x' },
            ],
          },
        },
        [id(2)]: {
          type: 'table',
          parent: 'root',
          pos: 'V',
          props: { columns: [{ id: 'a', name: 'A' }] },
        },
        [id(3)]: {
          type: 'row',
          parent: id(2),
          pos: 'V',
          props: {},
          cells: { a: { s: 'one', marks: [] } },
        },
        [id(4)]: {
          type: 'paragraph',
          parent: 'root',
          pos: 'V',
          props: {},
          text: { s: '', marks: [] },
          deleted: 1700000000000,
        },
      }),
    );

    // The same blocks on a page with no `pageType` are not a page; nor is a wrong shape.
    const wrong: [string, (blocks: Y.Map<unknown>, meta: Y.Map<unknown>) => void][] = [
      [
        'a blocks root on an ordinary page',
        (blocks) => blocks.set(id(1), block('paragraph', { text: new Y.Text() })),
      ],
      [
        'a block that is not a map',
        (blocks, meta) => (meta.set('pageType', 'blocks'), blocks.set(id(1), 'x')),
      ],
      [
        'props that are not a map',
        (blocks, meta) => (
          meta.set('pageType', 'blocks'),
          blocks.set(id(1), block('paragraph', { text: new Y.Text(), props: 5 }))
        ),
      ],
      [
        'a nested type inside a prop',
        (blocks, meta) => {
          meta.set('pageType', 'blocks');
          blocks.set(
            id(1),
            block('paragraph', { text: new Y.Text(), props: props({ tone: new Y.Map() }) }),
          );
        },
      ],
      [
        'a field outside the closed set',
        (blocks, meta) => (
          meta.set('pageType', 'blocks'),
          blocks.set(id(1), block('paragraph', { text: new Y.Text(), colour: 'red' }))
        ),
      ],
      [
        'a mark outside the closed set',
        (blocks, meta) => {
          meta.set('pageType', 'blocks');
          const t = new Y.Text();
          blocks.set(id(1), block('paragraph', { text: t }));
          t.insert(0, 'abc');
          t.format(0, 1, { underline: true });
        },
      ],
      [
        'a block that fails its schema',
        (blocks, meta) => (
          meta.set('pageType', 'blocks'),
          blocks.set(id(1), block('banner', { text: new Y.Text() }))
        ),
      ],
    ];
    for (const [name, fill] of wrong) {
      const result = await (await open())({ type: 'apply', updates: [build(fill)] });
      expect(result.error, name).toBeDefined();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});

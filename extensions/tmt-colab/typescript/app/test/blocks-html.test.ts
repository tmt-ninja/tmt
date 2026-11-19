import { expect, it } from 'vite-plus/test';
import vectors from '../../../contracts/vectors/blocks-html-v1.json';
import { renderBlocks } from '../src/blocks-html.js';

it.each(vectors.cases)('renders: $name', ({ blocks, html }) => {
  expect(renderBlocks(blocks)).toBe(html);
});

it('renders nothing for anything that is not an object of blocks', () => {
  expect(renderBlocks(undefined)).toBe('');
  expect(renderBlocks([])).toBe('');
});

it.each([
  ['image', 'Image or file attachment'],
  ['mockup', 'Mockup'],
  ['question', 'Interactive question'],
  ['page-view', 'Page view'],
  ['work-bundle', 'Work bundle'],
])('names the unavailable %s in shared readers', (type, label) => {
  const blocks = {
    child: { type, parent: 'root', pos: 'V', props: { markup: '<p>private mockup</p>' } },
  };
  const html = renderBlocks(blocks, 'reader');
  expect(html).toContain(label + ' is not shown in the shared reader.');
  expect(html).not.toContain('private mockup');
});

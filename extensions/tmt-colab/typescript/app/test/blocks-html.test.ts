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

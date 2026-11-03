import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { expect, it } from 'vite-plus/test';
import { BrandMark } from '../src/brand-mark.js';
import { brandMarkInner, brandMarkSvg } from '../src/brand-mark-svg.js';

const source = readFileSync(new URL('../src/brand-mark.svg', import.meta.url), 'utf8');
const tokens = JSON.parse(
  readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
);
const artwork = source.match(/<svg[^>]*>([\s\S]*)<\/svg>/)![1]!.trim();

it('keeps the selected ninja artwork exact, on its dark tile, at every product size', () => {
  expect(brandMarkInner()).toContain(artwork);
  expect(brandMarkInner()).toContain(`fill="${tokens.brand.mark.tile.light.toLowerCase()}"`);
  expect(tokens.brand.mark.tile.light).toBe(tokens.brand.mark.tile.dark);
  expect(tokens.browser['palette-b']['brand-mark'].tile.light).toBe(tokens.brand.mark.tile.light);
  expect(tokens.browser['palette-b']['brand-mark'].tile.dark).toBe(tokens.brand.mark.tile.dark);
  for (const size of [16, 24, 32, 256]) {
    const svg = brandMarkSvg({ size });
    expect(svg).toContain(`width="${size}" height="${size}"`);
    expect(svg).toContain(brandMarkInner());
    expect(svg).toContain('aria-hidden="true"');
    // No paint-server IDs: multiple visible or retained shells cannot resolve into one another.
    expect(svg).not.toMatch(/\bid=|url\(|<filter|<mask/);
    expect(renderToStaticMarkup(createElement(BrandMark, { size }))).toContain(artwork);
  }
});

it('pins the approved vector and uses it for the favicon and app icons', () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    '20e2cade81e8808d193e34eb13838decd7dc854a8245f7c81c26cf1cdf9c8214',
  );
  for (const name of ['favicon.svg', 'app-icon-light.svg', 'app-icon-dark.svg']) {
    const icon = readFileSync(new URL(`../generated/${name}`, import.meta.url), 'utf8');
    expect(icon).toContain(artwork);
    expect(icon).not.toContain('<image');
    expect(Buffer.byteLength(icon)).toBeLessThan(2048);
  }
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { expect, it } from 'vite-plus/test';
import { BrandMark } from '../src/brand-mark.js';
import { brandMarkInner, brandMarkSvg } from '../src/brand-mark-svg.js';

const source = readFileSync(new URL('../src/brand-mark.svg', import.meta.url), 'utf8');
const artwork = source.match(/<svg[^>]*>([\s\S]*)<\/svg>/)![1]!.trim();

it('keeps the selected ninja artwork exact, on its dark tile, at every product size', () => {
  expect(brandMarkInner()).toContain(artwork);
  expect(brandMarkInner()).toContain('fill="#0a0a0a"');
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

it('pins the approved blog sources and preserves exact favicon pixels and vector app icons', () => {
  const png = readFileSync(new URL('../src/brand-favicon.png', import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    '20e2cade81e8808d193e34eb13838decd7dc854a8245f7c81c26cf1cdf9c8214',
  );
  expect(createHash('sha256').update(png).digest('hex')).toBe(
    'e40ccbac730bc4664db3c59e918610fce4abf3db488875842742041d9abf63e1',
  );
  const favicon = readFileSync(new URL('../generated/favicon.svg', import.meta.url), 'utf8');
  const encoded = favicon.match(/href="data:image\/png;base64,([^"]+)"/)![1]!;
  expect(Buffer.from(encoded, 'base64')).toEqual(png);
  for (const name of ['app-icon-light.svg', 'app-icon-dark.svg']) {
    const icon = readFileSync(new URL(`../generated/${name}`, import.meta.url), 'utf8');
    expect(icon).toContain(artwork);
    expect(icon).toContain('width="512" height="512"');
    expect(icon).not.toContain('<image');
  }
});

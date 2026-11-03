import { expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
it('keeps frame and starter below Tailwind theme/base, with DS above preflight', () => {
  const generator = readFileSync(new URL('../../../scripts/page-ui.mjs', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../public/renderer.html', import.meta.url), 'utf8');
  const order = '@layer colab-frame,tmt-starter,theme,base,tmt-ui;';
  expect(generator.includes(order)).toBe(true);
  expect(renderer.includes(order)).toBe(true);
  expect(renderer.indexOf(order)).toBeLessThan(renderer.indexOf('@layer colab-frame{'));
});

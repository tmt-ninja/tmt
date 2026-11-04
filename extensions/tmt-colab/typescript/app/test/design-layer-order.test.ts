import { expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
it('keeps frame and starter below Tailwind theme/base, with DS and scope above preflight', () => {
  const generator = readFileSync(new URL('../../../scripts/page-ui.mjs', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../public/renderer.html', import.meta.url), 'utf8');
  const order = '@layer colab-frame,tmt-starter,theme,base,tmt-ui,tmt-ds-scope;';
  expect(generator.includes(order)).toBe(true);
  expect(renderer.includes(order)).toBe(true);
  const pageUi = renderer.slice(renderer.indexOf('// BEGIN GENERATED PAGE UI'));
  expect(pageUi.indexOf(order)).toBeLessThan(pageUi.indexOf('@layer colab-frame{'));
  expect(renderer.indexOf('document.head.append(ui)')).toBeLessThan(
    renderer.indexOf('document.head.append(sheet)'),
  );
});

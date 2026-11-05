import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vite-plus/test';
import runtime4 from '../../../contracts/vectors/design-runtime-4-ui.json';

it('exposes the curated icons on window.tmt so a page can write them as htm templates', async () => {
  vi.stubGlobal('window', globalThis);
  await import('../src/runtime/entry.js');
  const { icons } = await import('../src/runtime/icons.js');
  const tmt = (
    globalThis as unknown as {
      tmt: { html: (...args: unknown[]) => unknown; icons: typeof icons; ui: object };
    }
  ).tmt;
  expect(tmt.icons).toBe(icons);
  expect(Object.isFrozen(tmt)).toBe(true);
  const allowed = [...runtime4.parts, ...runtime4.blockParts];
  expect(Object.keys(tmt.ui).sort()).toEqual([...allowed].sort());
  expect(new Set(allowed).size).toBe(allowed.length);

  const { Check } = tmt.icons;
  const markup = renderToStaticMarkup(
    tmt.html`<button>${tmt.html`<${Check} size=${20} aria-label="Done" />`}</button>` as never,
  );
  expect(markup).toContain('<button><svg');
  expect(markup).toContain('width="20"');
  expect(markup).toContain('role="img"');
  expect(markup).toContain('stroke-linecap="square"');
});

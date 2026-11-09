import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vite-plus/test';
import runtime4 from '../../../contracts/vectors/design-runtime-4-ui.json';

it('exposes the curated icons on window.tmt so a page can write them as htm templates', async () => {
  vi.stubGlobal('window', globalThis);
  await import('../src/runtime/entry.js');
  const tmtBase = (globalThis as unknown as { tmt: { ui: object } }).tmt;
  // The base alone provides no parts; the chunks add theirs until the seal (#6085).
  expect(Object.keys(tmtBase.ui)).toEqual([]);
  for (const chunk of ['ui', 'browser', 'blocks', 'rich-input', 'docs', 'terminal-frame-ui'])
    await import(`../src/runtime/chunks/${chunk}.ts`);
  (globalThis as unknown as { __colabRuntimeSeal(): void }).__colabRuntimeSeal();
  expect(Object.isFrozen(tmtBase.ui)).toBe(true);
  expect('__colabRuntimeChunk' in globalThis).toBe(false);
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

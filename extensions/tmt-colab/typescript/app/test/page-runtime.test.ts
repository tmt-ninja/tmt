import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vite-plus/test';

// A pin over known texts, so the test controls which bytes match (#6085).
const texts = {
  'assets/colab-runtime.css': '@theme { --color-paper: #fff; }',
  'assets/colab-runtime-terminal-3333333333333333.wasm': 'wasm-test-bytes',
  'assets/colab-runtime-base-0000000000000000.js': 'window.base = 1;',
  'assets/colab-runtime-react-4444444444444444.js': 'window.react = 1;',
  'assets/colab-runtime-ui-1111111111111111.js': 'window.ui = 1;',
  'assets/colab-runtime-docs-2222222222222222.js': 'window.docs = 1;',
};
const pinned = (path: keyof typeof texts) => ({
  path,
  sha256: createHash('sha256').update(texts[path]).digest('hex'),
  length: Buffer.byteLength(texts[path]),
});
vi.mock('../runtime-pin.json', () => ({
  default: {
    chunks: [
      { name: 'base', ...pinned('assets/colab-runtime-base-0000000000000000.js') },
      { name: 'react', ...pinned('assets/colab-runtime-react-4444444444444444.js') },
      { name: 'ui', ...pinned('assets/colab-runtime-ui-1111111111111111.js') },
      { name: 'docs', ...pinned('assets/colab-runtime-docs-2222222222222222.js') },
      {
        name: 'terminal-frame',
        kind: 'wasm',
        ...pinned('assets/colab-runtime-terminal-3333333333333333.wasm'),
      },
    ],
    theme: pinned('assets/colab-runtime.css'),
  },
}));
const { loadRuntime, runtimeUrl, UTILITIES_ONLY } = await import('../src/page-runtime.js');

afterEach(() => vi.unstubAllGlobals());
/** Serves the pinned texts, with any overrides by path. */
function serve(overrides: Record<string, Response | string> = {}) {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url).pathname.replace(/^.*\/(assets\/)/, '$1');
    fetched.push(path);
    const override = overrides[path];
    if (override instanceof Response) return override;
    return new Response(override ?? texts[path as keyof typeof texts] ?? 'missing');
  });
  return fetched;
}

test('a chunk sits next to the renderer: mount-relative, or the root on the hosted origin', () => {
  const path = 'assets/colab-runtime-base-0000000000000000.js';
  expect(runtimeUrl('http://127.0.0.1:4179/r/abcdefghijklmnop/x/colab/', path)).toBe(
    `http://127.0.0.1:4179/r/abcdefghijklmnop/x/colab/${path}`,
  );
  expect(runtimeUrl('https://tmt-colab.web.app/s/anything', path)).toBe(
    `https://tmt-colab.web.app/${path}`,
  );
});

test('a page loads the base and only its named chunks, each verified once per tab', async () => {
  const fetched = serve();
  const base = 'http://127.0.0.1:4179/r/aaaaaaaaaaaaaaaa/x/colab/';
  // Without React the theme compiles Tailwind's utilities alone, with no preflight (#6077).
  expect(await loadRuntime(base)).toEqual({
    style: `${UTILITIES_ONLY}${texts['assets/colab-runtime.css']}`,
    scripts: ['window.base = 1;'],
  });
  expect(fetched.sort()).toEqual([
    'assets/colab-runtime-base-0000000000000000.js',
    'assets/colab-runtime.css',
  ]);
  fetched.length = 0;
  // Unknown names add nothing; known chunks load in vector order, and the base is not fetched again.
  // With React the theme is all of Tailwind, as before.
  const withReact = await loadRuntime(base, ['docs', 'nope', 'ui', 'react']);
  expect(withReact.scripts).toEqual([
    'window.base = 1;',
    'window.react = 1;',
    'window.ui = 1;',
    'window.docs = 1;',
  ]);
  expect(withReact.style).toBe(texts['assets/colab-runtime.css']);
  expect(fetched.sort()).toEqual([
    'assets/colab-runtime-docs-2222222222222222.js',
    'assets/colab-runtime-react-4444444444444444.js',
    'assets/colab-runtime-ui-1111111111111111.js',
  ]);
});

test('a lazy chunk whose bytes differ from the pin is left out; the rest of the page loads', async () => {
  serve({ 'assets/colab-runtime-ui-1111111111111111.js': 'window.ui = 2;' });
  const runtime = await loadRuntime('http://127.0.0.1:4179/r/bbbbbbbbbbbbbbbb/x/colab/', [
    'ui',
    'docs',
  ]);
  expect(runtime.scripts).toEqual(['window.base = 1;', 'window.docs = 1;']);
});

test('a base, theme or asked-for React that fails to load or verify fails the runtime, and the failure is not kept', async () => {
  const base = 'http://127.0.0.1:4179/r/cccccccccccccccc/x/colab/';
  serve({ 'assets/colab-runtime-react-4444444444444444.js': 'window.react = 2;' });
  await expect(
    loadRuntime('http://127.0.0.1:4179/r/gggggggggggggggg/x/colab/', ['react']),
  ).rejects.toThrow('does not match its pin');
  serve({ 'assets/colab-runtime-base-0000000000000000.js': 'window.base = 2;' });
  await expect(loadRuntime(base)).rejects.toThrow('does not match its pin');
  serve({ 'assets/colab-runtime.css': new Response('no', { status: 404 }) });
  await expect(loadRuntime('http://127.0.0.1:4179/r/dddddddddddddddd/x/colab/')).rejects.toThrow(
    'Page runtime unavailable',
  );
  // The verified theme is kept; the failed base is fetched again.
  const fetched = serve();
  expect((await loadRuntime(base)).scripts).toEqual(['window.base = 1;']);
  expect(fetched).toEqual(['assets/colab-runtime-base-0000000000000000.js']);
});

test('the optional renderer is fetched only on demand, verified and reused without transferring the cache', async () => {
  const fetched = serve();
  const base = 'http://127.0.0.1:4179/r/eeeeeeeeeeeeeeee/x/colab/';
  expect((await loadRuntime(base)).wasm).toBeUndefined();
  expect(fetched).not.toContain('assets/colab-runtime-terminal-3333333333333333.wasm');
  const runtime = await loadRuntime(base, ['terminal-frame']);
  expect(new TextDecoder().decode(runtime.wasm!.bytes)).toBe('wasm-test-bytes');
  expect(runtime.wasm!.mime).toBe('application/wasm');
  const again = await loadRuntime(base, ['terminal-frame']);
  expect(again.wasm!.bytes).toBe(runtime.wasm!.bytes);
  expect(fetched.filter((path) => path.endsWith('.wasm'))).toHaveLength(1);
});

test('renderer bytes that exceed or differ from the pin are omitted and never cached', async () => {
  const path = 'assets/colab-runtime-terminal-3333333333333333.wasm';
  const base = 'http://127.0.0.1:4179/r/ffffffffffffffff/x/colab/';
  serve({ [path]: 'wasm-test-bytEs' });
  expect((await loadRuntime(base, ['terminal-frame'])).wasm).toBeUndefined();
  serve({ [path]: 'wasm-test-bytes too long' });
  expect((await loadRuntime(base, ['terminal-frame'])).wasm).toBeUndefined();
  serve();
  expect((await loadRuntime(base, ['terminal-frame'])).wasm).toBeDefined();
});

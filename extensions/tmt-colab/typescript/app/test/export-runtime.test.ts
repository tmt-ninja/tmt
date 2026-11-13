import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { fixture, input } from './export-input.js';
import { UTILITIES_ONLY } from '../src/page-runtime.js';

// A React page's export carries its standalone copy with the whole runtime from the same base the
// renderer frame uses, wherever the app runs (#1693); any other page the runtime's base (#6077); a
// page that uses the design system carries the design system's file from the same base (#5057).
// Only the marker parse needs a browser (DOMParser), so it is replaced by a text test; the base, the
// fetches, the request and the bundle are the real modules.
vi.mock('../src/page-runtime.js', async (original) => ({
  ...(await original<typeof import('../src/page-runtime.js')>()),
  wantsReact: (text: string) => /tmt-colab-runtime" content="[^"]*\breact\b/.test(text),
  hasRuntimeMarker: (text: string) => text.includes('tmt-colab-runtime'),
}));

// The pin over the texts this test serves: each file's text is `text of <file name>` (#6085).
const BASE = 'colab-runtime-base-0000000000000000.js';
const REACT = 'colab-runtime-react-2222222222222222.js';
const UI = 'colab-runtime-ui-1111111111111111.js';
vi.mock('../runtime-pin.json', () => {
  const file = (name: string) => {
    const text = `text of ${name}`;
    return {
      path: `assets/${name}`,
      sha256: createHash('sha256').update(text).digest('hex'),
      length: Buffer.byteLength(text),
    };
  };
  return {
    default: {
      chunks: [
        { name: 'base', ...file('colab-runtime-base-0000000000000000.js') },
        { name: 'react', ...file('colab-runtime-react-2222222222222222.js') },
        { name: 'ui', ...file('colab-runtime-ui-1111111111111111.js') },
      ],
      theme: file('colab-runtime.css'),
    },
  };
});
/** The runtime an export carries: every chunk in load order, then the seal. */
const runtimeScript = `<script>text of ${BASE}\ntext of ${REACT}\ntext of ${UI}\nwindow.__colabRuntimeSeal?.();</script>`;

const door = 'https://door.test';
const mount = `${door}/r/abcdefghijklmnop/x/colab/`;
const source: string = fixture.standalone.source;
/** A fresh copy of the modules (the shell host and the runtime cache are module state) in a page
 * at `href` whose document base is `baseURI`; `shell` is what the TMT app host would register. */
async function exportIn(
  href: string,
  baseURI: string,
  shell?: URL | null,
  ok: boolean | ((target: string) => boolean) = true,
  pageSource: string = source,
) {
  vi.resetModules();
  const url = new URL(href);
  const fetched: string[] = [];
  vi.stubGlobal('location', { href, origin: url.origin, pathname: url.pathname });
  vi.stubGlobal('document', { baseURI, querySelector: () => null });
  vi.stubGlobal('fetch', async (target: string) => {
    fetched.push(target);
    const up = typeof ok === 'function' ? ok(target) : ok;
    const name = new URL(target).pathname.split('/').pop();
    const body =
      name === 'colab-page-ui.json'
        ? JSON.stringify({ style: 'page UI style', script: 'page UI script' })
        : `text of ${name}`;
    return new Response(up ? body : 'gone', { status: up ? 200 : 404 });
  });
  const entry = await import('../src/entry.js');
  if (shell !== undefined) entry.hostInShell(shell);
  const { standaloneRequest } = await import('../src/export-runtime.js');
  const { prepareExport } = await import('../src/export.js');
  const request = await standaloneRequest({ source: pageSource });
  const bundle = await prepareExport({
    ...input(),
    source: pageSource,
    ...(request === undefined ? {} : { standalone: request }),
  });
  const copy = bundle.files.some((file) => file.name === 'page.standalone.html')
    ? await bundle.blob('page.standalone.html').text()
    : undefined;
  return { request, fetched, base: entry.rendererBase(), bundle, copy };
}
afterEach(() => vi.unstubAllGlobals());

it('exports inside the TMT app with the runtime from /colab/, the base the renderer frame uses', async () => {
  const { fetched, base, bundle, copy } = await exportIn(
    `${door}/colab/p/12345678?x=1`,
    `${door}/colab/p/`,
    null,
  );
  expect(base).toBe(`${door}/colab/`);
  expect(fetched).toEqual([
    `${door}/colab/assets/colab-runtime.css`,
    `${door}/colab/assets/${BASE}`,
    `${door}/colab/assets/${REACT}`,
    `${door}/colab/assets/${UI}`,
  ]);
  expect(bundle.files.slice(0, 2).map(({ name }) => name)).toEqual([
    'page.html',
    'page.standalone.html',
  ]);
  expect(bundle.standalone).toEqual({ included: true });
  expect(copy).toContain(runtimeScript);
  expect(copy).toContain('<style type="text/tailwindcss">text of colab-runtime.css</style>');
  expect(copy).toContain(`<body>${source}</body>`);
});

it('exports from the paired mount when the TMT app reads through one', async () => {
  const { fetched, base, bundle, copy } = await exportIn(
    `${door}/colab/p/12345678`,
    `${door}/colab/p/`,
    new URL(mount),
  );
  expect(base).toBe(mount);
  expect(fetched).toEqual([
    `${mount}assets/colab-runtime.css`,
    `${mount}assets/${BASE}`,
    `${mount}assets/${REACT}`,
    `${mount}assets/${UI}`,
  ]);
  expect(bundle.standalone).toEqual({ included: true });
  expect(copy).toContain(runtimeScript);
});

it('exports outside the TMT app from the document base', async () => {
  const { fetched, base, bundle } = await exportIn(`${door}/app/index.html`, `${door}/app/`);
  expect(base).toBe(`${door}/app/`);
  expect(fetched).toEqual([
    `${door}/app/assets/colab-runtime.css`,
    `${door}/app/assets/${BASE}`,
    `${door}/app/assets/${REACT}`,
    `${door}/app/assets/${UI}`,
  ]);
  expect(bundle.standalone).toEqual({ included: true });
});

it('still exports the page, and says why it has no copy, when the TMT app cannot load the runtime', async () => {
  // Another origin: the runtime a page already loaded is kept for the session, so a failure needs
  // a base nothing has loaded from.
  const down = 'https://down.test';
  const { request, bundle, copy } = await exportIn(
    `${down}/colab/p/12345678`,
    `${down}/colab/p/`,
    null,
    false,
  );
  expect(request).toEqual({ reason: 'runtime-unavailable' });
  expect(bundle.standalone).toEqual({ included: false, reason: 'runtime-unavailable' });
  expect(copy).toBeUndefined();
  expect(bundle.files.map(({ name }) => name)).toContain('page.html');
});

const design: string = fixture.standaloneDesign.source;
it('exports a design-system page with the design files from the base the renderer frame uses, and the runtime base', async () => {
  // Its own origin: what a page loaded is kept for the session, so each case needs a base nothing has loaded from.
  const own = 'https://design.test';
  const { request, fetched, bundle, copy } = await exportIn(
    `${own}/colab/p/12345678?x=1`,
    `${own}/colab/p/`,
    null,
    true,
    design,
  );
  expect([...fetched].sort()).toEqual(
    [
      `${own}/colab/assets/colab-page-ui.json`,
      `${own}/colab/assets/colab-runtime.css`,
      `${own}/colab/assets/${BASE}`,
    ].sort(),
  );
  expect(request).toEqual({
    runtime: {
      script: `text of ${BASE}\nwindow.__colabRuntimeSeal?.();`,
      style: `${UTILITIES_ONLY}text of colab-runtime.css`,
    },
    design: { script: 'page UI script', style: 'page UI style' },
  });
  expect(bundle.standalone).toEqual({ included: true });
  expect(copy).toContain('<style>page UI style</style>');
  expect(copy).toContain('<script>page UI script</script>');
  expect(copy).toContain('<html data-colab-design>');
  expect(copy).not.toContain(REACT);
});

it('loads the runtime and the design files for a page that asks for both, and the base alone for a plain page', async () => {
  const own = 'https://both.test';
  const both = `${source}${design}`;
  const first = await exportIn(`${own}/colab/p/12345678`, `${own}/colab/p/`, null, true, both);
  expect([...first.fetched].sort()).toEqual(
    [
      `${own}/colab/assets/colab-page-ui.json`,
      `${own}/colab/assets/colab-runtime.css`,
      `${own}/colab/assets/${BASE}`,
      `${own}/colab/assets/${REACT}`,
      `${own}/colab/assets/${UI}`,
    ].sort(),
  );
  expect(first.bundle.standalone).toEqual({ included: true });
  const plain = await exportIn(
    `${own}/colab/p/12345678`,
    `${own}/colab/p/`,
    null,
    true,
    '<p>plain</p>',
  );
  // Every page compiles Tailwind's utilities (#6077): a plain page's copy carries the base.
  expect(plain.request).toEqual({
    runtime: {
      script: `text of ${BASE}\nwindow.__colabRuntimeSeal?.();`,
      style: `${UTILITIES_ONLY}text of colab-runtime.css`,
    },
  });
  expect(plain.fetched).toEqual([]);
  expect(plain.copy).toContain(`<script>text of ${BASE}\nwindow.__colabRuntimeSeal?.();</script>`);
});

it('says the design system could not be loaded, whatever else loaded', async () => {
  const down = 'https://down-design.test';
  const { request, bundle, copy } = await exportIn(
    `${down}/colab/p/12345678`,
    `${down}/colab/p/`,
    null,
    (target) => !target.includes('colab-page-ui'),
    design,
  );
  expect(request).toEqual({ reason: 'design-unavailable' });
  expect(bundle.standalone).toEqual({ included: false, reason: 'design-unavailable' });
  expect(copy).toBeUndefined();
});

it('hands the renderer frame the same base the export uses', async () => {
  vi.resetModules();
  vi.stubGlobal('location', {
    href: `${door}/colab/p/12345678`,
    origin: door,
    pathname: '/colab/p/12345678',
  });
  vi.stubGlobal('document', { baseURI: `${door}/colab/p/`, querySelector: () => null });
  const entry = await import('../src/entry.js');
  entry.hostInShell(null);
  const { rendererUrl } = await import('../src/renderer.js');
  expect(rendererUrl(entry.rendererBase())).toBe(`${door}/colab/renderer.html`);
});

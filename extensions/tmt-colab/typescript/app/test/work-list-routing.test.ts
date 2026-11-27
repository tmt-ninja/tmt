import { afterEach, expect, it, vi } from 'vite-plus/test';
import { localTransport } from '../src/transport.js';

afterEach(() => vi.unstubAllGlobals());

const space = 'a'.repeat(32);
const page = '10000000-0000-4000-8000-000000000001';
const pagePath = `/pages/${page}`;
const ownerFragment = `#space=${space}&path=${encodeURIComponent(pagePath)}`;

async function start(path: string, entry: 'shell' | 'mounted' | 'preview') {
  // Shell admission belongs to the module instance in a tab.
  vi.resetModules();
  const location = new URL(path, 'http://localhost');
  const replaceState: History['replaceState'] = (state, _unused, href) => {
    history.state = state;
    if (href != null) location.href = new URL(href, location).href;
  };
  const history = { state: null, pushState: replaceState, replaceState };
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', history);
  vi.stubGlobal('document', new EventTarget());
  const window = Object.assign(new EventTarget(), { location, history });
  vi.stubGlobal('window', window);
  vi.stubGlobal('self', window);
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
  if (entry === 'shell')
    (await import('../src/entry.js')).hostInShell(
      new URL('/r/abcdefghijklmnop/x/colab/', location),
    );
  const { createAppRouter, shellLocation } = await import('../src/router.js');
  if (entry === 'shell') shellLocation();
  return createAppRouter(
    localTransport('Routing fixture', []),
    entry === 'preview' ? undefined : space,
  );
}

it.each([
  [
    'shell owner fragment',
    '/colab/' + ownerFragment,
    'shell',
    '/colab' + pagePath,
    '/pages/$pageId',
  ],
  [
    'mounted owner history',
    '/r/abcdefghijklmnop/x/colab/' + ownerFragment,
    'mounted',
    pagePath,
    '/pages/$pageId',
  ],
  ['public short link', '/p/10000000', 'mounted', '/short/10000000', '/short/$prefix'],
] as const)(
  '%s matches the page route before loading',
  async (_name, href, entry, path, route) => {
    const router = await start(href, entry);
    try {
      expect(router.history.location.pathname).toBe(path);
      expect(router.matchRoutes(router.state.location).at(-1)?.routeId).toBe(route);
    } finally {
      router.history.destroy();
    }
  },
  15_000,
);

it('the preview root redirects to Work List', async () => {
  const router = await start('/', 'preview');
  try {
    await router.load();
    router.history.flush();
    expect(window.location.hash).toBe('#/work/list');
    expect(router.matchRoutes(router.state.location).at(-1)?.routeId).toBe('/work/list');
  } finally {
    router.history.destroy();
  }
});

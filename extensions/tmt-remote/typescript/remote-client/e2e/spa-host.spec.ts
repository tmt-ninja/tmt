import { expect, test, chromium, type Browser, type Page, type Request } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mockDocument } from '../src/digest-mock.js';
import type { UsageRange } from '../src/digest-source.js';

/**
 * The one TMT web app as a host (#3937): conditions the door and the shell must keep, against a
 * real `tmt remote serve` and Chromium. Run it with the binary built by
 * `cargo build -p tmt-remote`, or point TMT_REMOTE_BINARY at one.
 *
 * Tests whose reason is a door or shell gap name it in a TODO and start expected-to-fail.
 */
const BINARY =
  process.env.TMT_REMOTE_BINARY ??
  fileURLToPath(new URL('../../../../../rust/target/debug/tmt-remote', import.meta.url));

let root: string;
let serve: ChildProcessWithoutNullStreams;
let origin: string;
let address: string;
let browser: Browser;

test.beforeAll(async () => {
  // Short root: Unix socket paths are limited to about 100 bytes. The door runs in this private
  // HOME with the fixture core; it never touches the owner's TMT data or tmux.
  root = await mkdtemp('/tmp/tmt-e2e-');
  await writeFile(
    join(root, 'core.mjs'),
    await readFile(new URL('./core-fixture.mjs', import.meta.url)),
    { mode: 0o700 },
  );
  serve = spawn(BINARY, ['serve', '--json'], {
    env: {
      PATH: process.env.PATH,
      HOME: root,
      TMT_AGENT: '1',
      BROWSER: 'true',
      TMT_EXECUTABLE: join(root, 'core.mjs'),
      TMT_FIXTURE_ROOT: root,
    },
  });
  const line = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No descriptor within 30 s.')), 30000);
    createInterface({ input: serve.stdout }).once('line', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  address = (JSON.parse(line) as { address: string }).address;
  origin = new URL(address).origin;
  browser = await chromium.launch();
});
test.afterAll(async () => {
  const failures: unknown[] = [];
  const step = async (release: () => unknown) => {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  };
  await step(() => browser?.close());
  await step(async () => {
    if (!serve || serve.exitCode !== null || serve.signalCode !== null) return;
    const exited = new Promise((resolve) => serve.once('exit', resolve));
    serve.kill('SIGTERM');
    await exited;
  });
  await step(() => root && rm(root, { recursive: true, force: true }));
  if (failures.length) throw new AggregateError(failures, 'SPA host teardown failed');
});

const get = (path: string, init: RequestInit = {}) =>
  fetch(`${origin}${path}`, { redirect: 'manual', ...init });

/** Routes the door answers with the one shell document. */
const APP_ROUTES = [
  '/',
  '/settings',
  '/settings/',
  '/remote',
  '/remote/',
  '/remote/create',
  '/remote/join',
  '/remote/overview',
  '/remote/members',
  '/remote/invites',
  '/remote/my-devices',
  '/remote/service',
  '/remote/settings',
  '/ops',
  '/ops/',
  '/digest',
  '/digest/',
  '/colab',
  '/colab/',
  '/colab/p/abc123',
  '/colab/a/b',
];
/** Near misses and neighbours the shell must not claim. */
const NOT_APP_ROUTES = [
  '/nope',
  '/remote/other',
  '/ops/x',
  '/digest/x',
  '/settings/x',
  '/colab/a.b',
  `/colab/${'a'.repeat(161)}`,
  '/read',
  '/read/x',
  '/x',
  '/x/colab/',
  '/pair/x',
];

test.describe('the door', () => {
  test('answers GET and HEAD of the explicit route list with the one shell', async () => {
    const shell = await (await get('/')).text();
    expect(shell).toContain('/sdk/shell.js');
    for (const path of APP_ROUTES) {
      const full = await get(path);
      expect(full.status, `GET ${path}`).toBe(200);
      expect(full.headers.get('content-type'), `GET ${path}`).toBe('text/html; charset=utf-8');
      expect(await full.text(), `GET ${path} is the same document`).toBe(shell);
      const head = await get(path, { method: 'HEAD' });
      expect(head.status, `HEAD ${path}`).toBe(200);
      for (const name of ['content-type', 'content-security-policy', 'cache-control']) {
        expect(head.headers.get(name), `HEAD ${path} ${name}`).toBe(full.headers.get(name));
      }
      expect(await head.text(), `HEAD ${path} has no body`).toBe('');
    }
    // A cross-origin load is refused.
    expect((await get('/', { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
  });

  test('answers 404 for every path off the list and for any other method', async () => {
    for (const path of NOT_APP_ROUTES)
      for (const method of ['GET', 'HEAD'])
        expect((await get(path, { method })).status, `${method} ${path}`).toBe(404);
    for (const path of ['/', '/colab/p/abc123', '/settings', '/remote/settings'])
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
        expect((await get(path, { method, body: '{}' })).status, `${method} ${path}`).toBe(404);
  });

  test('keeps /sdk, /x, /p, /read and /pair as they were', async () => {
    const shell = await (await get('/')).text();
    // The SDK and its assets are served by name, not by the fallback.
    for (const [path, type] of [
      ['/sdk/remote-v1.js', 'text/javascript; charset=utf-8'],
      ['/sdk/shell.js', 'text/javascript; charset=utf-8'],
      ['/sdk/pages.css', 'text/css; charset=utf-8'],
    ] as const) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type'), path).toBe(type);
      expect(await response.text(), path).not.toBe(shell);
    }
    expect((await get('/sdk/nope')).status).toBe(404);
    // The legacy pairing link and the owner's short page link redirect, for GET and HEAD.
    for (const method of ['GET', 'HEAD']) {
      const pair = await get('/pair', { method });
      expect([pair.status, pair.headers.get('location')], `${method} /pair`).toEqual([
        308,
        '/remote/pair',
      ]);
      const short = await get('/p/abcd1234', { method });
      expect([short.status, short.headers.get('location')], `${method} /p`).toEqual([
        308,
        '/colab/p/abcd1234',
      ]);
    }
    expect((await get('/pair', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    // The pairing page keeps its own document and its own script hash.
    const pairing = await get('/remote/pair');
    expect(pairing.status).toBe(200);
    expect(await pairing.text()).not.toBe(shell);
    expect(pairing.headers.get('content-security-policy')).toMatch(/script-src 'self' 'sha256-/);
    // /read and an unprefixed /x are not the app's; module mounts live under the machine prefix.
    for (const path of ['/read', '/read/x', '/x', '/x/colab/', '/x/-/shell'])
      expect((await get(path)).status, path).toBe(404);
  });

  test('keeps the strict request-target grammar in front of the fallback', async () => {
    // A path escape, empty inner segment or malformed/escaped query key is a malformed
    // target (400), never the shell; the fallback stays an explicit list.
    for (const path of [
      '/settings?section=%G1',
      '/colab/pages/abcd?read=a/b',
      '/colab/pages/abcd?tmt-session=x',
      '/colab/a%2Fb',
      '/colab//x',
    ])
      for (const method of ['GET', 'HEAD'])
        expect((await get(path, { method })).status, `${method} ${path}`).toBe(400);
    // The app writes its own keys and opaque values onto its routes, so a
    // reload of such an address is the shell.
    for (const path of ['/colab/pages/abcd?read=x', '/colab/p/abcd?open=1&a=b'])
      expect((await get(path)).status, path).toBe(200);
  });

  test('redirects a short page link and preserves its opaque query bytes', async () => {
    for (const method of ['GET', 'HEAD']) {
      const short = await get('/p/abcd1234?open=1&a=b', { method });
      expect([short.status, short.headers.get('location')], method).toEqual([
        308,
        '/colab/p/abcd1234?open=1&a=b',
      ]);
    }
    for (const method of ['GET', 'HEAD']) {
      for (const query of ['project=%5B%22blog%22%5D', 'project=%E6%96%87&read=%2f%2F']) {
        const short = await get(`/p/abcd1234?${query}`, { method });
        expect([short.status, short.headers.get('location')], `${method} ${query}`).toEqual([
          308,
          `/colab/p/abcd1234?${query}`,
        ]);
      }
    }
    for (const path of [
      '/p/abcd1234?a=%G1',
      '/p/abcd1234?a=%4',
      '/p/abcd1234?a=%',
      '/p/abcd1234?%61=b',
      '/p/abcd1234?a=/../x',
      '/p/abcd1234?a=b;c',
    ])
      expect((await get(path)).status, path).toBe(400);
  });

  test('app routes keep well-formed escaped query values opaque without widening paths or handoff', async () => {
    const shell = await (await get('/')).text();
    // Colab's locked TanStack serializer uses URLSearchParams over JSON search values.
    const projectQuery = new URLSearchParams({
      project: JSON.stringify(['Q4 plan*(a)!~', '文']),
    }).toString();
    expect(projectQuery).toBe('project=%5B%22Q4+plan*%28a%29%21%7E%22%2C%22%E6%96%87%22%5D');
    const spacedName = new URLSearchParams({ project: JSON.stringify(['Q4 plan']) }).toString();
    for (const method of ['GET', 'HEAD']) {
      for (const path of ['/', '/colab/', '/colab/p/abcd', '/remote/']) {
        for (const query of [
          'project=%5B%22blog%22%5D',
          projectQuery,
          spacedName,
          'project=%E6%96%87',
          'read=%20',
          'read=%2F%26tmt-session%3Dopaque',
        ]) {
          const reply = await get(`${path}?${query}`, { method });
          expect(reply.status, `${method} ${path}?${query}`).toBe(200);
          expect(reply.headers.get('set-cookie')).toBeNull();
          if (method === 'GET') expect(await reply.text()).toBe(shell);
        }
      }
      for (const query of [
        'a=%G1',
        'a=%4',
        'a=%',
        'tmt%2Dsession=x',
        '%61=b',
        'a+b=x',
        'a*b=x',
        'tmt-session=x',
        'tmt-session=11111111-1111-4111-8111-111111111111',
        'a=b=c',
      ])
        expect((await get(`/colab/?${query}`, { method })).status, `${method} ${query}`).toBe(400);
      expect((await get('/colab/a%2Fb?project=%5B%5D', { method })).status).toBe(400);
    }
  });

  test('serves shell.html public and static', async () => {
    const plain = await get('/');
    const body = await plain.text();
    // The same bytes with or without a cookie or a device header, on every route and request.
    for (const init of <RequestInit[]>[
      {},
      { headers: { Cookie: 'tmt-session=a; tmt-device=b' } },
      { headers: { 'tmt-device-context': 'x' } },
    ]) {
      const again = await get('/colab/p/xyz', init);
      expect(await again.text()).toBe(body);
      expect(again.headers.get('set-cookie')).toBeNull();
      expect(again.headers.get('cache-control')).toBe('no-store');
    }
    expect(plain.headers.get('set-cookie')).toBeNull();
    // Nothing per machine or per request is embedded: no route prefix, no inline script.
    expect(body).not.toContain(new URL(address).pathname);
    expect(body).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(body).not.toMatch(/\son\w+\s*=/);
    expect([...body.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1])).toEqual([
      '/sdk/shell.js',
    ]);
  });

  test('gives the shell a strict CSP', async () => {
    const policy = (await get('/')).headers.get('content-security-policy')!;
    const directives = parsePolicy(policy);
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('script-src')).toEqual(["'self'"]);
    for (const name of ['base-uri', 'form-action', 'object-src', 'frame-ancestors'])
      expect(directives.get(name), name).toEqual(["'none'"]);
    expect(policy).not.toMatch(/unsafe-|\*|https?:/);
  });

  test('pins the shell CSP: the page policy plus only what the Colab route needs', async () => {
    // Agreed with tmt-lead and remote-lead (#3937): the pairing page's policy plus exactly
    // img-src 'self', worker-src 'self', frame-src 'self' and object-src 'none'. Any widening fails.
    const page =
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    const shell =
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'";
    for (const path of ['/', '/remote/', '/settings', '/colab/', '/colab/pages/x'])
      expect((await get(path)).headers.get('content-security-policy'), path).toBe(shell);
    // Pairing keeps its own document and the page policy, with its bootstrap's hash only.
    const pairing = (await get('/remote/pair')).headers.get('content-security-policy')!;
    expect(pairing.replace(/ 'sha256-[^']+'/, '')).toBe(page);
    // No wider than Colab's app document policy (tmt-colab browser_policy.rs POLICY).
    const source = await readFile(
      fileURLToPath(
        new URL('../../../../tmt-colab/rust/tmt-colab/src/browser_policy.rs', import.meta.url),
      ),
      'utf8',
    );
    const colab = parsePolicy(/pub const POLICY: &str = "([^"]+)"/.exec(source)![1]!);
    for (const [name, sources] of parsePolicy(shell)) {
      const allowed = new Set(colab.get(name) ?? colab.get('default-src') ?? ["'none'"]);
      for (const value of sources) expect(allowed, `${name} ${value}`).toContain(value);
    }
  });
});

/** `name -> sources`; a hash source stands for any per-page script hash. */
function parsePolicy(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [
        name!,
        sources.map((source) => (source.startsWith("'sha256-") ? "'sha256-*'" : source)),
      ]),
  );
}

/** Open an app route in a fresh page and watch its requests. */
async function openApp(path: string, prepare?: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepare?.(page);
  await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  await page.locator('.tmt-ui-shell-main[data-route]').waitFor({ timeout: 10000 });
  expect(errors).toEqual([]);
  return { page, requests, url: (request: Request) => new URL(request.url()) };
}

/** The same nested module tree is visible in the wide rail or open phone drawer. */
const modulePages = (page: Page) => page.locator('.tmt-ui-rail-sub:visible');

/** Requests that are not the document or the door's own static SDK files. */
const beyondAssets = (requests: Request[]) =>
  requests
    .filter((request) => !request.isNavigationRequest())
    .map((request) => `${request.method()} ${new URL(request.url()).pathname}`)
    .filter(
      (entry) =>
        !/^GET \/sdk\/(pages\.css|settings\.css|shell\.js|remote-v1\.js|settings-v1\.js|ops-composer-v1\.js)$/.test(
          entry,
        ),
    );

test.describe('route identities in the shared top bar', () => {
  for (const width of [1440, 390])
    for (const colorScheme of ['light', 'dark'] as const)
      test(`route title ownership at ${width} ${colorScheme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.addInitScript(
          (theme) => localStorage.setItem('tmt-ui-theme', theme),
          colorScheme,
        );
        await page.goto(`${origin}/`);
        const cases = [
          ['/', 'Home'],
          ['/remote/', 'My Remotes'],
          ['/remote/overview', 'Overview'],
          ['/remote/members', 'People'],
          ['/remote/my-devices', 'My devices'],
          ['/remote/service', 'Service & upgrade'],
          ['/remote/settings', 'Settings'],
          ['/remote/create', 'Create a Remote'],
          ['/remote/join', 'Join a Remote'],
          ['/ops#agents', 'Ops'],
          ['/ops#squads', 'Ops'],
          ['/ops#schedules', 'Ops'],
          ['/ops#settings', 'Ops'],
          ['/digest', 'Digest'],
          ['/settings#general', 'General'],
          ['/settings#identities', 'Identities'],
          ['/settings#modules', 'Modules'],
          ['/settings#drivers', 'Drivers & hooks'],
        ] as const;
        try {
          await page.evaluate(() => {
            (window as unknown as { titleDocument: number }).titleDocument = 1;
          });
          for (const [path, current] of cases) {
            await page.evaluate((path) => {
              history.pushState(null, '', path);
              window.dispatchEvent(new PopStateEvent('popstate'));
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }, path);
            const title = page.locator('.tmt-ui-topbar-navigation h1');
            await expect(title.locator('.tmt-ui-topbar-title-current'), path).toHaveText(current);
            await expect(page.locator('h1'), path).toHaveCount(1);
            await expect(page.locator('.tmt-ui-shell-main h1,.root-title-row'), path).toHaveCount(
              0,
            );
            const main = page.locator('.tmt-ui-shell-main');
            if (path.startsWith('/remote')) await expect(main).toHaveAttribute('data-remote-view');
            else await expect(main).not.toHaveAttribute('data-remote-view');
            const prefix = title.locator('.tmt-ui-topbar-title-prefix');
            if (await prefix.count()) {
              if (width <= 900) await expect(prefix, path).toBeHidden();
              else await expect(prefix, path).toBeVisible();
            }
            const geometry = await title.evaluate((node) => {
              const bar = node.closest('.tmt-ui-topbar')!.getBoundingClientRect();
              const box = node.getBoundingClientRect();
              return {
                inside: box.top >= bar.top && box.bottom <= bar.bottom,
                overflow: document.documentElement.scrollWidth > innerWidth,
              };
            });
            expect(geometry, path).toEqual({ inside: true, overflow: false });
            if (path === '/remote/') {
              await expect(page.locator('.tmt-ui-topbar-actions .remote-head-actions')).toHaveCount(
                0,
              );
              await expect(page.locator('#remote-head .remote-head-actions')).toBeVisible();
              const actions = page.locator('#remote-head .remote-head-actions');
              await expect(actions.locator(':scope > *').first()).toHaveAttribute(
                'data-variant',
                'primary',
              );
              await expect(actions.locator(':scope > *').last()).toHaveAttribute(
                'id',
                'remote-join',
              );
              await expect(
                page
                  .locator('#remote-head')
                  .getByRole('button', { name: 'Join a Remote', exact: true }),
              ).toHaveText('Join');
            }
            await page.mouse.move(0, 0);
            await page.screenshot({
              path: testInfo.outputPath(
                `route-${path.replace(/[^a-z0-9]/gi, '-') || 'home'}-${width}-${colorScheme}.png`,
              ),
            });
          }
          expect(
            await page.evaluate(
              () => (window as unknown as { titleDocument: number }).titleDocument,
            ),
          ).toBe(1);
          await page.goBack();
          await expect(page.locator('.tmt-ui-topbar-title-current')).toHaveText('Modules');
          await page.goForward();
          await expect(page.locator('.tmt-ui-topbar-title-current')).toHaveText('Drivers & hooks');
        } finally {
          await page.close();
        }
      });
});

test.describe('the app in a browser', () => {
  test('makes no session reads from an unpaired /remote', async () => {
    const { page, requests } = await openApp('/remote');
    await expect(page.locator('.tmt-ui-shell-main[data-route="remote"]')).toContainText(
      'Not paired',
    );
    await page.waitForTimeout(1500);
    // The composed list loads only its static assets; no session or management reads.
    expect(beyondAssets(requests)).toEqual([]);
    await page.close();
  });

  test('loads no Colab chunk on the Colab route unpaired', async () => {
    for (const path of ['/colab', '/colab/p/abc123']) {
      const { page, requests } = await openApp(path);
      await expect(page.locator('.tmt-ui-shell-main[data-route="colab"]')).toContainText(
        'Pair this browser with Remote to open Colab',
      );
      await page.waitForTimeout(500);
      // Only the page's own mount and the composed-shell read may be asked; no module under a
      // mount, and no Colab asset, is fetched.
      for (const entry of beyondAssets(requests))
        expect(entry, path).toMatch(/^(POST \/sdk\/mount|GET \/r\/[a-z0-9]+\/x\/-\/shell)$/);
      expect(requests.map((request) => request.url()).join('\n')).not.toMatch(
        /\/x\/colab\/|\/colab\/assets\//,
      );
      await page.close();
    }
  });

  test('every focusable on every route shows one inset frame (#3998 tab walk)', async () => {
    const { page } = await openApp('/');
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ['/', '/remote/', '/remote/settings', '/settings', '/ops', '/digest']) {
        await page.goto(`${origin}${path}`);
        // The route's own markup is in place and no first read is still painting.
        await expect(page.locator('.tmt-ui-shell-main > :not([hidden])').first()).toBeVisible();
        await expect(page.locator('.tmt-page-loading')).toHaveCount(0);
        await page.locator('body').focus();
        const seen = new Set<string>();
        let first = '';
        for (let step = 0; step < 60; step++) {
          await page.keyboard.press('Tab');
          const focus = await page.evaluate(() => {
            const element = document.activeElement as HTMLElement | null;
            if (!element || element === document.body) return undefined;
            const style = getComputedStyle(element);
            const width = Number.parseFloat(style.outlineWidth);
            const outline = style.outlineStyle !== 'none' && width > 0;
            const wrong: string[] = [];
            if (style.outlineStyle === 'auto') wrong.push('a browser default ring');
            if (outline && Number.parseFloat(style.outlineOffset) > -width)
              wrong.push(`an outline outside its border (offset ${style.outlineOffset})`);
            if (
              style.boxShadow !== 'none' &&
              style.boxShadow.split(/,(?![^(]*\))/).some((shadow) => !/inset/.test(shadow))
            )
              wrong.push('an outer glow');
            const name =
              element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 24) ?? '';
            const key = `${element.tagName.toLowerCase()}.${element.className} ${name}`;
            return { key, wrong };
          });
          if (!focus) continue;
          // One lap: stop when focus comes back to the first control.
          if (focus.key === first) break;
          first ||= focus.key;
          if (seen.has(focus.key)) continue;
          seen.add(focus.key);
          if (focus.wrong.length)
            problems.push(`${scheme} ${path} ${focus.key}: ${focus.wrong.join(', ')}`);
        }
        expect(seen.size, `${scheme} ${path} reached focusables`).toBeGreaterThan(3);
      }
    }
    expect(problems).toEqual([]);
    await page.close();
  });

  /** Remote's rows: the path, the menu row, the page heading, a heading that shows and one that
   * does not (the views share one document, so a hidden one is in the page but not shown). */
  const REMOTE_VIEWS = [
    {
      path: '/remote/',
      id: 'remotes',
      h1: 'My Remotes',
      shown: '#remotes',
      hidden: '#remote-context',
    },
    {
      path: '/remote/overview',
      id: 'overview',
      h1: 'Overview',
      shown: '#heading',
      hidden: '#remotes',
    },
    {
      path: '/remote/members',
      id: 'members',
      h1: 'People',
      shown: '#people-content',
      hidden: '#opening-title',
    },
    {
      path: '/remote/my-devices',
      id: 'my-devices',
      h1: 'My devices',
      shown: '#devices-title',
      hidden: '#opening-title',
    },
    {
      path: '/remote/settings',
      id: 'settings',
      h1: 'Settings',
      shown: '#opening-title',
      hidden: '#remotes',
    },
    {
      path: '/remote/service',
      id: 'service',
      h1: 'Service & upgrade',
      shown: '#remote-locked',
      hidden: '#opening-title',
    },
  ] as const;
  const litRow = (page: Page) =>
    page
      .locator('nav.tmt-ui-rail [aria-current="page"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-id')));
  const expectView = async (page: Page, view: (typeof REMOTE_VIEWS)[number]) => {
    expect(new URL(page.url()).pathname, view.id).toBe(view.path);
    expect(new URL(page.url()).hash, view.id).toBe('');
    await expect
      .poll(() => litRow(page), view.id)
      .toEqual([view.id === 'overview' ? 'remote' : view.id === 'service' ? 'settings' : view.id]);
    if (view.id !== 'remotes')
      await expect(page.locator(`#remote-tab-${view.id}`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tmt-ui-topbar-title-current'), view.id).toHaveText(view.h1);
    await expect(page.locator(view.shown), view.id).toBeVisible();
    await expect(page.locator(view.hidden), view.id).toBeHidden();
    await expect(page, view.id).toHaveTitle(`${view.h1} · TMT`);
  };

  async function selectView(page: Page, view: (typeof REMOTE_VIEWS)[number]): Promise<void> {
    const menu = modulePages(page);
    if (view.id === 'remotes') await menu.locator('a[data-id="remotes"]').click();
    else {
      if (new URL(page.url()).pathname === '/remote/')
        await page.locator('#remote-list [data-this-machine="true"] [data-action="open"]').click();
      await page.locator(`#remote-tab-${view.id}`).click();
    }
  }

  test('each Remote row is its own route and selection follows the URL', async () => {
    for (const view of REMOTE_VIEWS) {
      // A direct load, and a reload, land on the row the path names.
      const { page } = await openApp(view.path);
      await expectView(page, view);
      await page.reload({ waitUntil: 'load' });
      await expectView(page, view);
      await page.close();
    }
  });

  test('switching between Remote rows only swaps the content: no remount, no storage', async () => {
    const { page } = await openApp('/remote/');
    // Marks on what must survive a switch: the document, the shell's header slot and content slot,
    // the rail and the module menu element. Mutations of the slots' own children are counted.
    await page.evaluate(() => {
      const w = window as unknown as { __kept: unknown; __swaps: number };
      const bar = document.querySelector('.tmt-ui-shell-bar')!;
      const main = document.querySelector('.tmt-ui-shell-main')!;
      w.__kept = {
        bar: bar.firstElementChild,
        main: [...main.children],
        rail: document.querySelector('nav.tmt-ui-rail'),
        mark: 1,
      };
      w.__swaps = 0;
      const watch = new MutationObserver((records) => {
        for (const record of records) if (record.type === 'childList') w.__swaps++;
      });
      watch.observe(bar, { childList: true });
      watch.observe(main, { childList: true });
    });
    for (const view of REMOTE_VIEWS.slice(1).concat(REMOTE_VIEWS[0])) {
      await selectView(page, view);
      await expectView(page, view);
    }
    const kept = await page.evaluate(() => {
      const w = window as unknown as {
        __kept: { bar: Element; main: Element[]; rail: Element; mark: number };
        __swaps: number;
      };
      const bar = document.querySelector('.tmt-ui-shell-bar')!;
      const main = document.querySelector('.tmt-ui-shell-main')!;
      return {
        sameDocument: w.__kept.mark === 1,
        bar: bar.firstElementChild === w.__kept.bar,
        main:
          main.children.length === w.__kept.main.length &&
          [...main.children].every((child, index) => child === w.__kept.main[index]),
        rail: document.querySelector('nav.tmt-ui-rail') === w.__kept.rail,
        swaps: w.__swaps,
        stored: Object.keys(sessionStorage).filter((key) => key.startsWith('tmt.remote.menu')),
      };
    });
    expect(kept).toEqual({
      sameDocument: true,
      bar: true,
      main: true,
      rail: true,
      swaps: 0,
      stored: [],
    });
    await page.close();
  });

  test('Back and forward land on the same row, selected', async () => {
    const { page } = await openApp('/remote/');
    const order = [REMOTE_VIEWS[1]!, REMOTE_VIEWS[3]!, REMOTE_VIEWS[4]!, REMOTE_VIEWS[2]!];
    for (const view of order) {
      await selectView(page, view);
      await expectView(page, view);
    }
    for (const view of [...order.slice(0, -1).reverse(), REMOTE_VIEWS[0]!]) {
      await page.goBack();
      await expectView(page, view);
    }
    for (const view of order) {
      await page.goForward();
      await expectView(page, view);
    }
    await page.close();
  });

  test('captures every Remote row at 1440 and 390, light and dark', async () => {
    // Evidence for review, written only when a directory is named (TMT_REMOTE_CAPTURE_DIR).
    const directory = process.env.TMT_REMOTE_CAPTURE_DIR;
    test.skip(!directory, 'TMT_REMOTE_CAPTURE_DIR is not set');
    await mkdir(directory!, { recursive: true });
    for (const colorScheme of ['light', 'dark'] as const)
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ colorScheme, viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.goto(`${origin}/remote/`, { waitUntil: 'load' });
        await page.locator('.tmt-ui-shell-main[data-route="remote"]').waitFor();
        for (const view of REMOTE_VIEWS) {
          // Narrow screens keep the menu behind its button; the path is what is being shown.
          await page.evaluate((path) => window.history.pushState(null, '', path), view.path);
          await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
          await expectView(page, view);
          await page.screenshot({
            path: join(directory!, `remote-${view.id}-${width}-${colorScheme}.png`),
          });
        }
        await context.close();
      }
  });

  test('the Remote rail never retains invitation query or fragment', async () => {
    const { page } = await openApp('/remote/join?token=private-query#private-fragment');
    await page.locator('nav.tmt-ui-rail a[data-id="ops"]').click();
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'ops');
    const remote = page.locator('nav.tmt-ui-rail a[data-id="remote"]');
    const href = new URL((await remote.getAttribute('href'))!, page.url());
    expect(href.pathname).toBe('/remote/join');
    expect(href.search).toBe('');
    expect(href.hash).toBe('');
    await remote.click();
    expect(new URL(page.url()).pathname).toBe('/remote/join');
    expect(new URL(page.url()).search).toBe('');
    expect(new URL(page.url()).hash).toBe('');
    await page.close();
  });

  test('the rail returns to the last Remote location and My Remotes remains explicit', async () => {
    const { page } = await openApp('/remote/settings');
    await page.locator('nav.tmt-ui-rail a[data-id="ops"]').click();
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'ops');
    await page.locator('nav.tmt-ui-rail a[data-id="remote"]').click();
    await expectView(
      page,
      REMOTE_VIEWS.find((view) => view.id === 'settings')!,
    );
    await modulePages(page).locator('a[data-id="remotes"]').click();
    await expectView(page, REMOTE_VIEWS[0]!);
    // The menu has no Remotes heading; This machine's group keeps its own.
    await expect(modulePages(page).locator('.tmt-ui-rail-sub-group')).not.toContainText([
      'Remotes',
    ]);
    await expect(modulePages(page)).toContainText('This machine');
    await expect(modulePages(page).locator('a[data-id="remotes"]')).toContainText('My Remotes');
    await page.close();
  });

  test("loads a page's own stylesheet with its route and drops it on leaving", async () => {
    const { page } = await openApp('/remote/settings');
    const sheet = page.locator('head link[rel="stylesheet"][href="/sdk/settings.css"]');
    await expect(sheet).toHaveCount(1);
    // Its rules apply before the markup shows: the page's choice control keeps its arrow room.
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'remote');
    await page.locator('nav.tmt-ui-rail a[data-id="ops"]').click();
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'ops');
    await expect(sheet).toHaveCount(0);
    await page.goBack();
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'remote');
    await expect(sheet).toHaveCount(1);
    await page.close();
  });

  test('shows the identical rail on every route with one document load', async () => {
    const { page, requests } = await openApp('/');
    await page.evaluate(() => ((window as unknown as { __spa: number }).__spa = 1));
    const rail = () =>
      page.locator('nav.tmt-ui-rail a.tmt-ui-rail-item').evaluateAll((items) =>
        items.map((item) => ({
          id: item.getAttribute('data-id'),
          label: item.textContent?.trim(),
          href: item.getAttribute('href'),
          disabled: item.getAttribute('aria-disabled'),
          current: item.hasAttribute('data-module-current'),
        })),
      );
    const first = await rail();
    expect(first.map((item) => item.id)).toEqual([
      'home',
      'colab',
      'design',
      'remote',
      'ops',
      'digest',
      'settings',
    ]);
    const stable = (items: typeof first) => items.map(({ current: _current, ...item }) => item);
    expect(first.filter((item) => item.current).map((item) => item.id)).toEqual(['home']);
    // Follow the rail through every route this app serves itself, then walk back.
    for (const id of ['remote', 'ops', 'digest', 'settings', 'home']) {
      await page.locator(`nav.tmt-ui-rail a[data-id="${id}"]`).click();
      const route = id === 'settings' ? 'settings' : id;
      await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', route);
      const items = await rail();
      expect(stable(items), id).toEqual(stable(first));
      expect(
        items.filter((item) => item.current).map((item) => item.id),
        id,
      ).toEqual([id]);
    }
    await page.goBack();
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'settings');
    expect(stable(await rail())).toEqual(stable(first));
    // One document for all of it: the marker survived, and only the first request navigated.
    expect(await page.evaluate(() => (window as unknown as { __spa: number }).__spa)).toBe(1);
    expect(requests.filter((request) => request.isNavigationRequest()).length).toBe(1);
    await page.close();
  });

  test('keeps the full rail and selected sub-page despite an old preference, with the phone drawer unchanged', async () => {
    const { page } = await openApp('/ops', async (page) => {
      await page.addInitScript(() => localStorage.setItem('tmt.shell.rail', 'collapsed'));
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    const rail = page.locator('nav.tmt-ui-rail');
    const brand = rail.locator('> .tmt-ui-shell-brand');
    const header = page.getByRole('heading', { level: 1 });
    // The brand stays in the rail; the single route heading is in the top bar's left group.
    await expect(page.locator('.root-title-row')).toHaveCount(0);
    await expect(brand).toContainText('tmt');
    await expect(header).toHaveText('Ops');
    const [railBox, brandBox, headerBox] = await Promise.all(
      [rail, brand, header].map(async (node) => (await node.boundingBox())!),
    );
    expect(Math.round(brandBox!.x)).toBeGreaterThanOrEqual(Math.round(railBox!.x));
    expect(Math.round(brandBox!.y + brandBox!.height)).toBeLessThanOrEqual(
      Math.round(railBox!.y + railBox!.height),
    );
    expect(Math.round(headerBox!.x)).toBeGreaterThanOrEqual(
      Math.round(railBox!.x + railBox!.width),
    );
    await expect(header).toHaveCSS('font-size', '16px');
    // The route heading includes its module prefix without repeating the rail brand.
    await expect(header.locator('.tmt-ui-wordmark, .tmt-ui-brand')).toHaveCount(0);
    await expect(header).toHaveText('Ops');
    await expect(page.locator('.tmt-ui-module-menu-title')).toHaveCount(0);
    await expect(rail).toHaveCSS('width', '232px');
    await expect(page.getByRole('button', { name: /sidebar/i })).toHaveCount(0);
    await expect(rail.locator('.tmt-ui-rail-sub [aria-current="page"]')).toHaveCount(0);
    const home = rail.locator('a[data-id="home"]');
    const settings = rail.getByRole('link', { name: 'TMT settings', exact: true });
    const settingsBox = (await settings.boundingBox())!;
    expect(settingsBox.y).toBeGreaterThan((await home.boundingBox())!.y);
    expect(railBox!.y + railBox!.height - settingsBox.y - settingsBox.height).toBeLessThan(24);
    await expect(rail.locator('.tmt-ui-rail-bottom')).toHaveCSS('border-top-style', 'solid');
    await expect(rail.locator('.tmt-ui-rail-bottom')).toHaveCSS('position', 'static');
    expect(
      await rail.evaluate((node) =>
        [node, ...node.querySelectorAll('*')]
          .filter((entry) => ['auto', 'scroll'].includes(getComputedStyle(entry).overflowY))
          .map((entry) => entry.className),
      ),
    ).toEqual(['tmt-ui-rail']);
    await expect(brand).toHaveCSS('position', 'sticky');
    await expect(brand.locator('.tmt-ui-shell-brand-text')).toBeVisible();
    await expect(home.locator('.tmt-ui-rail-label')).toBeVisible();
    // Normal labelled entries have no tooltip; unavailable reasons keep their existing owner.
    await home.hover();
    await expect(page.locator('.tmt-ui-rail-tip')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(rail).toBeHidden();
    const open = page.getByRole('button', { name: 'Open navigation', exact: true });
    await open.click();
    await expect(rail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rail).toBeHidden();
    await expect(open).toBeFocused();
    await expect(rail.locator('.tmt-ui-rail-sub [aria-current="page"]')).toHaveCount(0);
    await open.click();
    await expect(rail.locator('.tmt-ui-rail-sub [aria-current="page"]')).toHaveCount(0);
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => localStorage.getItem('tmt.shell.rail'))).toBe('collapsed');
    await page.close();
  });
});

/** A composed shell answer whose Colab module carries `entry`, as a paired door would send it. */
function composed(rail: string, entry?: string) {
  return {
    version: 1,
    modules: [
      {
        extension: 'colab',
        rail: { label: 'Colab', icon: 'file-text', path: rail, order: 1 },
        menu: [],
        settings: [],
        ...(entry === undefined ? {} : { entry }),
      },
    ],
  };
}
const PREFIX = '/r/abcdefghijklmnop';
const MOUNT = `${PREFIX}/x/colab/`;

/** Open /colab/ as a paired browser would, with the door's mount and shell answers faked. */
async function openColab(answer: unknown) {
  const stub = `export function mount(slot) { slot.main.textContent = 'colab stub mounted'; }`;
  return openApp('/colab/', async (page) => {
    await page.route('**/sdk/mount', (route) =>
      route.fulfill({ json: { address: `${origin}${PREFIX}` } }),
    );
    await page.route(`**${PREFIX}/x/-/shell`, (route) => route.fulfill({ json: answer }));
    // Anything a module entry may point at answers with the stub, so a wrongly accepted entry
    // shows up as a request and as a mounted stub.
    await page.route(/\.js$/, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/sdk/')) return route.fallback();
      return route.fulfill({ body: stub, contentType: 'text/javascript' });
    });
  });
}
const loadedEntry = (requests: Request[]) =>
  requests.find(
    (request) =>
      !request.url().startsWith(`${origin}/sdk/`) &&
      /\.js(\?|$)/.test(new URL(request.url()).pathname),
  );

test.describe('a module entry', () => {
  for (const [name, rail, entry] of [
    ['the default under its mount', MOUNT, undefined],
    ['a named file under its mount', MOUNT, 'assets/other.js'],
  ] as const)
    test(`loads ${name}`, async () => {
      const { page, requests } = await openColab(composed(rail, entry));
      await expect(page.locator('.tmt-ui-shell-main')).toContainText('colab stub mounted');
      expect(new URL(loadedEntry(requests)!.url()).pathname.startsWith(MOUNT)).toBe(true);
      await page.close();
    });

  for (const [name, rail, entry] of [
    ['a cross-origin URL', MOUNT, 'https://evil.example/colab.js'],
    ['a protocol-relative URL', MOUNT, '//evil.example/colab.js'],
    ['a same-origin path outside the prefix', MOUNT, '/evil/colab.js'],
    ['a relative path that climbs out of its mount', MOUNT, '../../colab.js'],
    ['another module under the same prefix', MOUNT, `${PREFIX}/x/other/colab.js`],
    ['the same module under another machine prefix', MOUNT, '/r/zzzzzzzzzzzzzzzz/x/colab/colab.js'],
    ['an encoded slash', MOUNT, 'assets%2f..%2fcolab.js'],
    ['a dot segment', MOUNT, 'assets/../colab.js'],
  ] as const)
    test(`refuses ${name} and loads nothing`, async () => {
      const { page, requests } = await openColab(composed(rail, entry));
      await expect(page.locator('.tmt-ui-shell-main')).toContainText('Colab');
      await page.waitForTimeout(500);
      expect(requests.map((request) => request.url()).join('\n')).not.toMatch(
        /evil|colab\.js|\/zzzzzzzzzzzzzzzz\//,
      );
      await expect(page.locator('.tmt-ui-shell-main')).not.toContainText('colab stub mounted');
      await page.close();
    });

  test('shows the busy mark while the module loads, then the module in its place', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { page } = await openApp('/colab/', async (page) => {
      await page.route('**/sdk/mount', (route) =>
        route.fulfill({ json: { address: `${origin}${PREFIX}` } }),
      );
      await page.route(`**${PREFIX}/x/-/shell`, (route) =>
        route.fulfill({ json: composed(MOUNT) }),
      );
      await page.route(/\.js$/, async (route) => {
        if (new URL(route.request().url()).pathname.startsWith('/sdk/')) return route.fallback();
        await held;
        return route.fulfill({
          // Like Colab: it clears the main area for an empty root, filled a moment later.
          body: `export function mount(slot) {
            const root = document.createElement('div');
            slot.main.replaceChildren(root);
            window.fillStub = () => (root.innerHTML = '<p>colab stub mounted</p>');
          }`,
          contentType: 'text/javascript',
        });
      });
    });
    const loading = page.locator('.tmt-ui-shell-main + .tmt-ui-shell-loading');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('role', 'status');
    await expect(loading.locator('.tmt-ui-busy-mark svg')).toBeVisible();
    release();
    await page.waitForFunction(() => 'fillStub' in window);
    // Mounted but still empty: the mark stays until the module paints.
    await expect(loading).toBeVisible();
    await page.evaluate(() => (window as unknown as { fillStub: () => void }).fillStub());
    await expect(page.locator('.tmt-ui-shell-main')).toContainText('colab stub mounted');
    await expect(loading).toBeHidden();
    await page.close();
  });

  test('refuses a sibling that only shares the mount name as a prefix', async () => {
    const { page, requests } = await openColab(
      composed(`${PREFIX}/x/colab`, `${PREFIX}/x/colab-evil/colab.js`),
    );
    await page.waitForTimeout(500);
    expect(loadedEntry(requests)).toBeUndefined();
    await page.close();
  });

  test('opens an older Colab, which names no entry and has no module, by its own link', async () => {
    const { page } = await openApp('/colab/', async (page) => {
      await page.route('**/sdk/mount', (route) =>
        route.fulfill({ json: { address: `${origin}${PREFIX}` } }),
      );
      await page.route(`**${PREFIX}/x/-/shell`, (route) =>
        route.fulfill({ json: composed(MOUNT, undefined) }),
      );
      await page.route(`**${MOUNT}assets/colab-module.js`, (route) =>
        route.fulfill({ status: 404 }),
      );
    });
    await expect(page.locator('.tmt-ui-shell-main')).toContainText('Colab could not start here');
    await expect(page.locator(`.tmt-ui-shell-main a[href$="${MOUNT}"]`)).toHaveText('Open Colab');
    await page.close();
  });

  test('falls back to the module link when its entry is refused', async () => {
    const { page } = await openColab(composed(MOUNT, 'https://evil.example/colab.js'));
    await expect(page.locator(`.tmt-ui-shell-main a[href$="${MOUNT}"]`)).toBeVisible();
    await page.close();
  });
});

/**
 * The Ops route on the owner browser read `x/-/ops` (#4381). The door's read needs a live owner
 * session, so these stub the mount answer and the read: the page's own fetch, timer and states are
 * what is under test (the door's read has its own Rust tests and vectors).
 */
test.describe('the Ops route on the owner read', () => {
  const vectors = JSON.parse(
    readFileSync(new URL('../../../../../contracts/owner-reads-v1.json', import.meta.url), 'utf8'),
  ) as { cases: { target: string; expect: Record<string, unknown> }[] };
  const board = vectors.cases.find((vector) => vector.target === 'ops')!.expect;
  async function stub(page: Page, answers: Record<string, unknown>[]) {
    const reads: number[] = [];
    await page.route(`${origin}/sdk/mount`, (route) =>
      route.fulfill({ json: { address: `${origin}/r/owner` } }),
    );
    await page.route(`${origin}/r/owner/x/-/ops`, (route) => {
      reads.push(Date.now());
      const next = answers.length > 1 ? answers.shift()! : answers[0]!;
      return route.fulfill({ json: { ...next, observedAtMs: Date.now() } });
    });
    return reads;
  }

  for (const width of [1440, 390])
    for (const colorScheme of ['light', 'dark'] as const)
      test(`fixed menu children at ${width} ${colorScheme}`, async ({ browserName }, testInfo) => {
        expect(browserName).toBe('chromium');
        const observed = structuredClone(board) as {
          agents: { presence: string }[];
          timers: unknown;
        };
        observed.agents[1]!.presence = 'active';
        observed.timers = null;
        const { page } = await openApp('/ops#channel/tmt-core', async (page) => {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.addInitScript(
            (theme) => localStorage.setItem('tmt-ui-theme', theme),
            colorScheme,
          );
          await stub(page, [observed]);
        });
        const rail = page.locator('nav.tmt-ui-rail');
        const openMenu = async () => {
          if (width <= 900) {
            const open = page.getByRole('button', { name: 'Open navigation', exact: true });
            if ((await open.getAttribute('aria-expanded')) !== 'true') await open.click();
          }
        };
        const inspect = async (labels: string[], selected: string) => {
          await openMenu();
          const tree = modulePages(page);
          await expect(tree.locator('a .tmt-ui-module-menu-label')).toHaveText(labels);
          await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
          await expect(tree.locator(`a[data-id="${selected}"]`)).toHaveAttribute(
            'aria-current',
            'page',
          );
          await expect(tree.locator(':scope > li:last-child')).toHaveClass('tmt-ui-rail-settings');
          await expect(tree.locator('button.tmt-ui-rail-add')).toHaveCount(0);
          const geometry = await tree.evaluate((node) => ({
            indents: [...node.querySelectorAll('a.tmt-ui-rail-sub-item')]
              .filter((item) => !item.closest('.tmt-ui-rail-sub-children'))
              .map((item) => getComputedStyle(item).paddingLeft),
            nestedIndents: [...node.querySelectorAll('.tmt-ui-rail-sub-children a')].map(
              (item) => getComputedStyle(item).paddingLeft,
            ),
            nestedPadding: getComputedStyle(node)
              .getPropertyValue('--tmt-ui-rail-sub-padding-inline')
              .trim(),
            branches: [...node.querySelectorAll('.tmt-ui-rail-sub-children')].map((item) => ({
              indent: getComputedStyle(item).paddingLeft,
              rule: getComputedStyle(item).borderLeftStyle,
              edge: getComputedStyle(item).borderLeftWidth,
            })),
            edge: getComputedStyle(node.querySelector('[aria-current="page"]')!).borderLeftWidth,
            rule: getComputedStyle(node.lastElementChild!, '::before').borderTopStyle,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }));
          expect(new Set(geometry.indents)).toEqual(new Set(['36px']));
          const nested = labels.includes('#tmt-core');
          expect(geometry.nestedIndents).toEqual(
            nested ? [geometry.nestedPadding, geometry.nestedPadding] : [],
          );
          expect(geometry.branches).toEqual(
            nested ? [{ indent: '8px', rule: 'solid', edge: '1px' }] : [],
          );
          expect(geometry.edge).toBe('0px');
          expect(geometry.rule).toBe('solid');
          expect(geometry.overflow).toBe(false);
        };
        try {
          await openMenu();
          const tree = modulePages(page);
          await expect(tree.locator('a .tmt-ui-module-menu-label')).toHaveText([
            'tmt-core',
            'tmt-lead',
            'core-3',
          ]);
          await expect(tree.locator('.tmt-ui-rail-sub-group')).toContainText('THIS MACHINE');
          await expect(tree.locator('a[data-id="channel:tmt-core"]')).toHaveAttribute(
            'aria-current',
            'page',
          );
          await expect(tree.locator('.tmt-ui-attention-dot')).toHaveCount(0);
          await expect(
            tree.locator('a[data-id="channel:tmt-core"] .tmt-ui-shell-count'),
          ).toHaveCount(0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
            false,
          );
          await page.mouse.move(width - 1, 899);
          await page.screenshot({
            path: testInfo.outputPath(`rail-ops-${width}-${colorScheme}.png`),
          });
          await page.goto(`${origin}/remote/`);
          await page.evaluate(async () => {
            const { remoteRegistry } = (await import(
              '/sdk/remote-v1.js' as string
            )) as typeof import('../src/browser.js');
            await remoteRegistry.add('other-remote', 'https://other.invalid/');
          });
          await page.goto(`${origin}/remote/members`);
          const remoteLabels = ['My Remotes', 'People', 'My devices', 'Remote settings'];
          await inspect(remoteLabels, 'members');
          await expect(
            modulePages(page).locator('a[data-id="remotes"] .tmt-ui-shell-count'),
          ).toHaveText('2');
          await expect(
            modulePages(page).locator('a[data-id="members"] .tmt-ui-shell-count'),
          ).toHaveCount(0);
          await expect(modulePages(page).locator('.tmt-ui-rail-sub-group')).toContainText(
            'This machine',
          );
          await expect(
            modulePages(page).getByRole('button', { name: 'Pair again', exact: true }),
          ).toBeVisible();
          await page.mouse.move(width - 1, 899);
          await page.screenshot({
            path: testInfo.outputPath(`rail-remote-${width}-${colorScheme}.png`),
          });
          for (const id of ['my-devices', 'settings', 'members']) {
            await openMenu();
            await modulePages(page).locator(`a[data-id="${id}"]`).click();
            await inspect(remoteLabels, id);
          }
        } finally {
          await page.close();
        }
      });

  test('serves the local channel and UUID DM through the existing owner-read route', async () => {
    const { page, requests } = await openApp('/ops#channel/tmt-core', async (page) => {
      await stub(page, [board]);
    });
    try {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / #tmt-core');
      await expect(page.locator('.ops-member-row .ops-member-state')).toHaveText([
        'Working',
        'Offline',
      ]);
      await page.getByRole('button', { name: 'Show details', exact: true }).click();
      await page.getByRole('tab', { name: /^Timers/ }).click();
      await expect(page.getByRole('tabpanel', { name: /^Timers/ })).toContainText('Hourly pass');
      await modulePages(page).getByRole('link', { name: 'core-3 · Offline', exact: true }).click();
      await expect(page).toHaveURL(
        `${origin}/ops#dm/00000000-0000-4000-8000-000000000002/tmt-core`,
      );
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / core-3');
      await expect(page.getByRole('region', { name: 'Talk history' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      expect(
        requests.some((request) => /requests\.list|dispatch\.create/.test(request.url())),
      ).toBe(false);
    } finally {
      await page.close();
    }
  });

  test('refreshes the channel board while visible and stops on leaving the route', async () => {
    let reads: number[] = [];
    const changed = structuredClone(board) as { agents: { name: string }[] };
    changed.agents[0]!.name = 'renamed-lead';
    const { page } = await openApp('/ops', async (page) => {
      reads = await stub(page, [board, changed]);
    });
    await expect(page.locator('.tmt-ui-topbar-title-current')).toHaveText('#tmt-core');
    await expect(page.locator('#ops-channel-members .ops-member-row')).toHaveCount(2);
    await expect(page.locator('#ops-channel-members')).toContainText('renamed-lead', {
      timeout: 8000,
    });
    await page.locator('nav.tmt-ui-rail a[data-id="digest"]').click();
    await expect(page.locator('.tmt-ui-shell-main')).toHaveAttribute('data-route', 'digest');
    const left = reads.length;
    await page.waitForTimeout(6000);
    expect(reads).toHaveLength(left);
    await page.close();
  });

  test('a door that stops answering mid-route is retried, never a reason to pair again', async () => {
    let down = false;
    const { page } = await openApp('/ops', async (page) => {
      await stub(page, [board]);
      // The door stops: the read fails on the network, as a restart or a blip does.
      await page.route(`${origin}/r/owner/x/-/ops`, (route) =>
        down ? route.abort('connectionrefused') : route.fallback(),
      );
    });
    const rows = page.locator('#ops-channel-members .ops-member-row');
    await expect(rows).toHaveCount(2);
    down = true;
    await expect(page.locator('#ops-note')).toHaveText(
      'Your machine did not answer. This page tries again shortly.',
      { timeout: 8000 },
    );
    await expect(page.locator('#ops-note')).not.toContainText('Pair');
    // Back up: the next read (after the doubled wait) shows the board again and clears the note.
    down = false;
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('#ops-note')).toBeHidden();
    await page.close();
  });

  test('says why there is no board, never an empty list', async () => {
    const { page } = await openApp('/ops', async (page) => {
      await stub(page, [{ version: 1, state: 'unavailable', reason: 'not_installed' }]);
    });
    await expect(page.locator('#ops-note')).toHaveText(
      'Ops is not installed on your machine. Run tmt extension install ops, then reload this page.',
    );
    await expect(page.locator('#ops-section .tmt-ui-list-row')).toHaveCount(0);
    await page.close();
  });

  test('without an owner session it asks to pair', async () => {
    const { page } = await openApp('/ops');
    await expect(page.locator('#ops-note')).toContainText('Pair it from Remote');
    await expect(page.locator('#ops-section .tmt-ui-list-row')).toHaveCount(0);
    await page.close();
  });
});

/**
 * The Digest route on the owner reads `x/-/digest/<range>` and `x/-/limits`: the page's pieces are
 * the leaf's (card, status tile, segments, meter, badge, table), not page-local copies.
 */
test.describe('the Digest route on the owner reads', () => {
  async function stub(page: Page) {
    const reads: string[] = [];
    await page.route(`${origin}/sdk/mount`, (route) =>
      route.fulfill({ json: { address: `${origin}/r/owner` } }),
    );
    await page.route(new RegExp(`${origin}/r/owner/x/-/digest/(24h|7d|30d)$`), (route) => {
      const range = route.request().url().split('/').pop() as UsageRange;
      reads.push(`digest/${range}`);
      return route.fulfill({
        json: {
          version: 1,
          state: 'ok',
          since: range,
          report: mockDocument(range),
          observedAtMs: Date.now(),
        },
      });
    });
    await page.route(`${origin}/r/owner/x/-/limits`, (route) => {
      reads.push('limits');
      return route.fulfill({
        json: { version: 1, state: 'unavailable', reason: 'not_sampled', observedAtMs: Date.now() },
      });
    });
    return reads;
  }

  test('range switches reuse one allowance read and the minute tick obtains the next snapshot', async () => {
    let reads: string[] = [];
    const { page } = await openApp('/digest', async (page) => {
      await page.clock.install();
      reads = await stub(page);
    });
    await expect(page.locator('#digest-provider-codex > .digest-provider')).toBeVisible();
    const count = (target: string) => reads.filter((name) => name === target).length;
    expect(count('digest/7d')).toBe(1);
    expect(count('limits')).toBe(1);
    for (const range of ['7d', '30d', '24h']) {
      await page.getByRole('tab', { name: range, exact: true }).click();
      await expect(page.locator('.digest-total-label')).toContainText(range);
      expect(count('digest/7d')).toBe(1);
      expect(count('limits')).toBe(1);
    }
    await page.clock.fastForward(60_000);
    await expect.poll(() => count('limits')).toBe(2);
    await expect.poll(() => count('digest/7d')).toBe(2);
    await expect(page.locator('#digest-provider-codex > .digest-provider')).toBeVisible();
    await page.close();
  });

  for (const width of [1440, 390])
    test(`draws the website allowance rows, charts, tabs, meters and coverage from the leaf pieces at ${width}`, async () => {
      const { page } = await openApp('/digest', async (page) => {
        await page.setViewportSize({ width, height: 900 });
        await stub(page);
      });
      const cards = page.locator('#digest-sections .tmt-ui-card');
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBe(4);
      await expect(page.locator('#digest-activity')).toHaveCount(0);
      await expect(cards.first()).toHaveCSS('border-radius', '2px');
      const provider = page.locator('.digest-provider').first();
      const details = provider.locator('details');
      await expect(provider.locator('.digest-provider-label')).toContainText('% left');
      await expect(details).not.toHaveAttribute('open');
      await details.locator('summary').click();
      await expect(provider.locator('.tmt-ui-status-tile-label')).toHaveText([
        'Elapsed',
        'Pace',
        'Resets in',
      ]);
      const headline = page.locator('.tmt-ui-topbar-navigation h1');
      await expect(headline).toBeVisible();
      await expect(headline).toHaveCSS('font-family', /Inter, -apple-system, system-ui/);
      await expect(provider.locator('.tmt-ui-meter-fill')).toHaveCSS(
        'background-color',
        /rgb\(\d+, \d+, \d+\)/,
      );
      const left = await provider
        .locator('.tmt-ui-meter-fill')
        .evaluate((node) => (node as HTMLElement).style.getPropertyValue('--tmt-ui-meter-fill'));
      expect(Number(left)).toBeGreaterThan(0);
      // The range is the leaf's boxed tabs, one selected; choosing 7d reuses the weekly report.
      const ranges = page.locator('#usage-ranges .tmt-ui-tab');
      await expect(ranges).toHaveText(['24h', '7d', '30d']);
      await expect(ranges.first()).toHaveAttribute('aria-selected', 'true');
      await ranges.nth(1).click();
      await expect(ranges.nth(1)).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#digest-ranking-rows')).toBeVisible();
      expect((await page.locator('#usage-ranges').boundingBox())!.width).toBeGreaterThan(80);
      // The token scale is the same tabs for the chart below it.
      const scale = page.getByRole('tablist', { name: 'Scale', exact: true }).getByRole('tab');
      await expect(scale).toHaveText(['Absolute', 'Share']);
      await expect(scale.first()).toHaveAttribute('aria-selected', 'true');
      expect(
        (await page.getByRole('tablist', { name: 'Scale', exact: true }).boundingBox())!.width,
      ).toBeGreaterThan(80);
      await expect(page.locator('#digest-missing .digest-gap dd')).toHaveText(
        Array(4).fill('Not connected'),
      );
      await expect(page.locator('.digest-provider details').first()).toHaveAttribute('open', '');
      const heading = page.locator('#digest-ranking-rows .tmt-ui-table[data-numeric] th').nth(1);
      await expect(heading).toHaveText('Tokens');
      expect((await heading.boundingBox())!.height).toBeLessThan(40);
      const style = page.getByRole('tablist', { name: 'Chart style', exact: true });
      await expect(style.getByRole('tab')).toHaveText(['Stacked', 'Lines']);
      await style.getByRole('tab', { name: 'Lines', exact: true }).click();
      await expect(style.getByRole('tab', { name: 'Lines', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('#digest-token-plot .tmt-ui-chart-line')).toHaveCount(6);
      // Shared controls/charts stay public; Messages is the approved one-caller table.
      await expect(
        page.locator(
          '.digest-badge, .digest-segment, .digest-segments, .digest-stat, .digest-meter, .tmt-ui-segments, .tmt-ui-badge',
        ),
      ).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      await page.close();
    });
});

test.describe('Settings General website presentation', () => {
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark'] as const)
      test(`General cards, shared inset and theme choices at ${width} ${theme}`, async () => {
        const { page, requests } = await openApp('/settings#general', async (page) => {
          await page.setViewportSize({ width, height: 1050 });
          await page.emulateMedia({ colorScheme: theme });
          await page.addInitScript((theme) => {
            if (localStorage.getItem('tmt-ui-theme') === null)
              localStorage.setItem('tmt-ui-theme', theme);
          }, theme);
        });
        try {
          const general = page.locator('#tmt-settings-page');
          await expect(general).toHaveClass(/tmt-ui-page/);
          await expect(
            page.getByRole('heading', { name: 'TMT settings / General', exact: true }),
          ).toBeVisible();
          await expect(
            general.getByRole('heading', { name: 'Appearance', exact: true }),
          ).toBeVisible();
          await expect(general.getByRole('heading', { name: 'Core configuration' })).toBeVisible();
          await expect(general).toContainText('This browser cannot read Core settings yet.');
          await expect(general).toContainText('View machine configuration in your terminal.');
          await expect(general.locator('.tmt-settings-read-only')).toHaveText('Read only');
          await expect(general).not.toContainText('Reference defaults');
          await expect(general).not.toContainText('5000');
          await expect(general.locator('.tmt-settings-theme-radio')).toHaveCount(3);
          await expect(general.locator('.tmt-settings-theme-preview')).toHaveCount(3);
          await expect(general.locator('.tmt-ui-glyph-tile svg')).toHaveCount(1);
          const link = general.getByRole('link', { name: 'Browse modules →' });
          await expect(link).toHaveCSS('text-decoration-line', 'none');
          await expect(general).toHaveCSS('padding-left', width === 390 ? '18px' : '36px');
          const cards = general.locator('.tmt-settings-card');
          await expect(cards).toHaveCount(4);
          await expect(cards.first()).toHaveCSS('border-radius', '2px');
          const foot = general.locator('.tmt-settings-foot');
          const gridBox = await general.locator('.tmt-settings-grid').boundingBox();
          const footBox = await foot.boundingBox();
          expect(footBox!.x).toBeCloseTo(gridBox!.x, 0);
          expect(footBox!.width).toBeCloseTo(gridBox!.width, 0);
          await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
          if (process.env.TMT_SETTINGS_CAPTURE_DIR) {
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
              path: join(process.env.TMT_SETTINGS_CAPTURE_DIR, `general-${width}-${theme}.png`),
              fullPage: true,
            });
          }
          if (width === 390)
            await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
          const menu = modulePages(page);
          await expect(menu.getByRole('link', { name: 'General', exact: true })).toHaveAttribute(
            'aria-current',
            'page',
          );
          if (width === 390) await page.keyboard.press('Escape');
          const tabs = general.getByRole('tablist', { name: 'Theme' });
          await tabs.getByRole('tab', { name: 'Dark', exact: true }).click();
          await expect(tabs.getByRole('tab', { name: 'Dark', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          expect(await page.evaluate(() => localStorage.getItem('tmt-ui-theme'))).toBe('dark');
          await page.reload();
          await expect(tabs.getByRole('tab', { name: 'Dark', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await tabs.getByRole('tab', { name: 'Dark', exact: true }).focus();
          await page.keyboard.press('ArrowRight');
          await expect(tabs.getByRole('tab', { name: 'System', exact: true })).toBeFocused();
          await expect(tabs.getByRole('tab', { name: 'System', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          expect(await page.evaluate(() => localStorage.getItem('tmt-ui-theme'))).toBeNull();
          await link.click();
          await expect(page).toHaveURL(/#modules$/);
          // Modules has its own page and takes the inset like every settings section.
          await expect(general).toHaveClass(/tmt-ui-page/);
          await expect(
            page.getByRole('heading', { name: 'TMT settings / Modules', exact: true }),
          ).toBeVisible();
          await expect(general).not.toContainText('Make TMT feel like yours.');
          if (width === 390)
            await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
          await menu.getByRole('link', { name: 'Drivers & hooks', exact: true }).click();
          await expect(general).toHaveClass(/tmt-ui-page/);
          await expect(
            page.getByRole('heading', {
              name: 'TMT settings / Drivers & hooks',
              exact: true,
              level: 1,
            }),
          ).toBeVisible();
          await expect(general.getByRole('button', { name: 'Copy tmt driver ls' })).toBeVisible();
          if (width === 390)
            await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
          await menu.getByRole('link', { name: 'General', exact: true }).click();
          await expect(
            general.getByRole('heading', { name: 'Appearance', exact: true }),
          ).toBeVisible();
          // Settings has no machine read: these actions only change browser presentation.
          expect(
            requests.filter((request) => /\/x\/.*\/(config|settings)(?:\?|$)/.test(request.url())),
          ).toEqual([]);
        } finally {
          await page.close();
        }
      });

  for (const denied of [false, true])
    test(`General Copy ${denied ? 'denied' : 'succeeds'} with exact command and no execution`, async () => {
      const { page } = await openApp('/settings#general', async (page) => {
        await page.addInitScript((denied) => {
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: async (text: string) => {
                (window as unknown as { copiedCommand: string }).copiedCommand = text;
                if (denied) throw new Error('denied');
              },
            },
          });
        }, denied);
      });
      try {
        await page.getByRole('button', { name: 'Copy tmt config show' }).click();
        await expect(page.locator('.tmt-settings .tmt-ui-command-feedback')).toHaveText(
          denied ? 'Copy failed. Select the command and copy it manually.' : 'Copied.',
        );
        expect(
          await page.evaluate(() => (window as unknown as { copiedCommand: string }).copiedCommand),
        ).toBe('tmt config show');
      } finally {
        await page.close();
      }
    });
});

test.describe('Settings Identities website presentation', () => {
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark'])
      test(`Identities unavailable cards at ${width} ${theme}`, async () => {
        const { page, requests } = await openApp('/settings#identities', async (page) => {
          await page.setViewportSize({ width, height: 1050 });
          await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
          await page.addInitScript((theme) => localStorage.setItem('tmt-ui-theme', theme), theme);
        });
        try {
          const main = page.locator('#tmt-settings-page');
          await expect(main).toHaveClass(/tmt-ui-page/);
          await expect(
            page.getByRole('heading', { name: 'TMT settings / Identities', exact: true }),
          ).toBeVisible();
          await expect(main).toContainText('Identity inventory unavailable');
          await expect(main.locator('code')).toHaveText('tmt ls');
          await expect(main.locator('tbody')).toHaveCount(0);
          await expect(page.locator('#tmt-settings-note')).toBeHidden();
          await expect(main).not.toContainText('core-1');
          await expect(main).toHaveCSS('padding-left', width === 390 ? '18px' : '36px');
          await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
          const grid = await main.locator('.tmt-settings-grid').boundingBox();
          const foot = await main.locator('.tmt-settings-foot').boundingBox();
          expect(foot!.width).toBeCloseTo(grid!.width, 0);
          if (width === 390)
            await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
          await expect(
            modulePages(page).getByRole('link', { name: 'Identities', exact: true }),
          ).toHaveAttribute('aria-current', 'page');
          if (width === 390) await page.keyboard.press('Escape');
          if (process.env.TMT_IDENTITIES_CAPTURE_DIR) {
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
              path: join(
                process.env.TMT_IDENTITIES_CAPTURE_DIR,
                `identities-native-${width}-${theme}.png`,
              ),
              fullPage: true,
            });
          }
          expect(
            requests.filter((request) =>
              /\/x\/.*\/(identities|config)(?:\?|$)/.test(request.url()),
            ),
          ).toEqual([]);
        } finally {
          await page.close();
        }
      });
  for (const denied of [false, true])
    test(`Identities Copy ${denied ? 'denied' : 'succeeds'} without command execution`, async () => {
      const { page } = await openApp('/settings#identities', async (page) => {
        await page.addInitScript((denied) => {
          Object.defineProperty(navigator, 'clipboard', {
            value: {
              writeText: async (text: string) => {
                (window as unknown as { copiedIdentityCommand: string }).copiedIdentityCommand =
                  text;
                if (denied) throw new Error('denied');
              },
            },
          });
        }, denied);
      });
      try {
        await page.getByRole('button', { name: 'Copy tmt ls' }).click();
        await expect(page.locator('.tmt-settings .tmt-ui-command-feedback')).toHaveText(
          denied ? 'Copy failed. Select the command and copy it manually.' : 'Copied.',
        );
        expect(
          await page.evaluate(
            () => (window as unknown as { copiedIdentityCommand: string }).copiedIdentityCommand,
          ),
        ).toBe('tmt ls');
      } finally {
        await page.close();
      }
    });
});

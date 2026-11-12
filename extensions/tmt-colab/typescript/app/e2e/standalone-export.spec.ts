import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { standaloneDocument } from '../src/standalone.js';
import { sealedRuntimeScript, servePageRuntime } from './page-runtime.js';

// The standalone copy of an opted-in page (#1693), built from the real runtime and opened from
// disk the way a person opens a downloaded file: no Colab, no server, no network. The page is
// React + Tailwind; its theme must follow the system colour scheme, and the copy must stay inside
// the renderer frame's no-network policy.
const app = fileURLToPath(new URL('..', import.meta.url));
const tokens = JSON.parse(
  readFileSync(new URL('../../../../../design/tokens/tokens.json', import.meta.url), 'utf8'),
);
const rgb = (hex: string) => {
  const value = parseInt(hex.slice(1, 7), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
};
const surface = (key: string, mode: 'light' | 'dark') => rgb(tokens.browser.surface[key][mode]);
const color = (key: string, mode: 'light' | 'dark') => rgb(tokens.browser.color[key][mode]);

const source = `<meta name="tmt-colab-runtime" content="react tailwind">
<main id="app"></main>
<script>
  const { createRoot, html, icons } = window.tmt;
  createRoot(document.getElementById('app')).render(
    html\`<p id="message" class="bg-paper text-text p-4">Offline <\${icons.Check} id="icon" aria-label="ok" /></p>\`,
  );
</script>`;

// The design system's copy (#5057): a page with no runtime marker that uses `tmt-ui-*` classes and
// `<tmt-icon>`. It must look the way the renderer frame draws it, from disk and offline.
const designSource = `<section class="tmt-ui-card" id="card"><h2 class="tmt-ui-card-title">Release</h2>
<table class="tmt-ui-table" id="table"><thead><tr><th>Check</th><th>State</th></tr></thead><tbody><tr><td>Build</td><td>Done</td></tr></tbody></table></section>
<p><button class="tmt-ui-action" data-variant="primary" id="action"><span class="tmt-ui-action-label">Approve</span></button>
<span class="tmt-ui-count-chip" id="chip">3</span> <tmt-icon id="icon" name="check" label="ok"></tmt-icon></p>
<label class="tmt-ui-field" id="field"><span class="tmt-ui-field-label">Note</span><input class="tmt-ui-field-control" value="Note"></label>
<details class="tmt-ui-disclosure" id="disclosure"><summary>More detail</summary>Body</details>
<p id="plain">Plain text <a id="link" href="#">link</a></p>`;

// The same page under the author's own light body: the components must take the scheme it paints, in the
// file as in the frame.
const paintedSource = `<style>body{background:#fffdf7;color:#2b2b2b}</style>${designSource}`;

let directory = '';
let copy = '';
const designCopies = { unpainted: '', painted: '' };
test.beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'tmt-standalone-export-'));
  const built = join(directory, 'runtime');
  execFileSync('./node_modules/.bin/vp', ['build', '--mode', 'runtime', '--outDir', built], {
    cwd: app,
    stdio: 'pipe',
  });
  const textOf = (name: string) => readFileSync(join(built, 'assets', name), 'utf8');
  const runtimeFiles = new Map(
    readdirSync(join(built, 'assets'))
      .filter((name) => name.startsWith('colab-runtime'))
      .map((name) => [name, textOf(name)]),
  );
  const document = standaloneDocument(source, {
    runtime: { script: sealedRuntimeScript(runtimeFiles), style: textOf('colab-runtime.css') },
  });
  expect(typeof document).toBe('string');
  copy = join(directory, 'page.standalone.html');
  writeFileSync(copy, document as string);
  for (const [kind, text] of [
    ['unpainted', designSource],
    ['painted', paintedSource],
  ] as const) {
    const withDesign = standaloneDocument(text, {
      design: JSON.parse(textOf('colab-page-ui.json')) as { script: string; style: string },
    });
    expect(typeof withDesign).toBe('string');
    designCopies[kind] = join(directory, `design-${kind}.standalone.html`);
    writeFileSync(designCopies[kind], withDesign as string);
  }
});
test.afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('the standalone copy renders the page from disk, offline, and follows the system theme', async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: 'light', offline: true });
  const page = await context.newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(pathToFileURL(copy).href);

  const paint = (id: string, property: 'backgroundColor' | 'color') =>
    page.evaluate(
      ([target, name]) =>
        (getComputedStyle(document.getElementById(target!)!) as unknown as Record<string, string>)[
          name!
        ],
      [id, property],
    );
  // The page's own script ran against window.tmt, and Tailwind compiled its classes.
  await expect(page.locator('#message')).toContainText('Offline');
  await expect(page.locator('#icon')).toHaveAttribute('role', 'img');
  await expect.poll(() => paint('message', 'backgroundColor')).toBe(surface('paper', 'light'));
  expect(await paint('message', 'color')).toBe(color('text', 'light'));
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

  // The theme follows the system colour scheme, now and when it changes.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => paint('message', 'backgroundColor')).toBe(surface('paper', 'dark'));
  expect(await paint('message', 'color')).toBe(color('text', 'dark'));
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => paint('message', 'backgroundColor')).toBe(surface('paper', 'light'));

  // Nothing went wrong while it ran. (The probe below provokes errors of its own.)
  expect(problems).toEqual([]);

  // The renderer frame's policy travels with the copy: nothing leaves, and the copy asks for nothing.
  const violations = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const seen: string[] = [];
        document.addEventListener('securitypolicyviolation', (event) =>
          seen.push(event.violatedDirective),
        );
        void fetch('https://example.com/leak').catch(() => undefined);
        const frame = document.createElement('iframe');
        frame.src = 'https://example.com/';
        document.body.append(frame);
        setTimeout(() => resolve(seen), 500);
      }),
  );
  expect(violations.some((name) => name.startsWith('connect-src'))).toBe(true);
  expect(violations.some((name) => name.startsWith('frame-src'))).toBe(true);
  expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([]);
  await context.close();
});

// The styles that make a page look like the product, read from the same elements in the renderer frame
// and in the exported file (properties: display, ink, fill, border, radius, padding, type). The frame adds
// only the marker lane at the right edge, so sizes that depend on the viewport are not compared.
const read = () =>
  ['card', 'table', 'action', 'chip', 'field', 'disclosure', 'plain', 'link', 'icon'].map((id) => {
    const element = document.getElementById(id)!;
    const style = getComputedStyle(element) as unknown as Record<string, string>;
    return {
      id,
      ...Object.fromEntries(
        [
          'display',
          'color',
          'backgroundColor',
          'borderTopWidth',
          'borderTopColor',
          'borderTopLeftRadius',
          'paddingTop',
          'paddingLeft',
          'fontFamily',
          'fontSize',
          'fontWeight',
          'lineHeight',
          'textDecorationLine',
        ].map((name) => [name, style[name]]),
      ),
      svg: element.querySelector('svg')
        ? element.querySelector('svg')!.getAttribute('stroke-width')
        : null,
    };
  });

for (const kind of ['unpainted', 'painted'] as const)
  for (const scheme of ['light', 'dark'] as const)
    test(`a design-system page exports from disk looking the way the frame draws it (${kind}, ${scheme})`, async ({
      browser,
      page,
    }) => {
      // The renderer frame, bound to the same source in the app's own server.
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await page.evaluate(
        async ({ source, theme }) => {
          const target = document.createElement('iframe');
          target.id = 'frame';
          target.setAttribute('sandbox', 'allow-scripts');
          // As wide as the exported copy's viewport, so the type ramp takes the same width step.
          target.style.width = `${innerWidth}px`;
          target.style.border = '0';
          target.src = '/renderer.html';
          await new Promise<void>((resolve) => {
            target.onload = () => resolve();
            document.body.append(target);
          });
          const digest = 'c'.repeat(64);
          target.contentWindow!.postMessage(
            {
              type: 'colab.render.bind',
              renderId: `00000000-0000-4000-8000-000000000003:${digest}`,
              sourceDigest: digest,
              source,
              theme,
            },
            '*',
            [new MessageChannel().port2],
          );
        },
        { source: kind === 'painted' ? paintedSource : designSource, theme: scheme },
      );
      await expect(page.frameLocator('#frame').locator('#icon svg')).toBeAttached();
      // Components take the scheme the page paints: the viewer's, unless the author paints it light.
      const painted = kind === 'painted' ? 'light' : scheme;
      await expect(page.frameLocator('#frame').locator('html')).toHaveAttribute(
        'data-colab-scheme',
        painted,
      );
      const inFrame = await page.frameLocator('#frame').locator('html').evaluate(read);

      // The exported file, opened from disk with no network.
      const context = await browser.newContext({
        colorScheme: scheme,
        offline: true,
        viewport: page.viewportSize(),
      });
      const exported = await context.newPage();
      const problems: string[] = [];
      const requests: string[] = [];
      exported.on('pageerror', (error) => problems.push(String(error)));
      exported.on('request', (request) => requests.push(request.url()));
      await exported.goto(pathToFileURL(designCopies[kind]).href);
      await expect(exported.locator('#icon svg')).toBeAttached();
      expect(await exported.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
      await expect(exported.locator('html')).toHaveAttribute('data-colab-design', '');
      await expect(exported.locator('html')).toHaveAttribute('data-colab-scheme', painted);
      const onDisk = await exported.evaluate(read);
      expect(onDisk).toEqual(inFrame);
      // Not a vacuous match: the classes drew (a card has a fill and a radius) and the icon is the frame's.
      expect(onDisk.find((entry) => entry.id === 'card')).toMatchObject({
        borderTopLeftRadius: '2px',
        paddingTop: '24px',
      });
      expect(onDisk.find((entry) => entry.id === 'icon')?.svg).toBe('1.75');
      expect(problems).toEqual([]);
      expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([]);
      await context.close();
    });

test('a design-system copy follows the system theme live, and one the author paints stays as painted', async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: 'light', offline: true });
  const unpainted = await context.newPage();
  await unpainted.goto(pathToFileURL(designCopies.unpainted).href);
  await expect(unpainted.locator('html')).toHaveAttribute('data-colab-scheme', 'light');
  const painted = await context.newPage();
  await painted.goto(pathToFileURL(designCopies.painted).href);
  await expect(painted.locator('html')).toHaveAttribute('data-colab-scheme', 'light');
  for (const scheme of ['dark', 'light', 'dark'] as const) {
    await unpainted.emulateMedia({ colorScheme: scheme });
    await painted.emulateMedia({ colorScheme: scheme });
    // The scheme measured earlier must not keep painting the page in itself.
    await expect(unpainted.locator('html')).toHaveAttribute('data-colab-scheme', scheme);
    await expect(unpainted.locator('body')).toHaveCSS('background-color', surface('paper', scheme));
    await expect(painted.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect(painted.locator('html')).toHaveAttribute('data-colab-scheme', 'light');
  }
  await context.close();
});

// #6157: a page that pins a design system exports its verified bundle, so the copy, opened from disk
// with no network, draws the same `tmt-ui-*` components the frame draws. Each copy is made by the app's
// own export path (standaloneRequest, then deriveStandalone) from the bundle the app resolves for the pin.
const pinnedBundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
) as { hash: string; version: string };
const pinOf = (bundle: { hash: string; version: string }) =>
  `tmt-gui@${bundle.version}#${bundle.hash}`;
const pinnedSource = `<meta name="tmt-ds" content="${pinOf(pinnedBundle)}">
<p>Build <tmt-ui-badge id="badge" variant="secondary">Done</tmt-ui-badge></p>`;
/** Today's copy policy, frozen in the shared export vector: the binder needs no new source. */
const frozenPolicy = (
  JSON.parse(
    readFileSync(new URL('../../../contracts/vectors/export-v1.json', import.meta.url), 'utf8'),
  ) as { standalone: { policy: string } }
).standalone.policy;

/** The app's export of `source`, with `served` as the bundle its pin resolves to (a draft that throws
 * when `served` is null). */
async function exportPinned(page: Page, source: string, served: unknown = pinnedBundle) {
  await servePageRuntime(page);
  await page.goto('/');
  return page.evaluate(
    async ({ source, served }) => {
      const runtime = '/src/export-runtime.ts';
      const standalone = '/src/standalone.ts';
      const { standaloneRequest } = await import(runtime);
      const { deriveStandalone } = await import(standalone);
      const request = await standaloneRequest(
        { source },
        {
          release: async () => served,
          draft: async () => {
            if (!served) throw new Error('No draft');
            return served;
          },
          watch: () => () => {},
        },
      );
      return deriveStandalone(source, request) as {
        outcome: { included: boolean; reason?: string };
        document?: string;
      };
    },
    { source, served },
  );
}
/** `document` written to disk and opened offline, with the errors and requests it made. */
async function openOffline(browser: Browser, document: string, name: string) {
  const file = join(directory, name);
  writeFileSync(file, document);
  const context = await browser.newContext({ colorScheme: 'light', offline: true });
  const opened = await context.newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  opened.on('pageerror', (error) => problems.push(String(error)));
  opened.on('request', (request) => requests.push(request.url()));
  await opened.goto(pathToFileURL(file).href);
  return { context, opened, problems, requests };
}

test('a design-system page exported from the app draws its tmt-ui components offline', async ({
  browser,
  page,
}) => {
  const made = await exportPinned(page, pinnedSource);
  expect(made.outcome).toEqual({ included: true });
  expect(made.document).toContain(
    `<meta http-equiv="Content-Security-Policy" content="${frozenPolicy}">`,
  );
  const { context, opened, problems, requests } = await openOffline(
    browser,
    made.document!,
    'pinned.standalone.html',
  );
  await expect(opened.locator('#badge [data-slot="badge"]')).toHaveText('Done');
  expect(await opened.evaluate(() => !!customElements.get('tmt-ui-badge'))).toBe(true);
  await expect(
    opened.locator('[data-tmt-ds-notice], [data-colab-standalone-notice], [data-tmt-ds-findings]'),
  ).toHaveCount(0);
  await expect(opened.locator('[data-tmt-part-unavailable]')).toHaveCount(0);
  expect(problems).toEqual([]);
  expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([]);
  await context.close();
});

test('a copy checks its blocks when it opens: a changed bundle or base fails closed, a changed chunk leaves only its parts', async ({
  browser,
  page,
}) => {
  const made = await exportPinned(page, pinnedSource);
  const copy = made.document!;
  const block = (name: string) => {
    const open = `<script type="text/plain" data-chunk="${name}">`;
    const start = copy.indexOf(open) + open.length;
    return { start, end: copy.indexOf('</script>', start) };
  };
  const cases = [
    // The bundle no longer hashes to the release the export verified.
    {
      name: 'bundle',
      document: copy.replace('"name":"', '"name":"Changed '),
      notice: true,
    },
    // The base chunk is not this build's: no component can be defined.
    {
      name: 'base',
      document: `${copy.slice(0, block('base').start)}/* changed */${copy.slice(block('base').start)}`,
      notice: true,
    },
    // A lazy chunk is not this build's: the component draws, its part does not.
    {
      name: 'ui',
      document: `${copy.slice(0, block('ui').start)}/* changed */${copy.slice(block('ui').start)}`,
      notice: false,
    },
  ];
  for (const { name, document, notice } of cases) {
    expect(document, name).not.toBe(copy);
    const { context, opened, requests } = await openOffline(browser, document, `${name}.html`);
    if (notice) {
      await expect(opened.locator('[data-tmt-ds-notice]'), name).toBeVisible();
      expect(await opened.evaluate(() => !!customElements.get('tmt-ui-badge')), name).toBe(false);
    } else {
      await expect(opened.locator('#badge [data-tmt-part-unavailable]'), name).toBeVisible();
      await expect(opened.locator('[data-tmt-ds-notice]'), name).toHaveCount(0);
    }
    expect(
      requests.filter((url) => !url.startsWith('file:')),
      name,
    ).toEqual([]);
    await context.close();
  }
});

test('a copy refuses an unknown component with the page check, as the frame does', async ({
  browser,
  page,
}) => {
  const source = `${pinnedSource}<tmt-ui-nope id="nope">x</tmt-ui-nope>`;
  const made = await exportPinned(page, source);
  expect(made.outcome).toEqual({ included: true });
  const { context, opened, problems } = await openOffline(browser, made.document!, 'unknown.html');
  await expect(opened.locator('[data-tmt-ds-findings]')).toContainText('tmt-ui-nope');
  await expect(opened.locator('#badge [data-slot="badge"]')).toHaveText('Done');
  expect(await opened.evaluate(() => !!customElements.get('tmt-ui-nope'))).toBe(false);
  expect(problems).toEqual([]);
  await context.close();
});

test('a pin the export cannot verify gets no copy and names why', async ({ page }) => {
  const changed = { ...pinnedBundle, name: 'Someone else' };
  expect((await exportPinned(page, pinnedSource, changed)).outcome).toEqual({
    included: false,
    reason: 'design-hash-mismatch',
  });
  const other = pinnedSource.replace(pinnedBundle.version, '9.9.9');
  expect((await exportPinned(page, other)).outcome).toEqual({
    included: false,
    reason: 'design-unknown-release',
  });
  const follows = '<meta name="tmt-ds" content="space-system"><tmt-ui-badge>x</tmt-ui-badge>';
  expect((await exportPinned(page, follows, null)).outcome).toEqual({
    included: false,
    reason: 'design-draft-broken',
  });
});

test('a page that follows a draft is frozen to the draft its export resolved', async ({
  browser,
  page,
}) => {
  const follows =
    '<meta name="tmt-ds" content="tmt-gui"><tmt-ui-badge id="badge">Now</tmt-ui-badge>';
  const made = await exportPinned(page, follows);
  expect(made.document).toContain(
    `data-pin="tmt-gui" data-lock="${pinnedBundle.version}#${pinnedBundle.hash}"`,
  );
  const { context, opened } = await openOffline(browser, made.document!, 'follows.html');
  await expect(opened.locator('#badge [data-slot="badge"]')).toHaveText('Now');
  await context.close();
});

// The copy draws what the frame draws (#6157): the same components, read from the same elements in the
// renderer frame and in the exported file, at desktop and phone widths in both schemes.
const componentSource = `<meta name="tmt-ds" content="${pinOf(pinnedBundle)}">
<tmt-ui-card id="card" heading="Release" description="Build 42">Ready to ship</tmt-ui-card>
<p><tmt-ui-button id="button">Approve</tmt-ui-button> <tmt-ui-badge id="badge" variant="secondary">Done</tmt-ui-badge></p>
<tmt-ui-alert id="alert" heading="Heads up">The copy works offline.</tmt-ui-alert>`;
const readComponents = () =>
  ['card', 'button', 'badge', 'alert'].map((id) => {
    const host = document.getElementById(id)!;
    const drawn = host.querySelector('[data-slot]') ?? host;
    const style = getComputedStyle(drawn) as unknown as Record<string, string>;
    return {
      id,
      slot: drawn.getAttribute('data-slot'),
      text: drawn.textContent,
      ...Object.fromEntries(
        [
          'display',
          'color',
          'backgroundColor',
          'borderTopWidth',
          'borderTopColor',
          'borderTopLeftRadius',
          'paddingTop',
          'paddingLeft',
          'fontFamily',
          'fontSize',
          'fontWeight',
          'lineHeight',
        ].map((name) => [name, style[name]]),
      ),
    };
  });

for (const width of [1440, 390])
  for (const scheme of ['light', 'dark'] as const)
    test(`a pinned copy draws its components the way the frame does (${width}, ${scheme})`, async ({
      browser,
      page,
    }) => {
      const made = await exportPinned(page, componentSource);
      expect(made.outcome).toEqual({ included: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate(
        async ({ source, served }) => {
          const path = '/src/renderer.ts';
          const { mountRenderer } = await import(path);
          const host = document.createElement('div');
          host.id = 'probe';
          document.body.replaceChildren(host);
          // As wide as the copy's viewport, so the type ramp takes the same width step.
          const style = document.createElement('style');
          style.textContent = `body{margin:0}#probe iframe{width:${innerWidth}px;border:0}`;
          document.head.append(style);
          await mountRenderer(host, source, {
            signal: new AbortController().signal,
            onState: (state: string) => {
              host.dataset.state = state;
            },
            designSystem: {
              release: async () => served,
              draft: async () => served,
              watch: () => () => {},
            },
          });
        },
        { source: componentSource, served: pinnedBundle },
      );
      await expect(page.locator('#probe')).toHaveAttribute('data-state', 'ready');
      const frame = page.frameLocator('#probe iframe');
      await expect(frame.locator('#alert [data-slot]').first()).toBeAttached();
      const inFrame = await frame.locator('html').evaluate(readComponents);

      const file = join(directory, `components-${width}-${scheme}.html`);
      writeFileSync(file, made.document!);
      const context = await browser.newContext({
        colorScheme: scheme,
        offline: true,
        viewport: { width, height: 900 },
      });
      const exported = await context.newPage();
      const requests: string[] = [];
      exported.on('request', (request) => requests.push(request.url()));
      await exported.goto(pathToFileURL(file).href);
      await expect(exported.locator('#alert [data-slot]').first()).toBeAttached();
      const onDisk = await exported.evaluate(readComponents);
      expect(onDisk).toEqual(inFrame);
      // Not a vacuous match: each component drew its own part.
      expect(onDisk.map((entry) => entry.slot)).toEqual(['card', 'button', 'badge', 'alert']);
      expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([]);
      const capture = process.env.COLAB_CAPTURE_DIR;
      if (capture) {
        await page.screenshot({ path: join(capture, `6157-frame-${width}-${scheme}.png`) });
        await exported.screenshot({ path: join(capture, `6157-copy-${width}-${scheme}.png`) });
      }
      await context.close();
    });

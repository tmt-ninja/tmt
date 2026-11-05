import { readFileSync } from 'node:fs';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

// #6090: a page frame is as tall as its page, so the parent tells it which part the reader sees.
// A page-level dialog, sheet or drawer then centres in that part, its scrim covers exactly that
// part, and the Chat FAB never covers its buttons, wherever the page is scrolled.
const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
) as { hash: string };
const pin = `tmt-gui@0.1.0#${bundle.hash}`;
const HEADER = 56;

/** One set of page-level overlays, at a place on the page. */
const overlays = (at: string) =>
  `<p><tmt-ui-dialog label="${at} dialog" heading="Move ${at}">Pick where it lives.</tmt-ui-dialog>
   <tmt-ui-sheet label="${at} sheet" heading="Settings ${at}">Sheet body.</tmt-ui-sheet>
   <tmt-ui-dialog-drawer-panel label="${at} details" kind="drawer">Drawer body.</tmt-ui-dialog-drawer-panel></p>`;
const source = `<meta name="tmt-ds" content="${pin}">${overlays('Top')}
  <div style="height:2400px"></div>${overlays('Middle')}
  <div style="height:2400px"></div>${overlays('End')}<div style="height:120px"></div>`;

/** A bare host page: a fixed header, the renderer, and a FAB the parent measures. */
async function mount(page: Page) {
  await servePageRuntime(page);
  await page.route('**/viewport-host', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<!doctype html><html><head><meta charset="utf-8">' +
        // The dev server's React modules expect the refresh preamble its own pages carry.
        '<script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);' +
        'window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(t)=>t;' +
        'window.__vite_plugin_react_preamble_installed__=true;</script>' +
        '</head><body style="margin:0">' +
        `<header style="position:fixed;inset:0 0 auto;height:${HEADER}px;background:#888;z-index:5"></header>` +
        `<div id="probe" style="margin-top:${HEADER}px"></div>` +
        '<button id="fab" style="position:fixed;right:24px;bottom:24px;height:44px;width:120px;z-index:5">Chat</button>' +
        '</body></html>',
    }),
  );
  await page.goto('/viewport-host');
  await page.evaluate(
    async ({ source, header }) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.querySelector<HTMLElement>('#probe')!;
      const fab = document.querySelector<HTMLElement>('#fab')!;
      await mountRenderer(host, source, {
        signal: new AbortController().signal,
        onState: (state: string) => {
          host.dataset.state = state;
        },
        viewportInset: () => header,
        // The reserve is the FAB's measured box, with the gap the app keeps above it.
        viewportBottom: () => innerHeight - fab.getBoundingClientRect().top,
        designSystem: {
          release: async () => (await fetch('/bundle.json')).json(),
          draft: async () => (await fetch('/bundle.json')).json(),
          watch: () => () => {},
        },
      });
    },
    { source, header: HEADER },
  );
  await expect(page.locator('#probe')).toHaveAttribute('data-state', 'ready');
  return page.frameLocator('#probe iframe');
}

/** The visible part of the page in window pixels: under the header, above the FAB. */
async function visiblePart(page: Page) {
  return page.evaluate((header) => {
    const fab = document.querySelector('#fab')!.getBoundingClientRect();
    return { top: header, bottom: fab.top };
  }, HEADER);
}
/** A frame element's box in window pixels; the frame never scrolls, so its own box is offset. */
async function placed(page: Page, frame: FrameLocator, selector: string, backdrop = false) {
  const offset = (await page.locator('#probe iframe').boundingBox())!.y;
  const box = await frame
    .locator(selector)
    .last()
    .evaluate((node, pseudo) => {
      if (!pseudo) {
        const { top, bottom } = node.getBoundingClientRect();
        return { top, bottom };
      }
      // A native modal's scrim is its ::backdrop, which has no box to read: its used insets.
      const style = getComputedStyle(node, '::backdrop');
      return {
        top: parseFloat(style.top),
        bottom: innerHeight - parseFloat(style.bottom),
      };
    }, backdrop);
  return { top: offset + box.top, bottom: offset + box.bottom };
}

const kinds = [
  {
    kind: 'dialog',
    trigger: (at: string) => `${at} dialog`,
    surface: '[data-slot="dialog-content"]',
    scrim: '[data-slot="dialog-overlay"]',
    backdrop: false,
    centred: true,
  },
  {
    kind: 'sheet',
    trigger: (at: string) => `${at} sheet`,
    surface: '[data-slot="sheet-content"]',
    scrim: '[data-slot="sheet-overlay"]',
    backdrop: false,
    centred: false,
  },
  {
    kind: 'drawer',
    trigger: (at: string) => `Open ${at} details`,
    surface: 'dialog.tmt-ui-drawer[open]',
    scrim: 'dialog.tmt-ui-drawer[open]',
    backdrop: true,
    centred: false,
  },
] as const;

for (const width of [1440, 390])
  for (const at of ['Middle', 'End'])
    test(`a page-level overlay opened at the ${at.toLowerCase()} of a long page stays in view at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
      await page.route('**/bundle.json', (route) => route.fulfill({ json: bundle }));
      const frame = await mount(page);
      for (const { kind, trigger, surface, scrim, backdrop, centred } of kinds) {
        const button = frame.getByRole('button', { name: trigger(at) });
        await button.scrollIntoViewIfNeeded();
        if (at === 'End') await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await button.click();
        const view = await visiblePart(page);
        await expect(frame.locator(surface).last()).toBeVisible();
        // The band the parent sent is the visible part in the frame's own pixels.
        const offset = (await page.locator('#probe iframe').boundingBox())!.y;
        await expect
          .poll(() =>
            frame
              .locator('html')
              .evaluate((root) => [
                root.style.getPropertyValue('--tmt-ui-viewport-top'),
                root.style.getPropertyValue('--tmt-ui-viewport-height'),
              ]),
          )
          .toEqual([
            `${Math.round(view.top - offset)}px`,
            `${Math.round(view.bottom - offset) - Math.round(view.top - offset)}px`,
          ]);
        // The surface fits the visible part, its buttons above the FAB; a dialog centres in it.
        await expect
          .poll(async () => {
            const box = await placed(page, frame, surface);
            const fits = box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
            const middle = (box.top + box.bottom) / 2 - (view.top + view.bottom) / 2;
            return fits && (!centred || Math.abs(middle) <= 2);
          }, `${kind} in view`)
          .toBe(true);
        // The scrim covers exactly the visible part.
        const shade = await placed(page, frame, scrim, backdrop);
        expect(Math.abs(shade.top - view.top), `${kind} scrim top`).toBeLessThanOrEqual(1);
        expect(Math.abs(shade.bottom - view.bottom), `${kind} scrim bottom`).toBeLessThanOrEqual(1);
        // Scrolling the page, then resizing the window, while it is open keeps it in view.
        await page.evaluate(() => scrollBy(0, -200));
        await page.setViewportSize({ width, height: width > 600 ? 820 : 760 });
        const after = await visiblePart(page);
        await expect
          .poll(async () => {
            const box = await placed(page, frame, surface);
            return box.top >= after.top - 1 && box.bottom <= after.bottom + 1;
          }, `${kind} still in view`)
          .toBe(true);
        await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
        await page.keyboard.press('Escape');
        await expect(frame.locator(surface)).toHaveCount(0);
      }
    });

test('the frame takes only a whole-pixel band inside its own size, for the current render', async ({
  page,
}) => {
  await page.goto('/');
  const renderId = `00000000-0000-4000-8000-000000000003:${'c'.repeat(64)}`;
  await page.evaluate(async (renderId) => {
    const target = document.createElement('iframe');
    target.id = 'band';
    target.setAttribute('sandbox', 'allow-scripts');
    target.style.cssText = 'width:400px;height:600px;border:0';
    target.src = '/renderer.html';
    await new Promise<void>((resolve) => {
      target.onload = () => resolve();
      document.body.append(target);
    });
    const channel = new MessageChannel();
    (window as unknown as { bandPort: MessagePort }).bandPort = channel.port1;
    target.contentWindow!.postMessage(
      {
        type: 'colab.render.bind',
        renderId,
        sourceDigest: 'c'.repeat(64),
        source: '<p>Bound text</p>',
        theme: 'light',
      },
      '*',
      [channel.port2],
    );
  }, renderId);
  const frame = page.frameLocator('#band');
  await expect(frame.getByText('Bound text')).toBeVisible();
  const send = (message: Record<string, unknown>) =>
    page.evaluate(
      (message) => (window as unknown as { bandPort: MessagePort }).bandPort.postMessage(message),
      message,
    );
  const band = () =>
    frame.locator('html').evaluate((root) => ({
      marked: root.hasAttribute('data-tmt-ui-viewport'),
      top: root.style.getPropertyValue('--tmt-ui-viewport-top'),
      height: root.style.getPropertyValue('--tmt-ui-viewport-height'),
    }));
  const valid = { type: 'colab.render.viewport', renderId, top: 100, height: 300, width: 400 };
  for (const wrong of [
    { ...valid, renderId: `00000000-0000-4000-8000-000000000009:${'c'.repeat(64)}` },
    { ...valid, extra: 1 },
    { ...valid, top: 1.5 },
    { ...valid, top: -1 },
    { ...valid, height: '300' },
    { ...valid, height: 0 },
    { ...valid, width: 0 },
    // Beyond the frame's own 400 by 600 pixels.
    { ...valid, width: 2000 },
    { ...valid, top: 400, height: 300 },
    { ...valid, top: 1_000_001 },
  ])
    await send(wrong);
  // The port keeps order: a theme change after them proves they were all read.
  await send({ type: 'colab.render.theme', renderId, theme: 'dark' });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await band()).toEqual({ marked: false, top: '', height: '' });
  await send(valid);
  await expect.poll(band).toEqual({ marked: true, top: '100px', height: '300px' });
  // A frame that falls back to scrolling itself is its own viewport again, and stays so.
  await send({ type: 'colab.render.layout', renderId, mode: 'frame' });
  await expect.poll(band).toEqual({ marked: false, top: '', height: '' });
  await send({ ...valid, top: 50 });
  await send({ type: 'colab.render.theme', renderId, theme: 'light' });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await band()).toEqual({ marked: false, top: '', height: '' });
});

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

// #6060: a built-in Design component page shows the same scenes as the docs (5100), each as wide
// as the docs draw it. A scene that shrinks to a sliver (a size container in a centred canvas) or
// a page that draws other scenes than the docs fails here.
const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../design/systems/tmt-gui/generated/${name}`, import.meta.url),
      'utf8',
    ),
  );
const bundle = read('bundle.json') as { hash: string };
const pin = `tmt-gui@0.1.0#${bundle.hash}`;
const sections = read('pages.json') as { title: string; pages: { slug: string; html: string }[] }[];
/** Each component page's docs path, as its page names it. */
const paths = sections
  .filter((section) => ['Components', 'Browser components'].includes(section.title))
  .flatMap((section) => section.pages)
  .map(({ html }) => /tmt-ui-component-docs page="([^"]+)"/.exec(html)![1]!);

/** Every scene: its canvas (or Browser demo) width, its first drawn box's width and its text. */
function scenes(root: Element) {
  const first = (element: Element): Element | undefined => {
    for (const child of element.children) {
      if (child.matches('style,script,template')) continue;
      if (getComputedStyle(child).display === 'contents') {
        const inner = first(child);
        if (inner) return inner;
        continue;
      }
      return child;
    }
    return undefined;
  };
  return [...root.querySelectorAll('.docs-canvas, .docs-browser-demo')].map((scene) => {
    const box = first(scene);
    return {
      width: Math.round(scene.getBoundingClientRect().width),
      first: box ? Math.round(box.getBoundingClientRect().width) : 0,
      text: (scene as HTMLElement).innerText.trim().length,
    };
  });
}
type Scene = ReturnType<typeof scenes>[number];

async function reference(page: Page, path: string) {
  await page.evaluate(async (path) => {
    const module = '/test/design-scenes-browser.tsx';
    (await import(module)).mountDocs(`/ds/gui/${path}`);
  }, path);
  // The docs route follows the host path after mounting: wait for the component page itself.
  await expect(
    page.locator('#docs-reference .docs-main').locator('.docs-canvas, .docs-browser-demo').first(),
    path,
  ).toBeVisible();
  await expect(page.locator('#docs-reference [data-scene-loading]')).toHaveCount(0);
  // An image scene is as wide as its loaded image.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('#docs-reference img')].every(
          (image) => image.complete,
        ),
      ),
    )
    .toBe(true);
  const measured = await page.evaluate(
    `(${scenes.toString()})(document.querySelector('#docs-reference .docs-main'))`,
  );
  const width = await page
    .locator('#docs-reference .docs-article')
    .evaluate((article) => article.getBoundingClientRect().width);
  await page.evaluate(async () => {
    const module = '/test/design-scenes-browser.tsx';
    (await import(module)).hideDocs();
  });
  return { scenes: measured as Scene[], width };
}

async function design(page: Page, path: string, width: number): Promise<Scene[]> {
  await page.evaluate(
    async ({ path, pin, served, width }) => {
      const renderer = '/src/renderer.ts';
      const { mountRenderer } = await import(renderer);
      document.getElementById('design-scene')?.remove();
      const host = document.createElement('div');
      host.id = 'design-scene';
      host.style.width = `${width}px`;
      document.body.prepend(host);
      await mountRenderer(
        host,
        `<meta name="tmt-ds" content="${pin}"><div class="tmt-design-docs"><tmt-ui-component-docs page="${path}"></tmt-ui-component-docs></div>`,
        {
          signal: new AbortController().signal,
          onState: (state: string) => {
            host.dataset.state = state;
          },
          designSystem: {
            release: async () => served,
            draft: async () => served,
            watch: () => () => {},
          },
        },
      );
    },
    { path, pin, served: bundle, width },
  );
  await expect(page.locator('#design-scene')).toHaveAttribute('data-state', 'ready');
  const frame = page.frameLocator('#design-scene iframe');
  await expect(frame.locator('.docs-article > h1').first()).toBeVisible();
  await expect(frame.locator('[data-scene-loading]')).toHaveCount(0);
  await expect
    .poll(() =>
      frame
        .locator('body')
        .evaluate((body) => [...body.querySelectorAll('img')].every((image) => image.complete)),
    )
    .toBe(true);
  // The frame keeps its own page margin: widen it until its article is the docs' width.
  const article = () =>
    frame.locator('.docs-article').evaluate((node) => node.getBoundingClientRect().width);
  const inset = width - (await article());
  if (inset)
    await page
      .locator('#design-scene')
      .evaluate((host, next) => (host.style.width = `${next}px`), width + inset);
  await expect.poll(article).toBe(width);
  return (await frame
    .locator('body')
    .evaluate(`(${scenes.toString()})(document.querySelector('.docs-article'))`)) as Scene[];
}

for (const viewport of [1440, 390])
  test(`every built-in component page draws the docs' scenes at their width (${viewport})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: viewport, height: 900 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.addStyleTag({ content: '#design-scene iframe{display:block;width:100%;border:0}' });
    const failures: string[] = [];
    for (const path of paths) {
      const docs = await reference(page, path);
      const drawn = await design(page, path, docs.width);
      if (drawn.length !== docs.scenes.length)
        failures.push(`${path}: ${drawn.length} scenes, the docs draw ${docs.scenes.length}`);
      drawn.forEach((scene, index) => {
        const expected = docs.scenes[index];
        if (scene.text > 0 && scene.first < 8) failures.push(`${path} #${index}: collapsed`);
        // A page frame resets form controls (Tailwind's preflight drops an input's UA padding),
        // so an intrinsic control may differ by a few pixels; a thin or collapsed scene cannot.
        if (expected && Math.abs(scene.first - expected.first) > 6)
          failures.push(
            `${path} #${index}: ${scene.first} of ${scene.width}px, the docs ${expected.first} of ${expected.width}px`,
          );
      });
    }
    expect(failures).toEqual([]);
  });

// Design opens the Dialog and Sheet heroes over the page, as the docs do (#6090): the parent
// tells the frame which part the reader sees, so the modal and its scrim fit that part at 390.
for (const [path, trigger, kind] of [
  ['components/dialog', 'Move to project', 'dialog'],
  ['components/sheet', 'Page settings', 'sheet'],
] as const)
  test(`the ${path} hero opens over the visible page at 390`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.addStyleTag({ content: '#design-scene iframe{display:block;width:100%;border:0}' });
    await design(page, path, 358);
    const frame = page.frameLocator('#design-scene iframe');
    await expect(frame.locator('.docs-canvas-stage')).toHaveCount(0);
    await frame.getByRole('button', { name: trigger }).first().click();
    const surface = frame.locator(`[data-slot="${kind}-content"]`);
    await expect(surface).toBeVisible();
    const offset = await page
      .locator('#design-scene iframe')
      .evaluate((node) => node.getBoundingClientRect().top);
    const box = async (slot: string) =>
      frame.locator(`[data-slot="${kind}-${slot}"]`).evaluate((node) => {
        const { top, bottom, left, right } = node.getBoundingClientRect();
        return { top, bottom, left, right };
      });
    // The scrim covers the part of the frame in the window; the surface sits inside it.
    const visible = { top: Math.max(0, -offset), bottom: Math.min(844, 844 - offset) };
    await expect
      .poll(async () => {
        const scrim = await box('overlay');
        return [Math.round(scrim.top), Math.round(scrim.bottom)];
      })
      .toEqual([Math.round(visible.top), Math.round(visible.bottom)]);
    const content = await box('content');
    expect(offset + content.top).toBeGreaterThanOrEqual(0);
    expect(offset + content.bottom).toBeLessThanOrEqual(844);
    if (kind === 'dialog')
      expect(
        Math.abs(content.top + content.bottom - (visible.top + visible.bottom)),
      ).toBeLessThanOrEqual(2);
  });

// A narrow Design frame takes the compact (<=760px) tokens, as the docs do at 390: the frame's
// tokens once stopped before that block and kept the wide header padding and type.
test('a Design frame at 390 resolves the compact tokens as the docs do', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await servePageRuntime(page);
  await page.goto('/');
  await page.addStyleTag({ content: '#design-scene iframe{display:block;width:100%;border:0}' });
  const compact = (header: Element) => {
    const style = getComputedStyle(header);
    return {
      padding: style.paddingInlineStart,
      height: style.height,
      ...Object.fromEntries(
        [
          '--tmt-ui-header-padding-inline',
          '--tmt-ui-header-height',
          '--tmt-ui-type-display-size',
          '--tmt-ui-type-body-size',
        ].map((name) => [name, style.getPropertyValue(name).trim()]),
      ),
    };
  };
  await page.evaluate(async () => {
    const module = '/test/design-scenes-browser.tsx';
    (await import(module)).mountDocs('/ds/gui/browser/header');
  });
  const docsHeader = page.locator('#docs-reference .docs-browser-demo .tmt-ui-header').first();
  await expect(docsHeader).toBeVisible();
  const docs = await docsHeader.evaluate(compact);
  await page.evaluate(async () => {
    const module = '/test/design-scenes-browser.tsx';
    (await import(module)).hideDocs();
  });
  await design(page, 'browser/header', 358);
  const drawn = await page
    .frameLocator('#design-scene iframe')
    .locator('.docs-browser-demo .tmt-ui-header')
    .first()
    .evaluate(compact);
  expect(docs.padding).toBe('18px');
  expect(drawn).toEqual(docs);
});

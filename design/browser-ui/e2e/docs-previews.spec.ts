import { expect, test, type Page } from '@playwright/test';

// #5821: every width preview on a /docs page stays inside its cell, shows all of its own scaled
// viewport and never covers a neighbour, at a desktop and a phone viewport. The docs site is the
// second web server in playwright.config.ts.
const docs = `http://127.0.0.1:${Number(process.env.BROWSER_UI_TEST_PORT ?? 5184) + 1}`;

/** Every docs page of both design systems, from each system's own nav (mocks excluded). */
async function docsPages(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const paths: string[] = [];
  for (const root of ['/ds/gui', '/ds/tui']) {
    await page.goto(`${docs}${root}`);
    const hrefs = await page
      .locator('nav.docs-nav a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!));
    paths.push(root, ...hrefs.filter((href) => !href.includes('/mocks/')));
  }
  return [...new Set(paths)];
}

/** The layout faults of one page's previews, as readable lines; empty when the page is sound. */
const previewFaults = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const slack = 0.5;
    const frames = [...document.querySelectorAll<HTMLElement>('[data-preview-frame]')];
    const faults: string[] = [];
    const name = (frame: HTMLElement) => frame.querySelector('iframe')?.title ?? '(untitled)';
    const boxes = frames.map((frame) => frame.getBoundingClientRect());
    frames.forEach((frame, index) => {
      const box = boxes[index]!;
      const cell = frame.parentElement!.getBoundingClientRect();
      const view = frame.querySelector('iframe')!.getBoundingClientRect();
      if (box.left < cell.left - slack || box.right > cell.right + slack)
        faults.push(
          `${name(frame)}: box ${box.left}-${box.right} leaves cell ${cell.left}-${cell.right}`,
        );
      if (box.right > innerWidth + slack)
        faults.push(`${name(frame)}: box ends at ${box.right}, past the ${innerWidth}px viewport`);
      if (view.right > box.right + slack || view.bottom > box.bottom + slack)
        faults.push(
          `${name(frame)}: viewport ${view.width}x${view.height} clipped by box ${box.width}x${box.height}`,
        );
      boxes.slice(index + 1).forEach((other, offset) => {
        const width = Math.min(box.right, other.right) - Math.max(box.left, other.left);
        const height = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
        if (width > slack && height > slack)
          faults.push(`${name(frame)} overlaps ${name(frames[index + 1 + offset]!)}`);
      });
    });
    return { count: frames.length, faults };
  });

for (const width of [1440, 390]) {
  test(`docs previews keep to their cells at ${width}`, async ({ page }) => {
    test.setTimeout(300_000);
    const paths = await docsPages(page);
    expect(paths.length).toBeGreaterThan(20);
    await page.setViewportSize({ width, height: 900 });
    const faults: string[] = [];
    let previews = 0;
    for (const path of paths) {
      await page.goto(`${docs}${path}`);
      await page.locator('main').first().waitFor();
      const result = await previewFaults(page);
      previews += result.count;
      faults.push(...result.faults.map((fault) => `${path}: ${fault}`));
    }
    // The sweep reached the pattern and frame previews, not only pages without any.
    expect(previews).toBeGreaterThan(40);
    expect(faults).toEqual([]);
  });
}

test('the preview check catches a frame that keeps its full width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${docs}/ds/gui/patterns/tabs-row`);
  await page.locator('[data-preview-frame]').first().waitFor();
  // The #5821 fault: the old two-column grid with a fixed 720px box for the 1440 frame, which spills
  // out of its column over the 390 frame next to it.
  const seed = await page.addStyleTag({
    content: `.pattern-viewports { grid-template-columns: minmax(0, 720px) 390px !important; }
      .pattern-viewport[data-width='1440'] .scaled-frame { max-width: none !important; width: 720px !important; }`,
  });
  const spill = (await previewFaults(page)).faults;
  expect(spill.some((fault) => fault.includes('leaves cell'))).toBe(true);
  expect(spill.some((fault) => fault.includes(' overlaps '))).toBe(true);
  await seed.evaluate((style) => (style as Element).remove());
  // A box shorter than its scaled viewport clips the preview's own content.
  await page.addStyleTag({ content: '.scaled-frame { height: 40px !important; }' });
  expect((await previewFaults(page)).faults.some((fault) => fault.includes('clipped by box'))).toBe(
    true,
  );
});

test('the 390 tabs-row preview shows the phone row', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${docs}/ds/gui/patterns/tabs-row`);
  const phone = page.frameLocator('iframe[title="Tabs row with actions Default 390 dark"]');
  const actions = phone.locator('[data-slot="button"]');
  await expect(actions).toHaveCount(2);
  const [first, second] = [await actions.nth(0).boundingBox(), await actions.nth(1).boundingBox()];
  expect(first!.width).toBeCloseTo(first!.height, 0);
  expect(second!.width).toBeCloseTo(first!.width, 0);
  await expect(phone.getByRole('tab', { name: /All/ })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'New page' })).toBeVisible();
});

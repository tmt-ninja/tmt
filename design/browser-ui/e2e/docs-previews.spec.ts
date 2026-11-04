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
    const name = (frame: HTMLElement) => frame.dataset.previewTitle ?? '(untitled)';
    const boxes = frames.map((frame) => frame.getBoundingClientRect());
    frames.forEach((frame, index) => {
      const box = boxes[index]!;
      const cell = frame.parentElement!.getBoundingClientRect();
      const view = frame.querySelector('[data-tmt-ds-scope]')!.getBoundingClientRect();
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
  const phone = page.locator('[data-preview-title="Tabs row with actions Default 390 dark"]');
  const actions = phone.locator('[data-slot="button"]');
  await expect(actions).toHaveCount(2);
  const [first, second] = [await actions.nth(0).boundingBox(), await actions.nth(1).boundingBox()];
  expect(first!.width).toBeCloseTo(first!.height, 0);
  expect(second!.width).toBeCloseTo(first!.width, 0);
  await expect(phone.getByRole('tab', { name: /All/ })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'New page' })).toBeVisible();
});

for (const viewport of [390, 1440]) {
  test(`page-list previews use their scope width at viewport ${viewport}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.goto(`${docs}/ds/gui/components/page-list`);
    await expect(page.locator('iframe')).toHaveCount(0);
    for (const [stage, expectedColumns] of [
      [390, 1],
      [1440, 3],
    ] as const) {
      const preview = page.locator(`[data-preview-title="Page list ${stage} light"]`);
      const pins = preview.locator('.tmt-page-list-pins');
      await expect(pins).toBeVisible();
      expect(
        await pins.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
      ).toBe(expectedColumns);
    }
  });
}

test('an interactive pattern opens inside its scope without locking the docs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${docs}/ds/gui/patterns/add-dialog`);
  await expect(page.locator('iframe')).toHaveCount(0);
  const stage = page.locator('[data-preview-frame]').first();
  const outside = page.locator('nav.docs-nav a').first();
  await expect(stage.getByRole('dialog')).toHaveCount(0);
  await stage.getByRole('button', { name: 'Add a sub-page' }).click();
  const dialog = stage.getByRole('dialog', { name: /Add a sub-page/ });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(false);
  expect(
    await page.locator('body').evaluate((node) => ({
      inert: node.hasAttribute('inert'),
      hidden: node.hasAttribute('aria-hidden'),
      overflow: node.style.overflow,
    })),
  ).toEqual({ inert: false, hidden: false, overflow: '' });
  await expect(outside).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});

test('a long header suffix stays on one line clear of its status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${docs}/ds/gui/browser/header`);
  const heading = page.locator('.tmt-ui-heading-suffix').last();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText('· draft');
  const geometry = await heading.evaluate((node) => {
    const text = node.querySelector('span')!;
    const status = node.closest('.tmt-ui-header')!.querySelector('.tmt-ui-status')!;
    const a = text.getBoundingClientRect();
    const b = status.getBoundingClientRect();
    return { lines: text.getClientRects().length, right: a.right, statusLeft: b.left };
  });
  expect(geometry.lines).toBe(1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.statusLeft);
});

test('captures the affected docs pages at both widths and themes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const routes = [
    'components/data-table',
    'components/rich-input',
    'browser/dialog-drawer-panel',
    'browser/header',
    'browser/notifications',
  ];
  await page.goto(`${docs}/ds/gui`);
  for (const width of [390, 1440])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => localStorage.setItem('tmt-ui-theme', value), theme);
      for (const route of routes) {
        await page.goto(`${docs}/ds/gui/${route}`);
        await page.locator('main').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`${route.replace('/', '-')}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  expect(errors).toEqual([]);
});

test('a phone shell preview uses its own width and opens its drawer locally', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${docs}/ds/gui/browser/shell`);
  const pair = page
    .locator('.gallery-pair')
    .filter({ has: page.getByRole('heading', { name: 'Phone (390 px, ≤900 px layout)' }) });
  const stage = pair.locator('[data-preview-frame]').first();
  const opener = stage.getByRole('button', { name: 'Open navigation' });
  await expect(opener).toBeVisible();
  expect(
    await stage
      .locator('.tmt-ui-header')
      .first()
      .evaluate((node) => getComputedStyle(node).height),
  ).toBe('56px');
  await expect(opener).toHaveAttribute('aria-expanded', 'false');
  await opener.click();
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  await expect(stage.getByRole('navigation', { name: 'TMT' })).toBeVisible();
});

test('a wide shell preview stays wide inside a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${docs}/ds/gui/browser/shell`);
  const pair = page.locator('.gallery-pair').filter({
    has: page.getByRole('heading', { name: 'BrowserShell · rail expanded with module menu' }),
  });
  const stage = pair.locator('[data-preview-frame]').first();
  await expect(stage.getByRole('navigation', { name: 'TMT' })).toBeVisible();
  expect(
    await stage
      .locator('.tmt-ui-header')
      .first()
      .evaluate((node) => getComputedStyle(node).height),
  ).toBe('62px');
  await expect(stage.locator('.tmt-ui-shell-open')).toBeHidden();
});

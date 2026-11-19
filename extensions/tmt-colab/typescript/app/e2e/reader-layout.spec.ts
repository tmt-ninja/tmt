import { expect, test, type Page } from '@playwright/test';
import type { PageView } from '../src/transport.js';

const fixture = '/test/reader-metadata-browser.tsx';
const frame = (page: Page) => page.locator('#reader-metadata-fixture iframe');
const html = (page: Page) => page.frameLocator('#reader-metadata-fixture iframe').locator('html');
const layout = (page: Page, next: PageView['layout']) =>
  page.evaluate(async ({ fixture, next }) => (await import(fixture)).layout(next), {
    fixture,
    next,
  });
async function mount(page: Page) {
  await page.goto('/');
  await page.evaluate(async (fixture) => (await import(fixture)).mount('viewer'), fixture);
  await expect(
    page.frameLocator('#reader-metadata-fixture iframe').getByRole('heading', {
      name: 'Editor metadata',
      exact: true,
    }),
  ).toBeVisible();
}

for (const width of [390, 1440]) {
  for (const kind of ['column', 'full', 'canvas', undefined] as const)
    test(`reader applies ${kind ?? 'absent'} layout at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mount(page);
      await layout(page, kind);
      await expect(frame(page)).toHaveCount(1);
      if (kind === 'column' || kind === 'full')
        await expect(html(page)).toHaveAttribute('data-colab-layout', kind);
      // Canvas and absent (freeform) intentionally retain author layout, as in the page view.
      else await expect(html(page)).not.toHaveAttribute('data-colab-layout', /.+/);
    });

  test(`reader remounts for layout-only changes, not unchanged metadata, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(page);
    const source = await page.evaluate(
      async (fixture) => (await import(fixture)).proof().view.source,
      fixture,
    );
    for (const kind of ['column', 'full', 'canvas', undefined] as const) {
      const previous = (await frame(page).elementHandle())!;
      const previousId = await frame(page).getAttribute('data-render-id');
      await layout(page, kind);
      await expect.poll(() => previous.evaluate((node) => node.isConnected)).toBe(false);
      await expect(frame(page)).toHaveCount(1);
      await expect(frame(page)).not.toHaveAttribute('data-render-id', previousId!);
      if (kind === 'column' || kind === 'full')
        await expect(html(page)).toHaveAttribute('data-colab-layout', kind);
      else await expect(html(page)).not.toHaveAttribute('data-colab-layout', /.+/);
      const current = (await frame(page).elementHandle())!;
      await layout(page, kind);
      expect(await current.evaluate((node) => node.isConnected)).toBe(true);
      expect(
        await page.evaluate(
          async (fixture) => (await import(fixture)).proof().view.source,
          fixture,
        ),
      ).toBe(source);
    }
  });
}

// The shared reader shows the page view's outline for a page with three or more headings (#6470).
for (const width of [390, 1440])
  test(`reader shows the page outline and jumps to a heading at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto('/');
    await page.evaluate(
      async (fixture) =>
        (await import(fixture)).mount('viewer', [
          'Scope',
          'Plan',
          'Risks',
          ...Array.from({ length: 12 }, (_, n) => `Note ${n + 1}`),
        ]),
      fixture,
    );
    const outline = page.locator('#reader-metadata-fixture').getByRole('navigation', {
      name: 'Page outline',
    });
    await expect(outline).toBeVisible();
    await outline.locator('.page-outline-toggle').click();
    await outline.getByRole('button', { name: 'Note 12' }).click();
    await expect(
      page
        .frameLocator('#reader-metadata-fixture iframe')
        .getByRole('heading', { name: 'Note 12' }),
    ).toBeInViewport();
  });

// A link reader's page status follows the owner's bar (#6679): one status mark in the bar that opens
// the details, nothing under the title, and only what the share carries — the manual state and the
// owner's own fields, never the owner-local computed status, PRs, activity or sections.
const status = (page: Page, kind: 'filled' | 'manual' | 'none') =>
  page.evaluate(async ({ fixture, kind }) => (await import(fixture)).status(kind), {
    fixture,
    kind,
  });
const readerField = (details: import('@playwright/test').Locator, name: string) =>
  details
    .locator('.page-status-fields dt')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator('xpath=following-sibling::dd[1]');

for (const width of [1440, 390, 320])
  test(`a reader's status mark opens the page's own fields at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mount(page);
    await status(page, 'filled');
    const bar = page.getByRole('banner');
    const mark = bar.locator('.page-bar-status');
    // The dot stays in the bar at every width (#6677); the long title gives way.
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAccessibleName('Blocked, show status details');
    const box = (await mark.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    // Nothing under the title: no summary row, at any width.
    await expect(page.locator('.work-band:visible')).toHaveCount(0);
    await mark.click();
    const details = page.locator('.page-status-details:visible');
    await expect(details.locator('.page-status-headline')).toContainText(
      /^Blocked\s*Waiting for Core to decide/,
    );
    await expect(readerField(details, 'Owner')).toHaveText(/gui-3$/);
    await expect(readerField(details, 'Priority')).toHaveText('↑ High');
    await expect(readerField(details, 'Next')).toHaveText('Review the mockup');
    await expect(details.getByRole('button', { name: '4 sub-pages' })).toBeVisible();
    // Owner-local facts never show, not even as "unknown".
    for (const name of ['Sections', 'Last activity', 'Owner activity'])
      await expect(readerField(details, name)).toHaveCount(0);
    await expect(details.locator('.page-status-pulls')).toHaveCount(0);
    await expect(details.locator('.page-status-projects')).toHaveCount(0);
    // The details set body text that wraps, not the header's one-line title type.
    expect(await details.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const sheet = (await details.boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(width);
  });

test('a reader sees the manual state labelled as the page state, and no mark without fields', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);
  await status(page, 'manual');
  const mark = page.getByRole('banner').locator('.page-bar-status');
  await expect(mark).toHaveAccessibleName('Page state: In progress, show details');
  await expect(mark).toContainText('In progress');
  await mark.click();
  await expect(page.locator('.page-status-details:visible .page-status-headline')).toHaveText(
    /^Page state\s*In progress$/,
  );
  await page.keyboard.press('Escape');
  await expect(mark).toBeFocused();
  // No stored state and no field: no mark at all.
  await status(page, 'none');
  await expect(page.locator('.page-bar-status')).toHaveCount(0);
  await expect(page.locator('.work-band')).toHaveCount(0);
});

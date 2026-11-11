import { expect, test } from '@playwright/test';

// #6280: the canvas rules that place the page's own status notice match only that NoticeCard, so a
// callout block's notice stays in the page's flow. The page's notice keeps its place.
for (const sheet of ['app', 'reader'] as const)
  test(`the ${sheet} stylesheet places the page's notice and leaves a callout's in flow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.evaluate(async (which) => {
      const path = '/test/canvas-notice-browser.tsx';
      await (await import(path)).mountCanvasNotice(which);
    }, sheet);
    const own = page.locator('.canvas > .notice-card > .tmt-ui-notice');
    await expect(own).toContainText('This page could not be drawn.');
    const placed = await own.evaluate((node) => getComputedStyle(node).position);
    expect(placed).toBe(sheet === 'app' ? 'absolute' : 'fixed');
    const callout = page.getByTestId('callout').locator('.tmt-ui-notice');
    await expect(callout).toContainText('A callout');
    expect(await callout.evaluate((node) => getComputedStyle(node).position)).toBe('static');
  });

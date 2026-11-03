import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';

async function mount(
  page: Page,
  width: number,
  theme: 'light' | 'dark',
  size: 'work' | 'work-pinned' | 'none' | 'unmanaged' = 'work-pinned',
  hash = '/',
) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(
    async ({ theme, size, hash }) => {
      document.documentElement.dataset.theme = theme;
      const path = '/test/page-list-browser.tsx';
      const fixture = await import(path);
      await fixture.mountPageList(size, hash);
    },
    { theme, size, hash },
  );
  await expect(page.locator('#list-fixture [data-page-list]')).toBeVisible();
}

for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`page-list shared parts and states at ${width} ${theme}`, async ({ page }) => {
      const root = page.locator('#list-fixture');
      await mount(page, width, theme);
      await expect(root.getByRole('grid', { name: 'Pages' })).toBeVisible();
      await expect(root.getByRole('tablist', { name: 'Page views' })).toBeVisible();
      await page.screenshot({ path: await capturePath(`5972-filled-${width}-${theme}.png`) });
      await root.getByRole('checkbox', { name: 'Select Review 2', exact: true }).check();
      await expect(root.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
      await page.screenshot({ path: await capturePath(`5972-selected-${width}-${theme}.png`) });
      await mount(page, width, theme, 'none');
      await expect(root.getByText('No pages yet', { exact: true })).toBeVisible();
      await page.screenshot({ path: await capturePath(`5972-empty-${width}-${theme}.png`) });
      await mount(page, width, theme, 'work', '/?q=no-such-page');
      await expect(root.getByText('No pages match', { exact: true })).toBeVisible();
      await page.screenshot({
        path: await capturePath(`5972-filtered-empty-${width}-${theme}.png`),
      });
      await mount(page, width, theme, 'unmanaged');
      const readOnly = root.getByRole('row').filter({ hasText: 'Alpha plan' });
      await expect(readOnly.getByRole('checkbox', { name: 'Select Alpha plan' })).toBeDisabled();
      await expect(readOnly).toContainText('Read-only');
      await page.screenshot({ path: await capturePath(`5972-read-only-${width}-${theme}.png`) });
    });
  }

for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const)
    test(`home pending and retry at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/');
      await page.evaluate(async (theme) => {
        document.documentElement.dataset.theme = theme;
        const path = '/test/page-list-browser.tsx';
        const fixture = await import(path);
        fixture.holdHome();
        await fixture.mountPageList('few', '/', undefined, true, 'network');
      }, theme);
      const app = page.locator('#list-fixture');
      await expect(app.getByLabel('Loading pages')).toBeVisible();
      await expect(app.getByLabel('Loading pages').locator('[data-slot=skeleton]')).toHaveCount(6);
      await page.screenshot({ path: await capturePath(`5972-loading-${width}-${theme}.png`) });
      await page.evaluate(async () => {
        const path = '/test/page-list-browser.tsx';
        (await import(path)).releaseHome();
      });
      await expect(app.getByText('Could not load pages')).toBeVisible();
      await page.screenshot({ path: await capturePath(`5972-error-${width}-${theme}.png`) });
      await app.getByRole('button', { name: 'Try again' }).click();
      await expect(app.getByRole('grid', { name: 'Pages' })).toBeVisible();
    });

for (const failure of ['admission', 'session'] as const) {
  test(`home ${failure} failure keeps the existing root recovery view`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (kind) => {
      const path = '/test/page-list-browser.tsx';
      await (await import(path)).mountPageList('few', '/', undefined, true, kind);
    }, failure);
    const app = page.locator('#list-fixture');
    await expect(app.getByText('Could not load pages')).toHaveCount(0);
    await expect(app.getByRole('button', { name: /Try again|Retry/i }).first()).toBeVisible();
  });
}

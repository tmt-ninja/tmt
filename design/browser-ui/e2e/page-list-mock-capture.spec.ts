import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const docs = `http://127.0.0.1:${Number(process.env.BROWSER_UI_TEST_PORT ?? 5184) + 1}`;
const directory = process.env.PAGE_LIST_CAPTURE_DIR ?? '/tmp/tmt-page-list-captures';

for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`page-list mock states at ${width} ${theme}`, async ({ page }) => {
      mkdirSync(directory, { recursive: true });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const capture = async (state: string, query = '') => {
        await page.goto(`${docs}/ds/gui/mocks/colab${query}`);
        // A read-only list has no stage tabs, so wait on the list itself.
        await expect(page.locator('.list-page')).toBeVisible();
        await page.screenshot({
          path: path.join(directory, `5972-mock-${state}-${width}-${theme}.png`),
        });
      };
      await capture('filled');
      await page.getByRole('checkbox', { name: 'Select Theme B review', exact: true }).check();
      await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
      await page.screenshot({
        path: path.join(directory, `5972-mock-selected-${width}-${theme}.png`),
      });
      await capture('empty', '?data=empty');
      await capture('filtered-empty', '?filter=none');
      await capture('loading', '?data=loading');
      await capture('error', '?data=error');
      await capture('read-only', '?data=readonly');
      await expect(page.getByRole('tablist')).toHaveCount(0);
      await expect(page.getByRole('list', { name: 'Pinned pages' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Needs you, \d+ pages$/ })).toBeVisible();
      await capture('sticky', '?sticky=1');
    });
  }

import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const docs = `http://127.0.0.1:${Number(process.env.BROWSER_UI_TEST_PORT ?? 5184) + 1}`;
const captures = process.env.BLOCKS_CAPTURE_DIR ?? '/tmp/tmt-block-captures';

test('the structured block catalog renders at both widths and themes', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(captures, { recursive: true });
  const entries = [
    ['question-block', 'Question block'],
    ['image-block', 'Image block'],
    ['mockup-block', 'Mockup block'],
    ['work-bundle', 'Work bundle'],
    ['page-view', 'Page view'],
  ] as const;
  await page.goto(`${docs}/ds/gui`);
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => localStorage.setItem('tmt-ui-theme', value), theme);
      for (const [slug, name] of entries) {
        await page.goto(`${docs}/ds/gui/components/${slug}`);
        await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator('iframe')).toHaveCount(0);
        await page.screenshot({
          path: join(captures, `${slug}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
});

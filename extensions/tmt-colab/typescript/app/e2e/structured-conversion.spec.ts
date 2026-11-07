import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

for (const width of [390, 1440])
  for (const theme of ['light', 'dark']) {
    test(`conversion explains replacement and requires confirmation ${width} ${theme}`, async ({
      page,
    }) => {
      await page.route('**/src/main.tsx', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: '' }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.evaluate(async () => {
        const fixture = '/test/structured-conversion-fixture.tsx';
        (await import(/* @vite-ignore */ fixture)).render();
      });
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      const open = async () => {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Convert to structured page…' }).click();
      };
      await open();
      const dialog = page.getByRole('dialog', { name: 'Convert to a structured page?' });
      await expect(dialog).toContainText('The current page becomes an empty structured page.');
      await expect(dialog).toContainText(
        "A copy of the old page is kept in the archive as 'Planning (before conversion)'.",
      );
      await expect(dialog).toContainText(
        "The current page's layout is removed; the archived copy keeps it.",
      );
      const captureDir = process.env.COLAB_CONVERSION_CAPTURE_DIR;
      if (captureDir) {
        mkdirSync(captureDir, { recursive: true });
        await page.screenshot({ path: `${captureDir}/conversion-${width}-${theme}.png` });
      }
      const cancel = dialog.getByRole('button', { name: 'Cancel' });
      await expect(cancel).toBeFocused();
      await cancel.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('confirm-count')).toHaveText('0');
      await open();
      await dialog.getByRole('button', { name: 'Convert page' }).click();
      await expect(page.getByTestId('confirm-count')).toHaveText('1');
      await expect(dialog.getByRole('button', { name: 'Convert page' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('confirm-count')).toHaveText('1');
    });
  }

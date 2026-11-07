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
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Switch back to HTML…' }).click();
      const revert = page.getByRole('dialog', { name: 'Switch back to HTML?' });
      await expect(revert).toContainText(
        'The page shows its old HTML again. Switching back removes the 12 blocks written since conversion.',
      );
      if (process.env.COLAB_CONVERSION_CAPTURE_DIR) {
        mkdirSync(process.env.COLAB_CONVERSION_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: `${process.env.COLAB_CONVERSION_CAPTURE_DIR}/revert-${width}-${theme}.png`,
        });
      }
      await expect(revert.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await revert.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('confirm-count')).toHaveText('0');
      const open = async () => {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Convert to structured page…' }).click();
      };
      await open();
      const dialog = page.getByRole('dialog', { name: 'Convert to a structured page?' });
      await expect(dialog).toContainText('This page becomes an empty structured page.');
      await expect(dialog).toContainText(
        'The old HTML is kept with the page; you can read it or switch back at any time.',
      );
      await expect(dialog).toContainText("The current page's layout is removed.");
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

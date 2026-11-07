import { expect, test } from '@playwright/test';

test('conversion explains replacement and requires confirmation', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/test/structured-conversion-fixture.tsx';
    (await import(/* @vite-ignore */ fixture)).render();
  });
  const opener = page.getByRole('button', { name: 'Open conversion' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Convert to a structured page?' });
  await expect(dialog).toContainText('The current page becomes an empty structured page.');
  await expect(dialog).toContainText(
    "A copy of the old page is kept in the archive as 'Planning (before conversion)'.",
  );
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('confirm-count')).toHaveText('0');
  await opener.click();
  await dialog.getByRole('button', { name: 'Convert page' }).click();
  await expect(page.getByTestId('confirm-count')).toHaveText('1');
  await expect(dialog.getByRole('button', { name: 'Convert page' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('confirm-count')).toHaveText('1');
});

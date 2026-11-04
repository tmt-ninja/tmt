import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`page view controls change filters and columns at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(async () => {
      const fixture = '/blocks-harness.tsx';
      (await import(fixture)).mountPageViewToolbar();
    });
    const toolbar = page.getByRole('toolbar', { name: 'Spec pages page view' });
    await toolbar.getByRole('button', { name: 'Remove Project: gui filter' }).click();
    await expect(toolbar.getByText('Project: gui')).toHaveCount(0);
    await toolbar.getByLabel('Group by').selectOption('project');
    await expect(toolbar.getByLabel('Group by')).toHaveValue('project');
    await toolbar.getByRole('button', { name: 'Columns 3/3' }).click();
    if (width === 390) {
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name: 'Visible columns' })).toBeVisible();
      await sheet.getByRole('checkbox', { name: 'Updated' }).click();
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('menuitemcheckbox', { name: 'Updated' }).click();
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('[data-columns]')).toHaveText('title,state');
    await expect(toolbar.getByRole('button', { name: 'Columns 2/3' })).toBeFocused();
  });
}

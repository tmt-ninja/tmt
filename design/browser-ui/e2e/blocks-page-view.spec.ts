import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`page view shares one aligned grid and collapses groups at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(async () => {
      const fixture = '/blocks-harness.tsx';
      (await import(fixture)).mountPageView();
    });
    const grid = page.getByRole('grid', { name: 'Pages' });
    await expect(grid).toHaveCount(1);
    await expect(grid.getByText('First page')).toBeVisible();
    await expect(grid.getByText('Second page')).toBeVisible();
    const waiting = grid.getByRole('button', { name: /Waiting/ });
    await waiting.click();
    await expect(waiting).toHaveAttribute('aria-expanded', 'false');
    await expect(grid.getByText('First page')).toHaveCount(0);
    await expect(grid.getByText('Second page')).toBeVisible();
    await waiting.click();
    await expect(grid.getByText('First page')).toBeVisible();
    const rows = grid.locator('[data-table-row]');
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.getByLabel('Group by').selectOption('project');
    await expect(grid.getByRole('button', { name: /spec/ })).toContainText('2');
  });
}

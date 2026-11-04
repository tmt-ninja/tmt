import { expect, test } from '@playwright/test';

test('a 1440 mockup fits its own container without a document frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountMockup();
  });
  const stage = page.locator('[data-tmt-ds-scope]');
  await expect(stage.getByRole('button', { name: 'Inside stage' })).toBeVisible();
  await page.getByRole('button', { name: '1440' }).click();
  await expect(page.getByRole('button', { name: '1440' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Scaled 21%')).toBeVisible();
  expect((await stage.boundingBox())!.width).toBeLessThanOrEqual(301);
  expect(await stage.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(250);
  await expect(page.locator('iframe')).toHaveCount(0);
});

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
  // A 390 stage in a 300px block scales to fit too, rather than scrolling sideways.
  expect((await stage.boundingBox())!.width).toBeCloseTo(300, 0);
  await expect(page.getByLabel('Scaled 77%')).toHaveText('77%');
  await page.getByRole('button', { name: '1440' }).click();
  await expect(page.getByRole('button', { name: '1440' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Scaled 21%')).toHaveText('21%');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('[data-theme=dark]')).toHaveCount(1);
  expect((await stage.boundingBox())!.width).toBeLessThanOrEqual(301);
  expect(await stage.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(250);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('the host receives system, version and stage setting changes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountConfigurableMockup();
  });
  await page.getByLabel('Design system', { exact: true }).selectOption('brio');
  await page.getByLabel('Design system version').selectOption('2.0.0');
  await page.getByRole('button', { name: '1440' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('[data-setting]')).toHaveText('brio@2.0.0:1440:dark');
});

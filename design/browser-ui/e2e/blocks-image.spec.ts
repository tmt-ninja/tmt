import { expect, test } from '@playwright/test';

test('viewer traps focus, changes images and zoom, and restores focus', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountImages();
  });
  const open = page.getByRole('button', { name: 'Image 1: open viewer' });
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('First image');
  await dialog.press('ArrowRight');
  await expect(dialog).toContainText('Second image');
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog).toContainText('125%');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await expect(dialog.getByRole('link', { name: 'Download image' })).toHaveAttribute(
    'download',
    'image',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('a scoped image viewer leaves controls outside its stage usable', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountScopedImages();
  });
  await page.getByRole('button', { name: 'Image 1: open viewer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => (await dialog.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(389);
  await expect
    .poll(async () => (await dialog.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(359);
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Outside clicked' })).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => !!node.closest('[data-tmt-ds-scope]'))).toBe(true);
});

test('the viewer fills a phone viewport and offers its close control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountImages();
  });
  await page.getByRole('button', { name: 'Image 1: open viewer' }).click();
  const dialog = page.getByRole('dialog');
  await expect
    .poll(async () => (await dialog.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(389);
  await expect
    .poll(async () => (await dialog.boundingBox())?.height ?? 0)
    .toBeGreaterThanOrEqual(843);
  expect((await dialog.boundingBox())!.x).toBeCloseTo(0, 0);
  expect((await dialog.boundingBox())!.y).toBeCloseTo(0, 0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});

test('single layout returns focus to the opened image after navigating the viewer', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountImages('single');
  });
  const first = page.getByRole('button', { name: 'Image 1: open viewer' });
  await expect(page.getByRole('button', { name: 'Image 2: open viewer' })).toBeHidden();
  await first.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Next image' }).click();
  await expect(dialog).toContainText('Second image');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(first).toBeFocused();
});

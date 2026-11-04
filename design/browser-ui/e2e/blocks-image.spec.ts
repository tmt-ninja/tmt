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
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Outside clicked' })).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => !!node.closest('[data-tmt-ds-scope]'))).toBe(true);
});

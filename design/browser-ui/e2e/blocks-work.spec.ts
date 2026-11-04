import { expect, test } from '@playwright/test';

test('work bundle follows host metadata and retains work if the page is unavailable', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountWorkBundle();
  });
  const card = page.locator('article[data-page="page-1"]');
  await expect(card.getByRole('link', { name: 'Initial page' })).toHaveAttribute(
    'href',
    '/pages/page-1',
  );
  await page.getByRole('button', { name: 'Change source' }).click();
  await expect(card.getByRole('link', { name: 'Updated page' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove access' }).click();
  await expect(card).toContainText('Page not found');
  await expect(card).toContainText('Keep this work');
  await expect(card.getByRole('button', { name: '#12' })).toBeVisible();
  await expect(card.getByRole('link')).toHaveCount(0);
});

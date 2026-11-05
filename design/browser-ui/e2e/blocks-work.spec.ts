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

test('a stale source read cannot replace a newer page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountRacingWorkBundle();
  });
  await expect(page.getByRole('status')).toHaveText('Loading page…');
  await page.getByRole('button', { name: 'Change page' }).click();
  await page.getByRole('button', { name: 'Resolve first' }).click();
  await expect(page.getByRole('status')).toHaveText('Loading page…');
  await page.getByRole('button', { name: 'Resolve second' }).click();
  await expect(page.getByRole('link', { name: 'Current second' })).toHaveAttribute(
    'href',
    '/second',
  );
  await expect(page.getByText('Stale first')).toHaveCount(0);
});

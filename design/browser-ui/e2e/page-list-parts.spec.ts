import { expect, test } from '@playwright/test';

test('read-only selection is disabled and bulk actions reject synthetic clicks', async ({
  page,
}) => {
  await page.goto('/?frame=page-list');
  await expect(page.getByRole('checkbox', { name: 'Select Read-only page' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Select Theme B review' }).click();
  const archive = page.getByRole('button', { name: 'Archive', exact: true });
  await archive.evaluate((element: HTMLElement) => element.click());
  await expect(page.locator('[data-action]')).toHaveAttribute('data-action', '');
  await archive.click();
  await expect(page.locator('[data-action]')).toHaveAttribute('data-action', 'archive');
});

test('row menu actions reject a synthetic click and accept a trusted keyboard choice', async ({
  page,
}) => {
  await page.goto('/?frame=page-list');
  await page.getByRole('button', { name: 'More for Theme B review' }).click();
  await expect(page.getByRole('menuitem').allTextContents()).resolves.toEqual([
    'Open in new tab',
    'Pin',
    'Manage…',
    'Projects…',
    'Archive',
    'Delete',
  ]);
  const item = page.getByRole('menuitem', { name: 'Manage…', exact: true });
  await item.evaluate((element: HTMLElement) => element.click());
  await expect(page.locator('[data-action]')).toHaveAttribute('data-action', '');
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-action]')).toHaveAttribute('data-action', 'manage');
});

test('the project picker ignores synthetic selection and accepts a real choice', async ({
  page,
}) => {
  await page.goto('/?frame=page-list');
  await page.getByRole('checkbox', { name: 'Select Theme B review' }).check();
  await page.getByRole('button', { name: 'Projects…' }).click();
  const project = page.getByRole('menuitemcheckbox', { name: 'design' });
  await project.evaluate((element: HTMLElement) => element.click());
  await expect(page.locator('[data-action]')).toHaveAttribute('data-action', '');
  await project.click();
  await expect(page.locator('[data-action]')).toHaveAttribute('data-action', 'project:design');
});

test('read-only row keeps Open available and explains disabled Pin', async ({ page }) => {
  await page.goto('/?frame=page-list');
  await page.getByRole('button', { name: 'More for Read-only page' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Pin — Read-only access' })).toBeDisabled();
});

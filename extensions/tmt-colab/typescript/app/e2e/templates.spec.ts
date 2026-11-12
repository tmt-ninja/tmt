/** Colab user templates in the browser (#5076, #5077): the Templates page, the settings tab, the
 * template page's own chrome and Save as template. The owner is a fixture; serve tests prove it. */
import { expect, test, type Page } from '@playwright/test';
import { pageAction } from '../test/page-actions.js';

async function list(page: Page, hash: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.evaluate(async (hash) => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('few', hash);
  }, hash);
}
const app = (page: Page) => page.locator('#list-fixture');

test('the Templates page lists the default first, filters by source and starts a page (#5077)', async ({
  page,
}) => {
  await list(page, '/templates');
  const cards = app(page).locator('.templates-grid article');
  await expect(cards).toHaveCount(8);
  await expect(cards.first()).toHaveAccessibleName('starter');
  await expect(cards.first()).toContainText('Default');
  await expect(cards.nth(6)).toHaveAccessibleName('design-proposal');
  await expect(cards.nth(7)).toContainText('by ben');
  // The menu's Templates row counts them once they are read.
  await expect(page.getByRole('link', { name: /Templates/ }).first()).toContainText('8');
  await app(page).getByRole('radio', { name: /^TMT/ }).click();
  await expect(cards).toHaveCount(6);
  await app(page)
    .getByRole('radio', { name: /^This space/ })
    .click();
  await expect(cards).toHaveCount(2);
  // Use opens New page with that template chosen; Escape returns to Use.
  const use = app(page).getByRole('button', { name: 'Use weekly-review' });
  await use.click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await expect(dialog.getByRole('listbox').getByRole('option', { selected: true })).toContainText(
    'weekly-review',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(use).toBeFocused();
  // Open goes to the template's page.
  await app(page).getByRole('button', { name: 'Open weekly-review' }).click();
  await expect
    .poll(() => new URL(page.url()).hash)
    .toContain('/pages/d0000002-1111-4111-8111-000000000001');
});

test('Colab settings › Templates sets the default and confirms it (#5077)', async ({ page }) => {
  await list(page, '/settings');
  await app(page).getByRole('tab', { name: 'Templates' }).click();
  const starter = app(page).getByRole('radio', { name: 'Default: starter' });
  await expect(starter).toBeChecked();
  await expect(app(page).getByRole('row')).toHaveCount(9);
  await app(page).getByRole('radio', { name: 'Default: weekly-review' }).click();
  await expect(app(page).locator('.template-toast')).toContainText(
    'Default template: weekly-review',
  );
  await expect(app(page).getByRole('radio', { name: 'Default: weekly-review' })).toBeChecked();
  await starter.click();
  await expect(starter).toBeChecked();
  // The page sends the template's page for a template of this space, and nothing for starter.
  expect(await page.evaluate(() => window.__templateDefaults)).toEqual([
    'd0000002-1111-4111-8111-000000000001',
    null,
  ]);
});

const metadata = '/test/metadata-browser.html?owner=templates';
async function command(page: Page, method: string) {
  return page.evaluate(async (method) => {
    const path = '/test/metadata-browser.tsx';
    return (await import(path))[method]();
  }, method);
}

test('Save as template names the page, refuses a taken name with a suggestion, and the page becomes a template (#5077)', async ({
  page,
}) => {
  await page.goto(metadata);
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Metadata page' }),
  ).toBeVisible();
  await (await pageAction(page, 'Save as template…')).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('metadata-page');
  await expect(dialog).toContainText('No rule comments found.');
  // A name another page carries is said early, with a free one to take.
  await name.fill('weekly-review');
  await expect(dialog).toContainText('Another page already has this name.');
  await expect(
    dialog.getByRole('button', { name: 'Save as template', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Try weekly-review-2' }).click();
  await expect(name).toHaveValue('weekly-review-2');
  await expect(name).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Description' }).fill('A metadata page');
  await dialog.getByRole('button', { name: 'Save as template', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Saved as template' })).toContainText(
    'Saved as template weekly-review-2',
  );
  const { commands } = (await command(page, 'proof')) as {
    commands: { action: string; body: unknown }[];
  };
  expect(commands.at(-1)).toMatchObject({
    action: 'template.set',
    body: { name: 'weekly-review-2', description: 'A metadata page' },
  });
  // A template shows its chip and Use template; its menu edits or removes it.
  await expect(page.locator('.template-badge[data-kind="template"]')).toHaveText('Template');
  await page.getByRole('button', { name: 'Use template' }).click();
  const create = page.getByRole('dialog', { name: 'New page' });
  await expect(create.getByRole('listbox').getByRole('option', { selected: true })).toContainText(
    'weekly-review-2',
  );
  await page.keyboard.press('Escape');
  await (await pageAction(page, 'Remove template')).click();
  const remove = page.getByRole('dialog', { name: 'Remove template' });
  await expect(remove).toContainText('The page stays as a page');
  await remove.getByRole('button', { name: 'Remove template', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await expect(page.locator('.template-badge[data-kind="template"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use template' })).toHaveCount(0);
});

test('Template settings edits a saved template and Escape closes it (#5077)', async ({ page }) => {
  await page.goto(metadata);
  await expect(
    page.frameLocator('iframe').getByRole('heading', { name: 'Metadata page' }),
  ).toBeVisible();
  await (await pageAction(page, 'Save as template…')).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await name.fill('weekly-review-3');
  await dialog.getByRole('button', { name: 'Save as template', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await (await pageAction(page, 'Template settings…')).click();
  const settings = page.getByRole('dialog', { name: 'Template settings' });
  await expect(settings.getByRole('textbox', { name: 'Name' })).toHaveValue('weekly-review-3');
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

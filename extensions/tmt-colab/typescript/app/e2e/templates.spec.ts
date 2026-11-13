/** Colab user templates in the browser (#5076, #5077): the Templates page, the settings tab, the
 * template page's own chrome and Save as template. The owner is a fixture; serve tests prove it. */
import { expect, test, type Locator, type Page } from '@playwright/test';
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
  // A phone bar keeps only the title (#6359): the chip yields instead of running under Theme.
  const wide = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.template-badge[data-kind="template"]')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Use template' })).toBeVisible();
  // Use template turns into its mark alone, so the title keeps a readable width.
  const width = (locator: Locator) => async () => (await locator.boundingBox())?.width ?? 0;
  await expect.poll(width(page.getByRole('button', { name: 'Use template' }))).toBeLessThan(48);
  await expect.poll(width(page.locator('.tmt-ui-topbar-title-current'))).toBeGreaterThan(64);
  await page.setViewportSize(wide);
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

test('a template shows its rules above their blocks to its owner only, and drops them when it stops being one (#6333)', async ({
  page,
}) => {
  await page.goto(`${metadata}&rules`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Metadata page' })).toBeVisible();
  // One tag per comment that directly precedes a top-level block, numbered as `template show`
  // numbers the rules: the nested rule (3) and the one before nothing (5) count but draw nothing.
  const tags = frame.locator('[data-colab-rule]');
  await expect(tags).toHaveText([
    'rule 1 · layout: column',
    'rule 2 · one row per merged item',
    'rule 4 · next week',
  ]);
  const placed = await tags.evaluateAll((nodes) =>
    nodes.map((node) => ({
      hidden: node.getAttribute('aria-hidden'),
      next: node.nextElementSibling?.textContent,
      gap:
        node.nextElementSibling!.getBoundingClientRect().top - node.getBoundingClientRect().bottom,
    })),
  );
  expect(placed.map(({ hidden, next }) => [hidden, next])).toEqual([
    ['true', 'Metadata page'],
    ['true', 'Shipped work.'],
    ['true', 'Next week.'],
  ]);
  // The tag sits just over its block, the loose gap above the tag rather than between them.
  for (const { gap } of placed) expect(Math.round(gap)).toBe(6);
  await expect(tags.first().locator('span')).toHaveCSS('font-size', '11px');
  // A tag takes the scheme the page paints: this page paints nothing (white) under a dark viewer.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(tags.first().locator('span')).toHaveCSS('background-color', 'rgb(234, 242, 236)');

  // A tag is the frame's: selecting or copying the page leaves it out.
  const selected = await page
    .frameLocator('iframe')
    .locator('body')
    .evaluate(() => {
      getSelection()!.selectAllChildren(document.body);
      const text = getSelection()!.toString();
      getSelection()!.removeAllRanges();
      return text;
    });
  expect(selected).toContain('Shipped work.');
  expect(selected).not.toContain('rule 1');

  // The Source, and the source a save writes (what a read, page check or export sees), hold none;
  // an in-place update redraws or removes them, and so does a remount.
  await (await pageAction(page, 'Source')).click();
  const editor = page.locator('#source-edit:visible');
  await expect(editor).not.toHaveValue(/rule 1 ·/);
  const save = async (source: string) => {
    await editor.fill(source);
    await page.getByRole('button', { name: 'Save source', exact: true }).click();
    await expect.poll(() => command(page, 'storedSource')).toBe(source);
  };
  const shown = await page.locator('iframe').elementHandle();
  await save('<!-- rule: the week in one line -->\n<h1>Metadata page</h1>\n<p>Shipped work.</p>');
  await expect(tags).toHaveText(['rule 1 · the week in one line']);
  await save('<h1>Metadata page</h1>\n<p>Shipped work.</p>');
  await expect(tags).toHaveCount(0);
  expect(await shown!.evaluate((node) => node.isConnected)).toBe(true);
  await save(
    '<!-- rule: after a remount -->\n<h1>Metadata page</h1>\n<p>Shipped work.</p><script>document.body.dataset.ran = ""</script>',
  );
  await expect.poll(() => shown!.evaluate((node) => node.isConnected)).toBe(false);
  await expect(tags).toHaveText(['rule 1 · after a remount']);
  expect(String(await command(page, 'storedSource'))).not.toContain('data-colab-rule');
  await page.keyboard.press('Escape');

  // Removing the template takes the tags away without a reload.
  await (await pageAction(page, 'Remove template')).click();
  const remove = page.getByRole('dialog', { name: 'Remove template' });
  await remove.getByRole('button', { name: 'Remove template', exact: true }).click();
  await expect(page.locator('.template-badge[data-kind="template"]')).toHaveCount(0);
  await expect(tags).toHaveCount(0);
});

test('a reader of a template, editor or viewer, sees no rules (#6333)', async ({ page }) => {
  const fixture = '/test/reader-metadata-browser.tsx';
  await page.goto('/');
  for (const role of ['editor', 'viewer'] as const) {
    await page.evaluate(
      async ({ fixture, role }) => {
        const module = await import(fixture);
        await module.mount(role);
        module.template();
      },
      { fixture, role },
    );
    const frame = page.frameLocator('#reader-metadata-fixture iframe');
    await expect(frame.locator('html[data-colab-layout="column"]')).toHaveCount(1);
    await expect(frame.getByText('Shipped work.')).toBeVisible();
    await expect(frame.locator('html[data-colab-prepared]')).toHaveCount(1);
    await expect(frame.locator('[data-colab-rule]')).toHaveCount(0);
  }
});

test('a template shows no rules to someone who may not edit it (#6333)', async ({ page }) => {
  await page.goto(`${metadata}&rules&role=editor`);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Metadata page' })).toBeVisible();
  await expect(page.locator('.template-badge[data-kind="template"]')).toHaveText('Template');
  await expect(frame.locator('html[data-colab-prepared]')).toHaveCount(1);
  await expect(frame.locator('[data-colab-rule]')).toHaveCount(0);
});

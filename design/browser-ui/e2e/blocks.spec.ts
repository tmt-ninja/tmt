import { expect, test, type Page } from '@playwright/test';

// #5981 part A: the structured-page blocks, in the gallery's blocks frame (gallery/blocks-*.tsx).
const open = async (page: Page, query: string, width = 1440, theme = 'light') => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?frame=blocks&theme=${theme}&${query}`);
  await page.locator('.tmt-block-doc').first().waitFor();
};
const style = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
const transparent = 'rgba(0, 0, 0, 0)';

for (const theme of ['light', 'dark'])
  test(`a resting block draws no border, fill or shadow; hover and selection are tints only (${theme})`, async ({
    page,
  }) => {
    await open(page, 'part=editor', 1440, theme);
    const block = page.locator('[data-block-id="b-2"]');
    for (const name of ['background-color', 'box-shadow', 'outline-style'])
      expect(
        await block.evaluate((element, n) => getComputedStyle(element).getPropertyValue(n), name),
      ).toMatch(name === 'background-color' ? transparent : /^(none|rgba\(0, 0, 0, 0\))$/);
    expect(await block.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe(
      'none',
    );
    await expect(page.locator('.tmt-block-handle')).toHaveCount(0);
    await block.hover();
    await expect(page.locator('.tmt-block-handle')).toHaveCount(1);
    const hover = await block.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(hover).not.toBe(transparent);
    // The handle sits in the gutter, left of the block, never on it.
    const handle = (await page.locator('.tmt-block-handle').boundingBox())!;
    const box = (await block.boundingBox())!;
    expect(handle.x + handle.width).toBeLessThanOrEqual(box.x - 7.5);
    await page.mouse.move(0, 0);
    await block.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(block).toHaveAttribute('aria-selected', 'true');
    const selected = await block.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(selected).not.toBe(transparent);
    expect(selected).not.toBe(hover);
    expect(await block.evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe(
      'none',
    );
  });

test('one shared handle follows the pointer, and the focus ring shows only for the keyboard', async ({
  page,
}) => {
  await open(page, 'part=editor');
  await page.locator('[data-block-id="b-3"]').hover();
  await page.locator('[data-block-id="b-5"]').hover();
  await expect(page.locator('.tmt-block-handle')).toHaveCount(1);
  await expect(page.locator('[data-block-id="b-5"] .tmt-block-handle')).toHaveCount(1);
  await page.locator('[data-block-id="b-1"]').click();
  expect(await style(page, '[data-block-id="b-1"]', 'outline-style')).toBe('none');
  await page.keyboard.press('ArrowDown');
  expect(await style(page, '[data-block-id="b-2"]', 'outline-style')).toBe('solid');
});

test('the menu key, Shift+F10 and Cmd/Ctrl+/ open the block menu; Esc returns focus', async ({
  page,
}) => {
  await open(page, 'part=editor');
  const block = page.locator('[data-block-id="b-2"]');
  for (const key of ['ContextMenu', 'Shift+F10', 'ControlOrMeta+/']) {
    await block.focus();
    await page.keyboard.press(key);
    const menu = page.getByRole('menu', { name: 'Block actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Move to…',
      /^Move up/,
      /^Move down/,
      /^Duplicate/,
      'Copy link to block',
      '@ this block in a comment',
      /^Delete/,
    ]);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(block).toBeFocused();
  }
});

test('delete takes the block away, and Undo or Cmd/Ctrl+Z brings it back in place', async ({
  page,
}) => {
  await open(page, 'part=editor');
  const ids = () =>
    page
      .locator('[data-block-id]')
      .evaluateAll((all) => all.map((element) => element.getAttribute('data-block-id')));
  const before = await ids();
  await page.locator('[data-block-id="b-6"]').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('status')).toHaveText(/Deleted 1 block \(Table\)/);
  expect(await ids()).not.toContain('b-6');
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await ids()).toEqual(before);
  await page.locator('[data-block-id="b-6"]').focus();
  await page.keyboard.press('Delete');
  await page.locator('[data-block-id="b-7"]').focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await ids()).toEqual(before);
});

test('keyboard selection extends with Shift+arrows and Alt+Shift+arrows move the selection', async ({
  page,
}) => {
  await open(page, 'part=editor');
  await page.locator('[data-block-id="b-3"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('[aria-selected="true"][data-block-id]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('[aria-selected="true"][data-block-id]')).toHaveCount(0);
  await page.locator('[data-block-id="b-5"]').focus();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  const order = await page
    .locator('[data-block-id]')
    .evaluateAll((all) => all.map((element) => element.getAttribute('data-block-id')));
  expect(order.indexOf('b-5')).toBe(order.indexOf('b-4') - 1);
});

test('the insert menu filters, moves with arrows, inserts on Enter and shows no match', async ({
  page,
}) => {
  await open(page, 'part=editor');
  await page.locator('[data-block-id="b-2"]').hover();
  await page.getByRole('button', { name: 'Insert block' }).click();
  const menu = page.getByRole('listbox', { name: 'Insert block' });
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toHaveText(/^Paragraph/);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toHaveText(/^Heading/);
  await page.keyboard.type('zz');
  await expect(menu.getByText(/No block matches/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('dragging by the grip shows the drop line and moves the block', async ({ page }) => {
  await open(page, 'part=editor');
  await page.locator('[data-block-id="b-3"]').hover();
  const grip = (await page.getByRole('button', { name: 'Block actions' }).boundingBox())!;
  const target = (await page.locator('[data-block-id="b-6"]').boundingBox())!;
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 20, target.y + target.height - 4, { steps: 8 });
  await expect(page.locator('.tmt-block-drop')).toHaveCount(1);
  await expect(page.locator('.tmt-block-ghost')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.tmt-block-drop')).toHaveCount(0);
  await expect(page.getByRole('menu')).toHaveCount(0);
  const order = await page
    .locator('[data-block-id]')
    .evaluateAll((all) => all.map((element) => element.getAttribute('data-block-id')));
  expect(order.indexOf('b-3')).toBe(order.indexOf('b-6') + 1);
});

test('the table hides its narrow columns on its own width, not the viewport', async ({ page }) => {
  await open(page, 'part=table', 1440);
  await expect(page.locator('th', { hasText: 'Note' })).toBeVisible();
  await page
    .locator('.tmt-block-table')
    .evaluate((element) => ((element as HTMLElement).style.width = '400px'));
  await expect(page.locator('th', { hasText: 'Note' })).toBeHidden();
  await expect(page.locator('th', { hasText: 'Note' })).toHaveCount(1);
  await open(page, 'part=table', 390);
  await expect(page.locator('th', { hasText: 'Note' })).toBeHidden();
});

test('only the card draws a frame among the content blocks', async ({ page }) => {
  for (const part of ['heading', 'text', 'list-item', 'todo', 'code', 'mention']) {
    await open(page, `part=${part}`);
    const framed = await page.locator('.tmt-block-doc [data-slot]').evaluateAll((all) =>
      all
        .filter((element) => !['code-block', 'checkbox'].includes(element.getAttribute('data-slot')!))
        .filter((element) => getComputedStyle(element).borderTopStyle !== 'none')
        .map((element) => element.getAttribute('data-slot')),
    );
    expect(framed, part).toEqual([]);
  }
  await open(page, 'part=card');
  expect(await style(page, '.tmt-block-card[data-variant="card"]', 'border-top-style')).toBe(
    'solid',
  );
  expect(await style(page, '.tmt-block-card[data-variant="card"]', 'box-shadow')).toBe('none');
  expect(await style(page, '.tmt-block-card[data-variant="section"]', 'border-top-style')).toBe(
    'none',
  );
});

test('every part frame fits 390 without a horizontal page scroll', async ({ page }) => {
  for (const part of [
    'block',
    'menu',
    'heading',
    'text',
    'list-item',
    'todo',
    'table',
    'card',
    'callout',
    'code',
    'mention',
    'toast',
  ]) {
    await open(page, `part=${part}`, 390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      part,
    ).toBeLessThanOrEqual(390);
  }
});

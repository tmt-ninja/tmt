import { expect, test, type Page } from '@playwright/test';

// #5821 A6: the dense data table, in the gallery's data-table frame (gallery/page-table.tsx data).
const open = async (page: Page, width: number, query = '') => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?frame=data-table&${query}`);
  await page.locator('[data-table-row]').first().waitFor();
};
const rows = (page: Page) => page.locator('[data-table-row]');
const centreY = (box: { y: number; height: number }) => box.y + box.height / 2;

test('at 1440 hover actions stay inside the actions column and never touch another cell', async ({
  page,
}) => {
  await open(page, 1440);
  const count = await rows(page).count();
  for (let index = 0; index < count; index++) {
    const row = rows(page).nth(index);
    await row.hover();
    const faults = await row.evaluate((element) => {
      const actions = element.querySelector('[data-role="actions"]')!.getBoundingClientRect();
      const buttons = [...element.querySelectorAll('[data-role="actions"] button')].map((button) =>
        button.getBoundingClientRect(),
      );
      const cells = [
        ...element.querySelectorAll('[role="gridcell"]:not([data-role="actions"])'),
      ].map((cell) => cell.getBoundingClientRect());
      const out: string[] = [];
      for (const button of buttons) {
        if (button.left < actions.left - 0.5 || button.right > actions.right + 0.5)
          out.push(`button ${button.left}-${button.right} leaves ${actions.left}-${actions.right}`);
        for (const cell of cells)
          if (button.left < cell.right - 0.5 && button.right > cell.left + 0.5)
            out.push(
              `button ${button.left}-${button.right} covers cell ${cell.left}-${cell.right}`,
            );
      }
      return { out, visible: buttons.length };
    });
    expect(faults.visible).toBe(4);
    expect(faults.out).toEqual([]);
  }
  await rows(page).nth(1).hover();
  await expect(page.getByRole('button', { name: /^Archive / }).nth(1)).toBeVisible();
});

test('the hover check catches actions laid over another column', async ({ page }) => {
  await open(page, 1440);
  // Colab today: Open, Pin and Archive float over the Access column.
  await page.addStyleTag({
    content: '.tmt-data-table-actions { position: relative; right: 120px; }',
  });
  const row = rows(page).nth(1);
  await row.hover();
  const covered = await row.evaluate((element) => {
    const button = element.querySelector('[data-role="actions"] button')!.getBoundingClientRect();
    const access = element.querySelector('[data-role="access"]')!.getBoundingClientRect();
    return button.left < access.right && button.right > access.left;
  });
  expect(covered).toBe(true);
});

test('the row menu sits at the same height with and without a sub-line', async ({ page }) => {
  await open(page, 1440);
  // Neither is the first row, which has no rule above it.
  const withSub = rows(page).filter({ hasText: 'sub-pages done' }).nth(1);
  const without = rows(page).filter({ hasNotText: 'sub-pages done' }).nth(1);
  const menu = (row: typeof withSub) => row.getByRole('button', { name: /^More for / });
  const title = (row: typeof withSub) => row.locator('.tmt-data-table-line');
  for (const row of [withSub, without]) {
    const [menuBox, titleBox] = [
      (await menu(row).boundingBox())!,
      (await title(row).boundingBox())!,
    ];
    expect(Math.abs(centreY(menuBox) - centreY(titleBox))).toBeLessThan(1);
  }
  const offset = async (row: typeof withSub) =>
    centreY((await menu(row).boundingBox())!) - (await row.boundingBox())!.y;
  expect(Math.abs((await offset(withSub)) - (await offset(without)))).toBeLessThan(1);
  // Every first-line cell of the row shares the menu's centre.
  const stage = (await withSub.locator('[data-role="status"]').boundingBox())!;
  expect(Math.abs(centreY(stage) - centreY((await menu(withSub).boundingBox())!))).toBeLessThan(1);
});

test('a cut title shows its full text on hover, and +N lists every chip', async ({ page }) => {
  await open(page, 1440);
  const long = page.locator('.tmt-data-table-line .tmt-data-table-text', {
    hasText: 'Release plan for the 0.9 line',
  });
  const full = await long.textContent();
  expect(await long.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await long.hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(full!);
  await page.getByRole('button', { name: '2 more: ops, remote-launch' }).click();
  const list = page.locator('.tmt-data-table-chip-list');
  for (const name of ['release-0.9', 'ops', 'remote-launch'])
    await expect(list).toContainText(name);
});

test('the sticky header sorts, and the bulk bar replaces it while rows are selected', async ({
  page,
}) => {
  await open(page, 1440, 'rows=40');
  const updated = page.getByRole('columnheader', { name: /Updated/ });
  await expect(updated).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Title' }).click();
  await expect(page.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(updated).toHaveAttribute('aria-sort', 'none');
  await page.evaluate(() => scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(800);
  const head = (await page.locator('.tmt-data-table-head').boundingBox())!;
  expect(Math.abs(head.y)).toBeLessThan(1);
  await rows(page).nth(2).getByRole('checkbox').click();
  await expect(page.getByRole('toolbar', { name: 'Selected rows' })).toContainText('1 selected');
  await expect(page.getByRole('columnheader', { name: /Title/ })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select all rows' }).click();
  await expect(page.getByRole('toolbar', { name: 'Selected rows' })).toContainText('40 selected');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('columnheader', { name: /Title/ })).toBeVisible();
});

test('rows take the keyboard: arrows move, Space selects, Enter opens, the menu key opens the menu', async ({
  page,
}) => {
  await open(page, 1440);
  await rows(page).first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const third = rows(page).nth(2);
  await expect(third).toBeFocused();
  await page.keyboard.press('Space');
  await expect(third).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  const id = await page.evaluate(() => document.body.dataset.opened);
  expect(id).toMatch(/^page-/);
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0);
  await expect(third.getByRole('button', { name: /^More for / })).toBeFocused();
});

test('loading, empty and error rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?frame=data-table&state=loading');
  await expect(page.locator('[data-loading]')).toHaveCount(6);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(1);
  await page.goto('/?frame=data-table&state=empty');
  await expect(page.locator('[data-span="empty"]')).toContainText('No pages match');
  await page.goto('/?frame=data-table&state=error');
  await expect(page.locator('[data-span="error"]')).toContainText('Could not load pages');
});

test('comfortable density takes the taller row token', async ({ page }) => {
  await open(page, 1440, 'density=comfortable');
  const line = (await rows(page).nth(1).locator('.tmt-data-table-line').boundingBox())!;
  expect(line.height).toBe(48);
  await open(page, 1440);
  expect((await rows(page).nth(1).locator('.tmt-data-table-line').boundingBox())!.height).toBe(36);
});

test('at 390 rows are two-line cards with no page scroll, and hidden columns move to the menu', async ({
  page,
}) => {
  await open(page, 390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const row = rows(page).nth(1);
  const [title, menu, stage] = await Promise.all(
    [
      row.locator('.tmt-data-table-line'),
      row.getByRole('button', { name: /^More for / }),
      row.locator('[data-role="status"]'),
    ].map(async (locator) => (await locator.boundingBox())!),
  );
  expect(Math.abs(centreY(title!) - centreY(menu!))).toBeLessThan(1);
  expect(stage!.y).toBeGreaterThan(title!.y + title!.height - 1);
  // A card with a sub-line keeps its menu on the title line too.
  const withSub = rows(page).filter({ hasText: 'sub-pages done' }).nth(1);
  const [subTitle, subMenu] = [
    (await withSub.locator('.tmt-data-table-line').boundingBox())!,
    (await withSub.getByRole('button', { name: /^More for / }).boundingBox())!,
  ];
  expect(Math.abs(centreY(subTitle) - centreY(subMenu))).toBeLessThan(1);
  const time = (await row.locator('[data-role="time"]').boundingBox())!;
  expect(Math.abs(centreY(time) - centreY(stage!))).toBeLessThan(2);
  await expect(row.locator('[data-role="person"]')).toBeHidden();
  await expect(row.locator('.tmt-data-table-actions')).toBeHidden();
  await row.getByRole('button', { name: /^More for / }).click();
  await expect(page.getByRole('menu')).toContainText('Author: sample-1');
  await expect(page.getByRole('menuitem', { name: /^Archive / })).toBeVisible();
});

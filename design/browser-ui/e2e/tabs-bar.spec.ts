import { expect, test } from '@playwright/test';

test('at 1440 the tabs and the labelled actions share one row, space-l apart', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/?frame=tabs-bar');
  const tabs = (await page.locator('[data-slot="tabs-bar-scroller"]').boundingBox())!;
  const save = page.getByRole('button', { name: 'Save as shortcut' });
  const create = page.getByRole('button', { name: 'New page' });
  const [saveBox, createBox] = [(await save.boundingBox())!, (await create.boundingBox())!];
  await expect(save.getByText('Save as shortcut')).toBeVisible();
  expect(Math.abs(saveBox.y + saveBox.height / 2 - (tabs.y + tabs.height / 2))).toBeLessThan(2);
  expect(saveBox.x - (tabs.x + tabs.width)).toBeGreaterThanOrEqual(16);
  expect(saveBox.height).toBe(36);
  expect(createBox.height).toBe(36);
  await expect(page.locator('[data-slot="tabs-bar-scroller"]')).not.toHaveAttribute(
    'data-fade-end',
    'true',
  );
});

test('at 390 the actions are equal squares named by their labels, and the tabs scroll with a fade', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/?frame=tabs-bar');
  for (const name of ['Save as shortcut', 'New page']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!;
    expect([box.width, box.height]).toEqual([36, 36]);
  }
  const scroller = page.locator('[data-slot="tabs-bar-scroller"]');
  await expect(scroller).toHaveAttribute('data-fade-end', 'true');
  // Selecting the last tab by keyboard keeps it in view.
  await page.getByRole('tab', { name: /^All/ }).focus();
  await page.keyboard.press('End');
  const archived = page.getByRole('tab', { name: /^Archived/ });
  await expect(archived).toHaveAttribute('data-state', 'active');
  const [tab, view] = [(await archived.boundingBox())!, (await scroller.boundingBox())!];
  expect(tab.x).toBeGreaterThanOrEqual(view.x - 0.5);
  expect(tab.x + tab.width).toBeLessThanOrEqual(view.x + view.width + 0.5);
  await expect(scroller).toHaveAttribute('data-fade-start', 'true');
});

test('a chip keeps its own size inside a host that sizes its controls', async ({ page }) => {
  await page.goto('/?frame=tabs-bar');
  const host = page.getByTestId('sized-host');
  const chip = host.locator('[data-slot="chip"]');
  const remove = host.getByRole('button', { name: 'Remove project:design' });
  expect((await chip.boundingBox())!.height).toBe(22);
  const box = (await remove.boundingBox())!;
  expect([box.width, box.height]).toEqual([18, 18]);
  await expect(chip).toHaveCSS('border-top-width', '0px');
});

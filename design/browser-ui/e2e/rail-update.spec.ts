import { expect, test } from '@playwright/test';

// #5911: a page switch moves the highlight and updates the counts on the same rail rows. Rows are
// not rebuilt, so nothing jumps, hover and focus stay, and a click never pops a row's tip.
for (const renderer of ['native', 'react'])
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390])
      test(`rail ${renderer} ${theme} ${width}: a page switch keeps every row and pops no tip`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/?frame=rail&renderer=${renderer}&theme=${theme}`);
        const capture = async (state: string) =>
          testInfo.attach(`rail-switch-${renderer}-${theme}-${width}-${state}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        const rail = page.locator('nav.tmt-ui-rail');
        if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
        await expect(rail.locator('[aria-current="page"]')).toHaveAttribute('data-id', 'all');
        // Mark every row and remember where it is.
        const rows = () =>
          rail.locator('a[data-id]').evaluateAll((nodes) =>
            nodes.map((node) => {
              const box = node.getBoundingClientRect();
              return {
                id: (node as HTMLElement).dataset.id,
                marked: (node as HTMLElement & { kept?: boolean }).kept === true,
                box: [box.x, box.y, box.width, box.height].map(Math.round),
              };
            }),
          );
        await rail.locator('a[data-id]').evaluateAll((nodes) => {
          for (const node of nodes) (node as HTMLElement & { kept?: boolean }).kept = true;
        });
        const before = await rows();
        await capture('before');
        const target = rail.locator('[data-id="project"]');
        await target.hover();
        await target.click();
        if (width === 390) await page.getByRole('button', { name: 'Open navigation' }).click();
        await expect(rail.locator('[aria-current="page"]')).toHaveAttribute('data-id', 'project');
        const after = await rows();
        expect(after.map(({ id, box }) => ({ id, box }))).toEqual(
          before.map(({ id, box }) => ({ id, box })),
        );
        expect(after.every((row) => row.marked)).toBe(true);
        // The pressed row's tip does not open on the click or after the update.
        await page.waitForTimeout(150);
        await expect(page.locator('.tmt-ui-rail-tip:popover-open')).toHaveCount(0);
        await capture('after');
        // A host refresh that changes nothing structural keeps the rows too.
        if (width === 390) await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Refresh command bindings' }).click();
        expect((await rows()).every((row) => row.marked)).toBe(true);
      });

test('a row with a count still shows its tip on hover and on keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?frame=rail&renderer=native&theme=light');
  const rail = page.locator('nav.tmt-ui-rail');
  const tip = page.locator('.tmt-ui-rail-tip');
  await rail.locator('[data-id="all"]').hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('All pages');
  await page.mouse.move(1200, 900);
  await expect(tip).toBeHidden();
  await rail.locator('[data-id="all"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(rail.locator('[data-id="all"]')).toBeFocused();
  await expect(tip).toBeVisible();
});

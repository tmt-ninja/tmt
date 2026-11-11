import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`page view controls change filters and columns at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.evaluate(async () => {
      const fixture = '/blocks-harness.tsx';
      (await import(fixture)).mountPageViewToolbar();
    });
    const toolbar = page.getByRole('toolbar', { name: 'Spec pages page view' });
    await toolbar.getByRole('button', { name: 'Remove Project: gui filter' }).click();
    await expect(toolbar.getByText('Project: gui')).toHaveCount(0);
    const group = toolbar.getByRole('combobox', { name: 'Group by' });
    await group.click();
    await page.getByRole('option', { name: 'Project' }).click();
    await expect(group).toHaveText('Project');
    await toolbar.getByRole('button', { name: 'Columns 3/3' }).click();
    if (width === 390) {
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name: 'Visible columns' })).toBeVisible();
      await sheet.getByRole('checkbox', { name: 'Updated' }).click();
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('menuitemcheckbox', { name: 'Updated' }).click();
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('[data-columns]')).toHaveText('title,state');
    await expect(toolbar.getByRole('button', { name: 'Columns 2/3' })).toBeFocused();
  });
}

// Group by is the design system's Select, not the browser's own control: it matches the Columns
// button's frame in both themes and is chosen by keyboard (#6191).
for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`Group by is the DS select, framed like Columns, in ${theme} at ${width} (#6191)`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.evaluate(async () => {
        const fixture = '/blocks-harness.tsx';
        (await import(fixture)).mountPageViewToolbar();
      });
      const toolbar = page.getByRole('toolbar', { name: 'Spec pages page view' });
      await expect(toolbar.locator('select')).toHaveCount(0);
      const group = toolbar.getByRole('combobox', { name: 'Group by' });
      await expect(group).toHaveText('State');
      const columns = toolbar.getByRole('button', { name: 'Columns 3/3' });
      const frame = (locator: typeof group) =>
        locator.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            height: node.getBoundingClientRect().height,
            border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
            radius: style.borderTopLeftRadius,
            background: style.backgroundColor,
            color: style.color,
            font: `${style.fontSize} ${style.fontFamily}`,
          };
        });
      expect(await frame(group)).toEqual(await frame(columns));
      // On a wide toolbar it sits on the Columns button's row, centred on it (a phone wraps).
      if (width === 1440) {
        const [a, b] = [await group.boundingBox(), await columns.boundingBox()];
        expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThanOrEqual(1);
      }

      await group.focus();
      await page.keyboard.press('Enter');
      const list = page.getByRole('listbox');
      await expect(list).toBeVisible();
      const state = list.getByRole('option', { name: 'State' });
      await expect(state).toHaveAttribute('aria-selected', 'true');
      await expect(state).toBeFocused();
      for (const name of ['Project', 'Owner']) {
        await page.keyboard.press('ArrowDown');
        await expect(list.getByRole('option', { name })).toBeFocused();
      }
      await page.keyboard.press('Enter');
      await expect(list).toHaveCount(0);
      await expect(group).toHaveText('Owner');
      await expect(group).toBeFocused();
    });
  }
}

import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const fixture = `/@fs${fileURLToPath(new URL('../test/fixtures/scope-modal.html', import.meta.url))}`;

for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`scoped menu remains local at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto(fixture);
      const scope = page.locator('[data-tmt-ds-scope]').first();
      await scope.evaluate((node, size) => {
        (node as HTMLElement).style.width = `${size}px`;
      }, width - 32);
      await scope.getByRole('button', { name: 'Scoped menu' }).click();
      const menu = scope.locator('dialog.tmt-ui-menu-surface');
      await expect(menu).toBeVisible();
      expect(await menu.evaluate((node) => node.matches(':modal'))).toBe(false);
      await page.getByRole('button', { name: 'Outside 0' }).click();
      await expect(menu).toBeVisible();
      const dir = process.env.SCOPE_CAPTURE_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        await scope.screenshot({
          path: join(dir, `scope-menu-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
      const shellScope = page.locator('[data-tmt-ds-scope]').nth(2);
      await shellScope.evaluate((node, size) => {
        (node as HTMLElement).style.width = `${size}px`;
      }, width - 32);
      await expect(shellScope.locator('.tmt-ui-shell')).toHaveCSS(
        'display',
        width === 390 ? 'block' : 'grid',
      );
      if (dir)
        await shellScope.screenshot({
          path: join(dir, `scope-shell-${width}-${theme}.png`),
          animations: 'disabled',
        });
    });
  }

test('a scoped native dialog leaves the host usable and restores its own state', async ({
  page,
}) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Open dialog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scoped dialog' });
  await expect(dialog).toBeVisible();
  await expect(scope.locator(':scope > [data-tmt-ui-portal] dialog.tmt-ui-dialog')).toHaveCount(1);
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(false);
  expect(
    await page.evaluate(() => [
      document.body.style.overflow,
      document.documentElement.style.overflow,
    ]),
  ).toEqual(['', '']);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Last action' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close Scoped dialog' })).toBeFocused();
  await page.getByRole('button', { name: 'Close Scoped dialog' }).click();
  await expect(dialog).toBeHidden();
  expect(await scope.evaluate((node) => (node as HTMLElement).style.overflow)).toBe('auto');
  await expect(page.getByRole('button', { name: 'Open dialog' })).toBeEnabled();
  expect(await scope.locator('button[inert]').count()).toBe(1);
});

test('a scoped UI dialog does not lock or dismiss on interaction outside its scope', async ({
  page,
}) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Open UI dialog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scoped UI dialog' });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((node) => ({
      theme: node.closest('[data-tmt-ui]')?.getAttribute('data-tmt-theme'),
      foreground: getComputedStyle(node).getPropertyValue('--tmt-foundation-foreground').trim(),
    })),
  ).toEqual({ theme: 'dark', foreground: '#f2efe9' });
  expect(
    await page.evaluate(() => [
      document.body.style.overflow,
      document.documentElement.style.overflow,
      document.body.hasAttribute('inert'),
      document.body.hasAttribute('aria-hidden'),
    ]),
  ).toEqual(['', '', false, false]);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'Other scope 0' }).click();
  await expect(page.getByRole('button', { name: 'Other scope 1' })).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(await scope.evaluate((node) => (node as HTMLElement).style.overflow)).toBe('auto');
  await expect(page.getByRole('button', { name: 'Open UI dialog' })).toBeEnabled();
});

test('a scoped UI sheet leaves controls outside its scope usable', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Open UI sheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Scoped UI sheet' });
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  expect(await scope.evaluate((node) => (node as HTMLElement).style.overflow)).toBe('auto');
});

test('a nested scoped dialog owns focus until it closes', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Open UI dialog' }).click();
  const outer = page.getByRole('dialog', { name: 'Scoped UI dialog' });
  await outer.getByRole('button', { name: 'Open nested dialog' }).click();
  const inner = page.getByRole('dialog', { name: 'Nested dialog' });
  await expect(inner).toBeVisible();
  await inner.getByRole('button', { name: 'Nested action' }).focus();
  await page.keyboard.press('Tab');
  await expect(inner.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await expect(inner).toBeVisible();
  await inner.getByRole('button', { name: 'Close' }).click();
  await expect(inner).toBeHidden();
  await expect(outer).toBeVisible();
  await outer.getByRole('button', { name: 'Close' }).click();
  await expect(outer).toBeHidden();
});

test('scoped notifications never enter the top layer or escape the scope', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Show notification' }).click();
  const notice = page.locator('[data-notification="scope-notice"]');
  await expect(notice).toBeVisible();
  const surface = page.locator('.tmt-ui-notifications');
  expect(await surface.evaluate((node) => node.matches(':popover-open'))).toBe(false);
  const outer = await scope.boundingBox();
  const inner = await notice.boundingBox();
  expect(outer).not.toBeNull();
  expect(inner).not.toBeNull();
  expect(inner!.x).toBeGreaterThanOrEqual(outer!.x);
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
});

test('a scoped native menu stays inside its scope without top-layer modality', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Scoped menu' }).click();
  const surface = scope.locator('dialog.tmt-ui-menu-surface');
  await expect(surface).toBeVisible();
  expect(await surface.evaluate((node) => node.matches(':modal'))).toBe(false);
  const outer = await scope.boundingBox();
  const inner = await surface.boundingBox();
  expect(outer).not.toBeNull();
  expect(inner).not.toBeNull();
  expect(inner!.x).toBeGreaterThanOrEqual(outer!.x);
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await expect(surface).toBeVisible();
  await page.getByRole('button', { name: 'Inside action' }).click();
  await expect(surface).toBeHidden();
});

test('a scoped chips popup is not top-layer and leaves the host usable', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Add scoped recipient' }).click();
  const popup = scope.locator('dialog.tmt-ui-chips-surface');
  await expect(popup).toBeVisible();
  expect(await popup.evaluate((node) => node.matches(':modal'))).toBe(false);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await expect(popup).toBeVisible();
  await page.getByRole('button', { name: 'Inside action' }).click();
  await expect(popup).toBeHidden();
});

test('the scoped scrim dismisses a dialog without covering the host', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Open UI dialog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scoped UI dialog' });
  await expect(dialog).toBeVisible();
  const box = await scope.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 5, box!.y + 5);
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
});

test('page scopes own one portal even when inserted after page load', async ({ page }) => {
  const path = `/@fs${fileURLToPath(new URL('../test/fixtures/scope-page.html', import.meta.url))}`;
  await page.goto(path);
  const existing = page.locator('#existing');
  await expect(existing.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
  await page.evaluate(() => {
    const scope = document.createElement('div');
    scope.id = 'later';
    scope.setAttribute('data-tmt-ds-scope', '');
    document.body.append(scope);
  });
  const later = page.locator('#later');
  await expect(later.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
  await later.evaluate((node) => node.append(document.createElement('span')));
  await expect(later.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
});

test('a scoped icon tooltip stays within the stage and avoids the top layer', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await page.getByRole('button', { name: 'Close Scoped dialog' }).hover();
  const tooltip = scope.locator('.tmt-ui-icon-action-tooltip[data-tmt-ds-open]');
  await expect(tooltip).toBeVisible();
  expect(await tooltip.evaluate((node) => node.matches(':popover-open'))).toBe(false);
  const outer = (await scope.boundingBox())!;
  const inner = (await tooltip.boundingBox())!;
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
});

test('a scoped native scrim dismisses without making the host inert', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').first();
  await page.getByRole('button', { name: 'Open dialog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scoped dialog' });
  await expect(dialog).toBeVisible();
  const box = (await scope.boundingBox())!;
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
});

test('the scoped shell keeps its theme and Remote dialog local', async ({ page }) => {
  await page.goto(fixture);
  const shell = page.locator('[data-tmt-ds-scope]').nth(2);
  await shell.getByRole('button', { name: /^Theme:/ }).click();
  await shell.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(shell).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('tmt-ui-theme'))).toBeNull();
  await shell.getByRole('button', { name: 'Remote: 6 live sessions' }).click();
  const dialog = shell.getByRole('dialog', { name: 'Remote' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(false);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('a separate React root adopts a portal added after it mounts', async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole('button', { name: 'Install late portal' }).click();
  await page.getByRole('button', { name: 'Open late dialog' }).click();
  const dialog = page.getByRole('dialog', { name: 'Late dialog' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#late-scope > [data-tmt-ui-portal] [role=dialog]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Outside 0' }).click();
  await expect(page.getByRole('button', { name: 'Outside 1' })).toBeVisible();
});

test('the unscoped shell keeps the browser top layer', async ({ page }) => {
  await page.goto('/?frame=topbar&renderer=native');
  await page.getByRole('button', { name: 'Remote: 6 live sessions' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remote', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
});

test('the scoped rail tooltip belongs to its scope portal', async ({ page }) => {
  await page.goto(fixture);
  const shell = page.locator('[data-tmt-ds-scope]').nth(2);
  await shell.evaluate((node) => {
    (node as HTMLElement).style.width = '1000px';
  });
  const item = shell.locator('.tmt-ui-rail [data-id]').first();
  await expect(item).toBeVisible();
  await item.evaluate((node) => node.setAttribute('data-note', 'Unavailable in this scope'));
  await item.hover();
  const tooltip = shell.locator('[data-tmt-ui-portal] .tmt-ui-rail-tip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('Unavailable in this scope');
  expect(await tooltip.evaluate((node) => node.matches(':popover-open'))).toBe(false);
});

test('a React shell waits for its scope portal before mounting the top bar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixture);
  const shell = page.locator('[data-tmt-ds-scope]').nth(3);
  await shell.getByRole('button', { name: 'Remote: 6 live sessions' }).click();
  const dialog = shell.getByRole('dialog', { name: 'Remote', exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(false);
  expect(errors).toEqual([]);
});

test('unmounting a scoped shell releases its Remote dialog and modal state', async ({ page }) => {
  await page.goto(fixture);
  const scope = page.locator('[data-tmt-ds-scope]').nth(2);
  await scope.getByRole('button', { name: 'Remote: 6 live sessions' }).click();
  await expect(scope.getByRole('dialog', { name: 'Remote' })).toBeVisible();
  await page.getByRole('button', { name: 'Unmount native shell' }).click();
  await expect(scope.getByRole('dialog', { name: 'Remote' })).toHaveCount(0);
  expect(
    await scope.evaluate((node) => ({
      overflow: (node as HTMLElement).style.overflow,
      inert: node.querySelectorAll('[inert]').length,
    })),
  ).toEqual({ overflow: '', inert: 0 });
});

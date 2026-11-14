import { expect, test } from '@playwright/test';

for (const renderer of ['native', 'react'])
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390])
      test(`shared rail ${renderer} ${theme} ${width}: selection, counts, commands and lifetime`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/?frame=rail&renderer=${renderer}&theme=${theme}`);
        const rail = page.locator('nav.tmt-ui-rail');
        const open = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (width === 390) {
          await open.click();
          // The drawer covers its button, so opening it takes focus to the current item.
          await expect(rail.locator('[aria-current="page"]')).toBeFocused();
          // The open drawer dims the page under a scrim, and Search starts at the rail's top
          // inset with no band above it.
          const shell = page.locator('.tmt-ui-shell');
          expect(
            await shell.evaluate((node) => getComputedStyle(node, '::before').backgroundColor),
          ).not.toBe('rgba(0, 0, 0, 0)');
          const search = rail.getByRole('button', { name: /Search/ });
          const inset = await rail.evaluate((node) =>
            parseFloat(getComputedStyle(node).getPropertyValue('--tmt-ui-rail-padding-top')),
          );
          expect((await search.boundingBox())!.y).toBeCloseTo(inset, 0);
        }
        const selected = rail.locator('[aria-current="page"]');
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute('data-id', 'all');
        const module = rail.locator('[data-id="colab"]');
        await expect(module).not.toHaveAttribute('aria-current');
        await expect(module).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        expect(await module.evaluate((node) => getComputedStyle(node, '::before').content)).toBe(
          'none',
        );
        await expect(module).toHaveCSS('font-weight', '600');
        await expect(rail.locator('[data-id="home"] .tmt-ui-shell-count')).toHaveCount(0);
        await expect(rail.locator('[data-id="remote"] .tmt-ui-shell-count')).toHaveCount(0);
        await expect(rail.locator('[data-id="empty"] .tmt-ui-shell-count')).toHaveCount(0);
        const counts = rail.locator('[data-id="all"] .tmt-ui-shell-counts');
        await expect(counts).toHaveCSS('gap', '4px');
        const paints = () =>
          counts.locator('.tmt-ui-shell-count').evaluateAll((nodes) =>
            nodes.map((node) => {
              const css = getComputedStyle(node);
              return [css.color, css.backgroundColor, css.borderRadius];
            }),
          );
        const original = await paints();
        await expect(counts.locator('.tmt-ui-attention-dot')).toHaveCSS('outline-style', 'none');
        await expect(counts.locator('.tmt-ui-shell-count')).toHaveCount(1);
        await expect(counts.locator('.tmt-ui-shell-count')).toHaveText('42');
        await expect(counts.locator('.tmt-ui-shell-count')).toHaveCSS(
          'background-color',
          'rgba(0, 0, 0, 0)',
        );
        await expect(counts.locator('.tmt-ui-shell-count')).toHaveCSS('padding', '0px');
        await expect(counts.locator('.tmt-ui-shell-count')).toHaveCSS(
          'font-variant-numeric',
          'tabular-nums',
        );
        await expect(counts.locator('.tmt-ui-attention-dot')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
        await expect(rail.locator('[data-id="all"]')).toHaveAccessibleName(
          'All pages · 42 total, 3 need you',
        );
        await expect(rail.locator('.tmt-ui-rail-sub-group')).toHaveCSS('text-transform', 'none');
        await expect(rail.locator('.tmt-ui-rail-sub-group')).toHaveCSS('height', '28px');
        const allLabel = rail.locator('[data-id="all"] .tmt-ui-module-menu-label');
        const projectLabel = rail.locator('[data-id="project"] .tmt-ui-module-menu-label');
        const heading = rail.locator('.tmt-ui-rail-sub-group > span');
        const x = (node: typeof allLabel) =>
          node.evaluate((element) => element.getBoundingClientRect().x);
        expect(await x(projectLabel)).toBe(await x(allLabel));
        expect((await x(heading)) - (await selected.boundingBox())!.x).toBe(13);
        expect((await x(allLabel)) - (await selected.boundingBox())!.x).toBe(36);
        await expect(projectLabel).toHaveAttribute('title', 'Release planning and coordination');
        await expect(projectLabel).toHaveCSS('text-overflow', 'ellipsis');
        await expect(selected).toHaveCSS('border-left-width', '0px');
        await expect(selected).toHaveCSS(
          'border-radius',
          await module.evaluate((node) => getComputedStyle(node).borderRadius),
        );
        const settings = rail.locator('.tmt-ui-rail-sub > li:last-child');
        await expect(settings).toHaveClass('tmt-ui-rail-settings');
        expect(
          await settings.evaluate((node) => {
            const css = getComputedStyle(node, '::before');
            return { left: css.left, width: css.borderTopWidth };
          }),
        ).toEqual({ left: '36px', width: '1px' });
        await testInfo.attach(`rail-${renderer}-${theme}-${width}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await rail.locator('[data-id="project"]').click();
        if (width === 390) await open.click();
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute('data-id', 'project');
        expect(await paints()).toEqual(original);
        const manage = rail.getByRole('button', { name: 'Manage projects', exact: true });
        await manage.evaluate((button) => {
          button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          (button as HTMLButtonElement).click();
        });
        await expect(page.getByRole('status')).not.toHaveText('Manage 1');
        await manage.focus();
        await page
          .getByRole('button', { name: 'Refresh command bindings' })
          .evaluate((node) => (node as HTMLButtonElement).click());
        await expect(manage).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status')).toHaveText('Manage 1');
        if (width === 390) await open.click();
        const add = rail.getByRole('button', { name: 'New project', exact: true });
        await expect(add).not.toHaveAttribute('aria-current');
        const plus = add.locator('svg');
        await expect(plus).toHaveAttribute('aria-hidden', 'true');
        await expect(plus).toHaveCSS('width', '14px');
        await expect(plus).toHaveCSS('height', '14px');
        await add.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('status')).toHaveText('New 1');
        await page.getByRole('button', { name: 'Select module', exact: true }).click();
        if (width === 390) await open.click();
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute('data-id', 'colab');
        if (width === 390) {
          await page.keyboard.press('Escape');
          await expect(open).toBeFocused();
          await expect(rail).toBeHidden();
          // A press on the scrim beside the drawer closes it.
          await open.click();
          await expect(rail).toBeVisible();
          await page.mouse.click(370, 500);
          await expect(rail).toBeHidden();
        }
        await page.getByRole('button', { name: 'Unmount rail', exact: true }).click();
        await expect(rail).toHaveCount(0);
        await expect(page.getByRole('tooltip')).toHaveCount(0);
      });

for (const key of ['Enter', ' '])
  test(`shell command admits ${key === ' ' ? 'Space' : key} key-turn click and rejects synthetic input`, async ({
    page,
  }) => {
    await page.goto('/?frame=rail&renderer=native');
    const manage = page
      .locator('nav.tmt-ui-rail')
      .getByRole('button', { name: 'Manage projects', exact: true });
    const status = page.getByRole('status');
    await manage.evaluate((button) => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      (button as HTMLButtonElement).click();
    });
    await expect(status).toHaveText('Ready');
    await manage.evaluate((button, key) => {
      button.addEventListener(
        key === ' ' ? 'keyup' : 'keydown',
        (event) => {
          if (!(event instanceof KeyboardEvent) || event.key !== key) return;
          const other = document.querySelector<HTMLButtonElement>('.tmt-ui-rail-add')!;
          other.click();
          (button as HTMLButtonElement).click();
          (button as HTMLButtonElement).click();
          event.preventDefault();
        },
        { once: true },
      );
    }, key);
    await manage.focus();
    await page.keyboard.press(key === ' ' ? 'Space' : key);
    await expect(status).toHaveText('Manage 0');
    await expect(status).toHaveAttribute('data-command-calls', '1');
    await expect(status).toHaveAttribute('data-add-calls', '0');
    await manage.evaluate(async (button) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      (button as HTMLButtonElement).click();
    });
    await expect(status).toHaveAttribute('data-command-calls', '1');
    await manage.evaluate((button, key) => {
      button.addEventListener(
        key === ' ' ? 'keyup' : 'keydown',
        (event) => {
          if (!(event instanceof KeyboardEvent) || event.key !== key) return;
          event.preventDefault();
          (button as HTMLButtonElement).click();
        },
        { once: true },
      );
    }, key);
    await manage.focus();
    await page.keyboard.press(key === ' ' ? 'Space' : key);
    await expect(status).toHaveAttribute('data-command-calls', '1');
    await manage.click();
    await expect(status).toHaveAttribute('data-command-calls', '2');
  });

test('rail alert and disabled group command styles stay within rail markup', async ({ page }) => {
  await page.goto('/?frame=rail');
  await page.evaluate(() => {
    for (const parent of [document.querySelector('nav.tmt-ui-rail')!, document.body]) {
      const probe = document.createElement('div');
      probe.dataset.railStyleProbe = parent === document.body ? 'page' : 'rail';
      probe.innerHTML =
        '<div class="tmt-ui-rail-alert">Storage unavailable</div><button disabled class="tmt-ui-rail-group-action">Manage</button>';
      parent.append(probe);
    }
  });
  const rail = page.locator('[data-rail-style-probe="rail"]');
  const ordinary = page.locator('[data-rail-style-probe="page"]');
  await expect(rail.locator('.tmt-ui-rail-alert')).toHaveCSS('display', 'flex');
  await expect(rail.locator('button')).toHaveCSS('cursor', 'not-allowed');
  await expect(ordinary.locator('.tmt-ui-rail-alert')).toHaveCSS('display', 'block');
  await expect(ordinary.locator('button')).not.toHaveCSS('cursor', 'not-allowed');
});

for (const renderer of ['native', 'react'])
  test(`group fallback icons ignore display labels and preserve explicit icons (${renderer})`, async ({
    page,
  }) => {
    await page.goto(`/?frame=rail&icons=true&dashboard-defaults=true&renderer=${renderer}`);
    const rail = page.locator('nav.tmt-ui-rail');
    const dashboard = rail.locator('a[data-id="dashboard-default"] > svg');
    const explicit = rail.locator('a[data-id="dashboard-explicit"] > svg');
    const bookmark = rail.locator('a[data-id="project"] > svg');
    await expect(dashboard).toHaveAttribute('aria-hidden', 'true');
    await expect(dashboard.locator('rect')).toHaveCount(4);
    await expect(explicit.locator('path')).toHaveCount(1);
    await expect(rail.locator('a[data-id="other-default"] > svg')).toHaveCount(0);
    for (const property of ['width', 'height', 'color'])
      expect(
        await dashboard.evaluate(
          (node, key) => getComputedStyle(node).getPropertyValue(key),
          property,
        ),
      ).toBe(
        await bookmark.evaluate(
          (node, key) => getComputedStyle(node).getPropertyValue(key),
          property,
        ),
      );
  });

for (const renderer of ['native', 'react'])
  test(`optional row icons and text group action use the shared renderer in ${renderer}`, async ({
    page,
  }) => {
    await page.goto(`/?frame=rail&icons=true&renderer=${renderer}`);
    const menu = page.locator('nav.tmt-ui-rail .tmt-ui-rail-sub');
    await expect(menu.locator('a[data-id="all"] > svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(menu.locator('a[data-id="project"] > svg')).toHaveAttribute('aria-hidden', 'true');
    const manage = menu.getByRole('button', { name: 'Manage', exact: true });
    await expect(manage).toHaveText('Manage');
    await expect(manage.locator('svg')).toHaveCount(0);
    await manage.click();
    await expect(page.getByRole('status')).toHaveText('Manage 0');
  });

for (const renderer of ['native', 'react'])
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390])
      test(`reorder replaces the leading icon without moving its label ${renderer} ${theme} ${width}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `/?frame=rail&interactive=true&icons=true&renderer=${renderer}&theme=${theme}`,
        );
        const row = page.locator('li[data-menu-item="project"]');
        const link = row.locator(':scope > a');
        const hamburger = page.getByRole('button', { name: 'Open navigation' });
        if (width === 390) {
          // A tap focuses the current row but leaves it at rest: its icon, no grip, no actions.
          await hamburger.click();
          await expect(link).toBeFocused();
          // The swap transitions; read the row once its animations are done.
          await row.evaluate((node) =>
            Promise.all(node.getAnimations({ subtree: true }).map((each) => each.finished)),
          );
          await expect(row.locator(':scope > .tmt-ui-swap > svg[data-swap=rest]')).toHaveCSS(
            'opacity',
            '1',
          );
          await expect(row.locator('[data-rail-part="drag"]')).toBeHidden();
          await page.keyboard.press('Escape');
          await expect(hamburger).toBeFocused();
          // A keyboard opening focuses it too, and keyboard focus reveals its grip.
          await page.keyboard.press('Enter');
          await expect(link).toBeFocused();
          await expect(row.locator('[data-rail-part="drag"]')).toBeVisible();
          await page.keyboard.press('Escape');
          await hamburger.click();
          await expect(link).toBeFocused();
        }
        const icon = row.locator(':scope > .tmt-ui-swap > svg[data-swap=rest], :scope > a > svg');
        const grip = row.locator('[data-rail-part="drag"]');
        const label = link.locator('.tmt-ui-module-menu-label');
        const initial = (await label.boundingBox())!;
        const slot = (await icon.boundingBox())!;
        const capture = async (state: string) =>
          testInfo.attach(`icon-grip-${state}`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(icon).toHaveCSS('opacity', '1');
        await expect(grip).toBeHidden();
        await capture('rest');
        await link.hover();
        await expect(icon).toHaveCSS('opacity', '0');
        await expect(grip).toHaveCSS('opacity', '1');
        await expect(grip).toHaveAccessibleName('Reorder Colab v1 · In progress');
        const hit = (await grip.boundingBox())!;
        expect(hit.width).toBe(24);
        expect(hit.height).toBe(24);
        expect(hit.x + hit.width / 2).toBeCloseTo(slot.x + slot.width / 2, 0);
        expect(hit.y + hit.height / 2).toBeCloseTo(slot.y + slot.height / 2, 0);
        expect((await label.boundingBox())!.x).toBe(initial.x);
        await capture('hover');
        await page.mouse.move(width - 5, 895);
        // At 390 the tap left the link focused without focus-visible; refocus it by keyboard modality.
        await link.blur();
        await page.keyboard.press('Shift');
        await link.focus();
        await expect(icon).toHaveCSS('opacity', '0');
        await expect(grip).toHaveCSS('opacity', '1');
        expect((await label.boundingBox())!.x).toBe(initial.x);
        await capture('focus');
        const target = (await page.locator('li[data-menu-item="notes"] > a').boundingBox())!;
        await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
        await page.mouse.down();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
          steps: 12,
        });
        await expect(row).toHaveAttribute('data-dragging', '');
        await expect(icon).toHaveCSS('opacity', '0');
        await expect(grip).toHaveCSS('opacity', '1');
        expect((await label.boundingBox())!.x).toBe(initial.x);
        await capture('drag');
        await page.mouse.up();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(icon).toHaveCSS('transition-duration', '0s');
        await expect(grip).toHaveCSS('transition-duration', '0s, 0s');
        await page
          .getByRole('button', { name: 'Toggle reorder availability', exact: true })
          .evaluate((node) => (node as HTMLButtonElement).click());
        await link.focus();
        await expect(row.locator('[data-rail-part="drag"]')).toHaveCount(0);
        await expect(icon).toHaveCSS('opacity', '1');
      });

for (const renderer of ['native', 'react'])
  test(`coarse pointer retains the leading icon and Manage without a grip ${renderer}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 900 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      await page.goto(`/?frame=rail&interactive=true&icons=true&renderer=${renderer}`);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await page.getByRole('button', { name: 'Open navigation' }).click();
      const row = page.locator('li[data-menu-item="project"]');
      await row.locator(':scope > a').focus();
      await expect(row.locator(':scope > .tmt-ui-swap > svg[data-swap=rest]')).toHaveCSS(
        'opacity',
        '1',
      );
      await expect(row.locator('[data-rail-part="drag"]')).toBeHidden();
      await page.getByRole('button', { name: 'Manage shortcuts', exact: true }).click();
      await expect(page.locator('[data-host-status]')).toHaveText('Manage 0');
    } finally {
      await context.close();
    }
  });

import { expect, test } from '@playwright/test';

test('a 1440 mockup fits its own container without a document frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountMockup();
  });
  const stage = page.locator('[data-tmt-ds-scope]');
  await expect(stage.getByRole('button', { name: 'Inside stage' })).toBeVisible();
  // A 390 stage in a 300px block scales to fit too, rather than scrolling sideways.
  expect((await stage.boundingBox())!.width).toBeCloseTo(300, 0);
  await expect(page.getByLabel('Scaled 77%')).toHaveText('77%');
  await page.getByRole('button', { name: '1440' }).click();
  await expect(page.getByRole('button', { name: '1440' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Scaled 21%')).toHaveText('21%');
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('[data-theme=dark]')).toHaveCount(1);
  expect((await stage.boundingBox())!.width).toBeLessThanOrEqual(301);
  expect(await stage.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(250);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('the host receives system, version and stage setting changes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountConfigurableMockup();
  });
  await page.getByLabel('Design system', { exact: true }).selectOption('brio');
  await page.getByLabel('Design system version').selectOption('2.0.0');
  await page.getByRole('button', { name: '1440' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('[data-setting]')).toHaveText('brio@2.0.0:1440:dark');
});

test('a collapsed toolbar opens on request, and a stage scaled past reading opens at full size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountCollapsedMockup();
  });
  const settings = page.getByRole('button', { name: 'Mockup settings', exact: true });
  const toolbar = page.getByRole('toolbar', { name: 'Mockup settings' });
  // Read first: the stage, one settings control and, the stage being at 21%, the full-size view.
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(toolbar).toBeHidden();
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '1440' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Scaled 21%')).toHaveText('21%');
  await settings.click();
  await expect(toolbar).toBeHidden();
  const open = page.getByRole('button', { name: 'Open at full size' });
  await open.click();
  const view = page.getByRole('dialog', { name: 'tmt-gui mockup at full size' });
  await expect(view).toBeVisible();
  // The stage at its own width, unscaled; the window scrolls to the rest of it.
  const stage = view.locator('[data-tmt-ds-scope]');
  await expect(stage.getByRole('button', { name: 'Inside stage' })).toBeVisible();
  // Measured once the dialog has finished opening (it scales in).
  await expect
    .poll(() => stage.evaluate((node) => Math.round(node.getBoundingClientRect().width)))
    .toBe(1440);
  expect(await stage.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  // A stage is a size container: it is given its content's height, or it clips everything away.
  const fits = await stage.evaluate((node) => ({
    stage: node.clientHeight,
    content: (node.firstElementChild as HTMLElement).offsetHeight,
  }));
  expect(fits.content).toBeGreaterThan(0);
  expect(fits.stage).toBeGreaterThanOrEqual(fits.content);
  const viewport = view.locator('.tmt-block-mockup-full-viewport');
  expect(await viewport.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(view.getByRole('button', { name: 'Close full-size view' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('an open toolbar shows no settings control and no full-size view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountMockup();
  });
  await page.getByRole('button', { name: '1440' }).click();
  await expect(page.getByLabel('Scaled 21%')).toHaveText('21%');
  await expect(page.getByRole('toolbar', { name: 'Mockup settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mockup settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open at full size' })).toHaveCount(0);
});

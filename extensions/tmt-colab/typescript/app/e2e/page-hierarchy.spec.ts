import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';

/** The fixture's page IDs (`test/work-page-browser.tsx`): this page sits under Remote launch,
 * beside Remote copy deck, and has four sub-pages. */
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PAGE = { remote: id(1), launch: id(53), elsewhere: id(54) };

async function mount(
  page: Page,
  scenario: 'tree' | 'empty' | 'filled' | 'work-fields' = 'tree',
  owner = true,
) {
  await page.goto('/');
  await page.evaluate(
    async ([owner, scenario]) => {
      const path = '/test/work-page-browser.tsx';
      (await import(path)).mountWorkPage(owner, scenario);
    },
    [owner, scenario] as const,
  );
  const bar = page.locator('.tmt-ui-topbar:visible');
  await expect(page.locator('.page-mobile-title:visible h1')).toHaveText(
    /^(?:COLAB-128\s+)?Release plan/,
  );
  return bar;
}

for (const width of [1440, 1100, 800, 390])
  test(`work fields remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(page, 'work-fields');
    const work = page.getByRole('region', { name: 'Work on this page' });
    await expect(page.locator('.colab-work-number:visible')).toHaveText('COLAB-128');
    await expect(work.locator('.work-head').getByLabel('Priority high')).toBeVisible();
    await expect(work.locator('.work-owner-chip')).toBeVisible();
    await expect(
      page.locator('.page-work-notes').getByText('Next · Review the mockup'),
    ).toBeVisible();
    await expect(
      page.locator('.page-work-notes').getByText('Waiting for Core', { exact: true }),
    ).toBeVisible();
    await expect(work.locator('.work-count-wide')).toHaveText('4 sub-pages');
    await expect(work.locator('.work-count-wide')).toBeVisible();
    const state = work.getByRole('button', { name: 'Blocked, show status details' });
    await expect(state).toHaveText('Blocked');
    await expect(page.getByRole('link', { name: 'PR #42 · Released in v1.2.3' })).toBeVisible();
    await expect(page.getByText('Last activity 2 minutes ago')).toBeVisible();
    // Sections are progress (#6619): the title row counts done sections, and each counted heading
    // has its mark and count beside it, the state word added when the count does not say it.
    await expect(page.locator('.page-section-totals')).toHaveText('0/2 sections done');
    const sections = page.locator('.structured-section-heading');
    await expect(sections.locator('.structured-section-count')).toHaveText([
      '2/3',
      '0/1 · Needs you',
    ]);
    await expect(sections.first().locator('.structured-section-mark')).toHaveAttribute(
      'data-shape',
      'half',
    );
    await expect(sections.last().locator('.structured-section-mark')).toHaveAttribute(
      'data-shape',
      'target',
    );
    if (width === 1440) {
      await state.click();
      await expect(page.getByText(/CI passed.*Observed/)).toBeVisible();
      await page.keyboard.press('Escape');
    }
    expect(await state.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const box = await work.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width === 1100) {
      const controls = page.locator('.tmt-ui-topbar-controls:visible');
      const controlsBox = await controls.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(controlsBox!.y + controlsBox!.height);
    }
    const title = page.locator('.page-mobile-title:visible h1');
    expect((await title.boundingBox())!.width).toBeGreaterThan(40);
    await work.getByRole('button', { name: '4 sub-pages' }).click();
    const child = page.locator('.work-row-line').filter({ hasText: 'Remote pages v2' });
    await expect(child).toContainText('COLAB-129');
    await expect(child).toContainText('gui-3');
    await expect(child).toContainText('Next · Review the mockup');
    await expect(child).toContainText('Blocked · Waiting for Core');
  });

test('the parent chip menu goes up or across', async ({ page }) => {
  await mount(page);
  const parent = page.locator('.page-mobile-title:visible .page-hierarchy-parent');
  await expect(parent.locator('.page-hierarchy-icon')).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Parent · Remote launch' });
  await expect(trigger).not.toContainText('sub-pages');
  await expect(parent).toContainText('Parent ·');
  await trigger.click();
  const menu = page.locator('.page-hierarchy-menu');
  await expect(menu.getByRole('menuitem').first()).toHaveText('Back to Remote launch');
  await expect(menu.getByText('Remote launch · 2 sub-pages')).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Release plan \(this page\)/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menu.getByRole('menuitem', { name: /Remote copy deck/ })).toContainText('To do');
  await menu.getByRole('menuitem', { name: 'Back to Remote launch' }).click();
  await expect(page).toHaveURL(new RegExp(PAGE.launch));
});

test('Mock P1: "N sub-pages" after the title lists the direct sub-pages with their states', async ({
  page,
}) => {
  await mount(page);
  const chip = page
    .locator('.page-mobile-title:visible')
    .getByRole('button', { name: '4 sub-pages' });
  await expect(chip).toBeVisible();
  await chip.click();
  const rows = page.locator('.work-row-line');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Remote pages v2');
  await expect(rows.first()).toContainText('In progress');
  await rows.first().getByRole('link', { name: 'Remote pages v2' }).click();
  await expect(page).toHaveURL(new RegExp(PAGE.remote));
});

test('parts that do not apply are absent', async ({ page }) => {
  await mount(page, 'empty');
  await expect(page.locator('.page-mobile-title:visible .work-toggle')).toHaveCount(0);
  // This page still has its parent.
  await expect(page.locator('.page-mobile-title:visible .page-hierarchy-parent')).toHaveCount(1);
});

test('phone keeps the state and sub-page count, with parent navigation in More', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = await mount(page);
  await expect(page.locator('.page-mobile-title:visible .page-hierarchy-parent')).toBeVisible();
  await expect(page.getByRole('button', { name: '4 sub-pages' })).toBeVisible();
  const title = page.locator('.page-mobile-title:visible h1');
  expect((await title.boundingBox())!.width).toBeGreaterThan(40);
  await bar.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Back to Remote launch' })).toBeVisible();
});

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`captures filled work fields at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mount(page, 'work-fields');
      await expect(
        page.getByRole('button', { name: 'Blocked, show status details' }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Projects for Release plan: Colab/ }),
      ).toBeVisible();
      await page.screenshot({ path: capturePath(`work-fields-${width}-${theme}.png`) });
    });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`captures P1/P2 at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const bar = await mount(page);
      await page.screenshot({ path: capturePath(`top-bar-p1-${width}-${theme}.png`) });
      if (width === 390) await bar.getByRole('button', { name: 'More', exact: true }).click();
      else await page.locator('.page-mobile-title:visible .page-hierarchy-parent').click();
      await page.screenshot({ path: capturePath(`top-bar-parent-menu-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await page.locator('.work-toggle').click();
      await page.screenshot({ path: capturePath(`top-bar-subpages-menu-${width}-${theme}.png`) });
    });

// Filled states: long titles, a parent two levels below the top, and an archived sub-page, which
// neither the sub-pages menu nor the work panel lists (#5506, #5867).
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`captures filled states at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const bar = await mount(page, 'filled');
      // The long titles end in an ellipsis and stay on one line; the bar keeps its height.
      const title = page.locator('.page-mobile-title:visible h1');
      expect(await title.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect((await bar.boundingBox())!.height).toBeLessThan(80);
      await page.screenshot({ path: capturePath(`top-bar-filled-${width}-${theme}.png`) });
      if (width === 390) await bar.getByRole('button', { name: 'More', exact: true }).click();
      else await page.locator('.page-mobile-title:visible .page-hierarchy-parent').click();
      await page.screenshot({
        path: capturePath(`top-bar-filled-parent-menu-${width}-${theme}.png`),
      });
      await page.keyboard.press('Escape');
      const subpages = page.locator('.work-toggle');
      await expect(subpages).toHaveAccessibleName('3 sub-pages');
      await subpages.click();
      const menu = page.locator('.work-body');
      await expect(menu.locator('.work-row-line')).toHaveCount(3);
      await expect(menu).not.toContainText('Release notes draft');
      await page.screenshot({
        path: capturePath(`top-bar-filled-subpages-menu-${width}-${theme}.png`),
      });
    });

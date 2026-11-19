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

/** The bar's status chip opens the page's details: a popover, or a sheet up to 900px (#6652). */
async function openDetails(page: Page) {
  await page.locator('.tmt-ui-topbar:visible .page-bar-status').click();
  const details = page.locator('.page-status-details:visible');
  await expect(details).toBeVisible();
  return details;
}
const field = (details: import('@playwright/test').Locator, name: string) =>
  details
    .locator('.page-status-fields dt')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator('xpath=following-sibling::dd[1]');

for (const width of [1440, 1100, 800, 390])
  test(`work fields remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(page, 'work-fields');
    // The number shows in the page's title and again in the top bar (#6611).
    await expect(page.locator('.page-mobile-title h1 .colab-work-number')).toHaveText('COLAB-128');
    await expect(page.locator('.tmt-ui-topbar:visible .colab-work-number')).toHaveText('COLAB-128');
    // No row under the title any more (#6652): the bar's status chip holds what it showed.
    await expect(page.getByRole('region', { name: 'Work on this page' })).toHaveCount(0);
    await expect(page.locator('.page-section-totals')).toHaveCount(0);
    const barStatus = page.locator('.tmt-ui-topbar:visible .page-bar-status');
    await expect(barStatus).toHaveAccessibleName('Blocked, show status details');
    await expect(barStatus.locator('.page-bar-status-label')).toHaveText('Blocked');
    if (width === 1440) {
      // Not computed yet: the bar uses the page's own word for it, never the list's.
      await page.evaluate(async () => {
        const path = '/test/work-page-browser.tsx';
        (await import(path)).mountWorkPage(true, 'work-fields', false, 'unknown');
      });
      await expect(barStatus.locator('.page-bar-status-label')).toHaveText('Status unknown');
      await mount(page, 'work-fields');
    }
    if (width === 390) {
      await page.setViewportSize({ width: 320, height: 900 });
      await expect(barStatus).toBeHidden();
      await page.setViewportSize({ width, height: 900 });
    }
    // Sections are progress (#6619): each counted heading has its mark and count beside it, the
    // state word added when the count does not say it.
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
    const title = page.locator('.page-mobile-title:visible h1');
    expect((await title.boundingBox())!.width).toBeGreaterThan(40);
    const details = await openDetails(page);
    await expect(details.locator('.page-status-headline')).toHaveText(
      /^Blocked\s*Waiting for Core$/,
    );
    await expect(field(details, 'Owner')).toHaveText(/gui-3$/);
    await expect(field(details, 'Priority')).toHaveText('↑ High');
    await expect(field(details, 'Next')).toHaveText('Review the mockup');
    await expect(field(details, 'Sections')).toHaveText('0/2 sections done');
    await expect(field(details, 'Last activity')).toHaveText('2 minutes ago');
    await expect(details.locator('.page-status-pulls .work-pull-details')).toHaveText([
      /^PR #42 · Released in v1\.2\.3 · CI passed · Observed/,
    ]);
    await expect(details.getByRole('link', { name: 'PR #42' })).toHaveAttribute(
      'href',
      'https://github.com/example/project/pull/42',
    );
    // The observed age wraps whole: "Observed 2 hours ago" stays on one line.
    const age = details.locator('.work-pull-age');
    await expect(age).toHaveText(/^Observed .+ ago$/);
    expect(await age.evaluate((node) => node.getClientRects().length)).toBe(1);
    // Nothing in the details is cut at any width.
    const box = await details.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await details.getByRole('button', { name: '4 sub-pages' }).click();
    const child = page.locator('.work-row-line').filter({ hasText: 'Remote pages v2' });
    await expect(child).toContainText('COLAB-129');
    await expect(child).toContainText('gui-3');
    await expect(child).toContainText('Next · Review the mockup');
    await expect(child).toContainText('Blocked · Waiting for Core');
  });

test('the parent chip menu goes up or across', async ({ page }) => {
  await mount(page);
  const details = await openDetails(page);
  const parent = details.locator('.page-hierarchy-parent');
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

test('Mock P1: "N sub-pages" in the status details lists the direct sub-pages with their states', async ({
  page,
}) => {
  await mount(page);
  const chip = (await openDetails(page)).getByRole('button', { name: '4 sub-pages' });
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
  const details = await openDetails(page);
  await expect(details.locator('.work-toggle')).toHaveCount(0);
  // This page still has its parent.
  await expect(details.locator('.page-hierarchy-parent')).toHaveCount(1);
});

test('phone keeps the state and sub-page count, with parent navigation in More', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = await mount(page);
  const title = page.locator('.page-mobile-title:visible h1');
  expect((await title.boundingBox())!.width).toBeGreaterThan(40);
  const sheet = await openDetails(page);
  await expect(sheet.locator('.page-hierarchy-parent')).toBeVisible();
  await expect(sheet.getByRole('button', { name: '4 sub-pages' })).toBeVisible();
  await page.keyboard.press('Escape');
  await bar.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Back to Remote launch' })).toBeVisible();
});

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`captures filled work fields at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mount(page, 'work-fields');
      const details = await openDetails(page);
      // The projects: the bar's labels beside the chip, or a line in the phone sheet.
      if (width === 390)
        await expect(details.locator('.page-status-projects')).toContainText('Colab');
      else
        await expect(
          page.getByRole('button', { name: 'Projects: Colab. Edit projects' }),
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
      else await (await openDetails(page)).locator('.page-hierarchy-parent').click();
      await page.screenshot({ path: capturePath(`top-bar-parent-menu-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      if (width === 390 || !(await page.locator('.page-status-details:visible').count()))
        await openDetails(page);
      await page.locator('.page-status-details:visible .work-toggle').click();
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
      else await (await openDetails(page)).locator('.page-hierarchy-parent').click();
      await page.screenshot({
        path: capturePath(`top-bar-filled-parent-menu-${width}-${theme}.png`),
      });
      await page.keyboard.press('Escape');
      if (!(await page.locator('.page-status-details:visible').count())) await openDetails(page);
      const subpages = page.locator('.page-status-details:visible .work-toggle');
      await expect(subpages).toHaveAccessibleName('3 sub-pages');
      await subpages.click();
      const menu = page.locator('.work-body');
      await expect(menu.locator('.work-row-line')).toHaveCount(3);
      await expect(menu).not.toContainText('Release notes draft');
      await page.screenshot({
        path: capturePath(`top-bar-filled-subpages-menu-${width}-${theme}.png`),
      });
    });

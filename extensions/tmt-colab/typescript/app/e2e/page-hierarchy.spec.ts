import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';

/** The fixture's page IDs (`test/work-page-browser.tsx`): this page sits under Remote launch,
 * beside Remote copy deck, and has four sub-pages. */
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PAGE = { remote: id(1), launch: id(53), elsewhere: id(54) };

async function mount(page: Page, scenario: 'tree' | 'empty' = 'tree', owner = true) {
  await page.goto('/');
  await page.evaluate(
    async ([owner, scenario]) => {
      const path = '/test/work-page-browser.tsx';
      (await import(path)).mountWorkPage(owner, scenario);
    },
    [owner, scenario] as const,
  );
  const bar = page.locator('.tmt-ui-topbar:visible');
  await expect(bar.locator('.tmt-ui-topbar-title-current')).toHaveText('Release plan');
  return bar;
}

test('Mock P1: the direct parent and its progress lead the title, its menu goes up or across', async ({
  page,
}) => {
  const bar = await mount(page);
  const parent = bar.locator('.page-hierarchy-parent');
  await expect(parent.locator('.page-hierarchy-icon')).toBeVisible();
  const name = parent.getByRole('link', { name: 'Remote launch', exact: true });
  await expect(name).toHaveAttribute('href', new RegExp(PAGE.launch));
  const trigger = bar.getByRole('button', { name: 'Remote launch, 0 of 2 sub-pages done' });
  await expect(trigger).toHaveText('0/2');
  await expect(parent.locator('.page-hierarchy-separator')).toHaveText('›');
  // The parent replaces the scope crumb; nothing else of the bar moves.
  await expect(bar.locator('.colab-scope-crumb')).toHaveCount(0);
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
  const bar = await mount(page);
  const chip = bar.getByRole('button', { name: '4 sub-pages' });
  await expect(chip).toBeVisible();
  await chip.click();
  const items = page.locator('.page-hierarchy-menu').getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('Remote pages v2');
  await expect(items.first()).toContainText('In progress');
  await items.first().click();
  await expect(page).toHaveURL(new RegExp(PAGE.remote));
});

test('parts that do not apply are absent', async ({ page }) => {
  const bar = await mount(page, 'empty');
  await expect(bar.getByRole('button', { name: /sub-pages?$/ })).toHaveCount(0);
  // This page still has its parent.
  await expect(bar.locator('.page-hierarchy-parent')).toHaveCount(1);
});

test('Mock P2: on a phone the parent name truncates before the title and chips keep their size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bar = await mount(page);
  const name = bar.locator('.page-hierarchy-name');
  const title = bar.locator('.tmt-ui-topbar-title-current');
  await expect(name).toBeVisible();
  await expect(bar.getByRole('button', { name: '4 sub-pages' })).toHaveText('4');
  const widths = await bar.evaluate((node) => {
    const width = (selector: string) => node.querySelector(selector)!.getBoundingClientRect().width;
    const full = (selector: string) => {
      const element = node.querySelector<HTMLElement>(selector)!;
      return element.scrollWidth > element.clientWidth + 1;
    };
    return {
      nameTruncated: full('.page-hierarchy-name'),
      titleTruncated: full('.tmt-ui-topbar-title-current'),
      count: width('.page-hierarchy-count'),
    };
  });
  // The parent's name gives way first: if the title is cut, the name is cut too.
  if (widths.titleTruncated) expect(widths.nameTruncated).toBe(true);
  const natural = await bar.locator('.page-hierarchy-count').evaluate((node) => node.scrollWidth);
  expect(widths.count).toBeGreaterThanOrEqual(natural);
  await expect(title).toBeVisible();
});

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`captures P1/P2 at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const bar = await mount(page);
      await page.screenshot({ path: capturePath(`top-bar-p1-${width}-${theme}.png`) });
      await bar.locator('.page-hierarchy-count').click();
      await page.screenshot({ path: capturePath(`top-bar-parent-menu-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await bar.locator('.page-hierarchy-subpages').click();
      await page.screenshot({ path: capturePath(`top-bar-subpages-menu-${width}-${theme}.png`) });
    });

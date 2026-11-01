import { expect, test, type Page } from '@playwright/test';

// #5911: a switch from the Colab side menu draws its header with its own content, frame by frame:
// one title at a time, and never the next page's title over the previous page's content.
async function mount(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('shells', '/');
  });
  return page.locator('#list-fixture');
}
interface Sample {
  headings: number;
  titles: string[];
  settings: boolean;
  list: boolean;
}
for (const width of [1440, 390])
  test(`a side menu switch keeps one title, belonging to the content, ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 992 });
    const app = await mount(page);
    const rail = app.locator('nav.tmt-ui-rail');
    const open = app.getByRole('button', { name: 'Open navigation', exact: true });
    const go = async (name: RegExp) => {
      if (width === 390) await open.click();
      await rail.getByRole('link', { name }).first().click();
    };
    await expect(app.getByRole('region', { name: 'Reference defaults' })).toHaveCount(0);
    await page.evaluate(() => {
      const samples: Sample[] = [];
      Object.defineProperty(window, 'samples', { value: samples });
      const root = document.querySelector('#list-fixture')!;
      const tick = () => {
        samples.push({
          headings: [...root.querySelectorAll('h1')].filter(
            (node) => (node as HTMLElement).getClientRects().length > 0,
          ).length,
          titles: [...root.querySelectorAll('.tmt-ui-topbar-title-current')]
            .filter((node) => (node as HTMLElement).getClientRects().length > 0)
            .map((node) => node.textContent?.trim() ?? '')
            .filter(Boolean),
          settings: root.querySelector('[aria-label="Reference defaults"]') !== null,
          list: root.querySelector('[data-page-list], .page-list, table') !== null,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await go(/^Colab settings/);
    await expect(app.getByRole('region', { name: 'Reference defaults' })).toBeVisible();
    await go(/^All pages/);
    await expect(app.getByRole('region', { name: 'Reference defaults' })).toHaveCount(0);
    await page.waitForTimeout(300);
    const samples = await page.evaluate(() => (window as unknown as { samples: Sample[] }).samples);
    expect(samples.length).toBeGreaterThan(10);
    // The bar is never left without a title while the next screen loads.
    const untitled = samples.filter((sample) => sample.titles.length === 0);
    expect(untitled, JSON.stringify(untitled.slice(0, 3))).toEqual([]);
    const doubled = samples.filter((sample) => sample.headings > 1 || sample.titles.length > 1);
    expect(doubled, JSON.stringify(doubled.slice(0, 3))).toEqual([]);
    // Settings content is never shown under another title, nor the Settings title over other content.
    const mismatched = samples.filter(
      (sample) =>
        (sample.titles.includes('Settings') && sample.list) ||
        (sample.settings && !sample.titles.includes('Settings')),
    );
    expect(mismatched, JSON.stringify(mismatched.slice(0, 3))).toEqual([]);
  });

import { expect, test, type Page } from '@playwright/test';

// #6249: a batch of this tab is drawn at once and stays drawn until the page's own view shows it.
// The live page resolves a batch when its commit is admitted, a little before it publishes the view
// that shows it, so a block added by Enter (or removed by Delete) went away and came back when the
// page dropped the batch on that resolve. `delayViews` is that gap, made long enough to see.
async function mountFixture(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount('plan');
  });
  return page.locator('#structured-page-fixture');
}

/** What the page draws, every time it changes: each block's text, in order. */
async function watchBlocks(page: Page) {
  await page.evaluate(() => {
    const host = document.getElementById('structured-page-fixture')!;
    const seen: string[][] = [];
    (window as unknown as { seen: string[][] }).seen = seen;
    let last = '';
    const tick = () => {
      const now = [...host.querySelectorAll('[data-block-id]')].map((b) => b.textContent ?? '');
      const key = JSON.stringify(now);
      if (key !== last) seen.push(now);
      last = key;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const drawn = (page: Page) => page.evaluate(() => (window as unknown as { seen: string[][] }).seen);

test('Enter at the end of a block draws the new block once and keeps it while the view is late', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  await host.locator('[data-block-id="p"] [contenteditable="true"]').press('End');
  await page.evaluate(() => window.delayViews(500));
  await watchBlocks(page);
  await page.keyboard.press('Enter');
  await expect(host.locator('[data-block-id]')).toHaveCount(5);
  // The serve commits (120 ms) and the view arrives (500 ms later): the block stays all along.
  await page.waitForTimeout(1000);
  const counts = (await drawn(page)).map((blocks) => blocks.length);
  expect(counts.at(-1)).toBe(5);
  expect(counts.slice(counts.indexOf(5))).not.toContain(4);
});

test('Enter in the middle of a block splits it once and keeps the split while the view is late', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('Home');
  for (let i = 0; i < 4; i++) await editor.press('ArrowRight');
  await page.evaluate(() => window.delayViews(500));
  await watchBlocks(page);
  await page.keyboard.press('Enter');
  await expect(host.locator('[data-block-id]')).toHaveCount(5);
  await page.waitForTimeout(1000);
  const seen = await drawn(page);
  const split = seen.findIndex((blocks) => blocks.includes('Ship'));
  expect(split).toBeGreaterThanOrEqual(0);
  // After the split is drawn, the uncut text never comes back.
  expect(seen.slice(split).filter((blocks) => blocks.includes('Ship the stack.'))).toEqual([]);
  expect(seen.at(-1)).toContain('Ship');
});

test('Delete removes the block once and keeps it gone while the view is late', async ({ page }) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  await host.locator('[data-block-id="p"] [contenteditable="true"]').press('Escape');
  await page.evaluate(() => window.delayViews(500));
  await watchBlocks(page);
  await page.keyboard.press('Delete');
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
  await page.waitForTimeout(1000);
  const counts = (await drawn(page)).map((blocks) => blocks.length);
  expect(counts.at(-1)).toBe(3);
  expect(counts.slice(counts.indexOf(3))).not.toContain(4);
});

import { expect, test } from '@playwright/test';

// Work home (#6474) over the owner list: open work by status, a count that filters the project
// rows, and what got done with its owner and release.
test('Work home counts open work, filters by a status and lists what was done', async ({
  page,
}) => {
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(async () => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('work-home', '/work');
  });
  const home = page.locator('#list-fixture');
  await expect(home.getByText('8 open · 3 agents moving · 18 done in 7 days')).toBeVisible();
  await expect(home.locator('.tmt-ui-work-count')).toHaveText([
    '3In progress',
    '2Waiting for CI or release',
    '1Needs you',
    '1Blocked',
    '1Possibly stalled',
  ]);
  // Every ratio segment uses the tone of its count's dot (waiting shares the CI/release tone).
  const dot = await home
    .locator('.tmt-ui-work-count .tmt-ui-work-dot')
    .nth(1)
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const segment = await home
    .locator('.work-home-card .tmt-ui-work-ratio > span')
    .nth(1)
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(segment).toBe(dot);
  const rows = home.locator('.tmt-ui-work-row');
  await expect(rows).toHaveCount(8);
  await home.getByRole('button', { name: '1 Blocked' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('COLAB-119');
  const recent = home.locator('.work-home-recent li').first();
  await expect(recent).toContainText('Fix the mockup that would not open');
  await expect(recent).toContainText('gui-3');
  await expect(recent).toContainText('alpha.453');
});

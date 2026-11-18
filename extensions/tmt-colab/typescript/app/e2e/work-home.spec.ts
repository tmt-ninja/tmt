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

// A working agent's activity time moves on every read; that alone must not read the list again,
// and the re-read the first answer caused must not ask for activity again (#6578 review).
test('Work home reads owner activity once per event, never in a loop', async ({ page }) => {
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(async () => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('work-home', '/work');
  });
  const counts = () =>
    page.evaluate(() => ({ activity: window.__activityReads, list: window.__listReads }));
  await expect(page.locator('#list-fixture .tmt-ui-work-row').first()).toBeVisible();
  // Opening: the mount's list read, one activity read, and the list re-read its answer asked for.
  await expect.poll(counts).toEqual({ activity: 1, list: 2 });
  // The tab becoming visible reads activity again; the same states re-read nothing.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(counts).toEqual({ activity: 2, list: 2 });
});

// A row's status dot opens its details (spec 工作頁細節 › 操作); the title still opens the page.
test('a Work home row shows status details from its dot and opens its page from its title', async ({
  page,
}) => {
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(async () => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('work-home', '/work');
  });
  const home = page.locator('#list-fixture');
  await home.getByRole('button', { name: 'COLAB-143, show status details' }).click();
  const details = page.locator('.work-status-details');
  await expect(details).toContainText('In progress');
  await expect(details).toContainText('PR #6470');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  // The owner opens the Ops conversation by identity; Ops resolves the squad (#6474).
  await expect(home.getByRole('link', { name: 'Talk to gui-3 in Ops' }).first()).toHaveAttribute(
    'href',
    /^\/ops\/#dm\/[0-9a-f-]{36}$/,
  );
  await home.getByRole('link', { name: 'Mockup toolbar has no spacing' }).click();
  await expect(page).toHaveURL(/#\/pages\/|\/pages\//);
});

// The view lives in the URL (#6612): a filter, a page opened from it and Back restore the filter.
test('Work home keeps its filters in the URL, so Back from a page restores them', async ({
  page,
}) => {
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(async () => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('work-home', '/work');
  });
  const home = page.locator('#list-fixture');
  const rows = home.locator('.tmt-ui-work-row');
  await expect(rows).toHaveCount(8);
  await home.getByRole('button', { name: '1 Blocked' }).click();
  await home.getByRole('button', { name: '30 days' }).click();
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/status=blocked/);
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/pages\//);
  await page.goBack();
  await expect(rows).toHaveCount(1);
  await expect(home.getByRole('button', { name: '1 Blocked' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(home.getByRole('button', { name: '30 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Back again undoes one choice at a time.
  await page.goBack();
  await expect(home.getByRole('button', { name: '30 days' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.goBack();
  await expect(rows).toHaveCount(8);
});

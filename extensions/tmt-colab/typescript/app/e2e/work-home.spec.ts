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
  await expect(rows.filter({ hasText: 'OPS-33' }).locator('.tmt-ui-work-next')).toHaveText(
    'Waiting on a PR · Review PR #6461',
  );
  // Sections are progress (#6619): a page with sections shows one bar and one number, and its
  // details name the stuck section.
  const sectioned = rows.filter({ hasText: 'COLAB-140' });
  await expect(sectioned.getByRole('img', { name: '4 of 9 sections done' })).toBeVisible();
  await expect(sectioned.locator('.work-home-sections')).toHaveText('4/9');
  await sectioned.locator('.work-home-row-status').click();
  const details = page.locator('.work-status-details');
  await expect(details).toContainText('Needs you: stuck at the section “Decisions”.');
  await expect(details.locator('.work-home-section-details li')).toHaveCount(9);
  await page.keyboard.press('Escape');
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
for (const width of [390, 1440])
  test(`Work home keeps its filters in the URL at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
    await page.evaluate(async () => {
      const path = '/test/page-list-browser.tsx';
      await (await import(path)).mountPageList('work-home', '/colab/work');
    });
    const home = page.locator('#list-fixture');
    const rows = home.locator('.tmt-ui-work-row');
    await expect(rows).toHaveCount(8);
    await home.getByRole('button', { name: '3 In progress' }).click();
    await home.getByRole('button', { name: '30 days' }).click();
    await expect(rows).toHaveCount(3);
    await expect(page).toHaveURL(/status=working/);
    await home.getByRole('link', { name: 'Mockup toolbar has no spacing' }).click();
    await expect(page).toHaveURL(/\/pages\//);
    await page.goBack();
    await expect(rows).toHaveCount(3);
    await expect(home.getByRole('button', { name: '3 In progress' })).toHaveAttribute(
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
    await page.goForward();
    await expect(rows).toHaveCount(3);
    await expect(page).toHaveURL(/status=working/);
  });

async function mountOrder(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const path = '/test/page-list-browser.tsx';
    await (await import(path)).mountPageList('work-order', '/colab/work?project=Colab');
  });
}

test('keyboard reorder survives reload when the list omits the project order', async ({ page }) => {
  await page.goto('/');
  await mountOrder(page);
  const next = page.getByRole('region', { name: 'Next', exact: true });
  const rows = next.locator('[data-order-key]');
  await expect(rows).toHaveCount(8);
  await rows.nth(1).getByRole('button', { name: 'Move up' }).press('Enter');
  await expect(rows.first()).toContainText('Queued item 2');
  await expect(rows.first()).toBeFocused();
  await expect(rows.first().locator('.tmt-ui-work-rank')).toHaveText('1');
  await expect(
    page.getByRole('status').filter({ hasText: 'Queued item 2 moved to position 1.' }),
  ).toBeVisible();
  await page.reload();
  await mountOrder(page);
  await expect(rows.first()).toContainText('Queued item 2');
  expect(await page.evaluate(() => sessionStorage.getItem('fixture-notifications'))).toBeNull();
  // At 1440, 1280 and 1024 a hovered row's actions cover its trailing facts whole: no fact shows between or
  // around the buttons (#6688).
  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await rows.first().hover();
    const actions = rows.first().locator('.work-order-actions');
    await expect(actions).toHaveCSS('opacity', '1');
    const covered = await actions.evaluate((box) => {
      const row = box.closest('[data-order-key]')!.getBoundingClientRect();
      const own = box.getBoundingClientRect();
      const buttons = [...box.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      const first = buttons[0]!;
      // Every point across the buttons' band, gaps included, is the actions' own.
      const band: boolean[] = [];
      for (let x = first.left; x < own.right; x += 4)
        for (const y of [row.top + 2, (row.top + row.bottom) / 2, row.bottom - 2])
          band.push(box.contains(document.elementFromPoint(x, y)));
      return {
        fullHeight: Math.abs(own.top - row.top) <= 1.5 && Math.abs(own.bottom - row.bottom) <= 1.5,
        band: band.every(Boolean),
      };
    });
    expect(covered, `${width}`).toEqual({ fullHeight: true, band: true });
    await page.screenshot({ path: test.info().outputPath(`order-hover-${width}.png`) });
  }
  // A Remove that loses to another device's change says so, and the list shows the order as stored.
  await page.evaluate(() => {
    const order = JSON.parse(sessionStorage.getItem('fixture-order')!);
    sessionStorage.setItem(
      'fixture-order',
      JSON.stringify({ revision: order.revision + 1, items: order.items.slice(0, 7) }),
    );
  });
  const first = await rows.first().getAttribute('data-order-key');
  await rows.first().getByRole('button', { name: 'Remove from Next' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'The order changed on another device. Review it and try again.' }),
  ).toBeVisible();
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toHaveAttribute('data-order-key', first!);
});

test('Notify sends once to each explicitly chosen recipient', async ({ page }) => {
  await page.goto('/');
  await mountOrder(page);
  const next = page.getByRole('region', { name: 'Next', exact: true });
  await next.locator('[data-order-key]').nth(1).hover();
  await next.locator('[data-order-key]').nth(1).getByRole('button', { name: 'Move up' }).click();
  await expect(next.locator('[data-order-key]').first()).toContainText('Queued item 2');
  await page.getByRole('button', { name: 'Notify' }).click();
  const card = page.getByRole('dialog', { name: 'Recipients' });
  await expect(card.locator('blockquote')).toHaveText(
    'The work order for Colab has changed. Please arrange your work in the current order.',
  );
  await expect(page.getByRole('checkbox', { name: /Ada/ })).toBeChecked();
  const bea = page.getByRole('checkbox', { name: /Bea/ });
  await expect(bea).toBeChecked();
  await bea.uncheck();
  expect(await page.evaluate(() => sessionStorage.getItem('fixture-notifications'))).toBeNull();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await send.click();
  await expect(send).toBeDisabled();
  await expect(card.getByRole('status')).toHaveText('Sent');
  const messages = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('fixture-notifications') ?? '[]'),
  );
  expect(messages).toHaveLength(1);
  expect(messages[0].agentId).toBe('c0000501-1111-4111-8111-000000000001');
  expect(messages[0].message).toBe(
    'The work order for Colab has changed. Please arrange your work in the current order.\n' +
      new URL('/colab/work?project=Colab', page.url()).href,
  );
});

test('Notify stops after the first verified talk refusal', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('fixture-talk-denied', 'true'));
  await mountOrder(page);
  await page.getByRole('button', { name: 'Notify' }).click();
  const card = page.getByRole('dialog', { name: 'Recipients' });
  for (const name of ['Ada', 'Bea']) await card.getByRole('checkbox', { name }).check();
  const send = card.getByRole('button', { name: 'Send', exact: true });
  await send.click();
  await expect(card.locator('label').filter({ hasText: 'Ada' })).toContainText('Not allowed');
  await expect(
    card.getByText(
      'This browser is not allowed to send to agents. Turn sending on in Remote settings, or pair with talk.',
    ),
  ).toBeVisible();
  await expect(send).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-notifications')!)),
  ).toHaveLength(1);
});

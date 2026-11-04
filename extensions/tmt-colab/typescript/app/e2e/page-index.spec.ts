import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { capturePath } from './captures.js';

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const) {
    test(`pages index lists newest first with title ties and a menu for archived pages: ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
      await page.evaluate(async () => {
        const path = '/test/page-index-browser.tsx';
        await (await import(path)).mountPageIndex('few');
      });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const fixture = page.locator('#index-fixture');
      const rows = fixture.locator('.page-list-table [data-page-id]');
      await expect(rows).toHaveCount(3);
      expect(
        await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id'))),
      ).toEqual([
        'c0000002-1111-4111-8111-000000000001',
        'c0000003-1111-4111-8111-000000000001',
        'c0000001-1111-4111-8111-000000000001',
      ]);
      await expect(rows.locator('.tmt-ui-list-title')).toHaveText([
        'Alpha update',
        'Beta update',
        'Older notes',
      ]);
      const first = rows.first();
      await expect(first.locator('time')).toHaveText('1 hour ago');
      await expect(first.locator('time')).toHaveAttribute('datetime', '2026-10-08T23:00:00.000Z');
      await expect(first.locator('time')).toHaveAttribute('title', /2026/);
      if (width > 760) await expect(first.locator('[data-role=access]')).toContainText('Shared');
      // The shared grid uses roving row focus; keyboard movement and the menu retain focus.
      await first.focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(first).toBeFocused();
      const actions = first.getByRole('button', { name: /^More for/ });
      await actions.focus();
      await expect(actions).toBeFocused();
      await actions.click();
      await expect(page.getByRole('menuitem', { name: 'Manage…' })).toBeVisible();
      await expect(page.getByRole('menu').locator('.retention-hint')).toBeVisible();
      if (width <= 760) await expect(page.getByRole('menu')).toContainText('Access: Shared');
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              (window as unknown as { copiedId: string }).copiedId = value;
            },
          },
        });
      });
      const copy = page.getByRole('menuitem', { name: 'Copy page ID' });
      await copy.evaluate((node: HTMLElement) => node.click());
      expect(
        await page.evaluate(() => (window as unknown as { copiedId?: string }).copiedId),
      ).toBeUndefined();
      await copy.click();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { copiedId?: string }).copiedId))
        .toBe('c0000002-1111-4111-8111-000000000001');
      await actions.click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(first).toBeFocused();
      await page.screenshot({ path: await capturePath(`2168-few-${width}-${theme}.png`) });
      await fixture.getByRole('tab', { name: /^Archived/ }).click();
      await expect(rows).toHaveCount(2);
      await expect(rows.locator('.tmt-page-list-stage')).toHaveText(['Archived', 'Archived']);
      await expect(rows.getByRole('link')).toHaveCount(2);
      await expect(
        rows.first().getByRole('link', { name: 'Archived notes', exact: true }),
      ).toHaveAttribute('href', '/#/pages/c0000004-1111-4111-8111-000000000001');
      await expect(rows.last().locator('time')).toHaveCount(0);
      await expect(rows.last().locator('[data-role=time] time')).toHaveCount(0);
      await page.screenshot({ path: await capturePath(`2168-archived-${width}-${theme}.png`) });
    });

    test(`200 rows draw 50 at a time in the shared Home viewport: ${width}px ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
      await page.evaluate(async () => {
        const path = '/test/page-index-browser.tsx';
        await (await import(path)).mountPageIndex('many');
      });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const rows = page.locator('#index-fixture .page-list-table [data-page-id]');
      const count = page.locator('#index-fixture [data-page-list-count]').first();
      const list = page.locator('#index-fixture [data-page-list]');
      const search = page.locator('#index-fixture .page-list-search');
      await expect(rows).toHaveCount(50);
      await expect(count).toHaveText('200 pages in this view');
      await expect(rows.first().getByRole('link')).toHaveText('Page 001');
      await expect(rows.first()).toHaveCSS('box-shadow', 'none');
      await expect(rows.nth(1)).toHaveCSS('border-top-width', '1px');
      await page.screenshot({ path: await capturePath(`2168-many-${width}-${theme}.png`) });
      const searchTop = (await search.boundingBox())!.y;
      // Each time the list's end comes near, it draws the next 50, until every row is drawn.
      for (const drawn of [100, 150, 200]) {
        await list.evaluate((node) => (node.scrollTop = node.scrollHeight));
        await expect(rows).toHaveCount(drawn);
      }
      await expect(count).toHaveText('200 pages in this view');
      await list.evaluate((node) => (node.scrollTop = node.scrollHeight));
      await expect(rows.last().getByRole('link')).toBeInViewport();
      await expect(rows.last().getByRole('link')).toHaveText('Page 200');
      expect((await search.boundingBox())!.y).toBeLessThan(searchTop);
      expect((await page.locator('.tmt-ui-topbar:visible').boundingBox())!.y).toBe(0);
      const scroll = await page.evaluate(() => {
        const visible = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(
          (node) => node.getClientRects().length,
        );
        return {
          window: document.documentElement.scrollHeight > innerHeight,
          horizontal: document.documentElement.scrollWidth > innerWidth,
          nested: visible
            .filter(
              (node) =>
                /^(auto|scroll)$/.test(getComputedStyle(node).overflowY) &&
                node.scrollHeight > node.clientHeight + 1,
            )
            .map((node) => node.className),
          fixed: visible
            .filter((node) => /^(fixed|sticky)$/.test(getComputedStyle(node).position))
            .map((node) => node.className),
        };
      });
      // Home remains the only scroll viewport. Its controls now stick below the shell chrome;
      // this adds no nested scroller and does not make the document scroll.
      expect(scroll).toEqual({
        window: false,
        horizontal: false,
        nested: ['home tmt-ui-page'],
        fixed:
          width < 480
            ? // The phone's menu button sits in the shared bar now, not fixed on its own.
              [
                'tmt-ui-shell-bar',
                'tmt-page-list-controls page-list-controls',
                'tmt-data-table-head',
              ]
            : [
                'tmt-ui-rail',
                'tmt-ui-shell-brand',
                'tmt-ui-shell-bar',
                'tmt-page-list-controls page-list-controls',
                'tmt-data-table-head',
              ],
      });
    });
  }

test('website rows keep symmetric insets and control size while columns stack at 390', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/page-index-browser.tsx';
    await (await import(path)).mountPageIndex('few');
  });
  const row = page.locator('#index-fixture .page-list-table [data-page-id]').first();
  await expect(row).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const measures = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    measures.push(
      await row.evaluate((node) => {
        const title = node.querySelector('.tmt-ui-list-title')!.getBoundingClientRect();
        const meta = node.querySelector('time')!.getBoundingClientRect();
        const action = node
          .querySelector('[data-role=actions] button[aria-haspopup=menu]')!
          .getBoundingClientRect();
        return {
          height: node.getBoundingClientRect().height,
          padding: [
            getComputedStyle(node.querySelector('[data-role=primary]')!).paddingLeft,
            getComputedStyle(node.querySelector('[data-role=actions]')!).paddingRight,
          ],
          rule: getComputedStyle(node.parentElement!.children[1]!).borderTopWidth,
          action: [action.width, action.height],
          stacked: meta.top >= title.bottom,
          separateColumn: meta.left >= title.right,
          contained: node.scrollWidth <= node.clientWidth,
        };
      }),
    );
  }
  await writeFile(capturePath('2168-row-geometry.json'), JSON.stringify(measures, null, 2));
  // Each shared cell keeps equal start/end insets, with the same row rule at both widths.
  expect(measures[0].padding).toEqual(['8px', '8px']);
  // The phone selection track supplies the start inset; the action cell retains the end inset.
  expect(measures[1].padding).toEqual(['0px', '8px']);
  for (const measure of measures) expect(measure.rule).toBe('1px');
  expect(measures[0].action).toEqual(measures[1].action);
  for (const measure of measures) {
    expect(measure.height).toBeGreaterThanOrEqual(32);
    expect(measure.contained).toBe(true);
  }
  expect(measures[0].separateColumn).toBe(true);
  expect(measures[0].stacked).toBe(false);
  expect(measures[1].stacked).toBe(true);
  expect(measures[1].separateColumn).toBe(false);
});

test('static toggle markup keeps its symmetric inset when the obsolete host token is set', async ({
  page,
}) => {
  const leaf = new URL('../../../../../design/browser-ui/', import.meta.url);
  const html = await readFile(new URL('test/fixtures/static.html', leaf), 'utf8');
  await page.route('**/leaf-controls/', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**/generated/static.css', async (route) =>
    route.fulfill({
      contentType: 'text/css',
      body: await readFile(new URL('generated/static.css', leaf), 'utf8'),
    }),
  );
  await page.route('**/leaf-controls/controls.css', async (route) =>
    route.fulfill({
      contentType: 'text/css',
      body: await readFile(new URL('test/fixtures/controls.css', leaf), 'utf8'),
    }),
  );
  await page.route('**/leaf-controls/static.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.goto('/leaf-controls/');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--tmt-ui-host-toggle-padding', '0');
  });
  for (const toggle of await page.locator('.tmt-ui-toggle').all()) {
    for (const side of ['top', 'right', 'bottom', 'left'])
      await expect(toggle).toHaveCSS(`padding-${side}`, '8px');
  }
  await expect(page.locator('.tmt-ui-toggle')).toHaveCount(2);
});

test('metadata order follows update timestamps before English title ties', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/page-index-browser.tsx';
    await (await import(path)).mountPageIndex('few');
  });
  const rows = page.locator('#index-fixture .page-list-table [data-page-id]');
  await expect(rows).toHaveCount(3);
  expect(
    await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id'))),
  ).toEqual([
    'c0000002-1111-4111-8111-000000000001',
    'c0000003-1111-4111-8111-000000000001',
    'c0000001-1111-4111-8111-000000000001',
  ]);
});

test('an out-of-range update omits unknown metadata and never fabricates a time element', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/page-index-browser.tsx';
    await (await import(path)).mountPageIndex('few', Number.MAX_SAFE_INTEGER);
  });
  await page.getByRole('tab', { name: /^Archived/ }).click();
  const row = page.locator('#index-fixture [data-page-id="c0000005-1111-4111-8111-000000000001"]');
  await expect(row.locator('[data-role=time] time')).toHaveCount(0);
  await expect(row.locator('time')).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Untitled page', exact: true })).toHaveAttribute(
    'href',
    '/#/pages/c0000005-1111-4111-8111-000000000001',
  );
  await expect(row.getByText('Untitled page', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: /^More for/ })).toHaveAccessibleName(
    'More for Untitled page',
  );
});

test('the first committed index render uses the actual time snapshot', async ({ page }) => {
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(async () => {
    const path = '/test/page-index-browser.tsx';
    await (await import(path)).mountPageIndex('few');
  });
  await expect(page.locator('#index-fixture .page-list-table [data-page-id]')).toHaveCount(3);
  const initialLabels = await page.evaluate(async () => {
    const path = '/test/page-index-browser.tsx';
    return (await import(path)).firstUpdateLabels();
  });
  expect(initialLabels).toEqual(['1 hour ago', '1 hour ago', '3 days ago']);
});

test('Home fills only uncached visible title rows, including under StrictMode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/page-index-browser.tsx';
    const { mountPageIndex } = await import(path);
    await mountPageIndex('missing');
  });
  const rows = page.locator('#index-fixture [data-page-id]');
  await expect(rows).toHaveCount(30);
  await expect(rows.first().getByRole('link')).toHaveText('Cached title');
  const reads = () =>
    page.evaluate(async () => {
      const path = '/test/page-index-browser.tsx';
      return (await import(path)).titleReadCalls() as { id: string; visible: boolean }[];
    });
  await expect.poll(async () => (await reads()).length).toBeGreaterThan(0);
  const initial = await reads();
  const cachedId = await rows.first().getAttribute('data-page-id');
  const lastId = await rows.last().getAttribute('data-page-id');
  expect(initial.every((read) => read.visible)).toBe(true);
  expect(initial.some((read) => read.id === cachedId || read.id === lastId)).toBe(false);
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last().getByRole('link')).toHaveText(`Loaded ${lastId}`);
  const completed = await reads();
  expect(completed.every((read) => read.visible && read.id !== cachedId)).toBe(true);
  expect(new Set(completed.map((read) => read.id)).size).toBe(completed.length);
  expect(completed.length).toBeLessThanOrEqual(24);
});

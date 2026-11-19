import { expect, test, type Locator, type Page } from '@playwright/test';
import { capturePath } from './captures.js';

/** How many characters of a title, from the text node starting with `start`, show before the
 * nearest clipping box cuts them. */
const shownChars = (title: Locator, start: string) =>
  title.evaluate((element, start) => {
    let clip = element.getBoundingClientRect().right;
    for (
      let at: Element | null = element;
      at && at.getAttribute('role') !== 'row';
      at = at.parentElement
    )
      if (getComputedStyle(at).overflowX !== 'visible')
        clip = Math.min(clip, at.getBoundingClientRect().right);
    const text =
      [...element.childNodes].find((node) => node.textContent?.startsWith(start)) ?? element;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let count = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      for (let i = 0; i < node.textContent!.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        if (range.getBoundingClientRect().right > clip + 0.5) return count;
        count++;
      }
    return count;
  }, start);

/**
 * The page list's column layout in pixels (#6665): each fitted column's width beside what its
 * widest content (or header) needs, the title track, and the width the other tracks leave it.
 */
const titleLayout = (root: Locator) =>
  root.locator('.tmt-data-table-grid').evaluate((table) => {
    const head = table.querySelector('.tmt-data-table-head')!;
    const headers = [...head.querySelectorAll('[role="columnheader"]')];
    const rows = [...table.querySelectorAll('.tmt-data-table-row')];
    /** What a cell's content needs: its content's right edge plus the end padding. */
    const needs = (cell: Element | undefined) => {
      if (!cell) return 0;
      const range = document.createRange();
      range.selectNodeContents(cell);
      const content = range.getBoundingClientRect();
      if (!content.width) return 0;
      return (
        content.right -
        cell.getBoundingClientRect().left +
        Number.parseFloat(getComputedStyle(cell).paddingRight)
      );
    };
    const fitted = headers
      .filter((header) => header.hasAttribute('data-fit'))
      .map((header) => ({
        name: header.textContent,
        width: header.getBoundingClientRect().width,
        // Each fitted column of the page list has its own role.
        needs: Math.max(
          needs(header),
          ...rows.map((row) =>
            needs(
              row.querySelector(
                `[role="gridcell"][data-role="${header.getAttribute('data-role')}"]`,
              ) ?? undefined,
            ),
          ),
        ),
      }));
    const title = headers.find((header) => header.getAttribute('data-role') === 'primary')!;
    const others = headers
      .filter((header) => header !== title)
      .reduce((sum, header) => sum + header.getBoundingClientRect().width, 0);
    return {
      fitted,
      title: title.getBoundingClientRect().width,
      rest: head.getBoundingClientRect().width - others,
    };
  });

async function mount(
  page: Page,
  width: number,
  theme: 'light' | 'dark',
  size: 'work' | 'work-pinned' | 'none' | 'unmanaged' | 'titles' = 'work-pinned',
  hash = '/',
) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto('/');
  await page.clock.setFixedTime(new Date('2026-10-09T00:00:00Z'));
  await page.evaluate(
    async ({ theme, size, hash }) => {
      document.documentElement.dataset.theme = theme;
      const path = '/test/page-list-browser.tsx';
      const fixture = await import(path);
      await fixture.mountPageList(size, hash);
    },
    { theme, size, hash },
  );
  await expect(page.locator('#list-fixture [data-page-list]')).toBeVisible();
}

for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`page-list shared parts and states at ${width} ${theme}`, async ({ page }) => {
      const root = page.locator('#list-fixture');
      await mount(page, width, theme);
      await expect(root.getByRole('grid', { name: 'Pages' })).toBeVisible();
      const quickActions = root.locator('.tmt-data-table-actions button');
      expect(await quickActions.count()).toBeGreaterThan(0);
      for (const action of await quickActions.all())
        await expect(action).toHaveAttribute('tabindex', '-1');
      await expect(root.getByRole('tablist', { name: 'Page views' })).toBeVisible();
      const mixed = root.getByRole('row').filter({ hasText: '夜のレビュー' });
      const long = root.getByRole('row').filter({ hasText: 'A deliberately long page title' });
      if (width === 390) {
        await mixed.getByRole('button', { name: /^More for/ }).click();
        await expect(page.getByText('Access: Shared')).toBeVisible();
        await page.getByRole('menuitem', { name: 'Projects…', exact: true }).click();
        await expect(page.getByRole('menuitemcheckbox').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await root.locator('[data-page-list]').evaluate((node) => (node.scrollTop = 0));
      } else await expect(mixed).toContainText('Shared');
      await expect(mixed.locator('.tmt-data-table-sub')).toHaveText('');
      await expect(
        root
          .getByRole('row')
          .filter({ has: page.getByRole('checkbox', { name: 'Select Review 2', exact: true }) }),
      ).toContainText('Needs you · 3');
      await expect(long.locator('.tmt-page-list-project-overflow')).toHaveText('+2');
      await expect(long.locator('.tmt-page-list-project-overflow')).toHaveCSS(
        'border-top-width',
        '1px',
      );
      const pinnedLong = root
        .locator('.tmt-page-list-pin a')
        .filter({ hasText: 'A deliberately long page title' });
      expect(
        await pinnedLong.evaluate(
          (node) =>
            node.scrollWidth > node.clientWidth &&
            getComputedStyle(node).textOverflow === 'ellipsis',
        ),
      ).toBe(true);
      await expect(long.locator('.tmt-data-table-sub')).toHaveText('');
      if (width === 1440) {
        // The title column gives way last (#6646): at 1280 the long title beside its work number
        // shows at least its first 24 characters before the ellipsis.
        await page.setViewportSize({ width: 1280, height: 900 });
        const shown = await shownChars(long.locator('.tmt-ui-list-title'), 'A deliberately');
        expect(shown).toBeGreaterThanOrEqual(24);
        await page.setViewportSize({ width, height: 900 });
      }
      expect(
        await long
          .locator('.tmt-ui-list-title')
          .evaluate(
            (node) =>
              node.scrollWidth > node.clientWidth &&
              getComputedStyle(node).textOverflow === 'ellipsis',
          ),
      ).toBe(true);
      await expect(root.locator('.tmt-page-list-tabs-row')).not.toHaveCSS('box-shadow', 'none');
      expect(
        await root
          .locator('.tmt-page-list-tabs-row')
          .evaluate((node) =>
            Math.abs(
              node.getBoundingClientRect().width -
                node.parentElement!.getBoundingClientRect().width,
            ),
          ),
      ).toBeLessThanOrEqual(1);
      await expect(
        root.locator('.page-list-filter-menu svg.lucide-list-filter:visible'),
      ).toHaveCount(1);
      await expect(root.locator('.page-list-sort svg.lucide-arrow-down-up:visible')).toHaveCount(1);
      if (width === 1440) {
        await expect(root.locator('.page-list-sort button')).toHaveText('Sort');
        await expect(
          root.locator('.page-list-filter-menu .tmt-ui-menu-trigger > .tmt-ui-icon'),
        ).toBeHidden();
        await expect(
          root.locator('.page-list-sort .tmt-ui-menu-trigger > .tmt-ui-icon'),
        ).toBeHidden();
      }
      const rowFont = await long
        .locator('.tmt-page-list-project')
        .first()
        .evaluate((node) => getComputedStyle(node).fontFamily);
      const pinFont = await root
        .locator('.tmt-page-list-pin .tmt-page-list-project')
        .first()
        .evaluate((node) => getComputedStyle(node).fontFamily);
      expect(rowFont).not.toBe(pinFont);
      await page.screenshot({ path: await capturePath(`5972-filled-${width}-${theme}.png`) });
      await root.getByRole('checkbox', { name: 'Select Review 2', exact: true }).check();
      await expect(root.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
      await page.screenshot({ path: await capturePath(`5972-selected-${width}-${theme}.png`) });
      if (width === 1440) {
        // The other columns take only what their content needs, the title the rest (#6665). In
        // pixels, so it holds on any runner's fonts: on a list of sixty real-looking titles each
        // fitted column is no wider than its widest cell content or its header, and the title
        // track is everything else.
        await mount(page, width, theme, 'titles');
        const author = root.getByRole('columnheader', { name: 'Author' });
        expect(
          await author.evaluate((node) => {
            const label = node.querySelector('.tmt-data-table-text')!;
            return label.scrollWidth <= label.clientWidth;
          }),
        ).toBe(true);
        for (const at of [1440, 1280]) {
          await page.setViewportSize({ width: at, height: 900 });
          const layout = await titleLayout(root);
          expect(layout.fitted.map((column) => column.name)).toEqual([
            'Project',
            'Stage',
            'Updated',
            'Author',
            'Access',
          ]);
          for (const column of layout.fitted)
            expect(column.width, `${column.name} at ${at}`).toBeLessThanOrEqual(column.needs + 2);
          expect(Math.abs(layout.title - layout.rest)).toBeLessThanOrEqual(2);
          // On main the title track here is 320px at 1440, its #6646 ideal, while the other
          // columns grow to their caps; with this change it is about 530px on macOS Chromium.
          if (at === 1440) expect(layout.title).toBeGreaterThanOrEqual(450);
        }
        await page.setViewportSize({ width, height: 900 });
      }
      await mount(page, width, theme, 'none');
      await expect(root.getByText('No pages yet', { exact: true })).toBeVisible();
      await page.screenshot({ path: await capturePath(`5972-empty-${width}-${theme}.png`) });
      await mount(page, width, theme, 'work', '/?q=no-such-page');
      await expect(root.getByText('No pages match', { exact: true })).toBeVisible();
      await page.screenshot({
        path: await capturePath(`5972-filtered-empty-${width}-${theme}.png`),
      });
      await mount(page, width, theme, 'unmanaged');
      const readOnly = root.getByRole('row').filter({ hasText: 'Alpha plan' });
      await expect(readOnly.getByRole('checkbox', { name: 'Select Alpha plan' })).toBeDisabled();
      await expect(readOnly).toContainText('Read-only');
      if (width === 1440) {
        // #6015: the Access cell shows the whole label, not "Read-o…".
        const label = readOnly.locator('.tmt-data-table-text').filter({ hasText: 'Read-only' });
        expect(await label.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      const searchBox = root.locator('.page-list-search-box > .tmt-rich-input');
      await expect(searchBox).toHaveCSS('border-top-width', '1px');
      expect((await searchBox.boundingBox())!.height).toBeGreaterThanOrEqual(32);

      await page.screenshot({ path: await capturePath(`5972-read-only-${width}-${theme}.png`) });
      await readOnly.getByRole('button', { name: /^More for/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Copy page ID' })).toBeEnabled();
      await expect(page.getByRole('menu').locator('.retention-hint')).toBeVisible();
      await page.keyboard.press('Escape');
    });
  }

for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const)
    test(`home pending and retry at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/');
      await page.evaluate(async (theme) => {
        document.documentElement.dataset.theme = theme;
        const path = '/test/page-list-browser.tsx';
        const fixture = await import(path);
        fixture.holdHome();
        await fixture.mountPageList('few', '/', undefined, true, 'network');
      }, theme);
      const app = page.locator('#list-fixture');
      const tabs = app.getByRole('tablist', { name: 'Page views' });
      await expect(tabs.getByRole('tab')).toHaveCount(6);
      for (const name of ['All', 'Needs you', 'Discussion', 'In progress', 'Done', 'Archived'])
        await expect(tabs.getByRole('tab', { name, exact: true })).toBeDisabled();
      await expect(app.getByRole('combobox', { name: 'Search pages' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await expect(app.getByRole('button', { name: 'Filter' })).toBeDisabled();
      await expect(app.getByRole('button', { name: 'Sort' })).toBeDisabled();
      await expect(app.getByRole('button', { name: 'New page' })).toBeDisabled();
      await expect(app.getByRole('list', { name: 'Pinned pages' })).toHaveCount(0);
      await expect(app.getByLabel('Loading pages')).toBeVisible();
      await expect(app.getByLabel('Loading pages').locator('[data-slot=skeleton]')).toHaveCount(6);
      await page.screenshot({ path: await capturePath(`5972-loading-${width}-${theme}.png`) });
      await page.evaluate(async () => {
        const path = '/test/page-list-browser.tsx';
        (await import(path)).releaseHome();
      });
      const heading = app.getByText('Could not load pages');
      await expect(heading).toBeVisible();
      await expect(app.getByRole('tablist', { name: 'Page views' }).getByRole('tab')).toHaveCount(
        6,
      );
      await expect(app.getByRole('button', { name: 'Filter' })).toBeDisabled();
      await expect(app.getByRole('button', { name: 'Sort' })).toBeDisabled();
      const create = app.getByRole('button', { name: 'New page' });
      await expect(create).toBeEnabled();
      await create.evaluate((element: HTMLElement) => element.click());
      await expect(app.getByRole('dialog', { name: 'New page' })).toHaveCount(0);
      await create.click();
      const createDialog = app.getByRole('dialog', { name: 'New page' });
      await expect(createDialog).toContainText('tmt colab page create');
      await createDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(create).toBeFocused();
      const headerBox = (await app.locator('header').first().boundingBox())!;
      const tabList = app.getByRole('tablist', { name: 'Page views' });
      await expect(tabList).toBeVisible();
      const visibility = await tabList.evaluate((node) => {
        const chain = [];
        for (
          let current: HTMLElement | null = node as HTMLElement;
          current;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          chain.push({
            tag: current.tagName,
            opacity: style.opacity,
            visibility: style.visibility,
            display: style.display,
          });
        }
        return chain;
      });
      expect(
        visibility.every(
          (entry) =>
            Number(entry.opacity) > 0 && entry.visibility === 'visible' && entry.display !== 'none',
        ),
        JSON.stringify(visibility),
      ).toBe(true);
      const tabVisible = await tabList
        .getByRole('tab', { name: 'All', exact: true })
        .evaluate((node) => {
          const box = node.getBoundingClientRect();
          const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            clear: top === node || node.contains(top) || top === node.closest('[role=tablist]'),
            top: top?.outerHTML.slice(0, 400),
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
          };
        });
      expect(tabVisible.clear, JSON.stringify(tabVisible)).toBe(true);
      const tabBox = (await tabList.boundingBox())!;
      const searchBox = (await app.getByRole('combobox', { name: 'Search pages' }).boundingBox())!;
      expect(tabBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
      expect(searchBox.y).toBeGreaterThanOrEqual(tabBox.y + tabBox.height);
      const headingBox = (await heading.boundingBox())!;
      expect(headingBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
      await page.screenshot({ path: await capturePath(`5972-error-${width}-${theme}.png`) });
      await app.getByRole('button', { name: 'Try again' }).click();
      await expect(app.getByRole('grid', { name: 'Pages' })).toBeVisible();
    });

for (const failure of ['admission', 'session'] as const) {
  test(`home ${failure} failure keeps the existing root recovery view`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (kind) => {
      const path = '/test/page-list-browser.tsx';
      await (await import(path)).mountPageList('few', '/', undefined, true, kind);
    }, failure);
    const app = page.locator('#list-fixture');
    await expect(app.getByText('Could not load pages')).toHaveCount(0);
    await expect(app.getByRole('button', { name: /Try again|Retry/i }).first()).toBeVisible();
  });
}

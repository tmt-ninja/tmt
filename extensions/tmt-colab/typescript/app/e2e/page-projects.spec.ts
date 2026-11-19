import { expect, test, type Page } from '@playwright/test';
import { text } from '../src/strings.js';
import { capturePath } from './captures.js';
import { backToPageList } from '../test/home-list.js';
import { pageAction } from '../test/page-actions.js';

/**
 * The page's own projects (#4116): since #6652 the top bar's labels are the one button that opens
 * the list row's picker; More → Projects… is the other entry to the same owner, and the only one
 * with no project or on a phone (where the status sheet lists them too). Pin is in More.
 */
const fixture = '/test/ask-page-browser.tsx';
const run = (page: Page, method: string, argument?: unknown) =>
  page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
const requests = (page: Page) =>
  page.evaluate(async (path) => (await import(path)).projectProof().requests, fixture) as Promise<
    { pageId: string; projects: string[] }[]
  >;
const pins = (page: Page) =>
  page.evaluate(async (path) => (await import(path)).projectProof().pins, fixture) as Promise<
    { pageId: string; pinned: boolean }[]
  >;
const reads = (page: Page) =>
  page.evaluate(
    async (path) => (await import(path)).projectProof().spaceHomeReads,
    fixture,
  ) as Promise<number>;
const proof = (page: Page) =>
  page.evaluate(async (path) => (await import(path)).projectProof(), fixture) as Promise<{
    spaceHomeReads: number;
    spaceHomeRunning: number;
    spaceHomeAborted: number;
  }>;
const names = ['alpha', 'beta', 'gamma'];

async function open(
  page: Page,
  width = 1440,
  theme: 'light' | 'dark' = 'light',
  options: {
    current?: string[];
    all?: string[];
    fail?: boolean;
    deepLink?: boolean;
    slowRead?: boolean;
    strict?: boolean;
    pinFail?: string;
  } = {},
) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/');
  await run(page, 'mount', {
    strict: options.strict,
    projects: {
      names: options.all ?? names,
      current: options.current ?? ['alpha', 'beta'],
      fail: options.fail,
      deepLink: options.deepLink,
      slowRead: options.slowRead,
      pinFail: options.pinFail,
    },
  });
  await expect(page.frameLocator('#ask-page-fixture iframe').locator('#selected')).toBeVisible();
  return page.locator('#ask-page-fixture');
}
/** The bar's project labels: one button that opens the picker (#6652). */
const labels = (page: Page) => page.locator('.tmt-ui-topbar:visible button.page-bar-labels');
const labelNames = (page: Page) => labels(page).locator('.page-bar-label');
/** The labels where they show; More → Projects… with no project and on a phone. */
async function openPicker(page: Page) {
  if (await labels(page).isVisible()) await labels(page).click();
  else await (await pageAction(page.locator('#ask-page-fixture'), 'Projects…')).click();
  await expect(page.getByRole('menuitemcheckbox').first()).toBeVisible();
}
const capture = async (page: Page, name: string) => {
  if (process.env.COLAB_CAPTURE_DIR) await page.screenshot({ path: capturePath(name) });
};
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const theme of ['light', 'dark'] as const) {
  test(`the bar's project labels open the picker under them at 1440 ${theme}`, async ({ page }) => {
    const header = await open(page, 1440, theme);
    await expect(labelNames(page)).toHaveText(['alpha', 'beta']);
    await expect(labels(page)).toHaveAccessibleName('Projects: alpha, beta. Edit projects');
    // No project chips under the title any more (#6652); the leaf anchor stays hidden.
    await expect(header.locator('.page-project-group')).toHaveCount(0);
    await expect(header.locator('.page-header-projects-anchor button')).toBeHidden();
    expect(await noOverflow(page)).toBe(true);
    await capture(page, `projects-two-labels-1440-${theme}.png`);
    await openPicker(page);
    const rows = page.getByRole('menuitemcheckbox');
    // A checked row ends in its check mark.
    await expect(rows).toHaveText(['alpha✓', 'beta✓', 'gamma']);
    await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('menuitem', { name: text.pageList.newProjectItem })).toBeVisible();
    const picker = (await page
      .locator('dialog[open]:has([role="menuitemcheckbox"])')
      .boundingBox())!;
    const bar = (await labels(page).boundingBox())!;
    expect(picker.y).toBeGreaterThanOrEqual(bar.y + bar.height - 2);
    await capture(page, `projects-picker-1440-${theme}.png`);
  });

  test(`a page in no project shows no labels and still assigns through More at 1440 ${theme}`, async ({
    page,
  }) => {
    await open(page, 1440, theme, { current: [] });
    await expect(labels(page)).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    await openPicker(page);
    await page.getByRole('menuitemcheckbox', { name: 'gamma' }).click();
    await expect(labelNames(page)).toHaveText(['gamma']);
    expect((await requests(page)).map((request) => request.projects)).toEqual([['gamma']]);
  });

  test(`a failed write shows a mark with the failure words only while it holds at 1440 ${theme}`, async ({
    page,
  }) => {
    const header = await open(page, 1440, theme, { fail: true });
    await openPicker(page);
    await page.getByRole('menuitemcheckbox', { name: 'gamma' }).click();
    const mark = header.locator('.page-attention[data-attention="projects"]');
    await expect(mark).toContainText(text.pageList.failures.UNKNOWN);
    await expect(mark).toHaveAttribute('role', 'alert');
    // The labels are what the page holds: nothing was written.
    await expect(labelNames(page)).toHaveText(['alpha', 'beta']);
    expect(await requests(page)).toEqual([]);
    expect(await noOverflow(page)).toBe(true);
    await capture(page, `projects-failure-1440-${theme}.png`);
  });
}

test('choosing a project writes the page set and updates the labels; unchecking removes it', async ({
  page,
}) => {
  const header = await open(page);
  await openPicker(page);
  await page.getByRole('menuitemcheckbox', { name: 'gamma' }).click();
  await expect(labelNames(page)).toHaveText(['alpha', 'beta', 'gamma']);
  expect((await requests(page)).map((request) => request.projects)).toEqual([
    ['alpha', 'beta', 'gamma'],
  ]);
  await expect(header.locator('.page-header-projects-status')).toHaveText(text.pageList.saved);
  await openPicker(page);
  await page.getByRole('menuitemcheckbox', { name: 'alpha' }).click();
  await expect(labelNames(page)).toHaveText(['beta', 'gamma']);
  expect((await requests(page)).at(-1)!.projects).toEqual(['beta', 'gamma']);
});

test('the labels and Projects… in More open the same picker', async ({ page }) => {
  await open(page);
  await labels(page).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0);
  await expect(labels(page)).toBeFocused();
  await (await pageAction(page.locator('#ask-page-fixture'), 'Projects…')).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(3);
});

for (const current of [['alpha'], ['alpha', 'beta', 'gamma', 'delta']])
  test(`the labels open the picker from the keyboard and take focus back: ${current.length}`, async ({
    page,
  }) => {
    await open(page, 1440, 'light', { current, all: [...current, 'extra'] });
    await expect(labels(page)).toHaveAccessibleName(
      `Projects: ${current.join(', ')}. Edit projects`,
    );
    await expect(labelNames(page)).toHaveText(
      current.length === 1 ? current : [...current.slice(0, 3), '+1'],
    );
    for (const key of ['Enter', 'Space']) {
      await labels(page).focus();
      await labels(page).press(key);
      await expect(page.getByRole('menuitemcheckbox')).toHaveCount(current.length + 1);
      await page.keyboard.press('Escape');
      await expect(labels(page)).toBeFocused();
    }
    await labels(page).click();
    await page.getByRole('menuitem', { name: text.pageList.newProjectItem }).click();
    const dialog = page.getByRole('dialog', { name: text.pageList.newProject });
    await expect(dialog.getByRole('textbox', { name: text.pageList.nameField })).toBeFocused();
    expect(await requests(page)).toEqual([]);
  });

for (const width of [1440, 390])
  test(`the picker opened from More → Projects… sits right-aligned under More at ${width}`, async ({
    page,
  }) => {
    await open(page, width, 'light');
    await (await pageAction(page.locator('#ask-page-fixture'), 'Projects…')).click();
    const picker = page.locator('dialog[open]:has([role="menuitemcheckbox"])');
    await expect(picker).toBeVisible();
    const more = (await page
      .locator('.tmt-ui-topbar:visible')
      .getByRole('button', { name: 'More', exact: true })
      .boundingBox())!;
    const box = (await picker.boundingBox())!;
    // Under the More button, flush with its right edge, never floating under the title.
    expect(box.y).toBeGreaterThanOrEqual(more.y + more.height - 2);
    expect(box.x + box.width).toBeLessThanOrEqual(more.x + more.width + 2);
    expect(box.x + box.width).toBeGreaterThanOrEqual(more.x + more.width - 12);
    await capture(page, `projects-picker-from-more-${width}-light.png`);
  });

test('a page in eight projects cannot take a ninth or a new one', async ({ page }) => {
  const eight = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  await open(page, 1440, 'light', { current: eight, all: [...eight, 'p9'] });
  // The bar names three labels after the page's status, the rest as a count (#6611).
  await expect(labelNames(page)).toHaveText(['p1', 'p2', 'p3', '+5']);
  await expect(labelNames(page).last()).toHaveAccessibleName('5 more projects');
  await openPicker(page);
  await expect(page.getByRole('menuitemcheckbox', { name: 'p9' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: text.pageList.newProjectItem })).toBeDisabled();
});

test('New project… names a project and puts this page in it', async ({ page }) => {
  await open(page);
  await openPicker(page);
  await page.getByRole('menuitem', { name: text.pageList.newProjectItem }).click();
  const dialog = page.getByRole('dialog', { name: text.pageList.newProject });
  await dialog.getByLabel(text.pageList.nameField).fill('delta');
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await dialog.getByRole('button', { name: text.pageList.create, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(labelNames(page)).toHaveText(['alpha', 'beta', 'delta']);
  expect((await requests(page)).at(-1)!.projects).toEqual(['alpha', 'beta', 'delta']);
});

test('a page opened by a link reads the list once and then shows its labels', async ({ page }) => {
  await open(page, 1440, 'light', { deepLink: true });
  await expect(labelNames(page)).toHaveText(['alpha', 'beta']);
  expect(await reads(page)).toBe(1);
  await openPicker(page);
  // The picker opens at once on what is known, with this page's projects checked.
  await expect(page.getByRole('menuitemcheckbox')).toHaveText(['alpha✓', 'beta✓', 'gamma']);
  await expect.poll(() => reads(page)).toBe(2);
});

test('a page opened by a link in a strict tree still shows its labels, with no read left running', async ({
  page,
}) => {
  await open(page, 1440, 'light', { deepLink: true, strict: true });
  await expect(labelNames(page)).toHaveText(['alpha', 'beta']);
  const { spaceHomeReads, spaceHomeRunning } = await proof(page);
  expect(spaceHomeReads).toBeLessThanOrEqual(2);
  expect(spaceHomeRunning).toBe(0);
});

test('leaving a page while its list read waits cancels that read', async ({ page }) => {
  await open(page, 1440, 'light', { deepLink: true, slowRead: true });
  await expect.poll(async () => (await proof(page)).spaceHomeRunning).toBe(1);
  await expect(labels(page)).toHaveCount(0);
  await backToPageList(page);
  await expect.poll(async () => (await proof(page)).spaceHomeAborted).toBe(1);
  expect((await proof(page)).spaceHomeRunning).toBe(0);
});

test('arriving from the list shows the labels with no read, and the picker refreshes behind what it shows', async ({
  page,
}) => {
  await open(page);
  await expect(labelNames(page)).toHaveText(['alpha', 'beta']);
  expect(await reads(page)).toBe(0);
  await openPicker(page);
  await expect.poll(() => reads(page)).toBe(1);
});

test('a viewer who cannot write projects sees no labels, Projects… or Pin', async ({ page }) => {
  await page.goto('/');
  await run(page, 'mount', {});
  await expect(page.frameLocator('#ask-page-fixture iframe').locator('#selected')).toBeVisible();
  await expect(labels(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Projects…' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^(Pin to top|Unpin)$/ })).toHaveCount(0);
});

for (const width of [1440, 390])
  test(`More pins and unpins the page at ${width}`, async ({ page }) => {
    const header = await open(page, width);
    // Pin left the page header for the page menu (#6652).
    await expect(header.locator('.page-header-pin')).toHaveCount(0);
    await (await pageAction(header, text.pageList.pinItem)).click();
    await expect
      .poll(async () => (await pins(page)).map((request) => request.pinned))
      .toEqual([true]);
    await (await pageAction(header, text.pageList.unpinItem)).click();
    await expect
      .poll(async () => (await pins(page)).map((request) => request.pinned))
      .toEqual([true, false]);
    expect(await noOverflow(page)).toBe(true);
  });

test('a phone keeps its title readable', async ({ page }) => {
  const header = await open(page, 390);
  await expect(header.locator('.page-mobile-title h1')).toHaveText('Live shared page');
  expect(await noOverflow(page)).toBe(true);
});

test('More says why a pin was refused, keeps the page unpinned, and hides Pin when archived', async ({
  page,
}) => {
  const host = page.locator('#ask-page-fixture');
  await open(page, 390, 'light', { pinFail: 'CAPACITY' });
  const layout = () =>
    page.evaluate(() => {
      const frame = document.querySelector('#ask-page-fixture iframe');
      const menu = frame?.closest('.tmt-ui-shell')?.querySelector('.tmt-ui-module-menu');
      if (!menu || !frame) throw new Error('The page fixture needs its shell and frame.');
      return {
        menuHeight: menu.getBoundingClientRect().height,
        frame: frame.getBoundingClientRect().top,
      };
    });
  const beforeNotice = await layout();
  await (await pageAction(host, text.pageList.pinItem)).click();
  const notice = page.locator('.page-pin-notice [role="alert"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(text.pageList.pinFull);
  const noticeBox = await notice.boundingBox();
  expect(noticeBox).not.toBeNull();
  const withNotice = await layout();
  // The phone child tree lives in the closed drawer, not a content-offset tab strip.
  expect(beforeNotice.menuHeight).toBe(0);
  expect(withNotice.menuHeight).toBe(0);
  // The page moves down by the notice and by the projects' failure mark under the title, which
  // holds the same words without the alert role; nothing covers the page (#6652).
  const mark = page.locator('.page-attention[data-attention="projects"]');
  const markBox = (await mark.boundingBox())!;
  expect(withNotice.frame).toBeCloseTo(beforeNotice.frame + noticeBox!.height + markBox.height, 0);
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.locator('.page-attention[data-attention="projects"]')).not.toHaveAttribute(
    'role',
    'alert',
  );
  await pageAction(host, text.pageList.pinItem);
  await expect(
    page.getByRole('menuitem', { name: text.pageList.unpinItem, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await pins(page)).map((request) => request.pinned)).toEqual([true]);
  // A successful retry uses the unchanged pin state and clears the readable refusal.
  await (await pageAction(host, text.pageList.pinItem)).click();
  await expect(notice).toHaveCount(0);
  await pageAction(host, text.pageList.unpinItem);
  await page.keyboard.press('Escape');
  expect((await pins(page)).map((request) => request.pinned)).toEqual([true, true]);

  await open(page, 390, 'light', { pinFail: 'CAPACITY' });
  await (await pageAction(host, text.pageList.pinItem)).click();
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(host.locator('.page-attention[data-attention="projects"]')).toHaveCount(0);
  expect(await layout()).toEqual(beforeNotice);

  await open(page, 390, 'light', { pinFail: 'CAPACITY' });
  await (await pageAction(host, text.pageList.pinItem)).click();
  await expect(notice).toBeVisible();
  await run(page, 'navigateHome');
  await expect(notice).toHaveCount(0);

  await open(page, 1440);
  await run(page, 'archive');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^(Pin to top|Unpin)$/ })).toHaveCount(0);
});

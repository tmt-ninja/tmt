import { expect, test, type Page } from '@playwright/test';

// #5821: the docs shell serves two design systems, GUI and TUI, each under /ds/<id> with its own
// nav, mocks and header controls; old /docs and /mock URLs redirect. The docs site is the second
// web server in playwright.config.ts.
const docs = `http://127.0.0.1:${Number(process.env.BROWSER_UI_TEST_PORT ?? 5184) + 1}`;
const navHrefs = (page: Page) =>
  page
    .locator('nav.docs-nav a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')!));

test('old URLs land on their design system, keeping the query', async ({ page }) => {
  for (const [from, to] of [
    ['/', '/ds/gui'],
    ['/docs', '/ds/gui'],
    ['/docs/components/button', '/ds/gui/components/button'],
    ['/docs/patterns/tabs-row', '/ds/gui/patterns/tabs-row'],
    ['/docs/tui/roles', '/ds/tui/roles'],
    ['/mock/colab/page', '/ds/gui/mocks/colab/page'],
    ['/mock/tui/agents?state=agents', '/ds/tui/mocks/agents?state=agents'],
  ]) {
    await page.goto(`${docs}${from}`);
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(to);
  }
  await page.goto(`${docs}/docs/components/button`);
  await expect(page.getByRole('heading', { level: 1, name: 'Button' })).toBeVisible();
});

test('each system has its own nav, with no page of the other system', async ({ page }) => {
  await page.goto(`${docs}/ds/gui`);
  const gui = await navHrefs(page);
  expect(gui.length).toBeGreaterThan(40);
  expect(gui.every((href) => href.startsWith('/ds/gui'))).toBe(true);
  expect(gui).toContain('/ds/gui/mocks/colab');
  await expect(page.locator('nav.docs-nav')).not.toContainText('TUI');

  await page.getByRole('link', { name: 'tmt TUI' }).click();
  await expect(page).toHaveURL(`${docs}/ds/tui`);
  const tui = await navHrefs(page);
  expect(tui.every((href) => href.startsWith('/ds/tui'))).toBe(true);
  expect(tui).toContain('/ds/tui/roles');
  expect(tui).toContain('/ds/tui/mocks/agents');
  await expect(page.getByRole('link', { name: 'tmt TUI' })).toHaveAttribute('aria-current', 'page');
});

test('header controls follow the system: radius only in GUI', async ({ page }) => {
  await page.goto(`${docs}/ds/gui/components/button`);
  await expect(page.getByRole('group', { name: 'Radius' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch to/ })).toBeVisible();
  await page.goto(`${docs}/ds/tui/roles`);
  await expect(page.getByRole('group', { name: 'Radius' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Switch to/ })).toBeVisible();
});

test('the mocks open from their system nav', async ({ page }) => {
  await page.goto(`${docs}/ds/gui`);
  await page.locator('nav.docs-nav a[href="/ds/gui/mocks/colab"]').click();
  await expect(page).toHaveURL(`${docs}/ds/gui/mocks/colab`);
  await expect(page.getByRole('grid', { name: 'Pages' })).toBeVisible();
  await page.goto(`${docs}/ds/tui`);
  await page.locator('nav.docs-nav a[href="/ds/tui/mocks/agents"]').click();
  await expect(page).toHaveURL(`${docs}/ds/tui/mocks/agents`);
  await expect(page.getByText('No recorded state for this URL')).toHaveCount(0);
});

test('at 390 the header keeps the switcher with no page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const root of ['/ds/gui', '/ds/tui']) {
    await page.goto(`${docs}${root}`);
    await expect(page.getByRole('link', { name: 'tmt GUI' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'tmt TUI' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  }
});

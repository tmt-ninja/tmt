import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// #5954: a module that can be suspended is kept across rail switches instead of mounted again.
const fixturePath = `/@fs${fileURLToPath(new URL('../test/fixtures/shell-keep', import.meta.url))}`;
const run = async (page: import('@playwright/test').Page, name: string) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${fixturePath}.html`);
  const result = await page.evaluate(
    async ({ name, path }) => (await import(/* @vite-ignore */ path))[name](),
    { name, path: `${fixturePath}.tsx` },
  );
  expect(errors).toEqual([]);
  return result;
};

test('a kept module is suspended on leave and resumed, not mounted, on return', async ({
  page,
}) => {
  expect(await run(page, 'keepsAndResumes')).toEqual({
    log: ['mount a', 'suspend a', 'mount b', 'release b', 'resume a', 'suspend a', 'mount c'],
    away: 'content b',
    hidden: { hidden: true, inert: true },
    back: 'content a',
    sameFrame: true,
    title: 'a · TMT',
    sameSession: true,
    sessions: 1,
  });
});

test('one kept module per route and two in all, least recently used released first', async ({
  page,
}) => {
  expect(await run(page, 'boundsKept')).toEqual({
    afterCap: [
      'mount a',
      'suspend a',
      'mount b',
      'suspend b',
      'mount c',
      'suspend c',
      'release a',
      'mount d',
    ],
    afterDispose: ['release d', 'release b', 'release c'],
  });
});

test('a failed suspend or resume releases the module and the next visit mounts afresh', async ({
  page,
}) => {
  expect(await run(page, 'failuresRelease')).toEqual({
    suspend: ['mount a', 'release a', 'mount b', 'release b', 'mount a'],
    resume: ['mount a', 'suspend a', 'mount b', 'release b', 'release a', 'mount a'],
    main: 'content a',
  });
});

test('a session change releases kept modules before forgetting, and they never resume', async ({
  page,
}) => {
  expect(await run(page, 'sessionChangeReleasesFirst')).toEqual({
    order: ['mount a', 'suspend a', 'mount b', 'release a', 'forget'],
    after: ['release b', 'mount a'],
    renewed: true,
    sessions: 2,
  });
});

test('pagehide releases kept modules', async ({ page }) => {
  expect(await run(page, 'pagehideReleases')).toEqual([
    'mount a',
    'suspend a',
    'mount b',
    'release a',
  ]);
});

test('focus leaves a suspended module for the new main area and returns only by keyboard', async ({
  page,
}) => {
  expect(await run(page, 'focusMovesOut')).toEqual({ main: true, inert: false });
  // Back through the rail with the keyboard: focus goes back to where it was in the module.
  // Shift+Tab reaches the shell's rail; the test link to route a then takes focus the same way.
  await page.keyboard.press('Shift+Tab');
  await page.locator('.test-rail').focus();
  expect(await page.locator('.test-rail').evaluate((link) => link.matches(':focus-visible'))).toBe(
    true,
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.test-act')).toBeFocused();

  // Back with the pointer: focus stays where the user put it.
  await run(page, 'focusMovesOut');
  await page.locator('.test-rail').click();
  await expect(page.locator('.tmt-ui-shell-main .test-act')).toBeVisible();
  await expect(page.locator('.test-act')).not.toBeFocused();
});

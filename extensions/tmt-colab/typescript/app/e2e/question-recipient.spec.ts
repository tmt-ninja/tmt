import { expect, test, type Page } from '@playwright/test';

const fixture = (query = '') => `/test/question-recipient-browser.html${query}`;
const recipient = (page: Page) => page.locator('.question-recipient');
const trigger = (page: Page) => page.locator('.question-recipient-trigger');
async function chosen(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { recipientFixture: { chosen: unknown[] } }).recipientFixture.chosen,
  );
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const) {
    test(`the recipient line at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(fixture('?own=1'));
      await expect(page.locator('.question-recipient-label')).toHaveText('Receives answers');
      await expect(trigger(page)).toHaveText('First reviewer');
      await expect(trigger(page)).toHaveAttribute('data-own', 'true');
      await trigger(page).click();
      const list = page.getByRole('listbox');
      await expect(list.getByRole('option')).toHaveText([
        'The page creator (Page creator)',
        'First reviewer',
        'Next builder',
        'An agent with a very long name that has to truncate instead of pushing the line wider',
      ]);
      // The popup stays inside the viewport and the line never widens the page.
      const box = (await list.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await noOverflow(page);
    });
  }

test('a long name truncates on the trigger instead of widening the line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(fixture());
  await trigger(page).click();
  await page.getByRole('option', { name: /very long name/ }).click();
  await expect(trigger(page)).toContainText('An agent with a very long name');
  const row = (await recipient(page).boundingBox())!;
  const pill = (await trigger(page).boundingBox())!;
  expect(pill.x + pill.width).toBeLessThanOrEqual(row.x + row.width + 1);
  await noOverflow(page);
});

test('choosing an agent sends its ID once and the line shows who receives answers', async ({
  page,
}) => {
  await page.goto(fixture());
  await expect(trigger(page)).toHaveText('The page creator (Page creator)');
  await expect(trigger(page)).not.toHaveAttribute('data-own');
  await trigger(page).click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  await expect(trigger(page)).toHaveText('Next builder');
  await expect(trigger(page)).toHaveAttribute('data-own', 'true');
  expect(await chosen(page)).toHaveLength(1);
  expect((await chosen(page))[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test('"The page creator" clears the recipient', async ({ page }) => {
  await page.goto(fixture('?own=1'));
  await trigger(page).click();
  await page.getByRole('option', { name: 'The page creator (Page creator)' }).click();
  await expect(trigger(page)).toHaveText('The page creator (Page creator)');
  expect(await chosen(page)).toEqual([null]);
});

test('the line is busy and cannot be changed again while a choice settles', async ({ page }) => {
  await page.goto(fixture('?answer=slow'));
  await trigger(page).click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  await expect(recipient(page)).toHaveAttribute('data-pending', 'true');
  await expect(trigger(page)).toBeDisabled();
  await expect(trigger(page)).toHaveText('Next builder', { timeout: 5000 });
  await expect(trigger(page)).toBeEnabled();
  expect(await chosen(page)).toHaveLength(1);
});

test('a refusal keeps the current recipient and says why, and the next choice clears it', async ({
  page,
}) => {
  await page.goto(fixture('?own=1&answer=refused-once'));
  await trigger(page).click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  const alert = recipient(page).getByRole('alert');
  await expect(alert).toHaveText(
    'That identity was not found. Check the name or ID and try again.',
  );
  await expect(trigger(page)).toHaveText('First reviewer');
  await expect(trigger(page)).toBeEnabled();
  // The next choice clears the message.
  await trigger(page).click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(trigger(page)).toHaveText('Next builder');
});

test('a directory that is loading, failed, empty or missing offers nothing to choose', async ({
  page,
}) => {
  await page.goto(fixture('?directory=loading'));
  await expect(trigger(page)).toBeDisabled();
  await expect(recipient(page).getByText('Loading agents…')).toBeVisible();
  await page.goto(fixture('?directory=failed'));
  await expect(trigger(page)).toBeDisabled();
  await expect(recipient(page)).toContainText(
    'Agent directory unavailable (COLAB_REMOTE_UNAVAILABLE)',
  );
  await recipient(page).getByRole('button', { name: 'Retry' }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { recipientFixture: { retries(): number } }).recipientFixture.retries(),
    ),
  ).toBe(1);
  await page.goto(fixture('?directory=empty'));
  await expect(recipient(page).getByText('No agents are available to choose from.')).toBeVisible();
  await page.goto(fixture('?directory=none'));
  await expect(trigger(page)).toBeDisabled();
  await expect(recipient(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);
});

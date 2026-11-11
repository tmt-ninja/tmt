import { expect, test } from '@playwright/test';

// #6220: the serve refuses a batch as stale when the page moved between its preparation and its
// commit, and writes nothing. The page sends such a batch again, as a new one, and says so when it
// cannot.
async function mountFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount('plan');
  });
  return page.locator('#structured-page-fixture');
}

/** Select block `p` (Esc leaves its editor) and delete it: one batch. */
async function deleteParagraph(page: import('@playwright/test').Page) {
  const host = page.locator('#structured-page-fixture');
  await host.locator('[data-block-id="p"]').click();
  await host.locator('[data-block-id="p"] [contenteditable="true"]').press('Escape');
  await page.keyboard.press('Delete');
}

const attempted = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.attempts.map((ops) => ops.map((op) => `${op.op}:${op.id}`).join(',')));

test('a batch refused as stale is sent again, and the batch after it waits for it', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await page.evaluate(() => window.refuseBatch('stale', 1));
  // Two gestures in a row: the second is queued behind the first while it is refused and resent.
  await deleteParagraph(page);
  await expect(host.locator('[data-block-id="e"]')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect.poll(() => attempted(page)).toHaveLength(3);
  // The refused batch goes out again before the one after it, never behind it.
  expect(await attempted(page)).toEqual(['delete:p', 'delete:p', 'delete:e']);
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
  await expect(host.locator('[data-block-id="e"]')).toHaveCount(0);
  await expect(page.getByRole('status')).not.toContainText('not saved');
  expect(await page.evaluate(() => window.sent.map((op) => `${op.op}:${op.id}`))).toEqual([
    'delete:p',
    'delete:e',
  ]);
});

test('after the last stale refusal the page says so and Retry sends the batch again', async ({
  page,
}) => {
  const host = await mountFixture(page);
  // One attempt and three more are refused; the fifth, by Retry, goes through.
  await page.evaluate(() => window.refuseBatch('stale', 4));
  await deleteParagraph(page);
  const notice = page.getByRole('status').filter({ hasText: 'not saved' });
  await expect(notice).toContainText('The page kept changing, so your last change was not saved.');
  expect(await attempted(page)).toHaveLength(4);
  // Nothing was written, and the page shows the block again instead of hiding the loss.
  await expect(host.locator('[data-block-id="p"]')).toHaveText('Ship the stack.');
  await notice.getByRole('button', { name: 'Retry' }).click();
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(await attempted(page)).toHaveLength(5);
  expect(await page.evaluate(() => window.sent.map((op) => `${op.op}:${op.id}`))).toEqual([
    'delete:p',
  ]);
});

test('a refusal the serve gives every time says why, is not sent again and offers no Retry', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await page.evaluate(() => window.refuseBatch('missing', 1));
  await deleteParagraph(page);
  const notice = page.getByRole('status').filter({ hasText: 'not saved' });
  await expect(notice).toContainText(
    'Your last change was not saved: That block no longer exists.',
  );
  // A Retry would be refused the same way: the line has no action, and the block is drawn again.
  await expect(notice.getByRole('button')).toHaveCount(0);
  expect(await attempted(page)).toEqual(['delete:p']);
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(1);
});

test('a refusal the next send can get past offers Retry, and Retry sends the batch again', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await page.evaluate(() => window.refuseBatch('unavailable', 1));
  await deleteParagraph(page);
  const notice = page.getByRole('status').filter({ hasText: 'not saved' });
  await expect(notice).toContainText('Your last change was not saved: Colab could not take');
  // Not resent by itself (only a stale refusal is), and the block is drawn again meanwhile.
  expect(await attempted(page)).toEqual(['delete:p']);
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(1);
  await notice.getByRole('button', { name: 'Retry' }).click();
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  expect(await attempted(page)).toEqual(['delete:p', 'delete:p']);
});

test('an outcome in doubt is not sent again and offers no Retry', async ({ page }) => {
  const host = await mountFixture(page);
  await page.evaluate(() => window.refuseBatch('unknown', 1));
  await deleteParagraph(page);
  const notice = page.getByRole('status').filter({ hasText: 'may not have been saved' });
  await expect(notice).toBeVisible();
  // It may have landed: sending it again could write it twice.
  await expect(notice.getByRole('button')).toHaveCount(0);
  expect(await attempted(page)).toEqual(['delete:p']);
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(1);
});

import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';
import { pageAction } from '../test/page-actions.js';

// #5870: a Chat send belongs to Chat's composer, not to the open panel, so Chat closes while the
// send runs, and a failure after closing is said on the page, as an anchored window's is (#5816).
const fixture = '/test/ask-page-browser.tsx';
async function run(page: Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
const host = (page: Page) => page.locator('#ask-page-fixture');
const chat = (page: Page) => page.getByTestId('chat-panel');
const input = (page: Page) => chat(page).getByRole('combobox', { name: 'Message', exact: true });
const echo = (page: Page) => chat(page).getByTestId('comment-echo');
const notice = (page: Page) => page.locator('.page-unsent').getByRole('listitem');
async function openChat(page: Page) {
  await (await pageAction(host(page), 'Chat')).click();
  await expect(chat(page)).toBeVisible();
}
async function sendHeld(page: Page, body: string) {
  await page.goto('/');
  await run(page, 'mount');
  await expect(page.locator('#ask-page-fixture .status')).toContainText('Live');
  await openChat(page);
  await input(page).pressSequentially(body);
  await run(page, 'holdReply');
  await input(page).press('Enter');
  await expect(echo(page)).toHaveAttribute('data-echo', 'pending');
}
const chatComments = async (page: Page) =>
  ((await run(page, 'discussionProof')) as { anchor: unknown; comments: unknown[] }[])
    .filter((thread) => !thread.anchor)
    .flatMap((thread) => thread.comments);

for (const close of ['×', 'Escape', 'another panel'] as const)
  test(`Chat closes by ${close} while its send runs; reopening shows it still sending, then recorded once`, async ({
    page,
  }) => {
    await sendHeld(page, 'Held while Chat closes.');
    if (close === '×') await page.getByRole('button', { name: 'Close Chat', exact: true }).click();
    else if (close === 'Escape') await page.keyboard.press('Escape');
    else await (await pageAction(host(page), 'Comments')).click();
    await expect(chat(page)).toBeHidden();
    // Nothing is said on the page while the send is still running.
    await expect(notice(page)).toHaveCount(0);
    await openChat(page);
    await expect(echo(page)).toHaveAttribute('data-echo', 'pending');
    await expect(echo(page)).toContainText('Held while Chat closes.');
    await run(page, 'releaseReply');
    await expect(chat(page).getByTestId('comment-entry')).toContainText('Held while Chat closes.');
    await expect(echo(page)).toHaveCount(0);
    await expect.poll(async () => (await chatComments(page)).length).toBe(1);
  });

test('a Chat send failing after Chat closed is said on the page; Open shows its failed row and Retry records it once', async ({
  page,
}) => {
  await sendHeld(page, 'Kept through a closed Chat.');
  await run(page, 'failNextReply');
  await page.keyboard.press('Escape');
  await expect(chat(page)).toBeHidden();
  await run(page, 'releaseReply');
  await expect(page.locator('.page-unsent')).toHaveRole('alert');
  await expect(notice(page)).toHaveText(/^Your Chat message was not sent\.\s*Open$/);
  expect(await chatComments(page)).toHaveLength(0);
  for (const width of [390, 1440])
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: capturePath(`chat-unsent-notice-${width}-${theme}.png`) });
    }
  await notice(page).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(chat(page)).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await expect(echo(page)).toHaveAttribute('data-echo', 'failed');
  await expect(echo(page)).toContainText('Kept through a closed Chat.');
  // Closing again names it again.
  await page.keyboard.press('Escape');
  await expect(notice(page)).toHaveCount(1);
  await openChat(page);
  await echo(page).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(chat(page).getByTestId('comment-entry')).toContainText(
    'Kept through a closed Chat.',
  );
  await expect.poll(async () => (await chatComments(page)).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.page-unsent')).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';

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
  await page.goto(fixture('?answer=held'));
  await trigger(page).click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  await expect(recipient(page)).toHaveAttribute('data-pending', 'true');
  // Busy, but still focusable, so an editor around it does not lose focus.
  await expect(trigger(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(trigger(page)).not.toHaveAttribute('disabled');
  await trigger(page).click({ force: true });
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() =>
    (window as unknown as { recipientFixture: { release(): void } }).recipientFixture.release(),
  );
  await expect(trigger(page)).toHaveText('Next builder');
  await expect(trigger(page)).not.toHaveAttribute('aria-disabled');
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

// The picker on the block question editor's recipient line (#6194's line, #6197).
const QUESTION = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
async function openEditor(page: Page, options: { recipients?: boolean; follows?: boolean } = {}) {
  await page.goto('/');
  await page.evaluate(async (options) => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount('spec', options);
  }, options);
  const block = page.locator(`#structured-page-fixture [data-block-id="${QUESTION}"]`);
  await block.scrollIntoViewIfNeeded();
  await block.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('group', { name: 'Edit question' });
  await expect(edit).toBeVisible();
  return { block, edit, line: edit.locator('.tmt-block-question-eyebrow') };
}
const asked = (page: Page) =>
  page.evaluate(() => (window as unknown as { recipientChosen: unknown[] }).recipientChosen);

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const) {
    test(`the editor's recipient line holds the picker at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const { edit, line } = await openEditor(page, { recipients: true });
      await expect(line).toContainText('✎ Editing · Answers go to');
      const pick = line.getByRole('button', { name: 'Receives answers: tmt-gui-lead' });
      await expect(pick).toHaveText('tmt-gui-lead');
      // The line is one row beside the words, and the editor never widens the page.
      await expect(line.locator('.question-recipient-label')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.mouse.move(0, 0);
      await edit.screenshot({
        path: capturePath(`question-editor-recipient-${width}-${theme}-rest.png`),
      });
      await pick.click();
      const list = page.getByRole('listbox');
      await expect(list.getByRole('option')).toHaveText([
        'The page creator (gui-2)',
        'First reviewer',
        'Next builder',
        'An agent with a very long name that has to truncate instead of pushing the line wider',
        // The current recipient stays listed when the directory omits it.
        'tmt-gui-lead',
      ]);
      const box = (await list.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: capturePath(`question-editor-recipient-${width}-${theme}-open.png`),
      });
      // The editor stays open while the menu is used.
      await expect(edit).toBeVisible();
    });
  }

test('choosing in the editor keeps it open, sends one ID, and clearing follows the creator', async ({
  page,
}) => {
  const { block, edit, line } = await openEditor(page, { recipients: true });
  const pick = line.locator('.question-recipient-trigger');
  await pick.click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  await expect(pick).toHaveText('Next builder');
  await expect(edit).toBeVisible();
  expect(await asked(page)).toEqual(['00000000-0000-4000-8000-000000000007']);
  // The same agent again sends nothing; the creator is one more request with no selector.
  await pick.click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  expect(await asked(page)).toHaveLength(1);
  await pick.click();
  await page.getByRole('option', { name: 'The page creator (gui-2)', exact: true }).click();
  await expect(pick).toHaveText('The page creator (gui-2)');
  expect(await asked(page)).toEqual(['00000000-0000-4000-8000-000000000007', null]);
  // Choosing again, then Done: the answer card names who receives the answer.
  await pick.click();
  await page.getByRole('option', { name: 'First reviewer', exact: true }).click();
  await expect(pick).toHaveText('First reviewer');
  await edit.getByRole('button', { name: 'Done' }).click();
  await expect(edit).toHaveCount(0);
  await expect(block.getByRole('group', { name: '先做哪個區塊？' })).toContainText(
    'First reviewer',
  );
});

test('Esc closes the open menu first and the editor on the next press', async ({ page }) => {
  const { edit, line } = await openEditor(page, { recipients: true });
  await line.locator('.question-recipient-trigger').click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(edit).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(edit).toHaveCount(0);
});

test('a refused choice keeps the recipient and the editor and says why', async ({ page }) => {
  const { edit, line } = await openEditor(page, { recipients: true });
  await page.evaluate(() => (window as unknown as { refuseRecipient(): void }).refuseRecipient());
  const pick = line.locator('.question-recipient-trigger');
  await pick.click();
  await page.getByRole('option', { name: 'Next builder', exact: true }).click();
  await expect(line.getByRole('alert')).toHaveText(
    'That identity was not found. Check the name or ID and try again.',
  );
  await expect(pick).toHaveText('tmt-gui-lead');
  await expect(edit).toBeVisible();
});

test('without the owner seam the editor names the recipient and offers no choice', async ({
  page,
}) => {
  const { line } = await openEditor(page);
  await expect(line).toHaveText('✎ Editing · Answers go to tmt-gui-lead');
  await expect(line.getByRole('button')).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';

const search = (page: Page) => page.getByRole('textbox', { name: 'Search pages' });
const message = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const read = async (page: Page, name: 'search' | 'message' | 'sent') =>
  JSON.parse((await page.locator(`[data-${name}]`).getAttribute(`data-${name}`))!);

test.beforeEach(async ({ page }) => {
  await page.goto('/?frame=rich-input');
});

test('typing fills the value and Enter submits it', async ({ page }) => {
  await search(page).click();
  await page.keyboard.type('release notes');
  await expect.poll(() => read(page, 'search')).toEqual({ value: 'release notes', chips: [] });
  await page.keyboard.press('Enter');
  expect(await read(page, 'sent')).toEqual([{ value: 'release notes', chips: [] }]);
});

test('a trigger opens suggestions; Enter inserts the chip and Backspace removes it', async ({
  page,
}) => {
  await search(page).click();
  await page.keyboard.type('project:de');
  const option = page.getByRole('option', { name: 'project:design' });
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect
    .poll(() => read(page, 'search'))
    .toEqual({
      value: 'project:design ',
      chips: [{ kind: 'project', text: 'project:design', range: { start: 0, end: 14 } }],
    });
  // Nothing was submitted by the Enter that chose the option.
  expect(await read(page, 'sent')).toEqual([]);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect.poll(() => read(page, 'search')).toEqual({ value: '', chips: [] });
});

test('the chip remove button removes it', async ({ page }) => {
  await search(page).click();
  await page.keyboard.type('project:sp');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Remove filter project:spec' }).click();
  await expect.poll(() => read(page, 'search')).toEqual({ value: ' ', chips: [] });
});

test('Esc closes an open suggestion list and is consumed there', async ({ page }) => {
  await page.evaluate(() => {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') document.body.dataset.escapeReached = 'true';
    });
  });
  await message(page).click();
  await page.keyboard.type('@sa');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(message(page)).toBeFocused();
  await expect(page.locator('body')).not.toHaveAttribute('data-escape-reached', 'true');
});

test('the composer: Shift+Enter adds a line, Enter sends with the mention chip', async ({
  page,
}) => {
  await message(page).click();
  await page.keyboard.type('@sample-l');
  await page.keyboard.press('Enter');
  await page.keyboard.type('please look');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('thanks');
  await expect
    .poll(async () => (await read(page, 'message')).value)
    .toBe('@sample-lead please look\nthanks');
  await page.keyboard.press('Enter');
  expect(await read(page, 'sent')).toEqual([
    {
      value: '@sample-lead please look\nthanks',
      chips: [{ kind: 'mention', text: '@sample-lead', range: { start: 0, end: 12 } }],
    },
  ]);
  await expect.poll(() => read(page, 'message')).toEqual({ value: '', chips: [] });
});

test('Enter during an IME composition never submits', async ({ page }) => {
  await message(page).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 229,
  });
  await cdp.send('Input.insertText', { text: 'にほん' });
  await expect.poll(async () => (await read(page, 'message')).value).toBe('にほん');
  expect(await read(page, 'sent')).toEqual([]);
});

test('paste is plain text, and the single line turns a break into a space', async ({ page }) => {
  await search(page).click();
  await search(page).evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/html', '<b>bold</b><br>line');
    data.setData('text/plain', 'bold\nline');
    node.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect.poll(() => read(page, 'search')).toEqual({ value: 'bold line', chips: [] });
  await expect(search(page).locator('b')).toHaveCount(0);
});

test('the focus ring sits on the wrapper', async ({ page }) => {
  const wrapper = page.locator('.tmt-rich-input').first();
  await expect(wrapper).toHaveCSS('outline-style', 'none');
  await search(page).click();
  await expect(wrapper).toHaveCSS('outline-style', 'solid');
  await expect(search(page)).toHaveCSS('outline-style', 'none');
});

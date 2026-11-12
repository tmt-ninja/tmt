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

test('a non-chip choice and chip removal notify the list owner without submitting', async ({
  page,
}) => {
  await page.goto('/?frame=rich-input&list-actions=1');
  await search(page).click();
  await page.keyboard.type('stage:do');
  await page.getByRole('option', { name: 'Done' }).click();
  await expect(page.locator('[data-choice]')).toHaveAttribute('data-choice', 'stage:done');
  await expect.poll(() => read(page, 'search')).toEqual({ value: '', chips: [] });
  await page.keyboard.type('project:de');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Remove filter project:design' }).click();
  await expect(page.locator('[data-removals]')).toHaveAttribute('data-removals', '1');
  expect(await read(page, 'sent')).toEqual([]);
});

test('a press that gives no focus leaves no mark: the next scripted focus lands after the text (#6164)', async ({
  page,
}) => {
  await search(page).click();
  await page.keyboard.type('release notes');
  // A drag that starts in the focused field (no focus event) and ends outside it.
  const box = (await search(page).getByText('release notes').boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 2, box.y + box.height + 200);
  await page.mouse.up();
  await search(page).blur();
  await search(page).evaluate((node) => {
    const range = document.createRange();
    range.setStart(node, 0);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    (node as HTMLElement).focus();
  });
  await expect(search(page)).toBeFocused();
  // A focus that is not a pointer's moves the caret in a task queued at focus; this one runs after it.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
  await page.keyboard.type(' today');
  await expect
    .poll(() => read(page, 'search'))
    .toEqual({ value: 'release notes today', chips: [] });
});

// A press released outside the window has no click and no pointercancel. Its mark still ends: on
// the field's blur when the field had focus, or on the key that starts a keyboard focus (#6164).
for (const field of ['focused', 'unfocused'] as const)
  test(`a press on the ${field} field that never becomes a click leaves no mark: a later Shift+Tab focus lands after the text (#6164)`, async ({
    page,
  }) => {
    await search(page).click();
    await page.keyboard.type('release notes');
    if (field === 'unfocused') await message(page).focus();
    await search(page).dispatchEvent('pointerdown', { pointerType: 'mouse', isPrimary: true });
    // Keyboard focus from the field after it: Shift+Tab puts the caret at the start of the text.
    await message(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(search(page)).toBeFocused();
    // A focus that is not a pointer's moves the caret in a task queued at focus; this one runs after it.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
    await page.keyboard.type(' today');
    await expect
      .poll(() => read(page, 'search'))
      .toEqual({ value: 'release notes today', chips: [] });
  });

// On a touch screen the focus a tap gives arrives in a later task than its press, after the
// pointerup. The tap still places its own caret: tapping the start of existing text and typing
// writes before it, not after it (#6164).
test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a tap at the start of existing text puts the caret there', async ({ page }) => {
    await search(page).click();
    await page.keyboard.type('release notes');
    await expect.poll(() => read(page, 'search')).toEqual({ value: 'release notes', chips: [] });
    await search(page).blur();
    await expect(search(page)).not.toBeFocused();
    const text = search(page).getByText('release notes');
    const box = (await text.boundingBox())!;
    // A finger rests on the glass for a moment: the press (pointerdown) comes at touchstart and
    // the focus only after touchend, several tasks later.
    const touch = await page.context().newCDPSession(page);
    const point = { x: box.x + 1, y: box.y + box.height / 2 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(search(page)).toBeFocused();
    // A focus that is not a pointer's moves the caret in a task queued at focus; this one runs after it.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
    await page.keyboard.type('new ');
    await expect
      .poll(() => read(page, 'search'))
      .toEqual({ value: 'new release notes', chips: [] });
  });
});

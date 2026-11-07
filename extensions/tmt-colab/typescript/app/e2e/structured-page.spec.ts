import { expect, test } from '@playwright/test';
import { capturePath } from './captures.js';

async function mountFixture(page: import('@playwright/test').Page, content = 'plan') {
  await page.goto('/');
  await page.evaluate(async (content) => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount(content);
  }, content);
  return page.locator('#structured-page-fixture');
}

test('a structured page draws its blocks and edits only the focused one', async ({ page }) => {
  const host = await mountFixture(page);
  await expect(host.getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(host.locator('[data-block-id]')).toHaveCount(3);
  // At rest no block holds an editor.
  await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);
  await host.locator('[data-block-id="p"]').click();
  await expect(host.locator('[contenteditable="true"]')).toHaveCount(1);
  await expect(host.locator('[data-block-id="p"] [contenteditable="true"]')).toHaveText(
    'Ship the stack.',
  );
});

test('typing in a block while an agent edits the same block loses neither', async ({ page }) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await editor.pressSequentially(' Today.', { delay: 40 });
  // Mid-typing, before the person's text is sent, an agent changes the start of the same block.
  await page.evaluate(() => window.agentReplace('p', 'Ship', 'Merge'));
  await editor.pressSequentially(' Then rest.', { delay: 40 });
  const merged = 'Merge the stack. Today. Then rest.';
  await expect(editor).toHaveText(merged);
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toBe(merged);
  // Typing went out in bursts with merge bases, never once per key.
  const sent = await page.evaluate(() => window.sent);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.length).toBeLessThan(5);
  expect(sent.every((op) => op.op === 'text' && 'overlap' in op && op.overlap === 'both')).toBe(
    true,
  );
});

test('an agent edit while the person sends lands without moving the caret back', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await editor.pressSequentially(' A', { delay: 20 });
  // Rest long enough for the op to go out, then the agent writes while it is in flight.
  await page.waitForFunction(() => window.sent.length === 1);
  await page.evaluate(() => window.agentReplace('p', 'stack', 'whole stack'));
  await editor.pressSequentially('B', { delay: 20 });
  await expect(editor).toHaveText('Ship the whole stack. AB');
  await expect
    .poll(() => page.evaluate(() => window.serveText('p')))
    .toBe('Ship the whole stack. AB');
});

test('Enter splits a block at the caret and Backspace at its start joins it back', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const first = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await first.press('End');
  // Typing not sent yet goes in the split's batch.
  await first.pressSequentially(' Now', { delay: 20 });
  for (let i = 0; i < ' the stack. Now'.length; i++) await first.press('ArrowLeft');
  await first.press('Enter');
  const blocks = host.locator('[data-block-id]');
  await expect(blocks).toHaveCount(4);
  await expect(blocks.nth(1)).toHaveText('Ship');
  // The new block holds the rest and the editor, with the caret at its start.
  const second = blocks.nth(2).locator('[contenteditable="true"]');
  await expect(second).toHaveText(' the stack. Now');
  await second.pressSequentially('X', { delay: 20 });
  await expect(second).toHaveText('X the stack. Now');
  await expect.poll(() => page.evaluate(() => window.sent.at(-1))).toMatchObject({ op: 'text' });
  await second.press('Home');
  await second.press('Backspace');
  await expect(blocks).toHaveCount(3);
  const joined = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await expect(joined).toHaveText('ShipX the stack. Now');
  // The caret sits at the join.
  await joined.pressSequentially('|', { delay: 20 });
  await expect(joined).toHaveText('Ship|X the stack. Now');
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toBe('Ship|X the stack. Now');
  // Each gesture went out as one batch.
  const sent = await page.evaluate(() => window.sent.map((op) => op.op));
  expect(sent.filter((op) => op === 'insert')).toHaveLength(1);
  expect(sent.filter((op) => op === 'delete')).toHaveLength(1);
});

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`the spec page draws read-only and mid-typing at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const host = await mountFixture(page, 'spec');
      await expect(host.locator('[data-block-id]')).toHaveCount(12);
      await expect(host.getByRole('table')).toContainText('唯一能放其他區塊的區塊');
      await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);
      await page.screenshot({
        path: capturePath(`structured-${width}-${theme}-read.png`),
        fullPage: true,
      });
      await host.locator('[data-block-id="long"]').click();
      const editor = host.locator('[data-block-id="long"] [contenteditable="true"]');
      await editor.press('End');
      await editor.pressSequentially('我正在打', { delay: 20 });
      // The pointer leaves, so only the typed-in block shows a tint.
      await page.mouse.move(0, 0);
      await expect(editor).toContainText('頁面的字排在前面。我正在打');
      await page.screenshot({
        path: capturePath(`structured-${width}-${theme}-typing.png`),
        fullPage: true,
      });
    });

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
  await expect(host.locator('[data-block-id]')).toHaveCount(4);
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
  await expect(blocks).toHaveCount(5);
  await expect(blocks.nth(1)).toHaveText('Ship');
  // The new block holds the rest and the editor, with the caret at its start.
  const second = blocks.nth(2).locator('[contenteditable="true"]');
  await expect(second).toHaveText(' the stack. Now');
  await second.pressSequentially('X', { delay: 20 });
  await expect(second).toHaveText('X the stack. Now');
  await expect.poll(() => page.evaluate(() => window.sent.at(-1))).toMatchObject({ op: 'text' });
  await second.press('Home');
  await second.press('Backspace');
  await expect(blocks).toHaveCount(4);
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

test('/ in an empty paragraph opens the insert menu, which filters and inserts', async ({
  page,
}) => {
  const host = await mountFixture(page);
  // An empty paragraph at rest reads as space; only the focused one shows its placeholder.
  const drawn = () =>
    host
      .locator('[data-block-id="e"] [data-slot="text-block"]')
      .evaluate((node) => getComputedStyle(node, '::before').content);
  expect(['none', 'normal', '""']).toContain(await drawn());
  await host.locator('[data-block-id="e"]').click();
  await expect(host.locator('[data-block-id="e"]')).toContainText('Type / for blocks');
  const editor = host.locator('[data-block-id="e"] [contenteditable="true"]');
  await editor.press('/');
  const menu = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu.getByRole('option')).toHaveText([
    /Paragraph/,
    /Heading/,
    /Table/,
    /To-do/,
    /Code/,
  ]);
  await editor.pressSequentially('to', { delay: 20 });
  await expect(menu.getByRole('option')).toHaveText([/To-do/]);
  // Esc closes and keeps what was typed.
  await editor.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(editor).toHaveText('/to');
  // Typing on after Esc does not reopen it; clearing and typing / again does.
  for (let i = 0; i < 3; i++) await editor.press('Backspace');
  await editor.press('/');
  await editor.pressSequentially('he', { delay: 20 });
  await expect(menu.getByRole('option', { selected: true })).toHaveText(/Heading/);
  await editor.press('Enter');
  await expect(menu).toHaveCount(0);
  // The heading replaced the slash paragraph and holds the editor.
  await expect(host.locator('[data-block-id="e"]')).toHaveCount(0);
  const typedIn = host.locator('[contenteditable="true"]');
  await typedIn.pressSequentially('Next', { delay: 20 });
  // While typing, the heading part is a div with the heading role (valid markup for the editor).
  await expect(host.getByRole('heading', { name: 'Next' })).toBeVisible();
  const sent = await page.evaluate(() => window.sent.map((op) => op.op));
  expect(sent).toContain('insert');
  expect(sent).toContain('delete');
});

test('Esc selects the block, Delete removes it with an Undo line, and ⌘Z brings it back', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const blocks = host.locator('[data-block-id]');
  await host.locator('[data-block-id="p"]').click();
  await host.locator('[data-block-id="p"] [contenteditable="true"]').press('Escape');
  // Typing turned into selecting the block: no editor, the block selected and focused.
  await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(host.locator('[data-block-id="p"]')).toHaveAttribute('data-selected', '');
  await expect(host.locator('[data-block-id="p"]')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
  await expect(blocks).toHaveCount(3);
  const toast = page.getByRole('status').filter({ hasText: 'Deleted 1 block' });
  await expect(toast).toBeVisible();
  // The next block holds the selection, so the keys stay on the page.
  await expect(host.locator('[data-block-id="e"]')).toBeFocused();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(host.locator('[data-block-id="p"]')).toHaveText('Ship the stack.');
  await expect(toast).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.sent.map((op) => op.op)))
    .toEqual(['delete', 'restore']);
  // The keyboard way: ↓ moves the selection, Delete, then ⌘Z (Ctrl+Z off macOS).
  await host.locator('[data-block-id="p"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(host.locator('[data-block-id="e"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(host.locator('[data-block-id="t"]')).toHaveAttribute('data-selected', '');
  await page.keyboard.press('Backspace');
  await expect(host.locator('[data-block-id="t"]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(host.locator('[data-block-id="t"]')).toHaveText('Review');
});

test('typing in a block draws it pixel for pixel as at rest, in valid markup', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const host = await mountFixture(page);
  // Compare only the layout: no selection tint, caret or placeholder.
  await page.addStyleTag({
    content:
      '.tmt-block{background:none!important}[contenteditable]{caret-color:transparent}' +
      '.tmt-block-editor-placeholder{visibility:hidden}',
  });
  for (const id of ['h', 'p', 'e', 't']) {
    const block = host.locator(`[data-block-id="${id}"]`);
    const rest = await block.screenshot();
    const box = await block.boundingBox();
    await block.click();
    await expect(block.locator('[contenteditable="true"]')).toHaveCount(1);
    await page.mouse.move(0, 0);
    expect(await block.boundingBox(), id).toEqual(box);
    expect((await block.screenshot()).equals(rest), `${id} shifts while typing`).toBe(true);
    // No contenteditable root inside a phrasing element (p, h2, h3, span).
    expect(
      await block
        .locator('[contenteditable="true"]')
        .evaluate((node) => node.parentElement!.tagName),
      id,
    ).toBe('DIV');
    await block.locator('[contenteditable="true"]').press('Escape');
    await page.keyboard.press('Escape');
  }
  expect(errors.filter((error) => error.includes('cannot be a descendant'))).toEqual([]);
});

test('the handle opens the block menu, moves and duplicates, and its grip drags a block', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const ids = () =>
    host
      .locator('[data-block-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.blockId));
  await expect.poll(ids).toEqual(['h', 'p', 'e', 't']);
  // Hovering a block shows the one handle beside it.
  await host.locator('[data-block-id="t"]').hover();
  await expect(host.locator('[data-slot="block-handle"]')).toHaveCount(1);
  await expect(host.locator('[data-block-id="t"] [data-slot="block-handle"]')).toBeVisible();
  // ⋯ opens the block menu; Move up moves the to-do above the empty paragraph.
  await host.getByRole('button', { name: 'Block actions' }).click();
  const menu = page.getByRole('menu', { name: 'Block actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Move up/,
    /Move down/,
    /Duplicate/,
    /Delete/,
  ]);
  await menu.getByRole('menuitem', { name: /Move up/ }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(ids).toEqual(['h', 'p', 't', 'e']);
  // The keys: ⌥⇧↓ moves the selected block back, ⌘D duplicates it.
  await expect(host.locator('[data-block-id="t"]')).toBeFocused();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect.poll(ids).toEqual(['h', 'p', 'e', 't']);
  await page.keyboard.press('ControlOrMeta+d');
  await expect.poll(async () => (await ids()).length).toBe(5);
  await expect(host.locator('[data-block-id]').nth(4)).toHaveText('Review');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(ids).toEqual(['h', 'p', 'e', 't']);
  // Dragging the grip: the source dims, the accent line shows where it lands, release drops it.
  const heading = host.locator('[data-block-id="h"]');
  await heading.hover();
  const grip = host.locator('[data-block-id="h"] [data-grip]');
  const from = (await grip.boundingBox())!;
  const below = (await host.locator('[data-block-id="e"]').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, below.y + below.height - 2, { steps: 8 });
  await expect(heading).toHaveAttribute('data-state', 'dragging');
  await expect(host.locator('[data-slot="block-drop"]')).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(ids).toEqual(['p', 'e', 'h', 't']);
  await expect(host.locator('[data-slot="block-drop"]')).toHaveCount(0);
  // The drop was one move op, and the grip's click after a drag opened no menu.
  await expect(menu).toHaveCount(0);
  const sent = await page.evaluate(() => window.sent.map((op) => op.op));
  expect(sent.filter((op) => op === 'move')).toHaveLength(3);
});

test('＋ on the handle opens the insert menu in a new block after it', async ({ page }) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="h"]').hover();
  await host.getByRole('button', { name: 'Insert block' }).click();
  const menu = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu).toBeVisible();
  const editor = host.locator('[contenteditable="true"]');
  await editor.pressSequentially('to', { delay: 20 });
  await expect(menu.getByRole('option')).toHaveText([/To-do/]);
  await editor.press('Enter');
  await expect(host.locator('[data-block-id]').nth(1).locator('[data-slot="todo"]')).toHaveCount(1);
});

test('a gesture shows at once, before the serve commits it', async ({ page }) => {
  const host = await mountFixture(page);
  await page.evaluate(() => window.holdServe(true));
  // Typing, then Esc: the text stays while its op waits.
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await editor.pressSequentially(' Now', { delay: 20 });
  await editor.press('Escape');
  await expect(host.locator('[data-block-id="p"]')).toHaveText('Ship the stack. Now');
  // Delete: the block goes at once.
  await page.keyboard.press('Delete');
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.serveText('p'))).toBe('Ship the stack.');
  await page.evaluate(() => window.holdServe(false));
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toBe('Ship the stack. Now');
  await expect(host.locator('[data-block-id="p"]')).toHaveCount(0);
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
      // Enter at the end makes an empty paragraph; / there opens the insert menu.
      await editor.press('End');
      await editor.press('Enter');
      const empty = host.locator('[contenteditable="true"]');
      await expect(empty).toHaveText('');
      await empty.press('/');
      await empty.pressSequentially('t', { delay: 20 });
      await expect(page.getByRole('listbox', { name: 'Insert a block' })).toBeVisible();
      await page.mouse.move(0, 0);
      // The window as the person sees it: a phone sheet is fixed to the viewport, not the page.
      await page.screenshot({ path: capturePath(`structured-${width}-${theme}-insert.png`) });
      // Esc closes the menu, Esc again selects the block; the table is selected and deleted.
      await empty.press('Escape');
      await empty.press('Escape');
      await page.keyboard.press('ArrowDown');
      await expect(host.locator('[data-block-id="table"]')).toHaveAttribute('data-selected', '');
      await page.screenshot({ path: capturePath(`structured-${width}-${theme}-selected.png`) });
      await page.keyboard.press('Delete');
      await expect(page.getByRole('status').filter({ hasText: 'Deleted 1 block' })).toBeVisible();
      await page.screenshot({ path: capturePath(`structured-${width}-${theme}-deleted.png`) });
      // The block menu on the selected block from the menu key (the phone shows the sheet).
      await page.keyboard.press('Shift+F10');
      await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();
      await page.screenshot({ path: capturePath(`structured-${width}-${theme}-blockmenu.png`) });
      await page.keyboard.press('Escape');
      if (width === 1440) {
        // Dragging the long paragraph by its grip, held over the list.
        const long = host.locator('[data-block-id="long"]');
        await long.hover();
        const grip = (await long.locator('[data-grip]').boundingBox())!;
        const over = (await host.locator('[data-block-id="l2"]').boundingBox())!;
        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x + 4, over.y + over.height - 2, { steps: 8 });
        await expect(host.locator('[data-slot="block-drop"]')).toHaveCount(1);
        await page.screenshot({ path: capturePath(`structured-${width}-${theme}-drag.png`) });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(host.locator('[data-slot="block-drop"]')).toHaveCount(0);
      }
    });

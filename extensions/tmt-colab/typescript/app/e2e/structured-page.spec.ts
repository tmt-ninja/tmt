import { expect, test } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';
import { capturePath } from './captures.js';

async function mountFixture(page: import('@playwright/test').Page, content = 'plan') {
  await page.goto('/');
  await page.evaluate(async (content) => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount(content);
  }, content);
  return page.locator('#structured-page-fixture');
}

async function captureEmptyState(page: import('@playwright/test').Page, name: string) {
  const directory = process.env.COLAB_CONVERSION_CAPTURE_DIR;
  if (!directory) return;
  for (const width of [390, 1440])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await page.screenshot({
        path: `${directory}/${name}-${width}-${theme}.png`,
        animations: 'disabled',
      });
    }
}

test('an empty writer starts the first paragraph with one insert; a reader sees the empty state', async ({
  page,
}) => {
  const host = await mountFixture(page, 'empty');
  await captureEmptyState(page, 'empty-writer-fixture');
  const slot = host.getByRole('button', { name: 'Type / for blocks' });
  await slot.focus();
  await expect(slot).toBeFocused();
  await slot.press('Enter');
  expect(await page.evaluate(() => window.sent)).toHaveLength(0);
  await host.getByRole('textbox', { name: 'Empty paragraph' }).pressSequentially('A');
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(1);
  expect((await page.evaluate(() => window.sent))[0]).toMatchObject({
    op: 'insert',
    type: 'paragraph',
    text: 'A',
  });
  await expect(host.locator('[data-block-id]')).toHaveCount(1);
  await page.reload();
  const reader = await mountFixture(page, 'empty-reader');
  await expect(reader.getByText('This page is empty.')).toBeVisible();
  await captureEmptyState(page, 'empty-reader-fixture');
  await expect(reader.getByRole('button', { name: 'Type / for blocks' })).toHaveCount(0);
});

test('the empty page insert control opens the normal block menu', async ({ page }) => {
  const host = await mountFixture(page, 'empty');
  await host.getByRole('button', { name: 'Insert block' }).click();
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(1);
  expect((await page.evaluate(() => window.sent))[0]).toMatchObject({
    op: 'insert',
    type: 'paragraph',
    text: '/',
  });
  await expect(host.getByRole('listbox')).toBeVisible();
});

test('a refused first insert keeps the text for retry', async ({ page }) => {
  const host = await mountFixture(page, 'empty-failure');
  await host.getByRole('button', { name: 'Type / for blocks' }).click();
  await host.getByRole('textbox', { name: 'Empty paragraph' }).pressSequentially('A');
  await expect(host.getByRole('alert')).toContainText('could not be saved');
  await expect(host.getByRole('textbox', { name: 'Empty paragraph' })).toHaveText('A');
  await host.getByRole('button', { name: 'Retry' }).click();
  await expect(host.locator('[data-block-id]')).toHaveCount(1);
  await expect(host.locator('[data-block-id]')).toHaveText('A');
});

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
    /Question/,
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
  // A ghost of the block follows the pointer.
  const ghost = host.locator('[data-slot="block-ghost"]');
  await expect(ghost).toHaveText('Plan');
  const at = (await ghost.boundingBox())!;
  expect(Math.abs(at.x - (from.x + 4 + 12))).toBeLessThan(2);
  await page.mouse.up();
  await expect.poll(ids).toEqual(['p', 'e', 'h', 't']);
  await expect(host.locator('[data-slot="block-drop"]')).toHaveCount(0);
  await expect(ghost).toHaveCount(0);
  // The drop was one move op, and the grip's click after a drag opened no menu.
  await expect(menu).toHaveCount(0);
  // This tab's batches go in order, each once the one before it settles.
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.sent.map((op) => op.op))).filter((op) => op === 'move'),
    )
    .toHaveLength(3);
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

test('keys typed right after Enter, while the text before is in flight, stay in order', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  // The typing goes out and is held at the serve, so Enter waits for it; the next keys arrive
  // meanwhile, at the split.
  await page.evaluate(() => window.holdServe(true));
  await editor.pressSequentially(' Now', { delay: 20 });
  await expect
    .poll(() => page.evaluate(() => window.sent.some((op) => op.op === 'text')))
    .toBe(true);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Th');
  await page.evaluate(() => window.holdServe(false));
  // Once the page has the new block (and shows its text again), typing goes on after "Th".
  const blocks = host.locator('[data-block-id]');
  await expect(blocks).toHaveCount(5);
  const third = await blocks.nth(2).getAttribute('data-block-id');
  await expect.poll(() => page.evaluate((id) => window.serveText(id!), third)).toBe('Th');
  await page.keyboard.type('ird.');
  await expect(blocks.nth(1)).toHaveText('Ship the stack. Now');
  await expect(blocks.nth(2)).toHaveText('Third.');
  await expect.poll(() => page.evaluate((id) => window.serveText(id!), third)).toBe('Third.');
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

test('marks draw at rest, toggle with the format keys and link a pasted URL', async ({ page }) => {
  const host = await mountFixture(page, 'spec');
  const first = host.locator('[data-block-id="first"]');
  await expect(first.locator('strong')).toHaveText('第一批');
  await expect(first.locator('code')).toHaveText('13');
  await expect(first.locator('em')).toHaveText('ticket');
  await expect(first.getByRole('link')).toHaveAttribute('href', 'https://example.com/spec');
  // A script URL is never a link.
  await expect(host.locator('[data-block-id="unsafe"] a')).toHaveCount(0);
  // Marked text draws the same while typing as at rest.
  await page.addStyleTag({
    content: '.tmt-block{background:none!important}[contenteditable]{caret-color:transparent}',
  });
  const atRest = await first.screenshot({ path: capturePath('structured-marks-rest.png') });
  await first.getByText('種區塊', { exact: false }).click({ position: { x: 4, y: 4 } });
  await expect(first.locator('[contenteditable="true"]')).toHaveCount(1);
  await page.mouse.move(0, 0);
  const typing = await first.screenshot({ path: capturePath('structured-marks-typing.png') });
  expect(typing.equals(atRest), 'marked text shifts while typing').toBe(true);
  await first.locator('[contenteditable="true"]').press('Escape');
  await page.keyboard.press('Escape');
  // A link opens through the page's path, and the block does not start editing.
  await first.getByRole('link').click();
  expect(await page.evaluate(() => window.opened)).toEqual([
    { href: 'https://example.com/spec', newTab: false },
  ]);
  await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);

  // ⌘B on "Plan"'s neighbour: select the first four characters of "Ship the stack." and bold them.
  const plan = await mountFixture(page);
  await plan.locator('[data-block-id="p"]').click();
  const editor = plan.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('Home');
  for (let i = 0; i < 4; i++) await editor.press('Shift+ArrowRight');
  await editor.press('ControlOrMeta+b');
  await expect(editor.locator('strong')).toHaveText('Ship');
  await expect
    .poll(() => page.evaluate(() => window.sent.filter((op) => 'format' in op)))
    .toEqual([{ op: 'text', id: 'p', format: { from: 0, to: 4, mark: 'bold', value: true } }]);
  // Typing inside the bold run stays bold, as the editor draws it.
  await editor.press('ArrowLeft');
  await editor.press('ArrowRight');
  await editor.press('ArrowRight');
  await editor.pressSequentially('X', { delay: 20 });
  // The typing goes with the mark it was typed into, and the page draws it bold once it holds it.
  await expect
    .poll(() => page.evaluate(() => window.sent.filter((op) => 'format' in op).at(-1)))
    .toEqual({ op: 'text', id: 'p', format: { from: 2, to: 3, mark: 'bold', value: true } });
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toBe('ShXip the stack.');
  await expect(editor.locator('strong')).toHaveText('ShXip');
  // A URL pasted over "stack" links it; a script URL is pasted as text.
  await editor.press('End');
  await editor.press('ArrowLeft');
  for (let i = 0; i < 5; i++) await editor.press('Shift+ArrowLeft');
  const paste = (text: string) =>
    editor.evaluate((node, value) => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      node.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  await paste('https://example.com/stack');
  await expect
    .poll(() =>
      page.evaluate(() => window.sent.filter((op) => 'format' in op && op.format.mark === 'link')),
    )
    .toEqual([
      {
        op: 'text',
        id: 'p',
        format: { from: 10, to: 15, mark: 'link', value: 'https://example.com/stack' },
      },
    ]);
  await editor.press('Escape');
  await page.keyboard.press('Escape');
  const rest = plan.locator('[data-block-id="p"]');
  await expect(rest.locator('strong')).toHaveText('ShXip');
  await expect(rest.getByRole('link')).toHaveText('stack');
  // Undo takes the link back.
  await rest.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rest.getByRole('link')).toHaveCount(0);
});

test('numbered lists count their runs, Tab indents, and a to-do ticks', async ({ page }) => {
  const host = await mountFixture(page, 'spec');
  const marker = (id: string) =>
    host.locator(`[data-block-id="${id}"] .tmt-block-list-marker`).textContent();
  expect(await Promise.all(['n1', 'n2', 'n3', 'n4'].map(marker))).toEqual(['1.', '1.', '2.', '2.']);
  // Shift+Tab takes n3 out to the top level: it becomes 2 and n4 becomes 3.
  await host.locator('[data-block-id="n3"]').click();
  await host.locator('[data-block-id="n3"] [contenteditable="true"]').press('Shift+Tab');
  await expect
    .poll(() => Promise.all(['n1', 'n2', 'n3', 'n4'].map(marker)))
    .toEqual(['1.', '1.', '2.', '3.']);
  await expect
    .poll(() => page.evaluate(() => window.sent.filter((op) => op.op === 'props')))
    .toEqual([{ op: 'props', id: 'n3', set: {}, unset: ['indent'] }]);
  // Tab puts it back; the focus stays in the block.
  await host.locator('[data-block-id="n3"] [contenteditable="true"]').press('Tab');
  await expect.poll(() => marker('n4')).toBe('2.');
  await expect(host.locator('[data-block-id="n3"] [contenteditable="true"]')).toBeFocused();

  const plan = await mountFixture(page);
  const todo = plan.locator('[data-block-id="t"]');
  await todo.getByRole('checkbox').click();
  await expect(todo.getByRole('checkbox')).toBeChecked();
  await expect(plan.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.sent))
    .toEqual([{ op: 'props', id: 't', set: { checked: true }, unset: [] }]);
});

test('a work bundle and page views draw owner data only while the page is owner-only', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const bundle = host.locator('[data-block-id="bundle"]');
  await expect(bundle).toContainText('瀏覽器區塊編輯器');
  await expect(bundle).toContainText('瀏覽器編輯器：一個人寫、agent 同時改');
  const pages = host.locator('[data-block-id="pages"]');
  await expect(pages).toContainText('區塊資料模型');
  // An authored row's name is text, never markup.
  await expect(pages).toContainText('<img src=x onerror=alert(1)>');
  await expect(pages.locator('img')).toHaveCount(0);
  const live = host.locator('[data-block-id="live"]');
  await expect(live).toContainText('Colab 區塊');
  // A ticket opens through the page's link path.
  await bundle.getByRole('button', { name: '#6005' }).click();
  expect(await page.evaluate(() => window.opened)).toEqual([
    { href: 'https://github.com/tmt-ninja/tmt/issues/6005', newTab: true },
  ]);
  await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);
  // The gate closes: owner data goes, authored rows stay.
  await page.evaluate(() => window.revokeOwner());
  await expect(bundle).not.toContainText('瀏覽器區塊編輯器');
  await expect(live).not.toContainText('Colab 區塊');
  await expect(pages).toContainText('區塊資料模型');
});

test('a mockup renders only in an opaque sandboxed frame, never in the page', async ({ page }) => {
  await servePageRuntime(page);
  const host = await mountFixture(page, 'spec');
  const mock = host.locator('[data-block-id="mock"]');
  const frame = mock.locator('iframe');
  await expect(frame).toHaveCount(1);
  // The frame is the renderer's: sandboxed without same-origin, so the markup has no parent access.
  const sandbox = await frame.getAttribute('sandbox');
  expect(sandbox).toContain('allow-scripts');
  expect(sandbox).not.toContain('allow-same-origin');
  await expect(
    mock.frameLocator('iframe').getByRole('heading', { name: '手機上的區塊選單' }),
  ).toBeVisible();
  // The markup never reaches the parent's DOM.
  await expect(host.getByRole('heading', { name: '手機上的區塊選單' })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.querySelectorAll('#structured-page-fixture script').length),
  ).toBe(0);
  // The frame takes its page's height, not the viewport's.
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(40);
  expect((await frame.boundingBox())!.height).toBeLessThan(400);
  await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);
  // The stage's theme control paints the frame: Light and Dark are the stage's, Viewer the app's.
  const html = mock.frameLocator('iframe').locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  const themes = mock.getByRole('group', { name: 'Theme' });
  await themes.getByRole('button', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveAttribute('data-colab-scheme', 'dark');
  await themes.getByRole('button', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  await themes.getByRole('button', { name: 'Viewer' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // The sheet insets its content, as the DS stage does.
  const sheet = await mock.locator('.tmt-block-mockup-frame').boundingBox();
  const inner = await frame.boundingBox();
  expect(inner!.x - sheet!.x).toBeGreaterThanOrEqual(8);
  expect(sheet!.y + sheet!.height - (inner!.y + inner!.height)).toBeGreaterThanOrEqual(8);
});

test('a table cell edits in place, Tab walks the cells and adds a row, and the table duplicates', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const table = host.locator('[data-block-id="table"]');
  const editor = table.locator('[contenteditable="true"]');
  const rows = () => page.evaluate(() => window.serveRows('table'));
  const height = (await table.boundingBox())!.height;
  await table.getByText('一般文字').click();
  await expect(editor).toHaveCount(1);
  await expect(editor).toHaveText('一般文字');
  // The cell's editor draws in place: the table keeps its height.
  expect((await table.boundingBox())!.height).toBe(height);
  await editor.press('End');
  await editor.pressSequentially('和清單', { delay: 20 });
  await expect.poll(async () => (await rows())[1]!.cells!.use).toBe('一般文字和清單');
  expect(await page.evaluate(() => window.sent.at(-1))).toEqual({
    op: 'table',
    id: 'table',
    action: 'set-cell',
    row: 'r2',
    column: 'use',
    text: '一般文字和清單',
    base: '一般文字',
    overlap: 'both',
  });
  // An agent edits the same cell while the person types: both edits are kept.
  await editor.pressSequentially('！', { delay: 20 });
  await page.evaluate(() =>
    window.agentBatch([
      {
        op: 'table',
        id: 'table',
        action: 'set-cell',
        row: 'r2',
        column: 'use',
        text: '常用：一般文字和清單',
      },
    ]),
  );
  await expect.poll(async () => (await rows())[1]!.cells!.use).toBe('常用：一般文字和清單！');
  await expect(editor).toHaveText('常用：一般文字和清單！');
  // Tab and Shift+Tab walk the cells in reading order.
  await editor.press('Tab');
  await expect(editor).toHaveText('卡片／區段');
  await editor.press('Shift+Tab');
  await expect(editor).toHaveText('常用：一般文字和清單！');
  await editor.press('Tab');
  await editor.press('Tab');
  await expect(editor).toHaveText('唯一能放其他區塊的區塊');
  // Tab in the last cell adds a row, its first cell focused at once.
  await editor.press('Tab');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(editor).toHaveText('');
  await editor.pressSequentially('圖片', { delay: 20 });
  await expect
    .poll(async () => (await rows()).map((row) => row.cells?.name))
    .toEqual(['小標題', '段落', '卡片／區段', '圖片']);
  // Esc selects the table; ⌘Z takes the added row back.
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(table).toHaveAttribute('data-selected', '');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect.poll(async () => (await rows()).length).toBe(3);
  // ⌘D: a copy right after it, with copies of its rows (new IDs, the same cells).
  await table.focus();
  await page.keyboard.press('ControlOrMeta+d');
  const tables = host.locator('[data-block-id]').filter({ has: page.getByRole('table') });
  await expect(tables).toHaveCount(2);
  const copy = tables.nth(1);
  await expect(copy.locator('tbody tr')).toHaveCount(3);
  await expect(copy.locator('tbody')).toHaveText((await table.locator('tbody').textContent())!);
  const copyId = (await copy.getAttribute('data-block-id'))!;
  const copied = () => page.evaluate((id) => window.serveRows(id), copyId);
  const cells = (await rows()).map((row) => row.cells);
  await expect.poll(async () => (await copied()).map((row) => row.cells)).toEqual(cells);
  expect((await copied()).map((row) => row.id)).not.toContain('r1');
  // The copy is selected; Enter on a selected table goes to its first cell.
  await expect(copy).toHaveAttribute('data-selected', '');
  await expect(table).not.toHaveAttribute('data-selected', '');
  await page.keyboard.press('Enter');
  await expect(copy.locator('[contenteditable="true"]')).toHaveText('小標題');
});

test('the row and column menus add and remove rows, and add, rename, move and remove columns', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const table = host.locator('[data-block-id="table"]');
  const ids = async () => (await page.evaluate(() => window.serveRows('table'))).map((r) => r.id);
  const names = async () =>
    (await page.evaluate(() => window.serveColumns('table'))).map((c) => c.name);
  const item = (name: string) => page.getByRole('menuitem', { name, exact: true });
  const headings = table.locator('thead .tmt-block-table-heading > span:first-child');
  // A row's ⋯ is quiet until the row is hovered.
  const rowMenu = table.getByRole('button', { name: 'Row 2 actions' });
  await expect(
    rowMenu.locator('xpath=ancestor::span[contains(@class, "tmt-block-table-action")]'),
  ).toHaveCSS('opacity', '0');
  await table.locator('tbody tr').nth(1).hover();
  await expect(
    rowMenu.locator('xpath=ancestor::span[contains(@class, "tmt-block-table-action")]'),
  ).toHaveCSS('opacity', '1');
  // Insert a row above row 2: its first cell opens at once.
  await rowMenu.click();
  await item('Insert a row above').click();
  await expect(table.locator('tbody tr')).toHaveCount(4);
  const editor = table.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('清單', { delay: 20 });
  await expect.poll(ids).toHaveLength(4);
  const added = (await ids())[1]!;
  expect((await ids()).filter((id) => id !== added)).toEqual(['r1', 'r2', 'r3']);
  await expect
    .poll(async () => (await page.evaluate(() => window.serveRows('table')))[1]!.cells)
    .toEqual({ name: '清單' });
  // Remove it from its own menu; the open cell closes with it.
  await table.locator('tbody tr').nth(1).hover();
  await table.getByRole('button', { name: 'Row 2 actions' }).click();
  await item('Remove the row').click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(editor).toHaveCount(0);
  await expect.poll(ids).toEqual(['r1', 'r2', 'r3']);
  // Insert below the last row.
  await table.locator('tbody tr').nth(2).hover();
  await table.getByRole('button', { name: 'Row 3 actions' }).click();
  await item('Insert a row below').click();
  await expect.poll(async () => (await ids()).length).toBe(4);
  expect((await ids()).slice(0, 3)).toEqual(['r1', 'r2', 'r3']);
  await editor.press('Escape');

  // Columns: the first cannot move left; a table keeps one column.
  const columnMenu = (name: string) =>
    table.getByRole('button', { name: `Column actions: ${name}` });
  await columnMenu('區塊').click();
  await expect(item('Move left')).toBeDisabled();
  await expect(item('Move right')).toBeEnabled();
  await page.keyboard.press('Escape');
  // Add a column after 用途: its name field opens with the new name selected.
  await columnMenu('用途').click();
  await item('Add a column after').click();
  const field = table.getByRole('textbox', { name: 'Column name' });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Column 3');
  await field.fill('備註');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect.poll(names).toEqual(['區塊', '用途', '備註']);
  await expect(headings).toHaveText(['區塊', '用途', '備註']);
  // Move it left, then rename it; Esc in the name field keeps the old name.
  await columnMenu('備註').click();
  await item('Move left').click();
  await expect.poll(names).toEqual(['區塊', '備註', '用途']);
  await columnMenu('備註').click();
  await item('Rename').click();
  await field.fill('不要');
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  await columnMenu('備註').click();
  await item('Rename').click();
  await field.fill('說明');
  await field.press('Enter');
  await expect.poll(names).toEqual(['區塊', '說明', '用途']);
  // A cell under the new column edits like any other; a click anywhere in the empty cell opens it.
  await table.locator('tbody tr').first().locator('td').first().click();
  await editor.pressSequentially('常用', { delay: 20 });
  const column = (await page.evaluate(() => window.serveColumns('table')))[1]!.id;
  await expect
    .poll(async () => (await page.evaluate(() => window.serveRows('table')))[0]!.cells?.[column])
    .toBe('常用');
  await editor.press('Escape');
  // Remove it; ⌘Z brings it back between the same columns, with its cells.
  await columnMenu('說明').click();
  await item('Remove the column').click();
  await expect.poll(names).toEqual(['區塊', '用途']);
  await expect(headings).toHaveText(['區塊', '用途']);
  await table.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(names).toEqual(['區塊', '說明', '用途']);
  await expect(table.locator('tbody tr').first()).toContainText('常用');
});

test('an empty table offers Add a row, which adds one and focuses its first cell', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  await page.evaluate(() =>
    window.agentBatch([
      {
        op: 'insert',
        id: 'empty',
        type: 'table',
        parent: 'root',
        after: 'table',
        props: { label: '空表格', columns: [{ id: 'x', name: '項目' }] },
      },
    ]),
  );
  const empty = host.locator('[data-block-id="empty"]');
  const add = empty.getByRole('button', { name: 'Add a row' });
  await expect(add).toBeVisible();
  await add.click();
  const editor = empty.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await editor.pressSequentially('第一列', { delay: 20 });
  await expect
    .poll(() => page.evaluate(() => window.serveRows('empty').map((row) => row.cells)))
    .toEqual([{ x: '第一列' }]);
  await expect(add).toHaveCount(0);
});

for (const [width, theme] of [
  [1440, 'light'],
  [1440, 'dark'],
  [390, 'light'],
  [390, 'dark'],
] as const)
  test(`a question block answers through the page discussion, bound to its question ${width} ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    const host = await mountFixture(page, 'spec');
    const question = host.locator('[data-block-id="7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b"]');
    await expect(question.getByRole('group', { name: '先做哪個區塊？' })).toBeVisible();
    // The question allows no Other answer, so the part offers none.
    await expect(question.getByLabel('Other…')).toHaveCount(0);
    await question.getByLabel('圖片', { exact: true }).check();
    await question.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await question.screenshot({
      path: capturePath(`structured-question-${width}-${theme}-waiting.png`),
    });
    await question.getByRole('button', { name: /Send/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.answers()))
      .toEqual([
        {
          body: 'Answer to “先做哪個區塊？”: 圖片\nPage: 區塊編輯器',
          questionId: '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
        },
      ]);
    // The recorded answer folds the question to its answered line.
    await expect(question.getByRole('button', { name: /先做哪個區塊？.*圖片/ })).toBeVisible();
    await page.mouse.move(0, 0);
    await question.screenshot({
      path: capturePath(`structured-question-${width}-${theme}-answered.png`),
    });
    // Answering never starts editing the block, and sends no block op.
    await expect(host.locator('[contenteditable="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.sent)).toEqual([]);
  });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`a filled table and its row and column menus at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const host = await mountFixture(page, 'spec');
      const table = host.locator('[data-block-id="table"]');
      // Filled: a third column the phone folds away, and long cells that wrap.
      await page.evaluate(() =>
        window.agentBatch([
          {
            op: 'table',
            id: 'table',
            action: 'add-column',
            column: { id: 'note', name: '備註', hideNarrow: true },
          },
          ...(
            [
              ['r1', '只有兩層'],
              ['r2', '行內只有粗體、斜體、行內程式碼、連結、@agent 和 @區塊'],
              ['r3', '只有一層，卡片裡不能再放卡片'],
            ] as const
          ).map(([row, text]) => ({
            op: 'table' as const,
            id: 'table',
            action: 'set-cell' as const,
            row,
            column: 'note',
            text,
          })),
        ]),
      );
      await expect(table.locator('thead th')).toHaveCount(4);
      await table.scrollIntoViewIfNeeded();
      const shot = async (name: string, below = 0) => {
        const box = (await table.boundingBox())!;
        await page.screenshot({
          path: capturePath(`structured-table-${width}-${theme}-${name}.png`),
          clip: {
            x: 0,
            y: Math.max(0, box.y - 16),
            width,
            height: box.height + 32 + below,
          },
        });
      };
      await page.mouse.move(0, 0);
      await shot('filled');
      // Short labels never break while there is room: each row of the label columns is one line.
      const labels = table.locator('tbody th');
      const heights = await labels.evaluateAll((cells) =>
        cells.map((cell) => Math.round(cell.getBoundingClientRect().height)),
      );
      const line = await table
        .locator('tbody tr')
        .first()
        .evaluate((row) => Math.round(row.getBoundingClientRect().height));
      if (width === 1440) expect(heights).toEqual([line, heights[1], line]);
      // The label columns hug their content; the long 備註 column wraps in what is left.
      expect(
        await table
          .locator('thead th')
          .evaluateAll((cells) =>
            cells.slice(0, 3).map((cell) => getComputedStyle(cell).whiteSpace),
          ),
      ).toEqual(['nowrap', 'nowrap', 'normal']);
      // The phone folds the 備註 column; its cells stay in the DOM.
      const note = table.locator('thead th').nth(2);
      if (width === 390) await expect(note).toBeHidden();
      else await expect(note).toBeVisible();
      const weight = (name: string) =>
        page.getByRole('menuitem', { name }).evaluate((node) => getComputedStyle(node).fontWeight);
      await table.locator('tbody tr').nth(1).hover();
      await table.getByRole('button', { name: 'Row 2 actions' }).click();
      await expect(page.getByRole('menuitem', { name: 'Insert a row above' })).toBeVisible();
      await shot('row-menu', 200);
      const bodyWeight = await weight('Insert a row above');
      await page.keyboard.press('Escape');
      await table.getByRole('button', { name: 'Column actions: 用途' }).click();
      await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
      await shot('column-menu', 260);
      // The menu in a heading cell draws at the same weight as the one in a body cell.
      expect(await weight('Rename')).toBe(bodyWeight);
      await page.keyboard.press('Escape');
      const boxes = () =>
        table.locator('thead th').evaluateAll((cells) =>
          cells.map((cell) => {
            const box = cell.getBoundingClientRect();
            return [box.x, box.width, box.height].map(Math.round);
          }),
        );
      const resting = await boxes();
      await table.getByRole('button', { name: 'Column actions: 用途' }).click();
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      const field = table.getByRole('textbox', { name: 'Column name' });
      await expect(field).toBeFocused();
      // The field takes the heading's own box: no column moves or grows.
      expect(await boxes()).toEqual(resting);
      await shot('rename');
      await page.keyboard.press('Escape');
      // Density (#6196): roomy is the default and today's look; compact is the token step down.
      const cell = () =>
        table
          .locator('tbody td')
          .first()
          .evaluate((node) => {
            const style = getComputedStyle(node);
            return {
              padding: style.padding,
              size: style.fontSize,
              line: style.lineHeight,
              row: Math.round(node.closest('tr')!.getBoundingClientRect().height),
            };
          });
      const slot = table.locator('[data-slot="table-block"]');
      await expect(slot).toHaveAttribute('data-density', 'roomy');
      const roomy = await cell();
      expect(roomy).toMatchObject({ padding: '8px 12px 8px 0px', size: '15px', line: '24px' });
      // Row heights are whole-pixel rounding of the computed box above (Linux CI draws 42px where
      // macOS draws 41px), so they hold within a pixel; the computed values are exact.
      if (width === 1440) expect(Math.abs(roomy.row - 41)).toBeLessThanOrEqual(1);
      await page.evaluate(() =>
        window.agentBatch([{ op: 'props', id: 'table', set: { density: 'compact' }, unset: [] }]),
      );
      await expect(slot).toHaveAttribute('data-density', 'compact');
      const compact = await cell();
      expect(compact).toMatchObject({ padding: '4px 12px 4px 0px', size: '14px', line: '19.6px' });
      // 19.6px text plus 8px padding is 29px; a writer's row menu button (24px, in its padded cell)
      // holds the row at 32px.
      if (width === 1440) {
        expect(Math.abs(compact.row - 32)).toBeLessThanOrEqual(1);
        expect(compact.row).toBeLessThan(roomy.row);
      }
      await page.mouse.move(0, 0);
      await shot('compact');
    });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`the spec page draws read-only and mid-typing at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await servePageRuntime(page);
      const host = await mountFixture(page, 'spec');
      await expect(host.locator('[data-block-id]')).toHaveCount(24);
      await expect(host.getByRole('table')).toContainText('唯一能放其他區塊的區塊');
      // The mockup's frame has drawn its page.
      await expect(
        host
          .locator('[data-block-id="mock"]')
          .frameLocator('iframe')
          .getByRole('heading', { name: '手機上的區塊選單' }),
      ).toBeVisible();
      // ...and taken its page's height.
      await expect
        .poll(
          async () => (await host.locator('[data-block-id="mock"] iframe').boundingBox())!.height,
        )
        .toBeGreaterThan(40);
      // A full-page capture does not paint a sandboxed (cross-origin) frame: the mockup is captured
      // on its own, in view.
      await host.locator('[data-block-id="mock"]').scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      // Each stage theme: Viewer (the app's), then the stage's own Light and Dark.
      const mock = host.locator('[data-block-id="mock"]');
      const html = mock.frameLocator('iframe').locator('html');
      for (const stage of ['Viewer', 'Light', 'Dark'] as const) {
        await mock
          .getByRole('group', { name: 'Theme' })
          .getByRole('button', { name: stage })
          .click();
        // The frame paints the theme once its page's scheme follows it.
        const painted = stage === 'Viewer' ? theme : stage.toLowerCase();
        await expect(html).toHaveAttribute('data-theme', painted);
        await expect(html).toHaveAttribute('data-colab-scheme', painted);
        await page.mouse.move(0, 0);
        await mock.screenshot({
          path: capturePath(`structured-${width}-${theme}-mockup-${stage.toLowerCase()}.png`),
        });
      }
      await mock
        .getByRole('group', { name: 'Theme' })
        .getByRole('button', { name: 'Viewer' })
        .click();
      await page.evaluate(() => scrollTo(0, 0));
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
        await expect(host.locator('[data-slot="block-ghost"]')).toBeVisible();
        await page.screenshot({ path: capturePath(`structured-${width}-${theme}-drag.png`) });
        // Over the card's middle the block would go into it: the card takes the selection tint.
        const card = (await host.locator('[data-block-id="card"]').boundingBox())!;
        await page.mouse.move(grip.x + 4, card.y + card.height / 2, { steps: 8 });
        await expect(host.locator('[data-block-id="card"]')).toHaveAttribute('data-selected', '');
        await page.screenshot({ path: capturePath(`structured-${width}-${theme}-drag-card.png`) });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(host.locator('[data-slot="block-drop"]')).toHaveCount(0);
      }
    });

/** A new question block from the insert menu after the spec page's first paragraph, its editor
 * open. */
async function insertQuestion(page: import('@playwright/test').Page) {
  const host = await mountFixture(page, 'spec');
  // Enter at the end of a paragraph, then / in the new empty one.
  await host.locator('[data-block-id="first"]').click();
  const editor = host.locator('[contenteditable="true"]');
  await editor.press('End');
  await editor.press('Enter');
  await expect(editor).toHaveText('');
  await editor.press('/');
  await editor.pressSequentially('q', { delay: 20 });
  await expect(
    page.getByRole('listbox', { name: 'Insert a block' }).getByRole('option'),
  ).toHaveText([/Question/]);
  await editor.press('Enter');
  const edit = host.getByRole('group', { name: 'Edit question' });
  await expect(edit.getByLabel('Question')).toBeFocused();
  const id = await edit.evaluate((node) =>
    node.closest('[data-block-id]')!.getAttribute('data-block-id')!,
  );
  return { host, edit, id, block: host.locator(`[data-block-id="${id}"]`) };
}

test('a person inserts, edits, answers and deletes a question block (#6194)', async ({ page }) => {
  const { host, edit, id, block } = await insertQuestion(page);
  const sent = () => page.evaluate(() => window.sent);
  await expect.poll(sent).toContainEqual(
    expect.objectContaining({
      op: 'insert',
      id,
      type: 'question',
      props: { kind: 'single', choices: [], other: true },
    }),
  );
  // The recipient is named, read-only: the page's creator.
  await expect(edit).toContainText('Answers go to gui-2');
  // Enter on the title goes to a first choice; Enter on a choice adds the next.
  await edit.getByLabel('Question').fill('先做哪一種？');
  await edit.getByLabel('Question').press('Enter');
  await expect(edit.getByLabel('Choice 1', { exact: true })).toBeFocused();
  await page.keyboard.type('表格');
  await page.keyboard.press('Enter');
  await expect(edit.getByLabel('Choice 2', { exact: true })).toBeFocused();
  await page.keyboard.type('圖片');
  await page.keyboard.press('Enter');
  // Backspace in the new empty choice removes it and returns to the one before.
  await page.keyboard.press('Backspace');
  await expect(edit.getByLabel('Choice 3', { exact: true })).toHaveCount(0);
  await expect(edit.getByLabel('Choice 2', { exact: true })).toBeFocused();
  await expect(edit.getByText('Other…')).toBeVisible();
  await edit.getByRole('button', { name: 'Several' }).click();
  await expect(edit.getByRole('button', { name: 'Several' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await edit.getByRole('button', { name: 'Done' }).click();
  await expect(edit).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((id) => window.serveProps(id), id))
    .toEqual({ kind: 'multiple', choices: ['表格', '圖片'], other: true });
  expect(await page.evaluate((id) => window.serveText(id), id)).toBe('先做哪一種？');
  // At rest a writer's card offers Edit, which opens the editor again; Esc closes it.
  await block.getByRole('button', { name: 'Edit' }).click();
  await expect(
    host.getByRole('group', { name: 'Edit question' }).getByLabel('Question'),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(host.getByRole('group', { name: 'Edit question' })).toHaveCount(0);
  // The answer card sends to the creator through the discussion.
  const card = block.getByRole('group', { name: '先做哪一種？' });
  await card.getByLabel('圖片', { exact: true }).check();
  await card.getByRole('button', { name: /Send/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.answers()))
    .toContainEqual(expect.objectContaining({ questionId: id }));
  // The block menu deletes it, with its Undo line.
  await block.hover();
  await host.getByRole('button', { name: 'Block actions' }).click();
  await page
    .getByRole('menu', { name: 'Block actions' })
    .getByRole('menuitem', { name: /Delete/ })
    .click();
  await expect(block).toHaveCount(0);
  await expect.poll(sent).toContainEqual({ op: 'delete', id });
});

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`a question's editor keeps the waiting card's box at ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const { edit, id, block } = await insertQuestion(page);
      const shot = async (name: string) => {
        await page.mouse.move(0, 0);
        await block.scrollIntoViewIfNeeded();
        await block.screenshot({
          path: capturePath(`structured-question-${width}-${theme}-${name}.png`),
        });
      };
      await shot('editor-empty');
      await edit.getByLabel('Question').fill('先做哪個區塊？');
      await edit.getByLabel('Question').press('Enter');
      for (const choice of ['表格', '圖片', '提示框']) {
        await page.keyboard.type(choice);
        await page.keyboard.press('Enter');
      }
      await page.keyboard.press('Backspace');
      await shot('editing');
      // The same question at rest: the box is as wide, with the same padding and type.
      const box = async (selector: string) =>
        block
          .locator(selector)
          .first()
          .evaluate((node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return { width: rect.width, padding: style.padding, font: style.font };
          });
      const editing = {
        section: await box('.tmt-block-question'),
        title: await box('h3'),
      };
      // An unfocused choice reads as the card's choice; Done is below the kind, at the left.
      const chip = (selector: string) =>
        block
          .locator(selector)
          .first()
          .evaluate((node) => {
            const style = getComputedStyle(node);
            return { weight: style.fontWeight, size: style.fontSize, color: style.color };
          });
      const editingChip = await chip('.tmt-block-question-choice-edit');
      const kind = (await edit.getByRole('group', { name: 'Answer type' }).boundingBox())!;
      const doneBox = (await edit.getByRole('button', { name: 'Done' }).boundingBox())!;
      expect(doneBox.y).toBeGreaterThanOrEqual(kind.y + kind.height);
      await edit.getByRole('button', { name: 'Done' }).click();
      await expect(block.getByRole('group', { name: '先做哪個區塊？' })).toBeVisible();
      await shot('rest');
      expect({ section: await box('.tmt-block-question'), title: await box('h3') }).toEqual(
        editing,
      );
      expect(await chip('.tmt-block-question-choices label')).toEqual(editingChip);
      // The title is the DS card title, a space-m step under the meta line.
      const heading = await block.locator('h3').evaluate((node) => {
        const style = getComputedStyle(node);
        const token = (name: string) => {
          const probe = document.createElement('div');
          probe.style.width = `var(${name})`;
          node.append(probe);
          const value = getComputedStyle(probe).width;
          probe.remove();
          return value;
        };
        return {
          size: style.fontSize === token('--tmt-ui-card-title-size'),
          gap: style.marginTop === token('--tmt-ui-space-m'),
          weight: style.fontWeight === style.getPropertyValue('--tmt-ui-card-title-weight').trim(),
        };
      });
      expect(heading).toEqual({ size: true, gap: true, weight: true });
      const sendBox = (await block.getByRole('button', { name: 'Send' }).boundingBox())!;
      expect(sendBox.x).toBe(doneBox.x);
      expect(sendBox.height).toBe(doneBox.height);
      const editBox = (await block.getByRole('button', { name: 'Edit' }).boundingBox())!;
      expect(editBox.height).toBe(sendBox.height);
      // 20 choices and a long title, from an agent once this tab's edits have committed.
      await expect
        .poll(() => page.evaluate((id) => window.serveProps(id)?.choices, id))
        .toEqual(['表格', '圖片', '提示框']);
      await page.evaluate(
        (id) =>
          window.agentBatch([
            {
              op: 'text',
              id,
              set: '這一題的題目很長：先做哪一個區塊，才能讓 agent 和人在同一頁上一起編輯、拖曳和回答，又不會讓版面跑掉？',
              base: '先做哪個區塊？',
            },
            {
              op: 'props',
              id,
              set: { choices: Array.from({ length: 20 }, (_, n) => `選項 ${n + 1}`) },
              unset: [],
            },
          ]),
        id,
      );
      await expect(block.getByLabel('選項 20', { exact: true })).toBeVisible();
      await shot('full-rest');
      await block.getByRole('button', { name: 'Edit' }).click();
      const open = block.getByRole('group', { name: 'Edit question' });
      await expect(open.getByLabel('Choice 20', { exact: true })).toHaveValue('選項 20');
      // At the limit there is no Add a choice.
      await expect(open.getByRole('button', { name: 'Add a choice' })).toHaveCount(0);
      await shot('full-editing');
    });

const IMAGE_C = 'c3d4e5f6-0000-4000-8000-000000000003';
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`an image block draws only the page's attachments, in the spec's states, at ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const outside: string[] = [];
      await page.route('https://example.com/**', (route) => {
        outside.push(route.request().url());
        return route.abort();
      });
      // Loading: the reads wait, so each held image is its grey tile.
      await page.goto('/');
      await page.evaluate(async () => {
        const path = '/test/structured-page-browser.tsx';
        (await import(path)).mount('spec');
        window.holdImages();
      });
      const host = page.locator('#structured-page-fixture');
      const pics = host.locator('[data-block-id="pics"]');
      await pics.scrollIntoViewIfNeeded();
      const shot = async (name: string) => {
        await page.mouse.move(0, 0);
        await pics.screenshot({
          path: capturePath(`structured-image-${width}-${theme}-${name}.png`),
        });
      };
      const tile = (alt: string) => pics.getByRole('group', { name: alt, exact: true });
      const slot = (locator: import('@playwright/test').Locator) =>
        locator.evaluate((node) => Math.round(node.getBoundingClientRect().height));
      await expect(pics.locator('.tmt-block-image-placeholder')).toHaveCount(3);
      await shot('loading');
      await page.evaluate(() => window.releaseImages());
      // Ready: the two attachments draw from the read; the outside URL is a not-found tile.
      const drawn = pics.locator('img');
      await expect(drawn).toHaveCount(2);
      await expect
        .poll(() =>
          drawn.evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).naturalWidth)),
        )
        .toEqual([320, 320]);
      await expect(drawn.first()).toHaveAttribute('alt', '插入選單的草圖');
      // No alt text: the caption stands in.
      await expect(drawn.nth(1)).toHaveAttribute('alt', '手機上的把手');
      await expect(drawn.first()).toHaveAttribute('src', /^data:image\/png;base64,/);
      // Any other source: never fetched, an honest not-found tile in the image's slot, no Retry.
      await expect(tile('外部圖片')).toHaveText('Image not shown on this page');
      await expect(tile('外部圖片').getByRole('button')).toHaveCount(0);
      expect(await slot(tile('外部圖片'))).toBe(await slot(drawn.first()));
      expect((await page.evaluate(() => window.imageReads)).sort()).toEqual([
        'a1b2c3d4-0000-4000-8000-000000000001',
        'b2c3d4e5-0000-4000-8000-000000000002',
      ]);
      // Captions and a failed tile's copy are the small secondary caption.
      const caption = await pics
        .locator('figcaption')
        .first()
        .evaluate((node) => {
          const style = getComputedStyle(node);
          const probe = document.createElement('span');
          probe.style.color = 'var(--tmt-ui-color-secondary)';
          node.append(probe);
          const secondary = getComputedStyle(probe).color;
          probe.remove();
          return {
            size: style.fontSize,
            weight: style.fontWeight,
            secondary: style.color === secondary,
          };
        });
      expect(caption).toEqual({ size: '12px', weight: '400', secondary: true });
      expect(
        await tile('外部圖片').evaluate((node) => [
          getComputedStyle(node).fontSize,
          getComputedStyle(node).fontWeight,
        ]),
      ).toEqual(['12px', '400']);
      await shot('grid');
      // A carousel with a failed read in the middle, and a file the page does not hold.
      await page.evaluate(
        ({ failing }) =>
          window.agentBatch([
            {
              op: 'props',
              id: 'pics',
              set: {
                layout: 'carousel',
                images: [
                  { src: 'colab-attachment:a1b2c3d4', alt: '插入選單的草圖', caption: '插入選單' },
                  { src: `colab-attachment:${failing}`, alt: '讀不到的圖', caption: '讀取失敗' },
                  { src: 'colab-attachment:ffffffff', alt: '不在這頁', caption: '不在這頁的檔案' },
                  {
                    src: 'colab-attachment:b2c3d4e5',
                    alt: '手機上的把手',
                    caption: '手機上的把手',
                  },
                ],
              },
              unset: [],
            },
          ]),
        { failing: IMAGE_C },
      );
      await expect(tile('讀不到的圖')).toContainText('× Failed to load');
      await expect(tile('不在這頁')).toHaveText('File not found');
      await expect(tile('不在這頁').getByRole('button')).toHaveCount(0);
      // Each failed tile keeps the slot of the images beside it.
      await expect(pics.locator('img')).toHaveCount(2);
      const height = await slot(pics.locator('img').first());
      expect(await slot(tile('讀不到的圖'))).toBe(height);
      expect(await slot(tile('不在這頁'))).toBe(height);
      // Retry is the DS button at its small size, under the copy.
      const retry = tile('讀不到的圖').getByRole('button', { name: 'Retry' });
      await expect(retry).toHaveAttribute('data-slot', 'button');
      await expect(retry).toHaveAttribute('data-size', 'sm');
      // The image opener's reset never reaches it: it keeps the button's border.
      expect(await retry.evaluate((node) => getComputedStyle(node).borderTopStyle)).toBe('solid');
      expect(
        await retry.evaluate(
          (node) => getComputedStyle(node).borderTopColor !== 'rgba(0, 0, 0, 0)',
        ),
      ).toBe(true);
      await shot('carousel-failed');
      // Retry (the failed read only) reads it again.
      await page.evaluate(() => (window.failImage = false));
      await tile('讀不到的圖').getByRole('button', { name: 'Retry' }).click();
      await expect(pics.locator('img')).toHaveCount(3);
      await expect(pics.getByRole('img', { name: '讀不到的圖' })).toBeVisible();
      expect(outside).toEqual([]);
    });

test('deleting an image block and undoing it draws the image again', async ({ page }) => {
  const host = await mountFixture(page, 'spec');
  const pics = host.locator('[data-block-id="pics"]');
  await pics.scrollIntoViewIfNeeded();
  await expect(pics.locator('img')).toHaveCount(2);
  await pics.hover();
  await host.getByRole('button', { name: 'Block actions' }).click();
  await page
    .getByRole('menu', { name: 'Block actions' })
    .getByRole('menuitem', { name: /Delete/ })
    .click();
  await expect(pics).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(pics.locator('img')).toHaveCount(2);
  await expect
    .poll(() =>
      pics
        .locator('img')
        .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).naturalWidth)),
    )
    .toEqual([320, 320]);
});

/** Drops (or pastes) files on a block: a PNG drawn in the page and plain-text files. */
async function addFiles(
  page: import('@playwright/test').Page,
  target: string,
  files: { name: string; png?: string; text?: string }[],
  how: 'drop' | 'paste' = 'drop',
) {
  await page.evaluate(
    async ({ target, files, how }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        let blob: Blob;
        if (file.png) {
          const canvas = new OffscreenCanvas(240, 160);
          const context = canvas.getContext('2d')!;
          context.fillStyle = file.png;
          context.fillRect(0, 0, 240, 160);
          blob = await canvas.convertToBlob({ type: 'image/png' });
        } else blob = new Blob([file.text ?? ''], { type: 'text/plain' });
        transfer.items.add(new File([blob], file.name, { type: blob.type }));
      }
      const at = document.querySelector(`[data-block-id="${target}"]`)!;
      const node = how === 'paste' ? (at.querySelector('[contenteditable="true"]') ?? at) : at;
      node.dispatchEvent(
        how === 'paste'
          ? new ClipboardEvent('paste', {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { target, files, how },
  );
}

/** The blocks at the top level, in drawing order. */
const topLevel = (host: import('@playwright/test').Locator) =>
  host.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>('[data-block-id]')]
      .filter((block) => !block.parentElement?.closest('[data-block-id]'))
      .map((block) => block.dataset.blockId),
  );

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`dropped files upload as an image and a file card after the block, at ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const host = await mountFixture(page, 'spec');
      const blocks = await topLevel(host);
      const after = blocks[1]!;
      await page.evaluate(() => window.holdUploads());
      await addFiles(page, after, [
        { name: 'board.png', png: '#c8553d' },
        { name: 'notes.txt', text: 'Ship the stack.\n' },
      ]);
      // The file's grey tile shows at once, after the block it was dropped on (the second file
      // waits for the first upload).
      await expect.poll(async () => (await topLevel(host)).length).toBe(blocks.length + 1);
      const now = await topLevel(host);
      expect(now.slice(0, 2)).toEqual(blocks.slice(0, 2));
      const tile = host.locator(`[data-block-id="${now[2]}"]`);
      await expect(tile.locator('.tmt-block-image-placeholder')).toHaveCount(1);
      await expect(tile.locator('.tmt-block-image-failed')).toHaveCount(0);
      await tile.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await tile.screenshot({
        path: capturePath(`structured-upload-${width}-${theme}-loading.png`),
      });
      await page.evaluate(() => window.releaseUploads());
      // The image reads back through the page's authorized read; the text file is a card.
      const image = host.locator(`[data-block-id="${now[2]}"] img`);
      await expect(image).toHaveAttribute('alt', 'board.png');
      await expect
        .poll(() => image.evaluate((n) => (n as HTMLImageElement).naturalWidth))
        .toBe(240);
      const card = host.locator('.tmt-block-file');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('notes.txt');
      // The spec's card: name, its size in the caption style, Download; no media type string.
      await expect(card.locator('.tmt-block-file-size')).toHaveText('16 B');
      await expect(card).not.toContainText('text/plain');
      // The card never carries the raw reference as a link: Download asks the page's confirmed path.
      await expect(card.locator('a')).toHaveCount(0);
      await card.getByRole('button', { name: 'Download notes.txt' }).click();
      expect(await page.evaluate(() => window.downloads)).toEqual([
        await page.evaluate(() => window.listedFiles[1]![0]!),
      ]);
      const final = await topLevel(host);
      expect(final).toHaveLength(blocks.length + 2);
      expect(final.slice(0, 2)).toEqual(blocks.slice(0, 2));
      // Bytes, not names, decided each type; each file was listed in its block's own batch.
      expect(await page.evaluate(() => window.uploaded)).toEqual([
        { filename: 'board.png', mediaType: 'image/png', size: expect.any(Number) },
        { filename: 'notes.txt', mediaType: 'text/plain', size: 16 },
      ]);
      await expect
        .poll(() => page.evaluate(() => window.listedFiles.map((ids) => ids.length)))
        .toEqual([1, 1]);
      await host.locator(`[data-block-id="${final[2]}"]`).scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await host
        .locator(`[data-block-id="${final[3]}"]`)
        .screenshot({ path: capturePath(`structured-upload-${width}-${theme}-file.png`) });
    });

test('a pasted image goes after the focused block, and delete and Undo bring it back', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const blocks = await topLevel(host);
  const at = blocks.indexOf('l2');
  await host.locator('[data-block-id="l2"]').getByText('滑過或選取是淡色底。').click();
  await expect(host.locator('[data-block-id="l2"] [contenteditable="true"]')).toBeFocused();
  await addFiles(page, 'l2', [{ name: 'shot.png', png: '#2d6a8f' }], 'paste');
  const now = () => topLevel(host);
  await expect.poll(async () => (await now()).length).toBe(blocks.length + 1);
  const added = (await now())[at + 1]!;
  const image = host.locator(`[data-block-id="${added}"] img`);
  await expect.poll(() => image.evaluate((n) => (n as HTMLImageElement).naturalWidth)).toBe(240);
  // The list item keeps its text: the paste took only the file.
  expect(await page.evaluate(() => window.serveText('l2'))).toBe('滑過或選取是淡色底。');
  await page.keyboard.press('Escape');
  const block = host.locator(`[data-block-id="${added}"]`);
  await block.hover();
  await block.getByRole('button', { name: 'Block actions' }).click();
  await page
    .getByRole('menu', { name: 'Block actions' })
    .getByRole('menuitem', { name: /Delete/ })
    .click();
  await expect(block).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => image.evaluate((n) => (n as HTMLImageElement).naturalWidth)).toBe(240);
  expect(await page.evaluate(() => window.uploaded.length)).toBe(1);
});

test('a failed upload, or a refused batch, leaves a failed tile whose Retry finishes it', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const blocks = await topLevel(host);
  // The upload fails: Retry uploads again.
  await page.evaluate(() => (window.failUpload = true));
  await addFiles(page, blocks[0]!, [{ name: 'a.png', png: '#5b8c51' }]);
  let failed = host.getByRole('group', { name: 'a.png', exact: true });
  await expect(failed).toContainText('Failed to load');
  await page.evaluate(() => (window.failUpload = false));
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(host.locator('img[alt="a.png"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.uploaded.length)).toBe(2);
  // The upload succeeds but the serve refuses the batch: Retry repeats the batch, not the upload.
  await page.evaluate(() => (window.refuseFiles = true));
  await addFiles(page, blocks[0]!, [{ name: 'b.txt', text: 'b' }]);
  failed = host.getByRole('group', { name: 'b.txt', exact: true });
  await expect(failed).toContainText('Failed to load');
  expect(await page.evaluate(() => window.uploaded.length)).toBe(3);
  await page.evaluate(() => (window.refuseFiles = false));
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(host.locator('.tmt-block-file')).toContainText('b.txt');
  await expect(failed).toHaveCount(0);
  expect(await page.evaluate(() => window.uploaded.length)).toBe(3);
  expect(await page.evaluate(() => window.listedFiles.length)).toBe(2);
});

test('files past the page cap are refused before any upload, with what to do', async ({ page }) => {
  const host = await mountFixture(page, 'spec');
  const blocks = await topLevel(host);
  // The page lists 3 images; 124 more files leave room for one.
  await page.evaluate(() => (window.extraFiles = 124));
  await addFiles(page, blocks[0]!, [
    { name: 'one.txt', text: '1' },
    { name: 'two.txt', text: '2' },
  ]);
  await expect(page.getByRole('status')).toContainText(
    'A page holds at most 128 files, and these would pass that, so nothing was added. Delete files the page no longer uses, or ask an agent to run block detach, then add again.',
  );
  expect(await topLevel(host)).toEqual(blocks);
  expect(await page.evaluate(() => window.uploaded.length)).toBe(0);
  await expect(page.getByRole('status').getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

const QUESTION = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';

test('@ in a block offers agents and blocks, by keyboard, and inserts a block mark', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const item = host.locator('[data-block-id="l2"]');
  await item.getByText('滑過或選取是淡色底。').click();
  const editor = item.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.pressSequentially(' @', { delay: 20 });
  const menu = page.getByRole('listbox', { name: '@ mention' });
  // Agents first, then the page's blocks a mark can name, in reading order.
  await expect(menu.getByRole('option').first()).toHaveText('@tmt-gui-lead');
  await expect(menu.getByRole('option').nth(1)).toHaveText('@gui-2');
  await expect(menu.getByRole('option', { name: 'Question: 先做哪個區塊？' })).toBeVisible();
  await editor.pressSequentially('先做', { delay: 20 });
  await expect(menu.getByRole('option')).toHaveText(['Question: 先做哪個區塊？']);
  await expect(menu.getByRole('option', { selected: true })).toHaveText('Question: 先做哪個區塊？');
  await editor.press('Enter');
  await expect(menu).toHaveCount(0);
  // The @ and its query became the chip text and a space; the chip text carries the block mark.
  const expected = '滑過或選取是淡色底。 Question: 先做哪個區塊？ ';
  await expect.poll(() => page.evaluate(() => window.serveText('l2'))).toBe(expected);
  await expect
    .poll(() => page.evaluate(() => window.serveMarks('l2')))
    .toEqual([{ from: 11, to: 28, mark: 'block', value: QUESTION }]);
  // Typing goes on after the chip.
  await editor.pressSequentially('next', { delay: 20 });
  await expect.poll(() => page.evaluate(() => window.serveText('l2'))).toBe(`${expected}next`);
  // At rest the mark draws as the DS chip, linking to the block.
  await editor.press('Escape');
  const chip = item.locator('[data-slot="block-mention"]');
  await expect(chip).toHaveText('Question: 先做哪個區塊？');
  await expect(chip).toHaveAttribute('href', `#block-${QUESTION}`);
});

test('@ picks an agent with the mouse, and Esc closes the menu keeping the text', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const item = host.locator('[data-block-id="l1"]');
  await item.getByText('區塊之間沒有框線，只有卡片畫框。').click();
  const editor = item.locator('[contenteditable="true"]');
  await editor.press('End');
  await editor.pressSequentially(' @gui', { delay: 20 });
  const menu = page.getByRole('listbox', { name: '@ mention' });
  await expect(menu.getByRole('option')).toHaveText(['@tmt-gui-lead', '@gui-2']);
  // Esc closes and keeps what was typed; an @ in a word never opens it.
  await editor.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(editor).toHaveText('區塊之間沒有框線，只有卡片畫框。 @gui');
  await editor.pressSequentially(' a@b', { delay: 20 });
  await expect(menu).toHaveCount(0);
  for (let i = 0; i < 9; i++) await editor.press('Backspace');
  await editor.pressSequentially(' @', { delay: 20 });
  const agent = menu.getByRole('option', { name: '@gui-2' });
  await agent.hover();
  await expect(agent).toHaveAttribute('aria-selected', 'true');
  await agent.click();
  await expect(menu).toHaveCount(0);
  await expect(editor).toBeFocused();
  const expected = '區塊之間沒有框線，只有卡片畫框。 @gui-2 ';
  await expect.poll(() => page.evaluate(() => window.serveText('l1'))).toBe(expected);
  await expect
    .poll(() => page.evaluate(() => window.serveMarks('l1')))
    .toEqual([{ from: 17, to: 23, mark: 'agent', value: 'gui-2' }]);
});

test('the insert menu offers Image or file, which opens the file picker and adds the files', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const blocks = await topLevel(host);
  // An empty paragraph after l2, where the slash opens the insert menu.
  const blank = 'e0000000-0000-4000-8000-000000000001';
  await page.evaluate(
    (id) =>
      window.agentBatch([
        { op: 'insert', id, type: 'paragraph', parent: 'root', after: 'l2', text: '' },
      ]),
    blank,
  );
  await host.locator(`[data-block-id="${blank}"]`).click();
  const empty = host.locator(`[data-block-id="${blank}"] [contenteditable="true"]`);
  await empty.press('/');
  await empty.pressSequentially('fi', { delay: 20 });
  const menu = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu.getByRole('option')).toHaveText([/Image or file/]);
  // Chosen by keyboard, it opens the device's file picker.
  const chooser = page.waitForEvent('filechooser');
  await empty.press('Enter');
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(true);
  await picker.setFiles([
    { name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('Plan\n') },
  ]);
  await expect(host.locator('.tmt-block-file')).toContainText('plan.txt');
  // The slash paragraph was cleared, and the file went after it.
  const now = await topLevel(host);
  const at = now.indexOf('l2');
  expect(now).toHaveLength(blocks.length + 2);
  expect(now[at + 1]).toBe(blank);
  expect(await page.evaluate((id) => window.serveText(id), blank)).toBe('');
  await expect(host.locator(`[data-block-id="${now[at + 2]}"] .tmt-block-file`)).toHaveCount(1);
});

test('a page without files offers no Image or file entry', async ({ page }) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="e"]').click();
  const editor = host.locator('[data-block-id="e"] [contenteditable="true"]');
  await editor.press('/');
  await editor.pressSequentially('fi', { delay: 20 });
  await expect(page.getByRole('listbox', { name: 'Insert a block' })).toContainText(
    'No matching block',
  );
});

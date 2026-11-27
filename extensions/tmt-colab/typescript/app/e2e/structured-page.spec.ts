import { expect, test } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';
import { capturePath } from './captures.js';
import { text } from '../src/strings.js';

/** The platform's key to the line's end: End, and Cmd+Right on macOS, where End scrolls the
 * document as it does in any text field there. */
const lineEnd = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
/** The platform's key to the end of the text, past every line: a click puts the caret where it
 * lands, so a test that types at the end goes there first. */
const textEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

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
  const menu = host.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => window.sent)).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.sent)).toHaveLength(0);
  await host.getByRole('button', { name: 'Insert block' }).click();
  await menu.getByRole('option', { name: /Heading/ }).click();
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(1);
  expect((await page.evaluate(() => window.sent))[0]).toMatchObject({
    op: 'insert',
    type: 'heading',
  });
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

test('Backspace then Esc while the split is still out joins the blocks and leaves no landed draft to restore (#6749)', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const served = () => page.evaluate(() => window.serveText('p'));
  const drafts = () => page.evaluate(() => window.blockDrafts());
  await host.locator('[data-block-id="p"]').click();
  const first = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await first.press('Home');
  for (let i = 0; i < 'Ship'.length; i++) await first.press('ArrowRight');
  // The split stays out, and the reload store is slow, as a phone's can be.
  await page.evaluate(() => {
    window.holdServe(true);
    window.holdDraftSaves(true);
  });
  await first.press('Enter');
  const blocks = host.locator('[data-block-id]');
  await expect(blocks).toHaveCount(5);
  const second = blocks.nth(2).locator('[contenteditable="true"]');
  await expect(second).toBeFocused();
  await second.press('Backspace');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.holdServe(false));
  // The Backspace joined though Esc closed the editor before the split landed.
  await expect.poll(served).toBe('Ship the stack.');
  await expect(blocks).toHaveCount(4);
  await expect(host.locator('[data-block-id="p"]')).toHaveAttribute('data-selected', '');
  // The split's draft is saved only now, while the join's is still slow: a reload would find
  // nothing that landed to offer back.
  await page.evaluate(() => window.releaseDraftSave());
  await expect.poll(drafts).toEqual([]);
  await page.evaluate(() => window.holdDraftSaves(false));
  await expect.poll(drafts).toEqual([]);
});

test('a key the editor takes while a batch settles is never redrawn away (#6221)', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await page.evaluate(() => window.holdServe(true));
  const before = await page.evaluate(() => window.sent.length);
  await editor.pressSequentially('X', { delay: 20 });
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(before + 1);
  // The batch reaches the serve and is held there.
  await expect.poll(() => page.evaluate(() => window.heldCommits())).toBe(1);
  // Every text the editor shows from here on: a key, once shown, never leaves it.
  const shown = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>(
      '#structured-page-fixture [data-block-id="p"] [contenteditable="true"]',
    )!;
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(root.textContent ?? ''));
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    // The batch settles, and the editor takes a key before its redraw runs.
    window.holdServe(false);
    for (let i = 0; i < 60; i++) await Promise.resolve();
    document.execCommand('insertText', false, 'Y');
    // Watch until the serve holds the key too, at most 5 s.
    for (let wait = 0; wait < 100 && !window.serveText('p')?.endsWith('XY'); wait++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    return texts;
  });
  const typed = shown.findIndex((text) => text.endsWith('XY'));
  expect(typed).toBeGreaterThanOrEqual(0);
  expect(shown.slice(typed).filter((text) => !text.endsWith('XY'))).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toMatch(/XY$/);
});

test('a batch that has not landed after 2 s says so until it does (#6735)', async ({ page }) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await page.evaluate(() => window.holdServe(true));
  await editor.pressSequentially('X', { delay: 20 });
  await expect.poll(() => page.evaluate(() => window.heldCommits())).toBe(1);
  const saving = page.getByRole('status').filter({ hasText: 'Saving your change…' });
  // Not at once: a batch that lands within 2 s draws nothing.
  await expect(saving).toHaveCount(0);
  await expect(saving).toBeVisible({ timeout: 5_000 });
  await page.evaluate(() => window.holdServe(false));
  await expect(saving).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toMatch(/X$/);
});

test('a key the editor takes while a batch settles merges with an agent edit the redraw brings (#6221)', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await page.evaluate(() => window.holdServe(true));
  const before = await page.evaluate(() => window.sent.length);
  await editor.pressSequentially('X', { delay: 20 });
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(before + 1);
  // The batch reaches the serve and is held there; an agent changes the block's start meanwhile.
  await expect.poll(() => page.evaluate(() => window.heldCommits())).toBe(1);
  await page.evaluate(() => window.agentReplace('p', 'Ship', 'SHIP'));
  // Every text the editor shows from here on: a key, once shown, never leaves it.
  const shown = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>(
      '#structured-page-fixture [data-block-id="p"] [contenteditable="true"]',
    )!;
    const texts: string[] = [];
    const observer = new MutationObserver(() => texts.push(root.textContent ?? ''));
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    // The batch settles, and the editor takes a key before its redraw runs.
    window.holdServe(false);
    for (let i = 0; i < 60; i++) await Promise.resolve();
    document.execCommand('insertText', false, 'Y');
    // Watch until the serve holds the key too, at most 5 s.
    for (let wait = 0; wait < 100 && !window.serveText('p')?.endsWith('XY'); wait++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    return texts;
  });
  const typed = shown.findIndex((text) => text.endsWith('XY'));
  expect(typed).toBeGreaterThanOrEqual(0);
  expect(shown.slice(typed).filter((text) => !text.endsWith('XY'))).toEqual([]);
  // Both writers' changes stay, in the editor and on the serve.
  await expect(editor).toHaveText(/^SHIP.*XY$/);
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toMatch(/^SHIP.*XY$/);
});

test('a block inserted above the one being typed in keeps its editor and its keys (#6221)', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await editor.pressSequentially(' X', { delay: 20 });
  // The editor element itself: a remount would draw a new, empty one.
  await editor.evaluate((node) => ((window as unknown as { typedIn?: Element }).typedIn = node));
  // An agent inserts a block above the one being typed in, before the typing is sent.
  await page.evaluate(() =>
    window.agentBatch([
      { op: 'insert', id: 'n', type: 'paragraph', parent: 'root', after: 'h', text: 'Agent note.' },
    ]),
  );
  await expect(host.locator('[data-block-id="n"]')).toHaveText('Agent note.');
  expect(
    await editor.evaluate((node) => (window as unknown as { typedIn?: Element }).typedIn === node),
  ).toBe(true);
  await editor.pressSequentially('Y', { delay: 20 });
  await expect(editor).toHaveText(/ XY$/);
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toMatch(/ XY$/);
});

test("focus on a selected block's handle stays there while an agent edit redraws the page (#6221)", async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  // Esc selects the block, which shows its handle.
  await page.keyboard.press('Escape');
  await expect(host.locator('[data-block-id="p"]')).toBeFocused();
  // The handle is out of the tab order (tabindex -1); focus reaches it from a pointer or a script.
  const handle = host.locator('[data-block-id="p"]').getByRole('button', { name: 'Block actions' });
  await handle.focus();
  await expect(handle).toBeFocused();
  // An agent edit elsewhere redraws the page: the handle keeps focus.
  await page.evaluate(() => window.agentReplace('h', 'Plan', 'PLAN'));
  await expect(host.locator('[data-block-id="h"]')).toContainText('PLAN');
  await expect(handle).toBeFocused();
});

test("a key typed after Enter, before the new block's editor takes focus, reaches the new block (#6229)", async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="p"]').click();
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  await editor.press('End');
  await page.evaluate(() => window.holdServe(true));
  const before = await page.evaluate(() => window.sent.length);
  await editor.pressSequentially(' X', { delay: 20 });
  await expect.poll(() => page.evaluate(() => window.sent.length)).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => window.heldCommits())).toBe(1);
  // Enter waits for the batch in flight before it splits.
  await editor.press('Enter');
  await page.evaluate(async () => {
    const old = document.querySelector<HTMLElement>(
      '#structured-page-fixture [data-block-id="p"] [contenteditable="true"]',
    )!;
    // The batch settles and the split opens the new block; the old editor still has focus and
    // takes a key before the new one is drawn.
    window.holdServe(false);
    for (let i = 0; i < 60; i++) await Promise.resolve();
    old.focus();
    document.execCommand('insertText', false, 'Y');
  });
  const blocks = host.locator('[data-block-id]');
  await expect(blocks.nth(1)).toHaveText(/ X$/);
  await expect(blocks.nth(2)).toHaveText('Y');
  await expect(blocks.nth(2).locator('[contenteditable="true"]')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toMatch(/ X$/);
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
    'Turn into',
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
  // A heading's menu also sets its section (#6619): Mark as done, then back to automatic.
  await heading.hover();
  await host.getByRole('button', { name: 'Block actions' }).click();
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Move up/,
    /Move down/,
    /Duplicate/,
    'Turn into',
    /Delete/,
    'Mark as done',
    'Not progress',
  ]);
  await menu.getByRole('menuitem', { name: 'Mark as done' }).click();
  await expect
    .poll(() => page.evaluate(() => window.sent.filter((op) => op.op === 'props').at(-1)))
    .toMatchObject({ id: 'h', set: { progress: 'done' } });
  await heading.hover();
  await host.getByRole('button', { name: 'Block actions' }).click();
  await expect(menu.getByRole('menuitem').filter({ hasText: /Mark as done/ })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Count automatically' }).click();
  await expect
    .poll(() => page.evaluate(() => window.sent.filter((op) => op.op === 'props').at(-1)))
    .toMatchObject({ id: 'h', unset: ['progress'] });
  // The drop was one move op, and the grip's click after a drag opened no menu.
  await expect(menu).toHaveCount(0);
  // This tab's batches go in order, each once the one before it settles.
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.sent.map((op) => op.op))).filter((op) => op === 'move'),
    )
    .toHaveLength(3);
});

test('Turn into changes a block in place, keeping its ID and text, and one ⌘Z turns it back', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const block = host.locator('[data-block-id="p"]');
  const last = () => page.evaluate(() => window.sent.at(-1));
  await block.hover();
  await host.getByRole('button', { name: 'Block actions' }).click();
  const menu = page.getByRole('menu', { name: 'Block actions' });
  await menu.getByRole('menuitem', { name: 'Turn into' }).click();
  // Its list opens in the same menu: the way back, then every type but the one the block is.
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Turn into',
    'Heading 2',
    'Heading 3',
    'List',
    'To-do',
    'Callout',
    'Code',
  ]);
  await menu.getByRole('menuitem', { name: 'To-do' }).click();
  await expect(menu).toHaveCount(0);
  await expect(block.locator('[data-slot="todo"]')).toHaveCount(1);
  await expect(block).toHaveText('Ship the stack.');
  await expect.poll(last).toEqual({ op: 'retype', id: 'p', type: 'todo' });
  // The keys: the selected block's menu, ↓ to Turn into, Enter opens its list, ↓ and Enter pick.
  // The pointer still rests where To-do was, over the row Delete opens at: it must not take the row.
  await expect(block).toBeFocused();
  await page.keyboard.press('ControlOrMeta+/');
  await expect(menu).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('menuitem', { name: 'Paragraph' })).toBeVisible();
  // Paragraph is active first; Heading 3 is two rows down.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(block.getByRole('heading', { level: 3, name: 'Ship the stack.' })).toBeVisible();
  await expect.poll(last).toEqual({ op: 'retype', id: 'p', type: 'heading', level: 3 });
  // One ⌘Z each: back to the to-do, then to the paragraph it was.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(last).toEqual({ op: 'retype', id: 'p', type: 'todo', props: {} });
  await expect(block.locator('[data-slot="todo"]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(last).toEqual({ op: 'retype', id: 'p', type: 'paragraph', props: {} });
  await expect(block.locator('[data-slot="todo"]')).toHaveCount(0);
  await expect(block).toHaveText('Ship the stack.');
  // Into code the marks and props go; one ⌘Z brings back the paragraph, its tone and its bold.
  // The agent writes once the undo has landed, so the undo's props do not replace its tone.
  await expect.poll(() => page.evaluate(() => window.serveType('p'))).toBe('paragraph');
  await page.evaluate(() =>
    window.agentBatch([
      { op: 'props', id: 'p', set: { tone: 'muted' }, unset: [] },
      { op: 'text', id: 'p', format: { from: 0, to: 4, mark: 'bold', value: true } },
    ]),
  );
  await expect(block.locator('strong')).toHaveText('Ship');
  await block.hover();
  await host.getByRole('button', { name: 'Block actions' }).click();
  await menu.getByRole('menuitem', { name: 'Turn into' }).click();
  await menu.getByRole('menuitem', { name: 'Code' }).click();
  await expect.poll(last).toEqual({ op: 'retype', id: 'p', type: 'code' });
  await expect(block.locator('strong')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block.locator('strong')).toHaveText('Ship');
  await expect.poll(() => page.evaluate(() => window.serveProps('p'))).toEqual({ tone: 'muted' });
  expect(await page.evaluate(() => window.serveMarks('p'))).toEqual([
    { from: 0, to: 4, mark: 'bold' },
  ]);
  // A table turns into nothing: its menu has no Turn into.
  const spec = await mountFixture(page, 'spec');
  const table = spec
    .locator('[data-block-id]')
    .filter({ has: page.getByRole('table') })
    .first();
  await table.hover();
  await spec.getByRole('button', { name: 'Block actions' }).click();
  await expect(menu.getByRole('menuitem', { name: 'Turn into' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A callout waiting turns into a paragraph without its tone, which a paragraph cannot hold;
  // ⌘Z brings the callout back with its tone and heading.
  const callout = spec.locator('[data-block-id="agent"]');
  await callout.hover();
  await callout.getByRole('button', { name: 'Block actions' }).click();
  await menu.getByRole('menuitem', { name: 'Turn into' }).click();
  await menu.getByRole('menuitem', { name: 'Paragraph' }).click();
  await expect.poll(() => page.evaluate(() => window.serveType('agent'))).toBe('paragraph');
  expect(await page.evaluate(() => window.serveProps('agent'))).toEqual({});
  await expect(callout).toHaveText('tmt colab block insert PAGE --type table --after b-12 --json');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => window.serveType('agent'))).toBe('callout');
  expect(await page.evaluate(() => window.serveProps('agent'))).toEqual({
    tone: 'waiting',
    label: '等你',
    heading: 'agent 怎麼改',
  });
});

/** The hover a browser sends when a menu appears under a pointer that has not moved: over, enter
 * and move events with no movement. */
const restingHover = (row: import('@playwright/test').Locator) =>
  row.evaluate((node) => {
    for (const type of ['mouseover', 'mouseenter', 'mousemove'])
      node.dispatchEvent(
        new MouseEvent(type, { bubbles: type !== 'mouseenter', movementX: 0, movementY: 0 }),
      );
  });

test('the block menu, opened by keys, keeps its row under a resting pointer', async ({ page }) => {
  const host = await mountFixture(page);
  const last = () => page.evaluate(() => window.sent.at(-1));
  await host.locator('[data-block-id="t"]').click();
  await host.locator('[data-block-id="t"] [contenteditable="true"]').press('Escape');
  await page.keyboard.press('ControlOrMeta+/');
  const actions = page.getByRole('menu', { name: 'Block actions' });
  // A hover without movement on Delete does not take the row: Enter runs the first, Move up.
  await restingHover(actions.getByRole('menuitem', { name: /Delete/ }));
  await page.keyboard.press('Enter');
  await expect.poll(last).toMatchObject({ op: 'move', id: 't' });
  await expect(host.locator('[data-block-id="t"]')).toHaveCount(1);
});

test('the insert menu keeps the keys’ row under a resting pointer and takes a real move', async ({
  page,
}) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="e"]').click();
  const editor = host.locator('[data-block-id="e"] [contenteditable="true"]');
  await editor.press('/');
  const insert = page.getByRole('listbox', { name: 'Insert a block' });
  await restingHover(insert.getByRole('option', { name: /Table/ }));
  await expect(insert.getByRole('option', { selected: true })).toHaveText(/Paragraph/);
  await insert.getByRole('option', { name: /Table/ }).hover();
  await expect(insert.getByRole('option', { selected: true })).toHaveText(/Table/);
});

test('at the window’s bottom edge the insert and @ menus open above their block, in view', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const empty = host.locator('[data-block-id="e"]');
  const box = (await empty.boundingBox())!;
  // The empty paragraph sits on the window's bottom edge.
  await page.setViewportSize({ width: 1440, height: Math.ceil(box.y + box.height + 8) });
  await empty.click();
  await host.locator('[data-block-id="e"] [contenteditable="true"]').press('/');
  const insert = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(insert).toHaveAttribute('data-placement', 'above');
  await expect(insert).toBeInViewport({ ratio: 1 });
  expect(
    (await insert.boundingBox())!.y + (await insert.boundingBox())!.height,
  ).toBeLessThanOrEqual((await empty.boundingBox())!.y);
  // The @ menu at the end of a block on the bottom edge.
  await page.setViewportSize({ width: 1280, height: 720 });
  const spec = await mountFixture(page, 'spec');
  const { item, menu } = await atMenu(page, spec);
  const at = (await item.boundingBox())!;
  // The block sits low enough that the menu has no room under it.
  expect(at.y + at.height).toBeGreaterThan(720 - 300);
  await expect(menu).toHaveAttribute('data-placement', 'above');
  await expect(menu.getByRole('option').first()).toBeInViewport();
});

test('the @ menu keeps the keys’ row under a resting pointer and takes a real move', async ({
  page,
}) => {
  const spec = await mountFixture(page, 'spec');
  const { menu } = await atMenu(page, spec);
  const rows = menu.getByRole('option');
  const first = (await rows.first().textContent())!;
  await restingHover(rows.nth(1));
  await expect(menu.getByRole('option', { selected: true })).toHaveText(first);
  await rows.nth(1).hover();
  await expect(menu.getByRole('option', { selected: true })).not.toHaveText(first);
});

/** The point just inside the left edge of character `index` of `text`, as `scope` draws it: a click
 * there puts the caret right before that character. */
async function charPoint(scope: import('@playwright/test').Locator, text: string, index: number) {
  return scope.evaluate(
    (node, { text, index }) => {
      // A soft break draws as one line break element.
      const drawnText = (at: Node): string =>
        at.nodeType === Node.TEXT_NODE
          ? (at as Text).data
          : at.nodeName === 'BR'
            ? '\n'
            : [...at.childNodes].map(drawnText).join('');
      const drawn = [node, ...node.querySelectorAll('*')].filter((el) => drawnText(el) === text);
      const walker = document.createTreeWalker(
        drawn.at(-1)!,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      let left = index;
      for (let at = walker.nextNode(); at; at = walker.nextNode()) {
        if (at.nodeName === 'BR') {
          if (left === 0) throw new Error(`Character ${index} is the line break`);
          left--;
          continue;
        }
        if (at.nodeType !== Node.TEXT_NODE) continue;
        const scalars = [...(at as Text).data];
        if (left < scalars.length) {
          const start = scalars.slice(0, left).join('').length;
          const range = document.createRange();
          range.setStart(at, start);
          range.setEnd(at, start + scalars[left]!.length);
          const box = range.getBoundingClientRect();
          return { x: box.left + 1, y: box.top + box.height / 2, top: box.top };
        }
        left -= scalars.length;
      }
      throw new Error(`No character ${index} in ${text}`);
    },
    { text, index },
  );
}

test('a click starts editing with the caret where it landed, and a double click selects a word', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const typeAt = async (id: string, text: string, index: number) => {
    const at = await charPoint(host.locator(`[data-block-id="${id}"]`), text, index);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.type('X');
  };
  const editor = (id: string) => host.locator(`[data-block-id="${id}"] [contenteditable="true"]`);
  // Mid-word in a paragraph, and in a heading.
  await typeAt('p', 'Ship the stack.', 11);
  await expect(editor('p')).toHaveText('Ship the stXack.');
  await typeAt('h', 'Plan', 2);
  await expect(editor('h')).toHaveText('PlXan');
  // On the second line of a paragraph that wraps.
  const long = Array.from({ length: 12 }, (_, n) => `word${n} alpha beta gamma`).join(' ');
  await page.evaluate(
    (text) =>
      window.agentBatch([
        { op: 'insert', id: 'long', type: 'paragraph', parent: 'root', after: 'p', text },
      ]),
    long,
  );
  const wrapped = host.locator('[data-block-id="long"]');
  await expect(wrapped).toHaveText(long);
  const firstTop = (await charPoint(wrapped, long, 0)).top;
  let second = 0;
  while ((await charPoint(wrapped, long, second)).top <= firstTop) second++;
  await typeAt('long', long, second + 2);
  const scalars = [...long];
  await expect(editor('long')).toHaveText(
    [...scalars.slice(0, second + 2), 'X', ...scalars.slice(second + 2)].join(''),
  );
  // After a soft break: the break draws as one line break and counts as one position.
  const broken = 'First line\nsecond line here';
  await page.evaluate(
    (text) =>
      window.agentBatch([
        { op: 'insert', id: 'brk', type: 'paragraph', parent: 'root', after: 'long', text },
      ]),
    broken,
  );
  const brk = host.locator('[data-block-id="brk"]');
  await expect(brk.locator('br')).toHaveCount(1);
  expect((await charPoint(brk, broken, 11)).top).toBeGreaterThan(
    (await charPoint(brk, broken, 0)).top,
  );
  await typeAt('brk', broken, 14);
  await expect
    .poll(() => page.evaluate(() => window.serveText('brk')))
    .toBe('First line\nsecXond line here');
  // A double click selects the word, which typing then replaces.
  const fresh = await mountFixture(page);
  const word = await charPoint(fresh.locator('[data-block-id="p"]'), 'Ship the stack.', 11);
  await page.mouse.dblclick(word.x, word.y);
  await page.keyboard.type('Y');
  await expect(fresh.locator('[data-block-id="p"] [contenteditable="true"]')).toHaveText(
    'Ship the Y.',
  );
  // In a list item.
  const spec = await mountFixture(page, 'spec');
  const item = spec.locator('[data-block-id="l2"]');
  await item.scrollIntoViewIfNeeded();
  const at = await charPoint(item, '滑過或選取是淡色底。', 3);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('X');
  await expect(item.locator('[contenteditable="true"]')).toHaveText('滑過或X選取是淡色底。');
});

test('End and Home in a block do what they do in a plain contenteditable at the same place', async ({
  page,
}) => {
  // The platform owns these keys (on macOS they scroll the document, and Cmd+arrows move the
  // caret): a block matches plain editable text there and never takes them over (#6742).
  const text = '滑過或選取是淡色底。';
  const settle = async () => {
    let last = -1;
    for (let tries = 0; tries < 40; tries++) {
      const now = await page.evaluate(() => Math.round(scrollY));
      if (now === last) return now;
      last = now;
      await page.waitForTimeout(100);
    }
    return last;
  };
  const run = async (plain: boolean) => {
    const spec = await mountFixture(page, 'spec');
    const item = spec.locator('[data-block-id="l2"]');
    await item.scrollIntoViewIfNeeded();
    if (plain)
      await item.evaluate((block, text) => {
        const box = block.getBoundingClientRect();
        const field = document.createElement('div');
        field.id = 'plain-field';
        field.contentEditable = 'true';
        field.textContent = text;
        field.style.cssText = `position:absolute;left:${box.left + scrollX}px;top:${box.top + scrollY}px;width:${box.width}px;z-index:99;background:Canvas;font:15px/1.6 sans-serif`;
        document.body.append(field);
      }, text);
    const target = plain ? page.locator('#plain-field') : item;
    const at = await charPoint(target, text, 1);
    await page.mouse.click(at.x, at.y);
    const start = await settle();
    await page.keyboard.press('End');
    const end = await settle();
    await page.keyboard.type('X');
    await page.keyboard.press('Home');
    const home = await settle();
    await page.keyboard.type('Y');
    const typed = plain
      ? await target.textContent()
      : await item.locator('[contenteditable="true"]').textContent();
    return {
      endScrolls: Math.abs(end - start) > 200,
      homeScrolls: Math.abs(home - end) > 200,
      typed,
    };
  };
  const plain = await run(true);
  expect(await run(false)).toEqual(plain);
});

for (const width of [1440, 390])
  test(`/To-do and Enter turn the slash paragraph into a to-do at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const host = await mountFixture(page);
    await host.locator('[data-block-id="e"]').click();
    const editor = host.locator('[data-block-id="e"] [contenteditable="true"]');
    await editor.pressSequentially('/To-do', { delay: 20 });
    const menu = page.getByRole('listbox', { name: 'Insert a block' });
    await expect(menu.getByRole('option', { selected: true })).toHaveText(/To-do/);
    await editor.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(host.locator('[data-block-id="e"]')).toHaveCount(0);
    // The plan's own to-do and the new one.
    await expect(host.locator('[data-slot="todo"]')).toHaveCount(2);
  });

test('the reload draft follows undo, redo, paste and a slash pick, and clears once each lands', async ({
  page,
}) => {
  // A reload restores a block's draft (#6769). Whatever sends a block's text keeps it as the draft
  // until it lands: after ⌘Z the undone text, never the text before; a paste as typing; a split
  // or a picked slash entry leaves no stale draft behind.
  const host = await mountFixture(page);
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  const served = () => page.evaluate(() => window.serveText('p'));
  const drafts = () => page.evaluate(() => window.blockDrafts());
  const lastSaved = () => page.evaluate(() => window.draftSaves.at(-1));
  await host.locator('[data-block-id="p"]').click();
  await editor.press(textEnd);
  await editor.pressSequentially(' now', { delay: 20 });
  await expect.poll(served).toBe('Ship the stack. now');
  await expect.poll(drafts).toEqual([]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(served).toBe('Ship the stack.');
  expect(await lastSaved()).toBe('Ship the stack.');
  await expect.poll(drafts).toEqual([]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(served).toBe('Ship the stack. now');
  expect(await lastSaved()).toBe('Ship the stack. now');
  await expect.poll(drafts).toEqual([]);

  const paste = (data: Record<string, string>) =>
    editor.evaluate((node, data) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
      node.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, data);
  // A paste inside the block: its text is the draft until it lands.
  await editor.press(textEnd);
  await paste({ 'text/html': '<b>!</b>', 'text/plain': '!' });
  await expect.poll(served).toBe('Ship the stack. now!');
  expect(await lastSaved()).toBe('Ship the stack. now!');
  await expect.poll(drafts).toEqual([]);
  // Typing, then a paste that splits the block: the typing's draft goes once the split lands.
  await editor.pressSequentially(' more', { delay: 20 });
  await paste({ 'text/plain': 'One\n\nTwo' });
  await expect.poll(served).toBe('Ship the stack. now! moreOne');
  await expect.poll(drafts).toEqual([]);
  // A slash entry picked clears the typed '/To-do' with the block's change; no draft of it stays.
  await host.locator('[data-block-id="e"]').click();
  const empty = host.locator('[data-block-id="e"] [contenteditable="true"]');
  await empty.pressSequentially('/To-do', { delay: 20 });
  await empty.press('Enter');
  // The pick puts a to-do in the paragraph's place.
  await expect(host.locator('[data-block-id="e"]')).toHaveCount(0);
  await expect(host.locator('[data-slot="todo"]')).toHaveCount(2);
  await expect.poll(drafts).toEqual([]);
});

test('while the page reconnects, typing is kept on this device and sent once, and a split is refused with a notice (#6795)', async ({
  page,
}) => {
  const host = await mountFixture(page);
  const editor = host.locator('[data-block-id="p"] [contenteditable="true"]');
  const served = () => page.evaluate(() => window.serveText('p'));
  const drafts = () => page.evaluate(() => window.blockDrafts());
  const sent = () =>
    page.evaluate(() =>
      window.sent.flatMap((op) =>
        op.op === 'text' && 'set' in op && op.id === 'p' ? [op.set] : [],
      ),
    );
  await page.evaluate(() => window.reconnect(true));
  // A new edit opens as it does when the page is live.
  await host.locator('[data-block-id="p"]').click();
  await editor.press(textEnd);
  await editor.pressSequentially(' later', { delay: 20 });
  // Kept on this device before anything is sent: a reload now would offer it.
  await expect.poll(drafts).toEqual([{ id: 'p', value: 'Ship the stack. later' }]);
  expect(await served()).toBe('Ship the stack.');
  // A split cannot wait for the page: it is refused with a notice, and the typing stays.
  await editor.press('Enter');
  const notice = host.locator('[data-slot="block-toast"]');
  await expect(notice).toContainText('The page is reconnecting, so that change was not made.');
  await expect(host.locator('[data-block-id]')).toHaveCount(4);
  await expect(host.locator('[data-block-id="p"]')).toContainText('Ship the stack. later');
  // Back: the typed text goes out once, and its draft clears when it lands.
  await page.evaluate(() => window.reconnect(false));
  await expect.poll(served).toBe('Ship the stack. later');
  await expect.poll(drafts).toEqual([]);
  expect(await sent()).toEqual(['Ship the stack. later']);
});

test('a paste of paragraphs or of a web page makes blocks, and one ⌘Z takes the paste back', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const host = await mountFixture(page);
  const ids = () =>
    host
      .locator('[data-block-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.blockId));
  const paste = (into: string, data: Record<string, string>) =>
    host.locator(`[data-block-id="${into}"] [contenteditable="true"]`).evaluate((node, data) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
      node.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, data);
  // Plain text: a paragraph per blank-line break, in place of the empty paragraph.
  await host.locator('[data-block-id="e"]').click();
  await paste('e', { 'text/plain': 'One\n\nTwo\nstill two\n\nThree' });
  await expect.poll(async () => (await ids()).length).toBe(6);
  await expect(host.locator('[data-block-id="e"]')).toHaveCount(0);
  await expect(host.locator('[data-block-id]').nth(2)).toHaveText('One');
  // The single line feed stays in its block and draws as a line break.
  await expect(host.locator('[data-block-id]').nth(3)).toHaveText('Two\nstill two', {
    useInnerText: true,
  });
  await expect(host.locator('[data-block-id]').nth(4)).toHaveText('Three');
  // The caret is at the end of the last pasted block; one ⌘Z there takes the whole paste back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(ids).toEqual(['h', 'p', 'e', 't']);

  // A web page: headings, list items, marks and links; its image and script never load or run.
  const web = await mountFixture(page);
  await web.locator('[data-block-id="e"]').click();
  await paste('e', {
    'text/html':
      '<h1>Plan B</h1><ul><li><b>Ship</b> it</li><li>Test</li></ul>' +
      '<p>See <a href="https://example.com/x">docs</a></p>' +
      '<img src="https://img.example/x.png"><script>window.ran = 1</script>',
    'text/plain': 'Plan B\nShip it\nTest\nSee docs',
  });
  await expect(web.getByRole('heading', { name: 'Plan B' })).toBeVisible();
  await expect(web.locator('strong', { hasText: 'Ship' })).toBeVisible();
  // The caret is in the last block, which draws its link as styled text while typing; at rest it
  // is a link.
  await page.keyboard.press('Escape');
  await expect(web.getByRole('link', { name: 'docs' })).toHaveAttribute(
    'href',
    'https://example.com/x',
  );
  const inserted = await page.evaluate(() =>
    window.sent.flatMap((op) => (op.op === 'insert' ? [op.type] : [])),
  );
  expect(inserted).toEqual(['heading', 'list', 'list', 'paragraph']);
  expect(await page.evaluate(() => (window as { ran?: number }).ran)).toBeUndefined();
  expect(requests.filter((url) => url.includes('img.example'))).toEqual([]);

  // A pasted table: a paragraph per row, its cells apart so it stays readable.
  const rows = await mountFixture(page);
  await rows.locator('[data-block-id="e"]').click();
  await paste('e', {
    'text/html':
      '<table><tr><th>Block</th><th>Use</th></tr><tr><td>Heading</td><td>## and ###</td></tr></table>',
    'text/plain': 'Block\tUse\nHeading\t## and ###',
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.sent.flatMap((op) => (op.op === 'insert' ? [op.text] : []))),
    )
    .toEqual(['Block | Use', 'Heading | ## and ###']);

  // Past the bound, the paste goes in as plain text, and the page says why.
  const large = await mountFixture(page);
  await large.locator('[data-block-id="e"]').click();
  await paste('e', {
    'text/plain': Array.from({ length: 201 }, (_, index) => `Line ${index}`).join('\n\n'),
  });
  await expect(
    page.getByRole('status').filter({ hasText: text.blockEdit.pasteTooLarge(200) }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.sent.some((op) => op.op === 'insert'))).toBe(false);

  // One paragraph past a block's text limit: nothing is pasted, and the page says why, instead of
  // a batch the serve refuses.
  const long = await mountFixture(page);
  await long.locator('[data-block-id="e"]').click();
  await paste('e', { 'text/plain': 'x'.repeat(70 * 1024) });
  await expect(
    page.getByRole('status').filter({ hasText: text.blockEdit.pasteTooLong(64) }),
  ).toBeVisible();
  await expect(long.locator('[data-block-id="e"] [contenteditable="true"]')).toHaveText('');
  expect(await page.evaluate(() => window.sent.some((op) => op.op === 'text'))).toBe(false);
});

test('⌘Z takes typing back a run at a time, across blocks in time order, and ⌘⇧Z makes it again', async ({
  page,
}) => {
  // The page's clock: a pause between runs without waiting for one.
  await page.clock.install();
  const host = await mountFixture(page);
  const p = host.locator('[data-block-id="p"]');
  await p.click();
  const editor = p.locator('[contenteditable="true"]');
  await editor.press(lineEnd);
  await editor.pressSequentially(' One', { delay: 20 });
  await page.clock.fastForward(1500);
  await editor.pressSequentially(' Two', { delay: 20 });
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveText('Ship the stack. One');
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveText('Ship the stack.');
  await editor.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveText('Ship the stack. One');
  await editor.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveText('Ship the stack. One Two');
  await expect
    .poll(() => page.evaluate(() => window.serveText('p')))
    .toBe('Ship the stack. One Two');

  // Two blocks: the later typing comes back first, wherever the caret is.
  const t = host.locator('[data-block-id="t"]');
  await t.getByText('Review').click();
  const todo = t.locator('[contenteditable="true"]');
  await todo.press(lineEnd);
  await todo.pressSequentially(' soon', { delay: 20 });
  await todo.press('ControlOrMeta+z');
  await expect(todo).toHaveText('Review');
  await todo.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toBe('Ship the stack. One');
  await expect(todo).toBeFocused();

  // An agent's change to the same block stays: ⌘Z takes back only this tab's typing.
  await p.click();
  await editor.press(lineEnd);
  await editor.pressSequentially(' Three', { delay: 20 });
  await expect
    .poll(() => page.evaluate(() => window.serveText('p')))
    .toBe('Ship the stack. One Three');
  await page.evaluate(() => window.agentReplace('p', 'Ship', 'Merge'));
  await expect(editor).toHaveText('Merge the stack. One Three');
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveText('Merge the stack. One');
  await expect.poll(() => page.evaluate(() => window.serveText('p'))).toBe('Merge the stack. One');
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('a tap opens the block menu, and its Move up and Move down move the block', async ({
    page,
  }) => {
    const host = await mountFixture(page);
    const ids = () =>
      host
        .locator('[data-block-id]')
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.blockId));
    await host.locator('[data-block-id="t"]').getByText('Review').tap();
    const handle = host.locator('[data-block-id="t"] [data-slot="block-handle"]');
    const block = host.locator('[data-block-id="t"]');
    const box = block.getByRole('checkbox');
    const before = [
      (await handle.boundingBox())!,
      (await block.boundingBox())!,
      (await box.boundingBox())!,
    ];
    await host.locator('[data-block-id="t"]').getByRole('button', { name: 'Block actions' }).tap();
    const menu = page.getByRole('menu', { name: 'Block actions' });
    await expect(menu).toBeVisible();
    // The block does not move when its menu opens: the handle and the text stay where they were.
    expect([
      (await handle.boundingBox())!,
      (await block.boundingBox())!,
      (await box.boundingBox())!,
    ]).toEqual(before);
    // A phone has no keyboard: the sheet shows no key hints.
    await expect(menu.locator('kbd')).toHaveCount(0);
    await menu.getByRole('menuitem', { name: /Move up/ }).tap();
    await expect.poll(ids).toEqual(['h', 'p', 't', 'e']);
    await host.locator('[data-block-id="t"]').getByText('Review').tap();
    await host.locator('[data-block-id="t"]').getByRole('button', { name: 'Block actions' }).tap();
    await menu.getByRole('menuitem', { name: /Move down/ }).tap();
    await expect.poll(ids).toEqual(['h', 'p', 'e', 't']);
  });

  test('a block low on the page never covers a row of its menu sheet (#6795)', async ({ page }) => {
    // The block whose menu is open shows over the scrim. A code box, a callout, a table or an
    // image under the sheet once drew over its rows and took the press meant for Delete.
    const host = await mountFixture(page, 'spec');
    await page.evaluate(() => {
      window.agentBatch([
        {
          op: 'insert',
          id: 'code',
          type: 'code',
          parent: 'root',
          after: 'kinds',
          text: 'tmt colab ls --json\ntmt colab show PAGE --json\ntmt colab block ls PAGE',
        },
      ]);
      // Room to bring any block to the bottom of the window.
      document.getElementById('structured-page-fixture')!.style.marginBlock = '900px';
    });
    await expect(host.locator('[data-block-id="code"]')).toBeVisible();
    const menu = page.getByRole('menu', { name: 'Block actions' });
    for (const id of ['code', 'order', 'table', 'pics']) {
      const block = host.locator(`[data-block-id="${id}"]`);
      await block.evaluate((node) =>
        window.scrollBy(0, node.getBoundingClientRect().top - (innerHeight - 140)),
      );
      await block.hover();
      await block.getByRole('button', { name: 'Block actions' }).first().click();
      await expect(menu).toBeVisible();
      const rows = menu.getByRole('menuitem');
      // The block sits under the sheet, so the case is the one that failed.
      const [sheet, under] = [(await menu.boundingBox())!, (await block.boundingBox())!];
      expect(under.y + under.height, id).toBeGreaterThan(sheet.y);
      expect(await rows.count(), id).toBeGreaterThan(2);
      for (const row of await rows.all()) {
        const box = (await row.boundingBox())!;
        for (const x of [box.x + 4, box.x + box.width / 2, box.x + box.width - 4]) {
          const hit = await page.evaluate(
            ([x, y]) =>
              document.elementFromPoint(x!, y!)?.closest('[role="menuitem"]')?.textContent,
            [x, box.y + box.height / 2],
          );
          expect(hit, `${id}: ${await row.textContent()} at ${Math.round(x)}`).toBe(
            await row.textContent(),
          );
        }
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    }
    // The slash sheet the lift was made for (#6186): its rows win over the block typed in, low on
    // the page, and the typed filter shows over the scrim when the block sits above the sheet.
    await page.evaluate(() =>
      window.agentBatch([
        { op: 'insert', id: 'slash', type: 'paragraph', parent: 'root', after: 'kinds', text: '' },
      ]),
    );
    const slash = host.locator('[data-block-id="slash"]');
    const options = page.getByRole('listbox', { name: 'Insert a block' });
    for (const low of [true, false]) {
      await slash.evaluate(
        (node, low) =>
          window.scrollBy(0, node.getBoundingClientRect().top - (low ? innerHeight - 60 : 120)),
        low,
      );
      await slash.click();
      await slash.locator('[contenteditable="true"]').pressSequentially('/t', { delay: 20 });
      await expect(options).toBeVisible();
      for (const row of await options.getByRole('option').all()) {
        const box = (await row.boundingBox())!;
        const hit = await page.evaluate(
          ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[role="option"]')?.textContent,
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        expect(hit, `slash ${low ? 'low' : 'high'}: ${await row.textContent()}`).toBe(
          await row.textContent(),
        );
      }
      if (!low) {
        // Over the scrim: nothing but the block itself is drawn above the typed filter.
        const typed = (await slash.locator('[contenteditable="true"]').boundingBox())!;
        expect(typed.y + typed.height).toBeLessThan((await options.boundingBox())!.y);
        await expect(slash.locator('[contenteditable="true"]')).toHaveText('/t');
      }
      await page.keyboard.press('Escape');
      await expect(options).toBeHidden();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Escape');
    }
  });
});

test('＋ on the handle chooses a type before inserting a block after it', async ({ page }) => {
  const host = await mountFixture(page);
  await host.locator('[data-block-id="h"]').hover();
  await host.getByRole('button', { name: 'Insert block' }).click();
  const menu = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => window.sent)).toHaveLength(0);
  await menu.getByRole('option', { name: /To-do/ }).click();
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
  // The keys typed while Enter waited were the first block's draft for a moment; the split moved
  // them, so a reload offers nothing back once it all landed (#6795).
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.blockDrafts())).toEqual([]);
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

for (const theme of ['light', 'dark'] as const)
  test(`a page that stops taking edits draws what it holds and says where this tab's typing is, in view far down at 390 ${theme} (#6820)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.emulateMedia({ colorScheme: theme });
    await servePageRuntime(page);
    const host = await mountFixture(page, 'spec');
    const kept = page.getByText(text.blockEdit.kept);
    // Nothing of this tab on its way: the page says nothing.
    await page.evaluate(() => window.stopEdits(true));
    await expect(host.locator('[data-block-id="order"]')).toBeVisible();
    await expect(kept).toHaveCount(0);
    await page.evaluate(() => window.stopEdits(false));
    // A block far down the page, typed in while the serve holds the commit.
    const block = host.locator('[data-block-id="order"]');
    await block.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.holdServe(true));
    await block.getByText('#5980').click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await page.keyboard.type(' 保留');
    await expect.poll(() => page.evaluate(() => window.heldCommits())).toBeGreaterThan(0);
    // The page stops taking edits: the text on its way leaves the drawn page, and the line says
    // where it is, in view wherever the person has scrolled.
    await page.evaluate(() => window.stopEdits(true));
    await expect(block).not.toContainText('保留');
    await expect(kept).toBeInViewport();
    if (theme === 'dark')
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
        'rgb(255, 255, 255)',
      );
    await page.screenshot({ path: capturePath(`structured-kept-toast-390-${theme}.png`) });
    // It takes edits again: the text lands and the line goes.
    await page.evaluate(() => {
      window.stopEdits(false);
      window.holdServe(false);
    });
    await expect(block).toContainText('保留');
    await expect(kept).toHaveCount(0);
  });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`a chart block draws its data with written values at ${width} ${theme} (#6746)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const host = await mountFixture(page, 'charts');
      const block = (id: string) => host.locator(`[data-block-id="${id}"]`);
      // Stacked bars: three series in each of seven columns, each named in the legend.
      const stacked = block('stacked').getByRole('group', { name: '每週 token 用量' });
      await expect(stacked.locator('rect.tmt-ui-chart-bar')).toHaveCount(21);
      await expect(stacked.locator('.tmt-ui-chart-legend-label')).toHaveText([
        'Codex',
        'Claude',
        'Agy',
      ]);
      // Every category is named under its column, at 390 too (seven short names fit).
      await expect(
        stacked.locator('text.tmt-ui-chart-tick').filter({ hasText: /^週/ }),
      ).toHaveCount(7);
      // Bars write their values where the column holds them.
      if (width === 1440)
        await expect(block('bar').locator('text.tmt-ui-chart-value')).toHaveText([
          '24',
          '31',
          '18',
          '36',
          '28',
        ]);
      // A meter always writes its percent, after the series' name.
      const meters = block('meter').getByRole('meter');
      await expect(meters).toHaveCount(3);
      await expect(meters.first()).toHaveAttribute('aria-valuetext', '55%');
      await expect(block('meter')).toContainText('剩 55%');
      // No chart block carries markup of its own: nothing in the page runs.
      expect(
        await page.evaluate(
          () => document.querySelectorAll('#structured-page-fixture script').length,
        ),
      ).toBe(0);
      if (theme === 'dark')
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
          'rgb(255, 255, 255)',
        );
      await page.mouse.move(0, 0);
      await host.screenshot({
        path: capturePath(`structured-charts-${width}-${theme}.png`),
        animations: 'disabled',
      });
    });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`a diagram block draws its flowchart in the page's theme, the source a disclosure away, at ${width} ${theme} (#6746)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const host = await mountFixture(page, 'diagrams');
      const flow = host.locator('[data-block-id="flow"] .structured-diagram');
      // Shrunk to its column while its text stays at least 11px (Mermaid draws 16px); narrower than
      // that it keeps its size and scrolls sideways, a tab stop that says so. A phone always scrolls.
      await expect(flow.locator('.structured-diagram-drawing svg')).toBeVisible({
        timeout: 30_000,
      });
      const sizes = await flow.locator('.structured-diagram-drawing').evaluate((node) => ({
        column: node.clientWidth,
        natural: node.querySelector('svg')!.viewBox.baseVal.width,
      }));
      const scrolls = sizes.natural * (11 / 16) > sizes.column;
      if (width === 390) expect(scrolls, JSON.stringify(sizes)).toBe(true);
      const drawing = flow.getByRole('img', {
        name: scrolls ? '刪除頁面時發生什麼, scrolls sideways' : '刪除頁面時發生什麼',
        exact: true,
      });
      await expect(drawing.locator('svg')).toBeVisible({ timeout: 30_000 });
      if (!scrolls)
        expect(await drawing.evaluate((node) => node.querySelector('svg')!.clientWidth)).toBe(
          sizes.column,
        );
      if (scrolls) {
        await expect(drawing).toHaveAttribute('tabindex', '0');
        await drawing.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => drawing.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
        await drawing.evaluate((node) => (node.scrollLeft = 0));
      } else await expect(drawing).not.toHaveAttribute('tabindex');
      // Six nodes, one of them the decision, drawn as a diamond: its shape says so, not its colour.
      await expect(drawing.locator('g.node')).toHaveCount(6);
      await expect(drawing.locator('g.node polygon')).toHaveCount(1);
      await expect(drawing).toContainText('資料庫版本對嗎？');
      await expect(drawing).toContainText('是');
      // SVG text, never foreign HTML.
      await expect(drawing.locator('foreignObject')).toHaveCount(0);
      // The node's text reads against its fill in this theme.
      const colours = await drawing
        .locator('g.node')
        .first()
        .evaluate((node) => ({
          fill: getComputedStyle(node.querySelector('rect, polygon, path')!).fill,
          text: getComputedStyle(node.querySelector('text, tspan')!).fill,
        }));
      expect(colours.fill).not.toBe(colours.text);
      const source = flow.locator('details');
      await expect(source).not.toHaveAttribute('open', '');
      await source.locator('summary').click();
      await expect(source.locator('.structured-diagram-line')).toHaveCount(6);
      await expect(source.locator('.structured-diagram-line').nth(1)).toHaveText(
        '2  A[按下刪除] --> B{資料庫版本對嗎？}',
      );
      await source.locator('summary').click();
      // A source Mermaid cannot read says which line, and shows the source as it is.
      const broken = host.locator('[data-block-id="broken"]');
      await expect(broken.getByRole('alert')).toContainText('Line 3 cannot be read.', {
        timeout: 30_000,
      });
      // The caret under the line leads; Mermaid's list of expected tokens waits behind Details.
      await expect(broken.locator('.structured-diagram-message').first()).toHaveText(/\^$/);
      const details = broken.getByRole('alert').locator('details');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(details.locator('summary')).toHaveText('Details');
      await expect(details).toContainText('Expecting');
      await expect(broken.locator('.structured-diagram-line')).toHaveCount(6);
      await expect(broken.locator('svg')).toHaveCount(0);
      // A kind the page does not draw, or a directive, is never drawn and says why.
      await expect(host.locator('[data-block-id="other"]').getByRole('status')).toHaveText(
        text.diagram.kind,
      );
      await expect(host.locator('[data-block-id="directive"]').getByRole('status')).toContainText(
        'remove the %%{…}%% directive',
      );
      await expect(host.locator('[data-block-id="directive"] svg')).toHaveCount(0);
      if (theme === 'dark')
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
          'rgb(255, 255, 255)',
        );
      await host.locator('[data-block-id="flow"]').screenshot({
        path: capturePath(`structured-diagram-${width}-${theme}.png`),
        animations: 'disabled',
      });
      await host.locator('[data-block-id="broken"]').screenshot({
        path: capturePath(`structured-diagram-broken-${width}-${theme}.png`),
        animations: 'disabled',
      });
    });

/** What each kind past the flowchart draws from the fixture (DIAGRAM_KINDS in
 * structured-page-browser.tsx): its words, and the marks that are its own. */
const KIND_DRAWINGS = {
  sequence: {
    words: ['使用者', 'Colab', '按下刪除', '要求確認', '確認', '寫進 owner log'],
    marks: 'text.actor',
  },
  state: { words: ['草稿', '審查中', '已發布', '送出', '退回', '通過'], marks: 'g.node' },
  gantt: { words: ['發布計畫', '設計', '實作', '審查', '開發', '驗收'], marks: 'rect.task' },
  class: {
    words: ['Block', 'Chart', 'Diagram', '+id string', '+kind string', '延伸'],
    marks: 'g.node',
  },
} as const;

for (const [kind, drawn] of Object.entries(KIND_DRAWINGS))
  test(`a ${kind} diagram draws as SVG text in the page's theme, at 1440 and 390, light and dark (#6746)`, async ({
    page,
  }) => {
    const host = await mountFixture(page, 'diagrams');
    const block = host.locator(`[data-block-id="${kind}"]`);
    const figure = block.locator('.structured-diagram');
    await expect(figure).toHaveAttribute('data-kind', kind);
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        const svg = block.locator('.structured-diagram-drawing svg');
        await expect(figure).toHaveAttribute('data-state', 'drawn', { timeout: 30_000 });
        await expect(svg).toBeVisible();
        // Every word is drawn as SVG text, never foreign HTML, so the cleaner keeps it all.
        await expect(svg.locator('foreignObject')).toHaveCount(0);
        const words = await svg.evaluate((node) =>
          [...node.querySelectorAll('text')].map((text) => text.textContent ?? '').join('\n'),
        );
        for (const word of drawn.words) expect(words, word).toContain(word);
        expect(await svg.locator(drawn.marks).count()).toBeGreaterThan(0);
        // The text reads against the page in this theme.
        const colours = await svg.evaluate((node) => ({
          text: getComputedStyle(node.querySelector('text')!).fill,
          page: getComputedStyle(document.body).backgroundColor,
        }));
        expect(colours.text).not.toBe(colours.page);
        if (kind === 'state' || kind === 'class') {
          // Each transition or relation label sits on an opaque backing in the page's colour, as
          // large as its words, so no line runs through them.
          const labels = await svg.locator('g.edgeLabel').evaluateAll((groups) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--tmt-ui-surface-paper)';
            groups[0]!.closest('.structured-diagram')!.append(probe);
            const paper = getComputedStyle(probe).color;
            probe.remove();
            return groups
              .filter((group) => (group.textContent ?? '').trim() !== '')
              .map((group) => {
                const text = group.querySelector('text')!.getBoundingClientRect();
                const rect = group.querySelector('rect');
                const box = rect?.getBoundingClientRect();
                return {
                  words: group.textContent!.trim(),
                  opacity: rect ? getComputedStyle(rect).opacity : 'none',
                  paper: rect ? getComputedStyle(rect).fill === paper : false,
                  covers:
                    !!box &&
                    box.left <= text.left + 0.5 &&
                    box.right >= text.right - 0.5 &&
                    box.top <= text.top + 0.5 &&
                    box.bottom >= text.bottom - 0.5,
                };
              });
          });
          expect(labels.length, kind).toBeGreaterThan(0);
          for (const label of labels)
            expect(label, label.words).toMatchObject({ opacity: '1', paper: true, covers: true });
        }
        if (kind === 'sequence') {
          // The source's red grouping draws in the design system's sheet, not in red.
          const fill = await svg
            .locator('rect.rect')
            .first()
            .evaluate((node) => getComputedStyle(node).fill);
          expect(fill).not.toBe('rgb(255, 0, 0)');
        }
        if (kind === 'gantt') {
          // The page turns today's marker off, so a Gantt chart never changes with the date.
          await expect(svg.locator('.today')).toHaveCount(0);
          // Each date on the axis clears the next.
          const ticks = await svg.locator('g.tick text').evaluateAll((texts) =>
            texts
              .map((text) => text.getBoundingClientRect())
              .sort((a, b) => a.left - b.left)
              .map(({ left, right }) => [left, right]),
          );
          expect(ticks.length).toBeGreaterThan(5);
          for (let at = 1; at < ticks.length; at++)
            expect(ticks[at]![0]!, JSON.stringify(ticks)).toBeGreaterThan(ticks[at - 1]![1]!);
        }
        if (theme === 'dark')
          expect(
            await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
          ).not.toBe('rgb(255, 255, 255)');
        await page.mouse.move(0, 0);
        await block.screenshot({
          path: capturePath(`structured-diagram-${kind}-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
  });

test('each kind at its bound draws, and the time it takes is logged (#6746)', async ({ page }) => {
  await mountFixture(page, 'diagrams');
  await expect(page.locator('[data-block-id="flow"] svg')).toBeVisible({ timeout: 30_000 });
  const timings = await page.evaluate(async () => {
    const draw = '/src/diagram-draw.ts';
    const admit = '/src/diagram-source.ts';
    const { drawDiagram } = (await import(draw)) as typeof import('../src/diagram-draw.js');
    const { admitDiagram, DIAGRAM_EDGES, DIAGRAM_LINES } = (await import(
      admit
    )) as typeof import('../src/diagram-source.js');
    // A fixed tangle of 100 names, so every kind lays out the same many crossings.
    let seed = 6746;
    const pick = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 100;
    const lines = (count: number, line: (at: number) => string) =>
      Array.from({ length: count }, (_, at) => line(at));
    const sources = {
      flowchart: ['flowchart TD', ...lines(DIAGRAM_EDGES, () => `  N${pick()} --> N${pick()}`)],
      sequence: [
        'sequenceDiagram',
        ...lines(DIAGRAM_LINES.sequence - 1, (at) => `  P${pick() % 8}->>P${pick() % 8}: m${at}`),
      ],
      state: [
        'stateDiagram-v2',
        ...lines(DIAGRAM_LINES.state - 1, () => `  S${pick()} --> S${pick()}`),
      ],
      gantt: [
        'gantt',
        '  dateFormat YYYY-MM-DD',
        '  section S',
        '  t0 :a0, 2026-01-01, 1d',
        ...lines(
          DIAGRAM_LINES.gantt - 4,
          (at) => `  t${at + 1} :a${at + 1}, after a${at}, ${1 + (pick() % 5)}d`,
        ),
      ],
      class: [
        'classDiagram',
        ...lines(DIAGRAM_LINES.class - 1, () => `  C${pick()} <|-- C${pick()}`),
      ],
    };
    const theme = { dark: false, variables: {}, fontFamily: 'sans-serif' };
    const out: Record<string, { admitted: boolean; drawn: boolean; ms: number }> = {};
    for (const [kind, source] of Object.entries(sources)) {
      const admitted = admitDiagram(source.join('\n'));
      if (!admitted.ok) {
        out[kind] = { admitted: false, drawn: false, ms: 0 };
        continue;
      }
      const start = performance.now();
      const drawn = await drawDiagram(`cap-${kind}`, admitted.source, theme);
      out[kind] = {
        admitted: true,
        drawn: 'svg' in drawn,
        ms: Math.round(performance.now() - start),
      };
    }
    return out;
  });
  console.log(`diagram-cap-timing ${JSON.stringify(timings)}`);
  for (const [kind, timing] of Object.entries(timings))
    expect(timing, kind).toMatchObject({ admitted: true, drawn: true });
});

test('a hostile source of each kind draws as text: no link, menu or handler survives (#6746)', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await mountFixture(page, 'diagrams');
  await expect(page.locator('[data-block-id="flow"] svg')).toBeVisible({ timeout: 30_000 });
  const found = await page.evaluate(async () => {
    const draw = '/src/diagram-draw.ts';
    const admit = '/src/diagram-source.ts';
    const { drawDiagram } = (await import(draw)) as typeof import('../src/diagram-draw.js');
    const { admitDiagram } = (await import(admit)) as typeof import('../src/diagram-source.js');
    const sources = {
      sequence: [
        'sequenceDiagram',
        '  participant A as <img src=x onerror=alert(1)>',
        '  link A: Docs @ javascript:alert(2)',
        '  links A: {"Out": "https://example.com/l"}',
        '  rect rgb(255, 0, 0)',
        '    A->>A: <script>alert(3)</script>',
        '  end',
      ],
      state: [
        'stateDiagram-v2',
        '  [*] --> A',
        '  click A "https://example.com/c"',
        '  style A fill:url(https://example.com/s.png)',
      ],
      gantt: [
        'gantt',
        '  dateFormat YYYY-MM-DD',
        '  t :a1, 2026-01-01, 3d',
        '  click a1 href "javascript:alert(4)"',
        '  click a1 call alert(5)',
      ],
      class: [
        'classDiagram',
        '  class A',
        '  click A href "javascript:alert(6)"',
        '  link A "https://example.com/k"',
        '  callback A "alert"',
        '  style A fill:url(https://example.com/s.png)',
      ],
    };
    const theme = { dark: false, variables: {}, fontFamily: 'sans-serif' };
    const host = document.createElement('div');
    document.body.append(host);
    const out: Record<string, unknown> = {};
    for (const [kind, source] of Object.entries(sources)) {
      const admitted = admitDiagram(source.join('\n'));
      if (!admitted.ok) {
        out[kind] = admitted.reason;
        continue;
      }
      const drawn = await drawDiagram(`hostile-${kind}`, admitted.source, theme);
      if (!('svg' in drawn)) {
        out[kind] = drawn.error.excerpt;
        continue;
      }
      host.innerHTML = drawn.svg;
      const all = [...host.querySelectorAll('*')];
      out[kind] = {
        links: host.querySelectorAll('a').length,
        hrefs: all.filter((el) => el.hasAttribute('href') || el.hasAttribute('xlink:href')).length,
        foreign: host.querySelectorAll('foreignObject, image, use, script, iframe, img').length,
        handlers: all.filter((el) => [...el.attributes].some((attr) => attr.name.startsWith('on')))
          .length,
        outsideUrls: all.filter((el) =>
          [...el.attributes].some((attr) => /url\(\s*['"]?(?!#)/i.test(attr.value)),
        ).length,
        example: host.innerHTML.includes('example.com'),
      };
      for (const node of host.querySelectorAll('g, text, rect'))
        (node as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    host.remove();
    return out;
  });
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 300))),
  );
  const clean = { links: 0, hrefs: 0, foreign: 0, handlers: 0, outsideUrls: 0, example: false };
  expect(found).toEqual({ sequence: clean, state: clean, gantt: clean, class: clean });
  expect(dialogs).toEqual([]);
  expect(requested.filter((url) => url.includes('example.com'))).toEqual([]);
});

test('a hostile diagram source draws as text: nothing in it runs, links or loads (#6746)', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const host = await mountFixture(page, 'diagrams');
  const drawing = host.locator('[data-block-id="hostile"] .structured-diagram-drawing');
  await expect(drawing.locator('svg')).toBeVisible({ timeout: 30_000 });
  await expect(drawing.locator('g.node')).toHaveCount(3);
  const found = await drawing.evaluate((node) => ({
    links: node.querySelectorAll('a').length,
    hrefs: [...node.querySelectorAll('*')].filter(
      (el) => el.hasAttribute('href') || el.hasAttribute('xlink:href'),
    ).length,
    foreign: node.querySelectorAll('foreignObject, image, use, script, iframe, img').length,
    handlers: [...node.querySelectorAll('*')].filter((el) =>
      [...el.attributes].some((attr) => attr.name.startsWith('on')),
    ).length,
    outsideUrls: [...node.querySelectorAll('*')].filter((el) =>
      [...el.attributes].some((attr) => /url\(\s*['"]?(?!#)/i.test(attr.value)),
    ).length,
    styleText: [...node.querySelectorAll('style')].map((style) => style.textContent ?? '').join(''),
  }));
  expect(found).toMatchObject({ links: 0, hrefs: 0, foreign: 0, handlers: 0, outsideUrls: 0 });
  expect(found.styleText).not.toMatch(/example\.com|@import/);
  await drawing.locator('g.node').first().click();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 300))),
  );
  expect(dialogs).toEqual([]);
  expect(requested.filter((url) => url.includes('example.com'))).toEqual([]);
});

/** The fixture's flowchart (DELETE_FLOW in structured-page-browser.tsx), a line each. */
const DELETE_FLOW_LINES = [
  'flowchart LR',
  '  A[按下刪除] --> B{資料庫版本對嗎？}',
  '  B -->|是| C[寫進 owner log]',
  '  B -->|否| D[提示重新啟動 Colab]',
  '  C --> E[記下時間與誰]',
  '  E --> F[從列表移除]',
];

test("a diagram's source is edited in place: Enter is a line feed, and a fixed source draws (#6746)", async ({
  page,
}) => {
  const host = await mountFixture(page, 'diagrams');
  const blocks = host.locator('[data-block-id]');
  const count = await blocks.count();
  // The broken source: a click on its problem opens the source in the editor, the drawing's place
  // under it still saying what is wrong.
  const broken = host.locator('[data-block-id="broken"]');
  await expect(broken.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  await broken.getByRole('alert').click();
  const editor = broken.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(/B -->>\|是\|/);
  // The source typed again with line 3's arrow fixed and a new last edge: Enter adds a line, never
  // a block.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(editor).toHaveText('');
  const fixed = [...DELETE_FLOW_LINES, '  F --> G[完成]'];
  // Typed as a person types: an insert in the same frame as the clear is lost in any text block
  // (filed separately), never a keystroke.
  for (const [at, line] of fixed.entries()) {
    if (at) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Escape');
  await expect(blocks).toHaveCount(count);
  // The page holds the typed source, a line each.
  await expect(broken.locator('.structured-diagram-line')).toHaveText(
    fixed.map((line, at) => `${at + 1}${line}`),
  );
  const drawing = broken.locator('.structured-diagram-drawing svg');
  await expect(drawing).toBeVisible({ timeout: 30_000 });
  await expect(drawing.locator('g.node')).toHaveCount(7);
  await expect(broken.getByRole('alert')).toHaveCount(0);
  // Opening the source reads it, rather than editing it.
  await broken.locator('summary').click();
  await expect(broken.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(broken.locator('.structured-diagram-line')).toHaveCount(7);
  // Edited again on a wide screen, a drawing that still scrolls says how it would fit; read, or on
  // a phone, where every flowchart scrolls, it says nothing.
  const hint = broken.getByText(text.diagram.wide);
  await expect(hint).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await broken.locator('.structured-diagram-drawing').click();
  await expect(broken.locator('[contenteditable="true"]')).toBeFocused();
  await expect(hint).toBeVisible();
  await broken.screenshot({ path: capturePath('structured-diagram-hint-1440.png') });
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await broken.locator('.structured-diagram-drawing').click();
  await expect(broken.locator('[contenteditable="true"]')).toBeFocused();
  await expect(broken.locator('.structured-diagram-drawing')).toHaveAttribute('tabindex', '0');
  await expect(hint).toHaveCount(0);
});

test('a page without a diagram never loads the diagram drawer (#6746)', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (request) => {
    if (/diagram-draw|mermaid|dompurify/.test(request.url())) loaded.push(request.url());
  });
  const host = await mountFixture(page, 'charts');
  await expect(host.locator('[data-block-id="meter"]')).toContainText('剩 55%');
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 500))),
  );
  expect(loaded).toEqual([]);
  // A page with one loads it.
  await page.evaluate(async () => {
    const path = '/test/structured-page-browser.tsx';
    document.getElementById('structured-page-fixture')?.remove();
    (await import(path)).mount('diagrams');
  });
  await expect(page.locator('[data-block-id="flow"] svg')).toBeVisible({ timeout: 30_000 });
  expect(loaded.some((url) => url.includes('diagram-draw'))).toBe(true);
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
  await expect(mock.getByRole('status')).toHaveCount(0);
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

test('a mockup shows loading until its design system draws', async ({ page }) => {
  await servePageRuntime(page);
  for (const width of [1440, 390]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await page.evaluate(async () => {
        const path = '/test/structured-page-browser.tsx';
        (await import(path)).mount('spec', { slowMockup: true });
      });
      const mock = page.locator('[data-block-id="mock"]');
      await expect(mock.getByRole('status')).toHaveText('Loading…');
      await expect(mock.locator('.tmt-block-mockup-frame')).toHaveAttribute('aria-busy', 'true');
      const dir = process.env.COLAB_MOCKUP_CAPTURE_DIR;
      if (dir) await mock.screenshot({ path: `${dir}/loading-${width}-${theme}.png` });
      await page.evaluate(() => window.releaseMockup());
      await expect(
        mock.frameLocator('iframe').getByRole('heading', { name: '手機上的區塊選單' }),
      ).toBeVisible();
      await expect(mock.getByRole('status')).toHaveCount(0);
      await expect(mock.locator('.tmt-block-mockup-frame')).not.toHaveAttribute('aria-busy');
      if (dir) {
        await mock.screenshot({ path: `${dir}/rendered-${width}-${theme}.png` });
        await mock
          .frameLocator('iframe')
          .locator('body')
          .screenshot({
            path: `${dir}/frame-${width}-${theme}.png`,
          });
      }
    }
  }
});

test('a table cell edits in place, Tab walks the cells and adds a row, and the table duplicates', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const table = host.locator('[data-block-id="table"]');
  const editor = table.locator('[contenteditable="true"]');
  const rows = () => page.evaluate(() => window.serveRows('table'));
  // A line feed an agent writes into a cell draws as a line break.
  await page.evaluate(() =>
    window.agentBatch([
      {
        op: 'table',
        id: 'table',
        action: 'set-cell',
        row: 'r1',
        column: 'use',
        text: '一行\n兩行',
      },
    ]),
  );
  const broken = table.locator('[data-cell-row="r1"][data-cell-column="use"]');
  await expect(broken.locator('br')).toHaveCount(1);
  await expect(broken).toHaveText('一行\n兩行', { useInnerText: true });
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
  // Esc selects the table; ⌘Z takes back the typing in the new row, as a step of its own (#6742),
  // then the added row.
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(table).toHaveAttribute('data-selected', '');
  await page.keyboard.press('ControlOrMeta+z');
  await expect
    .poll(async () => (await rows()).map((row) => row.cells?.name ?? ''))
    .toEqual(['小標題', '段落', '卡片／區段', '']);
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

test('⌘Z in a table cell takes back the cell’s typing, never an earlier step elsewhere', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const rows = () => page.evaluate(() => window.serveRows('table'));
  const moves = () => page.evaluate(() => window.sent.filter((op) => op.op === 'move').length);
  // An earlier step elsewhere on the page: a block moved down from its menu.
  const first = host.locator('[data-block-id="first"]');
  await first.hover();
  await first.getByRole('button', { name: 'Block actions' }).click();
  await page
    .getByRole('menu', { name: 'Block actions' })
    .getByRole('menuitem', { name: /Move down/ })
    .click();
  await expect.poll(moves).toBe(1);
  const table = host.locator('[data-block-id="table"]');
  await table.getByText('一般文字').click();
  const editor = table.locator('[contenteditable="true"]');
  await editor.press(textEnd);
  await editor.pressSequentially('和清單', { delay: 20 });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await rows())[1]!.cells!.use).toBe('一般文字');
  await expect(editor).toHaveText('一般文字');
  // The move stays: ⌘Z took back the cell's typing only.
  expect(await moves()).toBe(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await rows())[1]!.cells!.use).toBe('一般文字和清單');
  expect(await moves()).toBe(1);
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
      const toolbar = await mock.locator('.tmt-block-mockup-toolbar').boundingBox();
      const stage = await mock.locator('.tmt-block-mockup-viewport').boundingBox();
      expect(stage!.y - (toolbar!.y + toolbar!.height)).toBe(8);
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
      await editor.press(textEnd);
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
  await editor.press(textEnd);
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
  // Opened again to change it, the form holds the answer given, so adding a choice keeps the
  // first (#6749).
  const strip = block.locator('.tmt-block-question-answered');
  await expect(strip).toContainText('圖片');
  await strip.click();
  await expect(card.getByLabel('圖片', { exact: true })).toBeChecked();
  await expect(card.getByLabel('表格', { exact: true })).not.toBeChecked();
  await card.getByLabel('表格', { exact: true }).check();
  await expect(card.getByLabel('圖片', { exact: true })).toBeChecked();
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
      // The title is the DS card title, a space-s step under the meta line (#6257).
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
          gap: style.marginTop === token('--tmt-ui-space-s'),
          weight: style.fontWeight === style.getPropertyValue('--tmt-ui-card-title-weight').trim(),
        };
      });
      expect(heading).toEqual({ size: true, gap: true, weight: true });
      const sendBox = (await block.getByRole('button', { name: 'Send' }).boundingBox())!;
      expect(sendBox.x).toBe(doneBox.x);
      expect(sendBox.height).toBe(doneBox.height);
      const editBox = (await block.getByRole('button', { name: 'Edit question' }).boundingBox())!;
      expect(editBox.y + editBox.height).toBeLessThan(sendBox.y);
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
      // That Retry reads the failed image again is test/block-images.test.ts's (#6357).
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

const RELEASE = 'b1000000-0000-4000-8000-000000000001';
const TAG = 'c1000000-0000-4000-8000-000000000002';

/** Opens the @ menu at the end of list item l2 of the spec fixture. */
async function atMenu(
  page: import('@playwright/test').Page,
  host: import('@playwright/test').Locator,
) {
  const item = host.locator('[data-block-id="l2"]');
  await item.getByText('滑過或選取是淡色底。').click();
  const editor = item.locator('[contenteditable="true"]');
  await editor.press(lineEnd);
  await editor.pressSequentially(' @', { delay: 20 });
  return { item, editor, menu: page.getByRole('listbox', { name: '@ mention' }) };
}

test('@ opens another page by keyboard and marks its block with the page', async ({ page }) => {
  const host = await mountFixture(page, 'spec');
  const { item, editor, menu } = await atMenu(page, host);
  // The page list is read once for the menu; no page is opened by typing.
  await expect(menu.getByRole('option', { name: 'Release checklist' })).toBeVisible();
  // The other pages are their own group, under a quiet heading; Enter opens the active one.
  const others = menu.getByRole('group', { name: 'Other pages' });
  await expect(others).toContainText('Other pages');
  await editor.pressSequentially('rel', { delay: 20 });
  await expect(menu.getByRole('option')).toHaveText(['Release checklist']);
  await expect(others.getByRole('option', { name: 'Release checklist' })).toBeVisible();
  await expect(menu.locator('[data-slot="block-menu-footer"]')).toContainText('Enter open');
  expect(await page.evaluate(() => [window.pageListReads, window.pageReads.length])).toEqual([
    1, 0,
  ]);
  // → opens the page: its blocks are read once, behind the way back.
  await editor.press('ArrowRight');
  await expect(menu.getByRole('option').first()).toHaveText('Release checklist');
  for (let i = 0; i < 3; i++) await editor.press('Backspace');
  await editor.pressSequentially('tag', { delay: 20 });
  await expect(menu.getByRole('option')).toHaveText([
    'Release checklist',
    'To-do: Tag the release',
  ]);
  await expect(menu.getByRole('option', { selected: true })).toHaveText('To-do: Tag the release');
  expect(await page.evaluate(() => window.pageReads)).toEqual([RELEASE]);
  await editor.press('Enter');
  await expect(menu).toHaveCount(0);
  const expected = '滑過或選取是淡色底。 To-do: Tag the release ';
  await expect.poll(() => page.evaluate(() => window.serveText('l2'))).toBe(expected);
  await expect
    .poll(() => page.evaluate(() => window.serveMarks('l2')))
    .toEqual([{ from: 11, to: 33, mark: 'block', value: `${RELEASE}/${TAG}` }]);
  // At rest the chip shows the stored text, never reads that page, and opens it through the
  // page's trusted link path.
  await editor.press('Escape');
  const chip = item.locator('[data-slot="block-mention"]');
  const href = `https://colab.example/pages/${RELEASE}#block-${TAG}`;
  await expect(chip).toHaveText('To-do: Tag the release');
  await expect(chip).toHaveAttribute('href', href);
  await chip.click();
  expect(await page.evaluate(() => window.opened)).toEqual([{ href, newTab: false }]);
  expect(await page.evaluate(() => window.pageReads)).toEqual([RELEASE]);
});

test('@ opens another page with the mouse, goes back, retries a failed read, and ends reads on close', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const { editor, menu } = await atMenu(page, host);
  await page.evaluate(() => (window.failPageReads = true));
  await menu.getByRole('option', { name: 'Release checklist' }).click();
  const retry = menu.getByRole('option', { name: 'Could not read this page. Retry' });
  await expect(retry).toBeVisible();
  await page.evaluate(() => (window.failPageReads = false));
  await retry.click();
  await expect(menu.getByRole('option', { name: 'To-do: Tag the release' })).toBeVisible();
  // ← and the way-back row both return to the list.
  await editor.press('ArrowLeft');
  await expect(menu.getByRole('option', { name: 'Release checklist' })).toBeVisible();
  await menu.getByRole('option', { name: 'Release checklist' }).click();
  await expect(menu.getByRole('option', { name: 'To-do: Tag the release' })).toBeVisible();
  await menu.getByRole('option', { name: 'Release checklist' }).click();
  await expect(menu.getByRole('option', { name: 'Roadmap' })).toBeVisible();
  // A page that does not answer shows it is being read; closing the menu ends that read.
  await menu.getByRole('option', { name: 'Roadmap' }).click();
  await expect(menu).toContainText('Reading this page…');
  await editor.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.pageAborts))
    .toEqual(['b2000000-0000-4000-8000-000000000002']);
  // Backspace with nothing after the @ goes back from an opened page instead of deleting the @.
  await editor.pressSequentially(' @', { delay: 20 });
  await menu.getByRole('option', { name: 'Release checklist' }).click();
  await expect(menu.getByRole('option', { name: 'To-do: Tag the release' })).toBeVisible();
  await editor.press('Backspace');
  await expect(menu.getByRole('option', { name: 'Release checklist' })).toBeVisible();
  await expect(editor).toContainText('@');
});

test('@ without the page list authority offers no other page and no hint', async ({ page }) => {
  const host = await mountFixture(page);
  const item = host.locator('[data-block-id="p"]');
  await item.click();
  const editor = item.locator('[contenteditable="true"]');
  await editor.press('End');
  await editor.pressSequentially(' @', { delay: 20 });
  const menu = page.getByRole('listbox', { name: '@ mention' });
  await expect(menu.getByRole('option')).toHaveText(['@tmt-gui-lead', '@gui-2']);
  await expect(menu.getByRole('group', { name: 'Other pages' })).toHaveCount(0);
});

// #6274: a dropped file shows its uploading tile at once, even while an earlier batch of this page
// is still held at the serve; the upload waits for that batch, the tile does not.
test('a dropped file shows its tile while an earlier batch is still in flight', async ({
  page,
}) => {
  const host = await mountFixture(page, 'spec');
  const blocks = await topLevel(host);
  const target = blocks[1]!;
  await host.locator(`[data-block-id="${target}"]`).click();
  const editor = host.locator(`[data-block-id="${target}"] [contenteditable="true"]`);
  await editor.press('End');
  await page.evaluate(() => window.holdServe(true));
  await editor.pressSequentially('X', { delay: 20 });
  await expect.poll(() => page.evaluate(() => window.heldCommits())).toBe(1);
  await addFiles(page, target, [{ name: 'board.png', png: '#c8553d' }]);
  // The tile is a new block right after the one the file was dropped on.
  await expect.poll(async () => (await topLevel(host)).length).toBe(blocks.length + 1);
  const tile = (await topLevel(host))[2]!;
  await expect(host.locator(`[data-block-id="${tile}"] .tmt-block-image-placeholder`)).toHaveCount(
    1,
  );
  // Nothing is uploaded before the held batch settles; then the image lands.
  expect(await page.evaluate(() => window.uploaded)).toEqual([]);
  await page.evaluate(() => window.holdServe(false));
  await expect(host.locator(`[data-block-id="${tile}"] img[alt="board.png"]`)).toHaveCount(1);
});

// #6274: files dropped or pasted on a page that cannot take them are not lost silently: the status
// line says nothing was added.
for (const how of ['drop', 'paste'] as const)
  test(`files ${how === 'drop' ? 'dropped' : 'pasted'} on a page without file access say they were not added`, async ({
    page,
  }) => {
    const host = await mountFixture(page, 'plan');
    const blocks = await topLevel(host);
    await addFiles(page, blocks[0]!, [{ name: 'notes.txt', text: 'Ship the stack.\n' }], how);
    await expect(host.getByText(text.blockFiles.unavailable)).toBeVisible();
    expect(await topLevel(host)).toEqual(blocks);
  });

for (const kind of ['single', 'multiple', 'short'] as const) {
  test(`a selected ${kind} question takes an answer directly (#6749)`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (kind) => {
      const fixture = '/test/structured-page-browser.tsx';
      (await import(fixture)).mount('spec', { questionKind: kind });
    }, kind);
    const block = page.locator(`[data-block-id="${QUESTION}"]`);
    const answer =
      kind === 'short'
        ? block.getByRole('textbox', { name: 'Your answer' })
        : block.getByLabel('問題', { exact: true });
    for (const target of [block.getByRole('heading'), block.getByText(/Waiting for your answer/)]) {
      await target.click();
      await expect(answer).toBeFocused();
    }
    await answer.click();
    await expect(answer).toBeFocused();
    await page.keyboard.press('Tab');
    await block.focus();
    await page.keyboard.press('Enter');
    await expect(answer).toBeFocused();
    await expect(block.getByRole('group', { name: 'Edit question' })).toHaveCount(0);
    if (kind === 'short') await answer.fill('Ship Friday');
    else await answer.check();
    await block.getByRole('button', { name: 'Send', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.answers()))
      .toContainEqual(expect.objectContaining({ questionId: QUESTION }));
    await block
      .getByRole('button', { name: kind === 'short' ? /Ship Friday/ : /先做哪個區塊？.*問題/ })
      .click();
    await expect(answer).toBeFocused();
  });
}

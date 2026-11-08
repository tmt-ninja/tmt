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
    });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`the spec page draws read-only and mid-typing at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await servePageRuntime(page);
      const host = await mountFixture(page, 'spec');
      await expect(host.locator('[data-block-id]')).toHaveCount(23);
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
      await edit.getByRole('button', { name: 'Done' }).click();
      await expect(block.getByRole('group', { name: '先做哪個區塊？' })).toBeVisible();
      await shot('rest');
      expect({ section: await box('.tmt-block-question'), title: await box('h3') }).toEqual(
        editing,
      );
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

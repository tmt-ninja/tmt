import { expect, test, type Page } from '@playwright/test';

// #6273: the handle (＋ and ⋯) hangs 48px left of its block. On a top-level block in the app, the
// page stage left it outside the page root (the stage's margin is 30px at 1440 with the sidebar), so
// the pointer left the root before it reached a button and the handle went, as before #6248; at a
// narrow window the handle lay off the screen. block-handle.spec.ts passed because its fixture host
// is a 720px column with the design system's own gutter. This one runs in the real shell.
async function mountShell(page: Page, width: number, hash = '') {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/colab/renderer.html', async (route) =>
    route.fulfill({
      response: await route.fetch({ url: new URL('/renderer.html', route.request().url()).href }),
    }),
  );
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import {mountBlockShell} from '/test/block-shell-browser.tsx'; void mountBlockShell(undefined, ${JSON.stringify(hash)});`,
    }),
  );
  // Any served path: the fixture puts the page's own address in place.
  await page.goto('/colab/design/');
  await expect(page.locator('.structured-page-stage [data-block-id="two"]')).toBeVisible();
}

/** Move the pointer from `from` to `to` in small steps, as a hand does, and say at which x the
 * handle was gone. */
async function travel(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const handle = page.locator('.structured-page-stage [data-slot="block-handle"]');
  const gone: number[] = [];
  await page.mouse.move(from.x, from.y);
  const steps = Math.ceil(Math.abs(from.x - to.x) / 4);
  for (let step = 1; step <= steps; step++) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    await page.mouse.move(x, from.y + ((to.y - from.y) * step) / steps);
    if ((await handle.count()) === 0) gone.push(Math.round(x));
  }
  return gone;
}

for (const width of [1440, 800])
  for (const block of ['two', 'nested'] as const)
    for (const button of ['Insert block', 'Block actions'] as const)
      test(`at ${width}px the pointer goes from the ${block} block's text to ${button} and clicks it`, async ({
        page,
      }) => {
        await mountShell(page, width);
        const stage = page.locator('.structured-page-stage');
        const target = stage.locator(`[data-block-id="${block}"]`);
        const text = (await target.boundingBox())!;
        const start = { x: text.x + 60, y: text.y + 12 };
        await page.mouse.move(start.x, start.y);
        const control = target.locator(':scope > [data-slot="block-handle"]').getByRole('button', {
          name: button,
        });
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        const goal = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        // The handle stays under the pointer all the way, over the gap between block and handle.
        expect(await travel(page, start, goal)).toEqual([]);
        await expect(control).toBeVisible();
        await page.mouse.down();
        await page.mouse.up();
        if (button === 'Block actions')
          await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();
        // Add chooses a type before inserting after this block.
        else {
          await page
            .getByRole('listbox', { name: 'Insert a block' })
            .getByRole('option', { name: /^Paragraph/ })
            .click();
          await expect
            .poll(() =>
              page.evaluate(
                (id) =>
                  (
                    window as unknown as {
                      blockShell: { batches: { op: string; after?: string | null }[][] };
                    }
                  ).blockShell.batches
                    .flat()
                    .filter((op) => op.op === 'insert' && op.after === id).length,
                block,
              ),
            )
            .toBe(1);
        }
      });

for (const width of [1440, 800])
  for (const block of ['two', 'nested'] as const)
    test(`at ${width}px the ${block} block's handle is on the screen and clear of the sidebar`, async ({
      page,
    }) => {
      await mountShell(page, width);
      const target = page.locator(`.structured-page-stage [data-block-id="${block}"]`);
      const text = (await target.boundingBox())!;
      await page.mouse.move(text.x + 60, text.y + 12);
      const handle = target.locator(':scope > [data-slot="block-handle"]');
      await expect(handle).toBeVisible();
      const box = (await handle.boundingBox())!;
      // Both buttons are inside the window, and beside the sidebar where there is one.
      expect(box.x).toBeGreaterThanOrEqual(0);
      if (width === 1440) {
        const rail = (await page.locator('.tmt-ui-rail').boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
      }
      // And inside the page root, so a pointer on the way to them has not left the page.
      const root = (await page.locator('.structured-page-stage .tmt-block-doc').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(root.x);
    });

/** The left edge of an element's text, not of its box. */
const textEdge = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Math.round(range.getBoundingClientRect().left);
    });

for (const width of [1440, 800, 390])
  test(`at ${width}px the blocks' text lines up with the page bar's text`, async ({ page }) => {
    await mountShell(page, width);
    const text = await textEdge(page, '.structured-page-stage [data-block-id="one"]');
    // No work row under the title any more (#6652): the blocks start right under it.
    await expect(page.locator('.page-mobile-title .work-band')).toHaveCount(0);
    if (width > 900) expect(text).toBe(await textEdge(page, '.page-mobile-title h1'));
  });

test('at 390px the handle sits at its block’s end, inside the window, as the design system says', async ({
  page,
}) => {
  await mountShell(page, 390);
  const target = page.locator('.structured-page-stage [data-block-id="two"]');
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 12);
  await expect(target).toHaveCSS('background-color', /.+/);
  // No gutter at a phone's width (#6742): the handle sits over the block's end, not off the screen.
  const handle = target.locator('[data-slot="block-handle"]');
  await expect(handle).toBeVisible();
  const at = (await handle.boundingBox())!;
  expect(at.x).toBeGreaterThan(box.x + box.width / 2);
  expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
  // Nothing of the page reaches past the window.
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(at.x + at.width).toBeLessThanOrEqual(390);
});

for (const width of [1440, 390])
  test(`at ${width}px a callout keeps its height in the page's flow (#6280)`, async ({ page }) => {
    await mountShell(page, width);
    const stage = page.locator('.structured-page-stage');
    const callout = stage.locator('[data-block-id="callout"]');
    await expect(callout).toContainText('先做這個，再做下一個。');
    const notice = (await callout.locator('.tmt-ui-notice').boundingBox())!;
    const block = (await callout.boundingBox())!;
    const next = (await stage.locator('[data-block-id="after"]').boundingBox())!;
    // The callout's notice is inside its block, which holds its height, and the block after it
    // starts below it rather than under it.
    expect(block.height).toBeGreaterThan(20);
    expect(notice.y).toBeGreaterThanOrEqual(block.y - 1);
    expect(notice.y + notice.height).toBeLessThanOrEqual(block.y + block.height + 1);
    expect(next.y).toBeGreaterThanOrEqual(notice.y + notice.height);
  });

for (const width of [1440, 390])
  test(`at ${width}px a long unbroken word in a list item or a callout wraps in the column (#6749)`, async ({
    page,
  }) => {
    await mountShell(page, width);
    const stage = page.locator('.structured-page-stage');
    const column = (await stage.locator('[data-block-id="after"]').boundingBox())!;
    for (const id of ['long-list', 'long-callout']) {
      const block = stage.locator(`[data-block-id="${id}"]`);
      await expect(block).toContainText('end');
      // The word breaks inside the block, which ends at the column's edge like the paragraph above.
      const text = (await block
        .locator('.tmt-block-list-text, .tmt-ui-notice-body')
        .boundingBox())!;
      expect(text.x + text.width).toBeLessThanOrEqual(column.x + column.width + 1);
      expect(
        await block.evaluate((node) =>
          [...node.querySelectorAll('*')].every(
            (child) => child.scrollWidth <= child.clientWidth + 1,
          ),
        ),
      ).toBe(true);
    }
    // Nothing widens the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });

test('a code block reads as code in the design system’s code box, at rest and while typing (#6749)', async ({
  page,
}) => {
  await mountShell(page, 1440);
  const block = page.locator('.structured-page-stage [data-block-id="code"]');
  const body = block.locator('[data-slot="code-block"] .tmt-block-code-body');
  // The body's face and surface are the design system's code tokens, as they resolve here.
  const look = () =>
    body.evaluate((node) => {
      const probe = document.createElement('span');
      probe.style.font = '13px var(--tmt-ui-font-mono)';
      probe.style.background = 'var(--tmt-ui-surface-code)';
      node.parentElement!.append(probe);
      const want = getComputedStyle(probe);
      const style = getComputedStyle(node);
      const result = {
        face: style.fontFamily === want.fontFamily,
        size: style.fontSize,
        surface: style.backgroundColor === want.backgroundColor,
      };
      probe.remove();
      return result;
    });
  const code = { face: true, size: '13px', surface: true };
  await expect(body).toHaveText('tmt colab ls --json');
  expect(await look()).toEqual(code);
  await block.click();
  const editor = body.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.pressSequentially(' | head');
  await expect(editor).toHaveText('tmt colab ls --json | head');
  expect(await look()).toEqual(code);
});

test('at 390px the page tools step aside while a block’s actions sheet is open (#6749)', async ({
  page,
}) => {
  await mountShell(page, 390);
  const tools = page.locator('.selection-mode');
  await expect(tools).toBeVisible();
  const block = page.locator('.structured-page-stage [data-block-id="two"]');
  await block.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+F10');
  const sheet = page.getByRole('menu', { name: 'Block actions' });
  await expect(sheet).toBeVisible();
  await expect(tools).toBeHidden();
  // The sheet's last row is the one under a tap at its centre, never a floating tool.
  const last = sheet.getByRole('menuitem').last();
  const box = (await last.boundingBox())!;
  expect(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'), {
      x: box.x + box.width - 24,
      y: box.y + box.height / 2,
    }),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(tools).toBeVisible();
});

test('opening a page at a block hash reveals the offscreen block', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '[data-block-id="one"] { min-height: 1200px }';
      document.head.append(style);
    });
  });
  await mountShell(page, 390, '#block-after');
  await expect(page.locator('[data-block-id="after"]')).toBeInViewport();
});

test('a block on a page of blocks opened from a link on another page is found, never called a missing passage (#6749)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '[data-block-id="one"] { min-height: 1200px }';
      document.head.append(style);
    });
  });
  // The route an @ mention on another page opens: the page with its block as the anchor.
  await mountShell(page, 1440, '?anchor=block-after');
  await expect(page.locator('[data-block-id="after"]')).toBeInViewport();
  await expect(page.getByText('That passage is not on this page.')).toHaveCount(0);
});

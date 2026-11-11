import { expect, test, type Page } from '@playwright/test';

// The handle (＋ and ⋯) follows the last block the pointer entered and stays when the pointer
// leaves it, so a person can move from the block's text across the gap to a button (#6248, #6283);
// it moves only when another block is entered, and hides while typing and off the page.
async function mountFixture(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount('plan');
  });
  return page.locator('#structured-page-fixture');
}

/** Move the pointer from `from` to `to` in small steps, as a hand does, and say whether the
 * handle was there after every step. */
async function travel(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const handle = page.locator('#structured-page-fixture [data-slot="block-handle"]');
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

for (const [button, popup] of [
  ['Insert block', { role: 'listbox', name: 'Insert a block' }],
  ['Block actions', { role: 'menu', name: 'Block actions' }],
] as const)
  test(`the pointer goes from a block's text to its ${button} button and clicks it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const host = await mountFixture(page);
    const text = (await host.locator('[data-block-id="p"]').boundingBox())!;
    const start = { x: text.x + 60, y: text.y + 12 };
    await page.mouse.move(start.x, start.y);
    const target = (await host.getByRole('button', { name: button }).boundingBox())!;
    const goal = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    // The handle stays under the pointer all the way, over the gap between block and handle.
    expect(await travel(page, start, goal)).toEqual([]);
    await expect(host.getByRole('button', { name: button })).toBeVisible();
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByRole(popup.role, { name: popup.name })).toBeVisible();
  });

test('the handle moves to the next block entered, and goes when the pointer leaves the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const host = await mountFixture(page);
  const first = (await host.locator('[data-block-id="p"]').boundingBox())!;
  await page.mouse.move(first.x + 60, first.y + 12);
  await expect(host.locator('[data-block-id="p"] [data-slot="block-handle"]')).toBeVisible();
  // Down onto the next block: the one handle follows.
  const next = (await host.locator('[data-block-id="t"]').boundingBox())!;
  await page.mouse.move(next.x + 60, next.y + 12, { steps: 6 });
  await expect(host.locator('[data-block-id="t"] [data-slot="block-handle"]')).toBeVisible();
  await expect(host.locator('[data-slot="block-handle"]')).toHaveCount(1);
  // Left past the handle, into the margin beside the page: nothing is there to reach.
  await page.mouse.move(next.x - 150, next.y + 12, { steps: 12 });
  await expect(host.locator('[data-slot="block-handle"]')).toHaveCount(0);
});

/** The real app shell (rail, header, page stage) around a page of blocks: the handle's room and
 * the blocks around it are the app's, not the 720px fixture column's. */
async function mountShell(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/colab/renderer.html', async (route) =>
    route.fulfill({
      response: await route.fetch({ url: new URL('/renderer.html', route.request().url()).href }),
    }),
  );
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import {mountBlockShell} from '/test/block-shell-browser.tsx'; void mountBlockShell();`,
    }),
  );
  // Any served path: the fixture puts the page's own address in place.
  await page.goto('/colab/design/');
  const stage = page.locator('.structured-page-stage');
  await expect(stage.locator('[data-block-id="two"]')).toBeVisible();
  return stage;
}

const handleOf = (stage: ReturnType<Page['locator']>, id: string) =>
  stage.locator(`[data-block-id="${id}"] > [data-slot="block-handle"]`);

/** The middle of a block's own text line, clear of the blocks inside it. */
async function middle(stage: ReturnType<Page['locator']>, id: string) {
  const box = (await stage.locator(`[data-block-id="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + 12 };
}

for (const block of ['two', 'nested'] as const)
  for (const button of ['Insert block', 'Block actions'] as const)
    test(`in the app, the pointer goes from the middle of the ${block} block to ${button} and clicks it`, async ({
      page,
    }) => {
      const stage = await mountShell(page);
      const start = await middle(stage, block);
      await page.mouse.move(start.x, start.y);
      const control = handleOf(stage, block).getByRole('button', { name: button });
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      const goal = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      // Every step of the way the handle is this block's, the one the pointer entered last.
      const handle = stage.locator('[data-slot="block-handle"]');
      const lost: number[] = [];
      const steps = Math.ceil(Math.abs(start.x - goal.x) / 4);
      for (let step = 1; step <= steps; step++) {
        const x = start.x + ((goal.x - start.x) * step) / steps;
        await page.mouse.move(x, start.y + ((goal.y - start.y) * step) / steps);
        if ((await handle.count()) !== 1 || (await handleOf(stage, block).count()) !== 1)
          lost.push(Math.round(x));
      }
      expect(lost).toEqual([]);
      await page.mouse.down();
      await page.mouse.up();
      if (button === 'Block actions')
        await expect(page.getByRole('menu', { name: 'Block actions' })).toBeVisible();
      // Insert block starts a new block after this one; the page answers it later.
      else
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
    });

test('in the app, the handle stays on the last block entered until another is entered', async ({
  page,
}) => {
  const stage = await mountShell(page);
  // Into the nested block, then back out into its card's own space: going out enters nothing.
  const nested = await middle(stage, 'nested');
  await page.mouse.move(nested.x, nested.y, { steps: 4 });
  await expect(handleOf(stage, 'nested')).toBeVisible();
  const card = (await stage.locator('[data-block-id="card"]').boundingBox())!;
  const inner = (await stage.locator('[data-block-id="nested"]').boundingBox())!;
  await page.mouse.move(nested.x, (card.y + card.height + inner.y + inner.height) / 2, {
    steps: 4,
  });
  await expect(handleOf(stage, 'nested')).toBeVisible();
  await expect(stage.locator('[data-slot="block-handle"]')).toHaveCount(1);
  // Into the space between two blocks, beside the page's text: still the last block's.
  const two = (await stage.locator('[data-block-id="two"]').boundingBox())!;
  await page.mouse.move(two.x + two.width / 2, two.y + 12, { steps: 6 });
  await expect(handleOf(stage, 'two')).toBeVisible();
  // The handle alone shows the block: the block under the pointer has no fill of its own.
  await expect(stage.locator('[data-block-id="two"]')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await page.mouse.move(two.x + two.width + 16, two.y + 12, { steps: 4 });
  await expect(handleOf(stage, 'two')).toBeVisible();
  // Entering another block moves it.
  const one = await middle(stage, 'one');
  await page.mouse.move(one.x, one.y, { steps: 4 });
  await expect(handleOf(stage, 'one')).toBeVisible();
  await expect(stage.locator('[data-slot="block-handle"]')).toHaveCount(1);
});

test('in the app, typing hides the handle and the next pointer move brings it back', async ({
  page,
}) => {
  const stage = await mountShell(page);
  const one = await middle(stage, 'one');
  await page.mouse.click(one.x, one.y);
  await expect(stage.locator('[data-block-id="one"] [contenteditable="true"]')).toBeFocused();
  await expect(handleOf(stage, 'one')).toBeVisible();
  await page.keyboard.type('ab');
  await expect(stage.locator('[data-slot="block-handle"]')).toHaveCount(0);
  // A held modifier (⌘-click on a link) is not typing.
  await page.mouse.move(one.x + 4, one.y);
  await expect(handleOf(stage, 'one')).toBeVisible();
  await page.keyboard.press('Shift');
  await expect(handleOf(stage, 'one')).toBeVisible();
});

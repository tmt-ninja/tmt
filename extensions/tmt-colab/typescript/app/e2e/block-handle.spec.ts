import { expect, test, type Page } from '@playwright/test';

// #6248: the handle (＋ and ⋯) shows while the pointer is on its block. A person moves the pointer
// from the block's text toward a button, across the gap between the block and its handle, so the
// handle has to stay while the pointer is in that gap.
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

test('the handle leaves with the pointer: to another block it moves, away from the page it goes', async ({
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

import { expect, test, type Page } from '@playwright/test';

// #6273: the handle (＋ and ⋯) hangs 48px left of its block. On a top-level block in the app, the
// page stage left it outside the page root (the stage's margin is 30px at 1440 with the sidebar), so
// the pointer left the root before it reached a button and the handle went, as before #6248; at a
// narrow window the handle lay off the screen. block-handle.spec.ts passed because its fixture host
// is a 720px column with the design system's own gutter. This one runs in the real shell.
async function mountShell(page: Page, width: number) {
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

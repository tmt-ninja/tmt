import { expect, test } from '@playwright/test';
import { pairBrowser, startDoor } from './harness/browser.js';
import { freePort, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

test.afterEach(disposeActiveWorlds);

// #6005: a structured page made and changed by the CLI draws in the browser from the fold, and the
// person's typing goes out as a block batch that merges with an agent's edit of the same block.
test('a structured page draws CLI blocks and keeps typing and an agent edit of the same block', async () => {
  test.setTimeout(180_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-author');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Structured',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const insert = (type: string, text: string) =>
      (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            created.pageId,
            '--type',
            type,
            '--text',
            text,
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    insert('heading', 'Plan');
    const paragraph = insert('paragraph', 'Ship the stack.');
    const textNow = () =>
      (
        JSON.parse(run(world, colab, ['block', 'get', created.pageId, paragraph, '--json'])) as {
          block: { base: string };
        }
      ).block.base;

    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toHaveText('Ship the stack.');
    // At rest no block holds an editor.
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);

    await block.click();
    const editor = block.locator('[contenteditable="true"]');
    await editor.press('End');
    await editor.pressSequentially(' Today.', { delay: 40 });
    // The person's typing reaches the page as a block batch.
    await expect.poll(textNow, { timeout: 30_000 }).toBe('Ship the stack. Today.');

    // An agent changes the start of the same block while the person types at its end.
    await editor.pressSequentially(' Then', { delay: 40 });
    run(world, colab, [
      'block',
      'text',
      created.pageId,
      paragraph,
      '--find',
      'Ship',
      '--replace',
      'Merge',
      '--json',
    ]);
    await editor.pressSequentially(' rest.', { delay: 40 });
    const merged = 'Merge the stack. Today. Then rest.';
    await expect(editor).toHaveText(merged, { timeout: 30_000 });
    await expect.poll(textNow, { timeout: 30_000 }).toBe(merged);
  });
});

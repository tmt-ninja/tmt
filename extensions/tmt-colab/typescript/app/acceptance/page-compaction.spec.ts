import { pageAction } from '../test/page-actions.js';
import { expect, test } from '@playwright/test';
import { pairBrowser, startDoor } from './harness/browser.js';
import { patchArgs, createPage, freePort, openPage, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

// #1627 slice B: the CLI combines its own tail into a checkpoint, so a page takes far more than
// 200 changes, the browser still opens and edits it, and the exact source survives everywhere.
const MIB = 1024 * 1024;
const text = (n: number) => {
  let out = '';
  for (let i = 0; out.length < n; i++)
    out += `<p id="p${i}">Line ${i}: ${'lorem ipsum dolor sit amet '.repeat(3)}</p>\n`;
  return out.slice(0, n);
};
test.afterEach(disposeActiveWorlds);
test('260 CLI changes with a browser edit in the middle read back exact in the CLI and the browser', async () => {
  test.setTimeout(600_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const a = await pairBrowser(world, 'compact-author');
    const colab = world.binaries.colab;
    const read = (id: string) =>
      JSON.parse(run(world, colab, ['page', 'read', id, '--json'])) as { source: string };
    const created = createPage(world, 'Many changes', '<p>start</p>');
    const page = await openPage(door, a, created);

    let source = '<p>start</p>';
    const append = (i: number) => {
      source += `<i>${String(i).padStart(4, '0')}</i>`;
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json']), source);
    };
    for (let i = 0; i < 100; i++) append(i);
    // The browser edits in the middle of the run, on top of the CLI's changes.
    await page.reload();
    await (await pageAction(page, 'Source')).click();
    const box = page.getByRole('textbox', { name: 'Page source', exact: true });
    expect((await box.inputValue()) === source).toBe(true);
    source += '<p>from the browser</p>';
    await box.evaluate((el, value) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, source);
    await page.getByRole('button', { name: 'Save source', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => read(created.pageId).source === source).toBe(true);
    // More than the old 200-change limit, with the CLI's own changes after the browser's.
    for (let i = 100; i < 260; i++) append(i);
    expect(read(created.pageId).source === source).toBe(true);

    await page.reload();
    await (await pageAction(page, 'Source')).click();
    expect(
      (await page.getByRole('textbox', { name: 'Page source', exact: true }).inputValue()) ===
        source,
    ).toBe(true);
  });
});

test('a 2 MiB page keeps taking changes and reads back exact', async () => {
  // 300 patches of a 2 MiB page take 8 to 11 minutes on CI debug binaries (#5511); #5548 cuts more.
  test.setTimeout(900_000);
  await withWorld(async (world) => {
    const colab = world.binaries.colab;
    let source = text(2 * MIB - 16 * 1024);
    const created = createPage(world, 'Big and busy', source);
    const readSource = () =>
      (
        JSON.parse(run(world, colab, ['page', 'read', created.pageId, '--json'])) as {
          source: string;
        }
      ).source;
    expect(readSource() === source).toBe(true);
    // Each patch is anchored on the source this case holds: every patch's range fence proves the
    // page still has it, so only the first and last reads go through the CLI.
    for (let i = 0; i < 300; i++) {
      const held = source;
      source = source.slice(0, -4) + `<i>${i}</i>` + source.slice(-4);
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json'], held), source);
    }
    expect(readSource() === source).toBe(true);
  });
});

// #5872: a history-heavy page stays responsive: a short source that agents rewrote many times, so
// its state carries far more history than text (several checkpoints and a tail of updates, the
// shape of the page in Ben's trace). While it sits open and takes live writes, the main thread's
// long tasks are counted; their total is recorded, and only the count is asserted.
test('a history-heavy page keeps its main thread free while it takes writes', async () => {
  test.setTimeout(900_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'history-owner');
    const colab = world.binaries.colab;
    const body = (n: number) =>
      `${text(28 * 1024 - 32).replaceAll('Line', `Rev ${n}`)}<p id="n">${n}</p>`;
    let source = body(0);
    const created = createPage(world, 'History heavy', source);
    const change = (i: number) => {
      const held = source;
      source = body(i);
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json'], held), source);
    };
    for (let i = 1; i <= 120; i++) change(i);
    const page = await openPage(door, browser, created);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#n')).toHaveText('120', { timeout: 120_000 });
    await page.evaluate(() => {
      const long: number[] = [];
      Object.defineProperty(window, 'longTasks', { value: long });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) long.push(entry.duration);
      }).observe({ type: 'longtask' });
    });
    const started = Date.now();
    for (let i = 121; i <= 150; i++) {
      change(i);
      await expect(frame.locator('#n')).toHaveText(String(i), { timeout: 60_000 });
    }
    // The rest of a 30 s window open and idle.
    await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - started)));
    const long = await page.evaluate(
      () => (window as unknown as { longTasks: number[] }).longTasks,
    );
    test.info().annotations.push({
      type: 'colab-history-busy',
      description: JSON.stringify({
        longTasks: long.length,
        busyMs: Math.round(long.reduce((sum, value) => sum + value, 0)),
        windowMs: Date.now() - started,
      }),
    });
    expect(long.length).toBeLessThanOrEqual(2);
  });
});

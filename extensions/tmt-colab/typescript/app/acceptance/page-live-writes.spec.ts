import { expect, test } from '@playwright/test';
import { pairBrowser, startDoor } from './harness/browser.js';
import { patchArgs, createPage, freePort, openPage, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

// The trace snapshotter serializes the whole 2 MiB DOM at every assertion, on the page's main
// thread, so a trace would count its own long tasks here.
test.use({ trace: 'off' });
const MIB = 1024 * 1024;
const text = (n: number) => {
  let out = '';
  for (let i = 0; out.length < n; i++)
    out += `<p id="p${i}">Line ${i}: ${'lorem ipsum dolor sit amet '.repeat(3)}</p>\n`;
  return out.slice(0, n);
};
test.afterEach(disposeActiveWorlds);

// #5891: on a page near the 2 MiB source limit, a live write changes a few bytes; the frame
// applies it without long main-thread tasks. Only the count is asserted; the total is recorded.
test('a 2 MiB page keeps its main thread free while it takes live writes', async () => {
  test.setTimeout(900_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'large-owner');
    const colab = world.binaries.colab;
    const body = text(2 * MIB - 16 * 1024);
    let source = `${body}<p id="n">0</p>`;
    const created = createPage(world, 'Large and live', source);
    const page = await openPage(door, browser, created);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#n')).toHaveText('0', { timeout: 120_000 });
    await page.evaluate(() => {
      const long: number[] = [];
      Object.defineProperty(window, 'longTasks', { value: long });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) long.push(entry.duration);
      }).observe({ type: 'longtask' });
    });
    const started = Date.now();
    for (let i = 1; i <= 10; i++) {
      const held = source;
      source = `${body}<p id="n">${i}</p>`;
      run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json'], held), source);
      await expect(frame.locator('#n')).toHaveText(String(i), { timeout: 60_000 });
    }
    await page.waitForTimeout(Math.max(0, 30_000 - (Date.now() - started)));
    const long = await page.evaluate(
      () => (window as unknown as { longTasks: number[] }).longTasks,
    );
    test.info().annotations.push({
      type: 'colab-large-busy',
      description: JSON.stringify({
        longTasks: long.length,
        busyMs: Math.round(long.reduce((sum, value) => sum + value, 0)),
        windowMs: Date.now() - started,
      }),
    });
    expect(long.length).toBeLessThanOrEqual(2);
  });
});

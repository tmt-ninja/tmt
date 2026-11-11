// #5872: typing in the Chat composer stays responsive and keeps every key while background work
// settles: a held annotation send and a Resolve all of 30 comments, released mid-typing, on a small
// page and a 512 KiB page. Asserted: Chat handles every key (#6266), one React commit per key at
// the median, and at most two long tasks. The per-key latency is recorded, not asserted. The
// composer's final text must also match exactly, including while background work settles (#6267).
import { commentsRegion } from '../test/comments-region.js';
import { pageAction, commentsAction } from '../test/page-actions.js';
import { expect, test, type Page } from '@playwright/test';
import { text } from '../src/strings.js';
import { pairBrowser, startDoor } from './harness/browser.js';
import { createPage, freePort, openChat, openPage, selectInRenderer } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

test.afterEach(disposeActiveWorlds);

interface Probe {
  commits: number;
  keys: { latency: number; commits: number }[];
  long: number[];
}
/** Counts React commits through the DevTools hook React calls when one is present, each Chat key's
 * time to the next frame, and long tasks. Installed before the app loads. */
const install = () => {
  const probe: Probe = { commits: 0, keys: [], long: [] };
  Object.assign(window, {
    typingProbe: probe,
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: () => void probe.commits++,
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      checkDCE: () => {},
    },
  });
  addEventListener(
    'keydown',
    (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid=chat-panel]'))
        return;
      const at = event.timeStamp;
      const commits = probe.commits;
      requestAnimationFrame(() =>
        setTimeout(() =>
          probe.keys.push({ latency: performance.now() - at, commits: probe.commits - commits }),
        ),
      );
    },
    true,
  );
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) probe.long.push(entry.duration);
  }).observe({ type: 'longtask' });
};

async function annotate(page: Page, body: string, selector: string, held = false) {
  // A large page may still apply the previous write: select again until the control shows.
  await expect(async () => selectInRenderer(page, selector)).toPass({ timeout: 60_000 });
  await page.getByTestId('selection-ask').click();
  const compose = page.getByRole('dialog', { name: 'Annotate selection' });
  const input = compose.getByRole('combobox', { name: 'Message', exact: true });
  await expect(input).toBeEnabled();
  await input.fill(body);
  if (await page.getByRole('listbox').isVisible()) await input.press('Escape');
  await compose.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
  if (held) return;
  const window = compose.getByTestId('comment-thread');
  await expect(window).toBeVisible();
  await window.getByRole('button', { name: text.threadCollapse, exact: true }).click();
}

const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))]!;
const typed = 'typing while background writes run, one key at a time.';

async function typeMeasured(page: Page, label: string, busy?: () => void) {
  const input = page.getByTestId('chat-panel').getByRole('combobox', { name: 'Message' });
  await input.click();
  const initial = await input.textContent();
  expect(initial).toBe('');
  await page.evaluate(() => {
    const probe = (window as unknown as { typingProbe: Probe }).typingProbe;
    probe.keys.length = 0;
    probe.long.length = 0;
  });
  for (const [index, char] of [...typed].entries()) {
    if (index === 10) busy?.();
    await page.keyboard.type(char);
    await page.waitForTimeout(60);
  }
  const read = () => page.evaluate(() => (window as unknown as { typingProbe: Probe }).typingProbe);
  await expect.poll(async () => (await read()).keys.length).toBe(typed.length);
  const probe = await read();
  const latencies = probe.keys.map((key) => key.latency);
  const commits = probe.keys.map((key) => key.commits);
  test.info().annotations.push({
    type: 'colab-typing',
    description: JSON.stringify({
      label,
      p50: Math.round(quantile(latencies, 0.5)),
      p95: Math.round(quantile(latencies, 0.95)),
      commitsP50: quantile(commits, 0.5),
      commitsMax: Math.max(...commits),
      longTasks: probe.long.length,
      longMs: Math.round(probe.long.reduce((sum, value) => sum + value, 0)),
    }),
  });
  expect(quantile(commits, 0.5)).toBeLessThanOrEqual(1);
  expect(probe.long.length).toBeLessThanOrEqual(2);
  expect(await input.innerText()).toBe(typed);
  // Use real editing keys: fill selects the DOM before Lexical admits its selection.
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
}

for (const [size, rows] of [
  ['small', 0],
  // Bytes in markup, not text: the frame's selection map stops at 256 Ki code points.
  ['512 KiB', Math.ceil((512 * 1024) / 520)],
] as const)
  test(`typing in Chat keeps every key and stays responsive during background writes (${size} page)`, async () => {
    test.setTimeout(600_000);
    await withWorld(async (world) => {
      const door = await startDoor(world, await freePort());
      await world.startAgent('busy-agent');
      const author = await pairBrowser(world, 'busy-author', { talk: true });
      await author.context.addInitScript(install);
      const pad = Array.from(
        { length: rows },
        (_, i) => `<p data-pad="${'x'.repeat(480)}">Row ${i}</p>`,
      ).join('');
      const spans = Array.from({ length: 30 }, (_, i) => `<span id="q${i}">P${i}.</span>`);
      const created = createPage(
        world,
        `Typing ${size}`,
        `<p id="held">Held passage.</p><p>${spans.join(' ')}</p><section>${pad}</section>`,
      );
      const page = await openPage(door, author, created);
      await expect(page.frameLocator('iframe').locator('#q29')).toBeVisible({ timeout: 120_000 });
      for (let i = 0; i < 30; i++) await annotate(page, `Comment ${i}.`, `#q${i}`);
      await expect(commentsAction(page)).toHaveAccessibleName(/^Comments \(30\)/);
      await openChat(page);
      await typeMeasured(page, `${size} idle`);
      await page.getByRole('button', { name: 'Close Chat', exact: true }).click();
      // A held annotation send, then Resolve all while it is held; it is released mid-typing.
      world.armNextBarrier('after');
      await annotate(page, '@busy-agent Held comment.', '#held', true);
      await world.barrierEntered();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Annotate selection' })).toHaveCount(0);
      if (!(await commentsRegion(page).isVisible()))
        await (await pageAction(page, 'Comments')).click();
      await commentsRegion(page)
        .getByRole('button', { name: /^Resolve all open \(\d+\)$/ })
        .click();
      await page
        .getByRole('dialog', { name: /^Resolve \d+ open comments\?$/ })
        .getByRole('button', { name: 'Resolve all', exact: true })
        .click();
      await openChat(page);
      await typeMeasured(page, `${size} busy`, () => world.releaseBarrier());
    });
  });

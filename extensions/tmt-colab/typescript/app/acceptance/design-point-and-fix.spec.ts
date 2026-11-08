// Point-and-fix on a design-system page (#5866): a person comments on an example with @agent, the
// agent patches that example through the CLI, and the open Design page re-renders it live; Chat
// works on the same page.
import { expect, test, type WebSocket } from '@playwright/test';
import { pairBrowser, startDoor } from './harness/browser.js';
import {
  annotationInput,
  composeChat,
  createPage,
  freePort,
  run,
  sendChat,
} from './harness/ask.js';
import { withWorld } from './harness/with-world.js';

test('an @agent comment on a design-system example becomes a live patch of that example', async () => {
  test.setTimeout(360_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('sample-1');
    const browser = await pairBrowser(world, 'sample-lead', { talk: true });
    await browser.context.addInitScript(() => {
      Object.assign(globalThis, {
        __tmt6188: (event: string) => performance.mark(`tmt-6188:${event}`),
      });
    });
    // A serve without `page.new` makes a new system's root under an existing page and detaches it.
    createPage(world, 'sample-lead notes', '<h1>Notes</h1>');
    const page = await browser.context.newPage();
    // Open page connections (Colab sync sockets), as the door sees them.
    const sync = new Set<WebSocket>();
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).pathname.endsWith('/sync')) return;
      sync.add(socket);
      socket.on('close', () => sync.delete(socket));
    });
    // Held list reads in flight across this browser's tabs (#6162), counted from the first request.
    // A closed tab never reports its last request finished, so each tab counts its own.
    const inFlight = new Map<number, number>();
    let patched = 0;
    const timeline: { tab: number; at: number; event: string }[] = [];
    const responseChecks: Promise<void>[] = [];
    const record = (tab: number, event: string) => {
      if (patched && timeline.length < 200) timeline.push({ tab, at: Date.now() - patched, event });
    };
    const held = {
      by: new Set<number>(),
      get now() {
        return [...inFlight.values()].reduce((sum, count) => sum + count, 0);
      },
    };
    const watch = (tab: number, target: typeof page) => {
      const isHeld = (url: string) =>
        /\/api\/pages\/after\/[0-9a-f]{64}$/.test(new URL(url).pathname);
      const isList = (url: string) => new URL(url).pathname.endsWith('/api/pages');
      target.on('request', (request) => {
        if (isHeld(request.url())) record(tab, 'held-start');
        else if (isList(request.url())) record(tab, 'list-start');
        if (!isHeld(request.url())) return;
        inFlight.set(tab, (inFlight.get(tab) ?? 0) + 1);
        held.by.add(tab);
      });
      target.on('response', (response) => {
        if (!patched || !isHeld(response.url())) return;
        const requested = new URL(response.url()).pathname.split('/').pop();
        const check = response
          .json()
          .then((body: { listToken?: unknown; unchanged?: unknown }) => {
            const token =
              typeof body.listToken !== 'string'
                ? 'invalid'
                : body.listToken === requested
                  ? 'same'
                  : 'changed';
            record(tab, `held-reply-${token}-${body.unchanged === true ? 'unchanged' : 'full'}`);
          })
          .catch(() => record(tab, 'held-reply-unreadable'));
        responseChecks.push(check);
      });
      const done = (request: { url(): string }) => {
        if (isHeld(request.url())) {
          record(tab, 'held-end');
          inFlight.set(tab, (inFlight.get(tab) ?? 1) - 1);
        } else if (isList(request.url())) record(tab, 'list-end');
      };
      target.on('requestfinished', done);
      target.on('requestfailed', done);
    };
    watch(0, page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${door.origin}/design/`);
    await page.getByRole('button', { name: 'New design system', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Brio');
    await dialog.getByRole('textbox', { name: 'Tag prefix', exact: true }).fill('brio');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 120_000 });
    const created = Date.now();
    const frame = page.locator('.design-workspace iframe').first().contentFrame();
    await frame.getByRole('link', { name: /brio-button/ }).click();
    const opened = Date.now();
    await expect(page).toHaveURL(/\/design\/systems\/[0-9a-f-]+\/[0-9a-f-]+$/);
    const pageId = page.url().split('/').pop()!;
    const example = frame.locator('[data-ds-example="button:secondary"]');
    const draft = example.getByRole('button', { name: 'Draft', exact: true });
    // A new system's tree comes from the owner list and its page reuses the docs the system page
    // just compiled from, so the first draft draws within the default wait (#6177).
    await expect(draft).toBeVisible();
    // The measurement #6177 reports: from the dialog closing to the first Draft, and the part
    // after the system page drew and its component link was followed.
    console.log(
      `first draft ${Date.now() - created} ms after creation (${Date.now() - opened} ms after opening the page)`,
    );
    await expect(draft).not.toHaveAttribute('data-variant', 'outline');

    // The open page follows its system's draft (#6162). A new system has far more component pages
    // than the door's 16 tunnels, yet the page holds two connections: its own and its system's root.
    // Component changes come from the live page list, never a connection per component.
    await expect.poll(() => sync.size, { timeout: 30_000 }).toBe(2);
    // A CLI edit to a component page no browser has open recompiles the draft the page follows.
    const card = page.getByRole('link', { name: 'Card brio-card', exact: true });
    const cardId = (await card.getAttribute('href'))!.split('/').pop()!;
    run(world, world.binaries.colab, [
      'page',
      'patch',
      cardId,
      '--find',
      '"css": "',
      '--replace',
      '"css": ".zz-live-6162{outline:0}',
      '--json',
    ]);
    await expect
      .poll(
        () =>
          frame
            .locator('style')
            .evaluateAll((nodes) =>
              nodes.some((node) => node.textContent?.includes('.zz-live-6162')),
            ),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(sync.size).toBe(2);

    // Selection mode, then a click anywhere in the example quotes the whole example.
    await frame.locator('h1').click();
    await page.keyboard.press('c');
    await draft.click();
    const popover = page.getByRole('dialog', { name: 'Annotate selection' });
    await expect(popover).toContainText('button:secondary');
    const input = await annotationInput(popover, agent.name);
    await input.fill(`@${agent.name} Make this the outline variant.`);
    await input.press('Enter');
    await expect.poll(() => agent.received().length).toBe(1);
    const asked = String(agent.received()[0]!.message);
    expect(asked).toContain('button:secondary');
    expect(asked).toContain('Make this the outline variant.');

    // The agent finds the example by its root and patches its live markup and snippet together.
    const read = JSON.parse(
      run(world, world.binaries.colab, [
        'page',
        'read',
        pageId,
        '--grep',
        'data-ds-example="button:secondary"',
        '--context',
        '6',
        '--json',
      ]),
    ) as unknown;
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
    expect(strings(read).join('\n')).toContain('variant="secondary">Draft</brio-button>');
    run(world, world.binaries.colab, [
      'page',
      'patch',
      pageId,
      '--find',
      '<brio-button variant="secondary">Draft</brio-button>',
      '--replace',
      '<brio-button variant="outline">Draft</brio-button>',
      '--find',
      '&lt;brio-button variant=&quot;secondary&quot;&gt;Draft',
      '--replace',
      '&lt;brio-button variant=&quot;outline&quot;&gt;Draft',
      '--json',
    ]);
    // The patched page is also one of its system's components: the draft recompiles once the edit
    // settles and the frame draws again, so this waits past the in-place update.
    await expect(draft).toHaveAttribute('data-variant', 'outline', { timeout: 20_000 });
    await expect(example.locator('pre')).toContainText(
      '<brio-button variant="outline">Draft</brio-button>',
    );

    // Chat with @agent on the same Design page.
    await page.keyboard.press('Escape');
    const composed = await composeChat(page, agent, 'Which examples use the outline variant?');
    await sendChat(page, composed);
    expect(composed.delivered()).toContain('Which examples use the outline variant?');

    // Five tabs follow the draft. Browsers allow six HTTP/1.1 connections per host across tabs, so
    // one tab holds the list read for the whole browser and the others hear it (#6162).
    const tabs = [page];
    for (let tab = 1; tab < 5; tab++) {
      const next = await browser.context.newPage();
      await next.setViewportSize({ width: 1440, height: 1000 });
      watch(tab, next);
      await next.goto(page.url());
      await expect(
        next
          .locator('.design-workspace iframe')
          .first()
          .contentFrame()
          .locator('[data-ds-example]')
          .first(),
      ).toBeVisible({ timeout: 60_000 });
      tabs.push(next);
    }
    // Settled: one held read in flight for the five tabs.
    await expect.poll(() => held.now, { timeout: 30_000 }).toBe(1);
    const reportDrafts = async () => {
      await Promise.all(responseChecks);
      for (const [tab, target] of tabs.entries()) {
        const marks = await target.evaluate(
          (after) =>
            performance
              .getEntriesByType('mark')
              .filter((entry) => entry.name.startsWith('tmt-6188:'))
              .map((entry) => ({
                event: entry.name.slice('tmt-6188:'.length),
                at: Math.round(performance.timeOrigin + entry.startTime - after),
              }))
              .slice(-100),
          patched,
        );
        console.log(`tab ${tab} draft timeline ${JSON.stringify(marks)}`);
      }
    };
    held.by.clear();
    // A CLI edit to an unopened component page reaches every tab through that one read.
    run(world, world.binaries.colab, [
      'page',
      'patch',
      cardId,
      '--find',
      '.zz-live-6162{outline:0}',
      '--replace',
      '.zz-live-6162b{outline:0}',
      '--json',
    ]);
    patched = Date.now();
    const drawTimes: number[] = [];
    await Promise.all(
      tabs.map(async (tab, index) => {
        try {
          await expect
            .poll(
              () =>
                tab
                  .locator('.design-workspace iframe')
                  .first()
                  .contentFrame()
                  .locator('style')
                  .evaluateAll((nodes) =>
                    nodes.some((node) => node.textContent?.includes('.zz-live-6162b')),
                  ),
              { timeout: 30_000, intervals: [50, 100, 200] },
            )
            .toBe(true);
        } catch (error) {
          // Which tab missed the edit, and which tabs held the list meanwhile.
          console.log(
            `tab ${index} of ${tabs.length} did not draw the CLI edit; held reads by tab: ${[...held.by].join(',')}; in flight: ${JSON.stringify([...inFlight])}`,
          );
          await reportDrafts();
          console.log(`five-tab timeline ${JSON.stringify(timeline)}`);
          throw error;
        }
        drawTimes[index] = Date.now() - patched;
        console.log(`tab ${index} drew the CLI edit ${drawTimes[index]} ms after it`);
        record(index, 'drawn');
      }),
    );
    await reportDrafts();
    console.log(`five-tab timeline ${JSON.stringify(timeline)}`);
    // One tab issued every held read meanwhile (a request's finished event can trail the next
    // request, so the in-flight count is read only when settled).
    expect(held.by.size).toBe(1);
    await expect.poll(() => held.now, { timeout: 30_000 }).toBe(1);
    // The holding tab closes: another tab takes the read over.
    const holder = [...held.by][0]!;
    await tabs[holder]!.close();
    inFlight.delete(holder);
    held.by.clear();
    await expect.poll(() => held.by.size, { timeout: 30_000 }).toBe(1);
    expect(held.by.has(holder)).toBe(false);
    await expect.poll(() => held.now, { timeout: 30_000 }).toBe(1);
  });
});

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
    // A serve without `page.new` makes a new system's root under an existing page and detaches it.
    createPage(world, 'sample-lead notes', '<h1>Notes</h1>');
    const page = await browser.context.newPage();
    // Open page connections (Colab sync sockets), as the door sees them.
    const sync = new Set<WebSocket>();
    // Page connections opened so far: each is one page read (a component compile opens each page).
    let syncOpened = 0;
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).pathname.endsWith('/sync')) return;
      syncOpened++;
      sync.add(socket);
      socket.on('close', () => sync.delete(socket));
    });
    // Held list reads in flight across this browser's tabs (#6162), counted from the first request.
    // A closed tab never reports its last request finished, so each tab counts its own.
    const inFlight = new Map<number, number>();
    const detached = new Map<number, number>();
    let measuringEdit = false;
    // Held list reads answered so far, across tabs: one answers after each change to the list.
    let heldAnswers = 0;
    const held = {
      by: new Set<number>(),
      get now() {
        return [...inFlight.values()].reduce((sum, count) => sum + count, 0);
      },
    };
    const watch = (tab: number, target: typeof page) => {
      target.on('framedetached', () => {
        if (measuringEdit) detached.set(tab, (detached.get(tab) ?? 0) + 1);
      });
      const isHeld = (url: string) =>
        /\/api\/pages\/after\/[0-9a-f]{64}$/.test(new URL(url).pathname);
      target.on('request', (request) => {
        if (!isHeld(request.url())) return;
        inFlight.set(tab, (inFlight.get(tab) ?? 0) + 1);
        held.by.add(tab);
      });
      const done = (request: { url(): string }) => {
        if (!isHeld(request.url())) return;
        inFlight.set(tab, (inFlight.get(tab) ?? 1) - 1);
        heldAnswers++;
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

    // A membership change elsewhere in the space (a new page) moves every page's revision but no
    // component's content revision: the follow reads no component page for it (#6179). The next
    // component edit then reads only that page and the root.
    const answered = heldAnswers;
    const connectionsBefore = syncOpened;
    const membershipAt = Date.now();
    createPage(world, 'sample-lead elsewhere', '<h1>Elsewhere</h1>');
    await expect.poll(() => heldAnswers, { timeout: 30_000 }).toBeGreaterThan(answered);
    run(world, world.binaries.colab, [
      'page',
      'patch',
      cardId,
      '--find',
      '"css": "',
      '--replace',
      '"css": ".zz-live-6179{outline:0}',
      '--json',
    ]);
    const editAt = Date.now();
    await expect
      .poll(
        () =>
          frame
            .locator('style')
            .evaluateAll((nodes) =>
              nodes.some((node) => node.textContent?.includes('.zz-live-6179')),
            ),
        { timeout: 30_000 },
      )
      .toBe(true);
    // The measurement #6179 reports.
    console.log(
      `after a membership change the follow drew a component edit ${Date.now() - editAt} ms after it (${Date.now() - membershipAt} ms after the change), opening ${syncOpened - connectionsBefore} page connections`,
    );
    expect(syncOpened - connectionsBefore).toBeLessThanOrEqual(2);
    await expect.poll(() => sync.size, { timeout: 30_000 }).toBe(2);

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
      // The source's example exists even when the initial frame still has a draft-unavailable
      // notice. Begin measuring only after the actual component from the prior edit is drawn.
      await expect(
        next
          .locator('.design-workspace iframe')
          .first()
          .contentFrame()
          .locator('[data-ds-example="button:secondary"]')
          .getByRole('button', { name: 'Draft', exact: true }),
      ).toHaveAttribute('data-variant', 'outline', { timeout: 60_000 });
      tabs.push(next);
    }
    // Settled: one held read in flight for the five tabs.
    await expect.poll(() => held.now, { timeout: 30_000 }).toBe(1);
    held.by.clear();
    // A CLI edit to an unopened component page reaches every tab through that one read.
    measuringEdit = true;
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
    const patched = Date.now();
    const drawTimes: number[] = [];
    await Promise.all(
      tabs.map(async (tab, index) => {
        try {
          await expect
            .poll(
              async () => {
                try {
                  return await tab
                    .locator('.design-workspace iframe')
                    .first()
                    .contentFrame()
                    .locator('style')
                    .evaluateAll((nodes) =>
                      nodes.some((node) => node.textContent?.includes('.zz-live-6162b')),
                    );
                } catch (error) {
                  // A draft refresh replaces the frame; inspect its replacement on the next poll.
                  if (error instanceof Error && /frame was detached/i.test(error.message))
                    return false;
                  throw error;
                }
              },
              { timeout: 30_000, intervals: [50, 100, 200] },
            )
            .toBe(true);
        } catch (error) {
          // Which tab missed the edit, and which tabs held the list meanwhile.
          console.log(
            `tab ${index} of ${tabs.length} did not draw the CLI edit; held reads by tab: ${[...held.by].join(',')}; in flight: ${JSON.stringify([...inFlight])}`,
          );
          throw error;
        }
        drawTimes[index] = Date.now() - patched;
        console.log(`tab ${index} drew the CLI edit ${drawTimes[index]} ms after it`);
      }),
    );
    measuringEdit = false;
    console.log(
      `frame detach count per tab: ${tabs.map((_, tab) => detached.get(tab) ?? 0).join(' / ')}`,
    );
    // One tab issued every held read meanwhile (a request's finished event can trail the next
    // request, so the in-flight count is read only when settled).
    expect(held.by.size).toBe(1);
    await expect.poll(() => held.now, { timeout: 30_000 }).toBe(1);
    const holder = [...held.by][0]!;
    // The holder may still be catching up on an earlier code change, which requires a remount;
    // peers must apply this CSS-only edit without replacing their frames.
    expect(tabs.flatMap((_, tab) => (tab === holder ? [] : [detached.get(tab) ?? 0]))).toEqual([
      0, 0, 0, 0,
    ]);
    // The holding tab closes: another tab takes the read over.
    await tabs[holder]!.close();
    inFlight.delete(holder);
    held.by.clear();
    await expect.poll(() => held.by.size, { timeout: 30_000 }).toBe(1);
    expect(held.by.has(holder)).toBe(false);
    await expect.poll(() => held.now, { timeout: 30_000 }).toBe(1);
  });
});

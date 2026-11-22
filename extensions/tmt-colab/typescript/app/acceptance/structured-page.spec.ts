import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { pairBrowser, restartColab, startDoor } from './harness/browser.js';
import { recordBlocksResults } from './harness/blocks-results.js';
import { freePort, openChat, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import { until } from './harness/process.js';
import { commentsClose } from '../test/comments-region.js';
import { backToPageList, showAllPages } from '../test/home-list.js';

test.afterEach(disposeActiveWorlds);

/** The platform's key to the end of a block's text, past every line: a click puts the caret where
 * it lands (#6742), so a case that types at the end goes there first. */
const textEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

// #6005: a structured page made and changed by the CLI draws in the browser from the fold, and the
// person's typing goes out as a block batch that merges with an agent's edit of the same block.
test('a structured page draws CLI blocks and keeps typing and an agent edit of the same block', async () => {
  test.setTimeout(360_000);
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

    let page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    let block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toHaveText('Ship the stack.');
    // At rest no block holds an editor.
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);

    await block.click();
    const editor = block.locator('[contenteditable="true"]');
    await editor.press(textEnd);
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

    // #6741: a phone may background and discard the tab while typing is pending.
    const expected = `${merged} background`;
    const address = new URL(created.path, `${door.address}/`).href;
    await page.setViewportSize({ width: 390, height: 900 });
    const cdp = await browser.context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const other = await browser.context.newPage();
    await page.bringToFront();
    await block.click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await page.evaluate((id) => {
      const state = window as Window & { inputSerial?: number; durableSerial?: number };
      state.inputSerial = 0;
      state.durableSerial = 0;
      document.addEventListener(
        'input',
        (event) => {
          if (event.isTrusted) state.inputSerial!++;
        },
        true,
      );
      window.addEventListener('colab:block-draft-durable', (event) => {
        if ((event as CustomEvent<{ id: string }>).detail.id === id)
          state.durableSerial = state.inputSerial;
      });
    }, paragraph);
    await page.keyboard.type(' background');
    await other.bringToFront();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = window as Window & { inputSerial?: number; durableSerial?: number };
            return !!state.inputSerial && state.inputSerial === state.durableSerial;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.close();
    page = await browser.context.newPage();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(address);
    await other.close();
    block = page.locator(`[data-block-id="${paragraph}"]`);
    const notice = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
    await expect
      .poll(
        async () => (await block.textContent())?.includes(expected) || (await notice.isVisible()),
        { timeout: 30_000 },
      )
      .toBe(true);
    if (await notice.isVisible())
      await notice.getByRole('button', { name: 'Keep and continue' }).click();
    await expect(block).toContainText(expected);
    await expect.poll(textNow, { timeout: 30_000 }).toBe(expected);

    // Keep a draft while the serve is down; a concurrent CLI edit must survive its recovery.
    await block.click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await restartColab(world, door, async () => {
      await page.keyboard.type(' unsent');
      await expect(block).toContainText(`${expected} unsent`);
      await backToPageList(page);
      await expect(
        page.getByRole('alert').getByRole('heading', { name: 'Page unavailable', exact: true }),
      ).toBeVisible();
      run(world, colab, [
        'block',
        'text',
        created.pageId,
        paragraph,
        '--find',
        'Merge',
        '--replace',
        'Reviewed',
        '--json',
      ]);
    });
    await page.getByRole('button', { name: 'Try again', exact: true }).click({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /^All, \d+\+?$/ })).toBeVisible({ timeout: 30_000 });
    await showAllPages(page);
    await page.getByRole('link', { name: 'Structured', exact: true }).click();
    const restored = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
    await expect(restored).toBeVisible({ timeout: 30_000 });
    expect(textNow()).toContain('Reviewed');
    expect(textNow()).not.toContain(' unsent');
    const captureDir = process.env.COLAB_6741_CAPTURE_DIR;
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await page.screenshot({ path: path.join(captureDir, `${width}-${theme}-restored.png`) });
        }
      }
    }
    await restored.getByRole('button', { name: 'Keep and continue' }).click();
    await expect
      .poll(textNow, { timeout: 30_000 })
      .toBe(`${expected.replace('Merge', 'Reviewed')} unsent`);
    await page.reload();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' }),
    ).toHaveCount(0);
    await expect(block).toContainText(`${expected.replace('Merge', 'Reviewed')} unsent`);
  });
});

for (const departure of ['reload', 'navigate'] as const) {
  test(`#6741 block typing survives immediate ${departure}`, async () => {
    await withWorld(async (world) => {
      const door = await startDoor(world, await freePort());
      const browser = await pairBrowser(world, `block-recovery-${departure}`);
      const colab = world.binaries.colab;
      const created = JSON.parse(
        run(world, colab, [
          'page',
          'create',
          '--title',
          'Recovery',
          '--structured',
          '--json',
          '--no-open',
        ]),
      ) as { pageId: string; path: string };
      const paragraph = (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            created.pageId,
            '--type',
            'paragraph',
            '--text',
            'Plan',
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
      const page = await browser.context.newPage();
      await page.goto(new URL(created.path, `${door.address}/`).href);
      const block = page.locator(`[data-block-id="${paragraph}"]`);
      await block.click();
      await block.locator('[contenteditable="true"]').press(textEnd);
      await page.evaluate((id) => {
        const state = window as Window & { inputSerial?: number; durableSerial?: number };
        state.inputSerial = 0;
        state.durableSerial = 0;
        document.addEventListener(
          'input',
          (event) => {
            if (event.isTrusted) state.inputSerial!++;
          },
          true,
        );
        window.addEventListener('colab:block-draft-durable', (event) => {
          if ((event as CustomEvent<{ id: string }>).detail.id === id)
            state.durableSerial = state.inputSerial;
        });
      }, paragraph);
      let savedRecord: { key: string; value: unknown } | undefined;
      let guarded = false;
      page.on('dialog', async (dialog) => {
        expect(dialog.type()).toBe('beforeunload');
        guarded = true;
        await dialog.dismiss();
      });
      await page.keyboard.type(' publish Friday');
      if (departure === 'reload') {
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const state = window as Window & { inputSerial?: number; durableSerial?: number };
                return !!state.inputSerial && state.durableSerial === state.inputSerial;
              }),
            { timeout: 5_000 },
          )
          .toBe(true);
        const beforeReload = (
          JSON.parse(run(world, colab, ['block', 'get', created.pageId, paragraph, '--json'])) as {
            block: { base: string };
          }
        ).block.base;
        expect(beforeReload).toBe('Plan');
        // Capture the real sealed recovery record while the server still has the old text.
        savedRecord = await page.evaluate(async (pageId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('tmt-colab', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const store = database.transaction('keys').objectStore('keys');
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = store.getAllKeys();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const key = keys.find(
              (item) =>
                typeof item === 'string' &&
                item.startsWith('block-drafts:') &&
                item.endsWith(`:${pageId}`),
            );
            if (typeof key !== 'string') throw new Error('Missing sealed block draft');
            const value = await new Promise<unknown>((resolve, reject) => {
              const request = database.transaction('keys').objectStore('keys').get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return { key, value };
          } finally {
            database.close();
          }
        }, created.pageId);
        await page.reload();
        expect(guarded).toBe(false);
      } else {
        await backToPageList(page);
        await showAllPages(page);
        await page.getByRole('link', { name: 'Recovery', exact: true }).click();
      }
      const notice = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
      await expect
        .poll(
          async () =>
            (await block.textContent())?.includes('Plan publish Friday') ||
            (await notice.isVisible()),
          { timeout: 30_000 },
        )
        .toBe(true);
      if (await notice.isVisible())
        await notice.getByRole('button', { name: 'Keep and continue' }).click();
      await expect(block).toContainText('Plan publish Friday');
      await expect
        .poll(
          () =>
            (
              JSON.parse(
                run(world, colab, ['block', 'get', created.pageId, paragraph, '--json']),
              ) as { block: { base: string } }
            ).block.base,
          { timeout: 30_000 },
        )
        .toBe('Plan publish Friday');
      if (savedRecord) {
        // Restore the actual encrypted record for a block deleted elsewhere, then fail its clear.
        run(world, colab, ['block', 'delete', created.pageId, paragraph, '--json']);
        await page.evaluate(async ({ key, value }) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('tmt-colab', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const transaction = database.transaction('keys', 'readwrite');
              transaction.objectStore('keys').put(value, key);
              transaction.oncomplete = () => resolve();
              transaction.onerror = () => reject(transaction.error);
              transaction.onabort = () => reject(transaction.error);
            });
          } finally {
            database.close();
          }
        }, savedRecord);
        await page.reload();
        const deleted = page
          .getByRole('status')
          .filter({ hasText: 'This block was deleted while you were editing it.' });
        await expect(deleted).toBeVisible();
        await page.evaluate((key) => {
          const original = IDBObjectStore.prototype.put;
          (window as Window & { restoreDraftPut?: () => void }).restoreDraftPut = () => {
            IDBObjectStore.prototype.put = original;
          };
          IDBObjectStore.prototype.put = function (value, recordKey) {
            if (recordKey === key) throw new Error('Simulated local storage failure');
            return original.call(this, value, recordKey);
          };
        }, savedRecord.key);
        await deleted.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(
          page.getByRole('status').filter({ hasText: 'Your last change was not applied.' }),
        ).toBeVisible();
        await expect(deleted).toBeVisible();
        await page.evaluate(() => {
          const restore = (window as Window & { restoreDraftPut?: () => void }).restoreDraftPut;
          if (!restore) throw new Error('Missing draft storage restore hook');
          restore();
        });
        await deleted.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(deleted).toHaveCount(0);
      }
    });
  });
}

test('#6741 warns before leaving while a draft write is pending', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'block-draft-guard');
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Guard',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const paragraph = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Plan',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await block.click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await page.evaluate(() => {
      const locks = navigator.locks;
      const request = locks.request.bind(locks);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      (window as Window & { releaseDraftWrite?: () => void }).releaseDraftWrite = release;
      Object.defineProperty(locks, 'request', {
        value: (name: string, callback: LockGrantedCallback<unknown>) =>
          name.startsWith('block-drafts:')
            ? held.then(() => request(name, callback))
            : request(name, callback),
      });
    });
    let warned = false;
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      warned = true;
      await dialog.dismiss();
    });
    await page.keyboard.type(' Friday');
    const diagnostic = async (stage: string) => {
      const dom = await page.evaluate((id) => {
        const block = document.querySelector(`[data-block-id="${id}"]`);
        const editor = block?.querySelector('[contenteditable="true"]');
        const active = document.activeElement;
        return {
          url: location.href,
          block: block?.textContent,
          editor: editor?.textContent,
          active: active?.outerHTML.slice(0, 300),
        };
      }, paragraph);
      const server = (
        JSON.parse(run(world, colab, ['block', 'get', created.pageId, paragraph, '--json'])) as {
          block: { base: string };
        }
      ).block.base;
      console.log(`#6741 case B ${stage} ${JSON.stringify({ dom, server, navigations })}`);
    };
    await diagnostic('before-dismissal');
    try {
      await page.reload({ timeout: 10_000 });
    } catch (error) {
      if (!warned) throw error;
    }
    expect(warned).toBe(true);
    await diagnostic('after-dismissal');
    await expect(block).toContainText('Plan Friday');
    await page.evaluate(() =>
      (window as Window & { releaseDraftWrite?: () => void }).releaseDraftWrite?.(),
    );
    await expect
      .poll(
        () =>
          (
            JSON.parse(
              run(world, colab, ['block', 'get', created.pageId, paragraph, '--json']),
            ) as { block: { base: string } }
          ).block.base,
        { timeout: 30_000 },
      )
      .toBe('Plan Friday');
  });
});

// #6449: the comment remains anchored after a real page reload. #6611: text selected in a block
// offers Annotate as on an HTML page, without Selection mode; a block without text is still
// annotated whole from Selection mode.
test('a comment on a structured block survives reopening', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'block-comment');
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(
        world,
        colab,
        [
          'page',
          'create',
          '--title',
          'Review notes',
          '--html',
          '--reason',
          'Exercise the HTML source path',
          '--layout',
          'column',
          '--file',
          '-',
          '--json',
          '--no-open',
        ],
        '<p>Legacy review page.</p>',
      ),
    ) as { pageId: string; path: string };
    run(world, colab, ['page', 'convert', created.pageId, '--yes', '--json']);
    const paragraph = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Review this release before launch.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const duplicate = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Review this release before launch.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const mockup = crypto.randomUUID();
    run(
      world,
      colab,
      ['block', 'batch', created.pageId, '--file', '-', '--json'],
      JSON.stringify([
        {
          op: 'insert',
          id: mockup,
          type: 'mockup',
          parent: 'root',
          after: duplicate,
          props: { markup: '<p>Mockup</p>' },
        },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toContainText('Review this release before launch.');
    // A person selects with the pointer (#6636): a drag across words of a block at rest selects
    // that text, not the block, and offers Annotate quoting exactly the dragged words.
    const dragAcross = async (phrase: string) => {
      const words = await block.evaluate((node, phrase) => {
        const text = [...node.querySelectorAll('*')]
          .flatMap((element) => [...element.childNodes])
          .find(
            (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(phrase),
          )!;
        const range = document.createRange();
        const start = text.textContent!.indexOf(phrase);
        range.setStart(text, start);
        range.setEnd(text, start + phrase.length);
        const rects = range.getClientRects();
        const first = rects[0]!;
        const last = rects[rects.length - 1]!;
        return {
          x1: first.left + 1,
          y1: first.top + first.height / 2,
          x2: last.right - 1,
          y2: last.top + last.height / 2,
        };
      }, phrase);
      await page.mouse.move(words.x1, words.y1);
      await page.mouse.down();
      await page.mouse.move(words.x2, words.y2, { steps: 12 });
      await page.mouse.up();
    };
    await dragAcross('this release');
    await expect(block).not.toHaveAttribute('data-selected');
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    const dragged = page.locator('.annotation-popover');
    await expect(dragged.getByText('Annotate the selection', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        [...(CSS.highlights.get('colab-annotating') ?? [])].map((range) => range.toString()),
      ),
    ).toEqual(['this release']);
    await page.keyboard.press('Escape');
    await expect(dragged).toHaveCount(0);
    // The control leaves with its window instead of staying where the selection was (#6636).
    await expect(page.getByRole('button', { name: 'Annotate', exact: true })).toHaveCount(0);
    // The keyboard path selects the same way.
    await block.getByText('Review this release before launch.').click();
    await page.keyboard.press(textEnd);
    for (const _ of 'launch.') await page.keyboard.press('Shift+ArrowLeft');
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    const annotation = page.locator('.annotation-popover');
    // Titled and marked as an HTML page's selection: the quoted text stays marked while it is open.
    await expect(annotation.getByText('Annotate the selection', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const marked = [...(CSS.highlights.get('colab-annotating') ?? [])];
        return marked.map((range) => range.toString());
      }),
    ).toEqual(['launch.']);
    await annotation.getByRole('combobox', { name: 'Message' }).fill('Please check this block.');
    await annotation.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    await expect(page.getByText('Please check this block.', { exact: true })).toBeVisible();
    // The composer echoes immediately; wait for the admitted thread before navigating away.
    await expect(block.getByRole('button', { name: 'Open comment 1' })).toBeAttached();
    await expect(
      page
        .locator(`[data-block-id="${duplicate}"]`)
        .getByRole('button', { name: 'Open comment 1' }),
    ).toHaveCount(0);
    await page.reload();
    await block.getByRole('button', { name: 'Open comment 1' }).click();
    await expect(page.getByText('Please check this block.', { exact: true })).toBeVisible();
    await commentsClose(page, 'discussion').click();
    await page.getByRole('button', { name: 'Selection mode', exact: true }).click();
    // In Selection mode the same drag quotes the dragged text at a phone width too (#6636).
    await page.setViewportSize({ width: 390, height: 844 });
    await dragAcross('release before');
    const narrow = page.locator('.annotation-popover');
    await expect(narrow.getByText('Annotate the selection', { exact: true })).toBeVisible();
    await expect(narrow.locator('.annotation-quote')).toHaveText('release before');
    await page.keyboard.press('Escape');
    await expect(narrow).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    // Escape also left Selection mode; the mockup below is annotated in it.
    const mode = page.getByRole('button', { name: 'Selection mode', exact: true });
    if ((await mode.getAttribute('aria-pressed')) !== 'true') await mode.click();
    const preview = page.locator(`[data-block-id="${mockup}"]`);
    await preview.locator('.tmt-block-mockup-viewport').click();
    const mockupComment = page.locator('.annotation-popover');
    await expect(mockupComment.getByText('Annotate the block', { exact: true })).toBeVisible();
    await mockupComment.getByRole('combobox', { name: 'Message' }).fill('Review this mockup.');
    await mockupComment.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    await expect(preview.getByRole('button', { name: 'Open comment 2' })).toBeAttached();
    await page.reload();
    await preview.getByRole('button', { name: 'Open comment 2' }).click();
    await expect(page.getByText('Review this mockup.', { exact: true })).toBeVisible();
    const threads = JSON.parse(run(world, colab, ['threads', created.pageId, '--json']))
      .threads as {
      id: string;
      anchor: { block?: string; quote?: { exact: string } } | null;
    }[];
    expect(threads.map((thread) => thread.anchor?.block).sort()).toEqual(
      [paragraph, mockup].sort(),
    );
    // The selection's text is the quote; the editor kept its text.
    expect(threads.find((thread) => thread.anchor?.block === paragraph)?.anchor?.quote?.exact).toBe(
      'launch.',
    );
    await expect(block).toContainText('Review this release before launch.');
    const target = threads.find((thread) => thread.anchor?.block === mockup)!;
    run(world, colab, ['page', 'convert', created.pageId, '--revert', '--yes', '--json']);
    await page.reload();
    await expect(page.locator('iframe')).toBeVisible();
    await page.getByRole('button', { name: /^Comments/ }).click();
    await expect(page.getByText('Review this mockup.', { exact: true })).toBeVisible();
    const after = JSON.parse(run(world, colab, ['threads', created.pageId, '--json'])) as {
      threads: { id: string; anchor: { block?: string } | null; resolved: boolean }[];
    };
    expect(after.threads.find((thread) => thread.id === target.id)?.anchor?.block).toBe(mockup);
    run(world, colab, ['threads', 'resolve', created.pageId, target.id, '--json']);
    const resolved = JSON.parse(run(world, colab, ['threads', created.pageId, '--json'])) as {
      threads: { id: string; resolved: boolean }[];
    };
    expect(resolved.threads.find((thread) => thread.id === target.id)?.resolved).toBe(true);
    run(world, colab, ['threads', 'reopen', created.pageId, target.id, '--json']);
    const reopened = JSON.parse(run(world, colab, ['threads', created.pageId, '--json'])) as {
      threads: { id: string; resolved: boolean }[];
    };
    expect(reopened.threads.find((thread) => thread.id === target.id)?.resolved).toBe(false);
  });
});

// #6611: an agent's edit never moves a person's typing out of the Chat composer, even with a
// block selected on the page before they moved there.
test('an agent edit keeps focus in Chat and never moves it into the page', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'chat-focus', { talk: true });
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Focus',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const id = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'First block.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await block.getByText('First block.').click();
    await page.keyboard.press('Escape');
    await expect(block).toBeFocused();
    await openChat(page);
    const input = page.getByTestId('chat-panel').getByRole('combobox', { name: 'Message' });
    await input.click();
    await page.keyboard.type('hello ');
    run(world, colab, [
      'block',
      'text',
      created.pageId,
      id,
      '--find',
      'First',
      '--replace',
      'Second',
      '--json',
    ]);
    await expect(block).toContainText('Second block.');
    await expect(input).toBeFocused();
    await page.keyboard.type('there');
    await expect.poll(() => input.innerText()).toBe('hello there');
    await expect(page.locator('[data-block-id]')).toHaveText(['Second block.']);
    // Focus the person left on the empty page is not taken by the selected block either: a key
    // after the agent's next edit changes nothing on the page.
    await page.getByRole('button', { name: 'Close Chat', exact: true }).click();
    await block.getByText('Second block.').click();
    await page.keyboard.press('Escape');
    await expect(block).toBeFocused();
    const empty = (await page.locator('.structured-page-stage').boundingBox())!;
    await page.mouse.click(empty.x + empty.width / 2, empty.y + empty.height + 120);
    await expect(block).not.toBeFocused();
    run(world, colab, [
      'block',
      'text',
      created.pageId,
      id,
      '--find',
      'Second',
      '--replace',
      'Third',
      '--json',
    ]);
    await expect(block).toContainText('Third block.');
    await expect(block).not.toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.type('x');
    await expect(page.locator('[data-block-id]')).toHaveText(['Third block.']);
  });
});

// #6005's done condition: a person writes and rearranges a page in the browser, and edits its
// table, while an agent edits the same page through the CLI; both land, and the page the CLI reads
// back is the page the browser draws.
test('a person writes, rearranges and edits a table while an agent edits the same page', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-together');
    const colab = world.binaries.colab;
    world.linkExtensions();
    // Block and row IDs are UUIDs, as the serve requires.
    const id = Object.fromEntries(
      ['plan', 'first', 'second', 'work', 'w1', 'w2', 'w3', 'note'].map((key) => [
        key,
        crypto.randomUUID(),
      ]),
    ) as Record<'plan' | 'first' | 'second' | 'work' | 'w1' | 'w2' | 'w3' | 'note', string>;
    const { pageId, path } = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Together',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const batch = (ops: unknown[]) =>
      run(world, colab, ['block', 'batch', pageId, '--file', '-', '--json'], JSON.stringify(ops));
    batch([
      {
        op: 'insert',
        id: id.plan,
        type: 'heading',
        parent: 'root',
        text: 'Plan',
        props: { level: 2 },
      },
      {
        op: 'insert',
        id: id.first,
        type: 'paragraph',
        parent: 'root',
        after: id.plan,
        text: 'First step.',
      },
      {
        op: 'insert',
        id: id.second,
        type: 'paragraph',
        parent: 'root',
        after: id.first,
        text: 'Second step.',
      },
      {
        op: 'insert',
        id: id.work,
        type: 'table',
        parent: 'root',
        after: id.second,
        props: {
          label: 'Work',
          columns: [
            { id: 'task', name: 'Task' },
            { id: 'state', name: 'State' },
          ],
        },
      },
      { op: 'table', id: id.work, action: 'add-row', row: id.w1, cells: { task: 'Model' } },
      { op: 'table', id: id.work, action: 'add-row', row: id.w2, cells: { task: 'Menus' } },
    ]);
    type Listed = {
      id: string;
      type: string;
      depth: number;
      text?: { s: string };
      cells?: Record<string, { s: string }>;
      props?: { columns?: { id: string; name: string }[] };
    };
    const listed = () =>
      (JSON.parse(run(world, colab, ['block', 'ls', pageId, '--json'])) as { blocks: Listed[] })
        .blocks;
    const texts = () =>
      listed()
        .filter((block) => block.depth === 0 && block.text)
        .map((block) => block.text!.s);
    const table = () => {
      const blocks = listed();
      return {
        columns: blocks.find((block) => block.id === id.work)!.props!.columns!.map((c) => c.name),
        rows: blocks
          .filter((block) => block.type === 'row')
          .map((row) =>
            Object.fromEntries(Object.entries(row.cells ?? {}).map(([key, cell]) => [key, cell.s])),
          ),
      };
    };

    const page = await browser.context.newPage();
    recordBlocksResults(page);
    await page.goto(new URL(path, `${door.address}/`).href);
    const second = page.locator(`[data-block-id="${id.second}"]`);
    await expect(second).toHaveText('Second step.');

    // The person writes at the end of a block and starts a new one with Enter.
    await second.click();
    const editor = page.locator('[contenteditable="true"]');
    await editor.press(textEnd);
    await editor.pressSequentially(' Now.', { delay: 40 });
    // Meanwhile the agent adds a note under the heading and fills a cell.
    batch([
      {
        op: 'insert',
        id: id.note,
        type: 'paragraph',
        parent: 'root',
        after: id.plan,
        text: 'Agent note.',
      },
      { op: 'table', id: id.work, action: 'set-cell', row: id.w1, column: 'state', text: 'done' },
    ]);
    await editor.press('Enter');
    await editor.pressSequentially('Third step.', { delay: 40 });
    await expect
      .poll(texts, { timeout: 30_000 })
      .toEqual(['Plan', 'Agent note.', 'First step.', 'Second step. Now.', 'Third step.']);

    // The person rearranges: Esc selects the block, and ⌥⇧↑ moves it above the first step.
    await editor.press('Escape');
    await page.locator(`[data-block-id="${id.second}"]`).click();
    await page.keyboard.press('Escape');
    await expect(second).toHaveAttribute('data-selected', '');
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect
      .poll(texts, { timeout: 30_000 })
      .toEqual(['Plan', 'Agent note.', 'Second step. Now.', 'First step.', 'Third step.']);

    // The table: the person fills a cell and adds a column while the agent adds a row.
    const work = page.locator(`[data-block-id="${id.work}"]`);
    await expect(work.locator('tbody tr').first()).toContainText('done');
    await work.locator('tbody tr').nth(1).locator('td').first().click();
    await editor.pressSequentially('open', { delay: 40 });
    batch([{ op: 'table', id: id.work, action: 'add-row', row: id.w3, cells: { task: 'Review' } }]);
    await editor.press('Escape');
    await work.getByRole('button', { name: 'Column actions: State' }).click();
    await page.getByRole('menuitem', { name: 'Add a column after' }).click();
    const name = work.getByRole('textbox', { name: 'Column name' });
    await name.fill('Owner');
    await name.press('Enter');
    await expect.poll(table, { timeout: 30_000 }).toEqual({
      columns: ['Task', 'State', 'Owner'],
      rows: [
        { task: 'Model', state: 'done' },
        { task: 'Menus', state: 'open' },
        { task: 'Review' },
      ],
    });

    // The browser draws the page the CLI reads back.
    const drawn = page.locator('[data-block-id]');
    await expect(drawn).toHaveText([
      'Plan',
      'Agent note.',
      'Second step. Now.',
      'First step.',
      'Third step.',
      /Task.*State.*Owner.*Model.*done.*Menus.*open.*Review/,
    ]);
    // A batch of the person's that the page could not get through (#6220) shows its notice.
    await expect(page.getByRole('status').filter({ hasText: 'not saved' })).toHaveCount(0);
  });
});

// #6005 image step: an agent attaches a file and inserts an image naming it; the browser draws it
// through the page's authorized read; a delete keeps the file, so undo draws it again.
test('an attached image draws on a page of blocks and comes back on undo', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-image');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Images',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    run(world, colab, [
      'block',
      'insert',
      pageId,
      '--type',
      'paragraph',
      '--text',
      'The sketch follows.',
      '--json',
    ]);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-image-'));
    // The serve reaches the page's object channel once a browser has opened it.
    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    await expect(page.getByText('The sketch follows.')).toBeVisible({ timeout: 30_000 });
    try {
      // A 2x2 PNG.
      const file = path.join(out, 'sketch.png');
      fs.writeFileSync(
        file,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEJMOAQBACsjQf5o4qoqgAAAABJRU5ErkJggg==',
          'base64',
        ),
      );
      const attached = JSON.parse(
        run(world, colab, ['attachment', 'attach', pageId, file, '--json']),
      ) as { attachment: { attachmentId: string } };
      const reference = `colab-attachment:${attached.attachment.attachmentId}`;
      const image = (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            pageId,
            '--type',
            'image',
            '--props',
            JSON.stringify({ images: [{ src: reference, alt: 'Sketch' }], layout: 'single' }),
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;

      const block = page.locator(`[data-block-id="${image}"]`);
      const drawn = block.getByRole('img', { name: 'Sketch' });
      await expect(drawn).toBeVisible({ timeout: 30_000 });
      await expect(drawn).toHaveAttribute('src', /^data:image\/png;base64,/);
      // An agent's insert draws the block without selecting it.
      expect(await block.getAttribute('aria-label')).toBe('image');
      await expect
        .poll(() => drawn.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(2);

      // Delete from the block menu, then Undo: the file stayed on the page, so it draws again.
      await block.hover();
      await page.getByRole('button', { name: 'Block actions' }).click();
      await page
        .getByRole('menu', { name: 'Block actions' })
        .getByRole('menuitem', { name: /Delete/ })
        .click();
      await expect(block).toHaveCount(0);
      const listed = () =>
        (
          JSON.parse(run(world, colab, ['block', 'ls', pageId, '--all', '--json'])) as {
            blocks: { id: string; deleted?: unknown }[];
          }
        ).blocks.find((entry) => entry.id === image);
      await expect.poll(() => listed()?.deleted !== undefined, { timeout: 30_000 }).toBe(true);
      // The deleted block still keeps the file: the serve reads it out, verified.
      const kept = JSON.parse(
        run(world, colab, [
          'attachment',
          'read',
          pageId,
          attached.attachment.attachmentId,
          '--output',
          out,
          '--json',
        ]),
      ) as { path: string };
      expect(fs.readFileSync(kept.path)).toEqual(fs.readFileSync(file));
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(drawn).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => listed()?.deleted, { timeout: 30_000 }).toBeUndefined();
      await page.close();
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

// #6202: a person drops an image and pastes a text file onto a page of blocks; each uploads, and
// one batch inserts its block and lists the file, so the CLI reads both back byte for byte. A
// delete in the browser keeps the file listed, so Undo draws the card again.
test('a dropped image and a pasted file upload, list and come back on undo', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-files');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Files',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const anchor = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          pageId,
          '--type',
          'paragraph',
          '--text',
          'Files follow.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-files-'));
    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    await expect(page.getByText('Files follow.')).toBeVisible({ timeout: 30_000 });
    try {
      // A 2x2 PNG, and a text file whose name claims an image: its bytes decide it is a file card.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEJMOAQBACsjQf5o4qoqgAAAABJRU5ErkJggg==',
        'base64',
      );
      const notes = Buffer.from('Ship the stack.\n');
      const add = (how: 'drop' | 'paste', name: string, bytes: Buffer, type: string) =>
        page.evaluate(
          ({ how, name, data, type, anchor }) => {
            const transfer = new DataTransfer();
            const raw = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
            transfer.items.add(new File([raw], name, { type }));
            const block = document.querySelector(`[data-block-id="${anchor}"]`)!;
            const target =
              how === 'paste' ? (block.querySelector('[contenteditable="true"]') ?? block) : block;
            target.dispatchEvent(
              how === 'paste'
                ? new ClipboardEvent('paste', {
                    clipboardData: transfer,
                    bubbles: true,
                    cancelable: true,
                  })
                : new DragEvent('drop', {
                    dataTransfer: transfer,
                    bubbles: true,
                    cancelable: true,
                  }),
            );
          },
          { how, name, data: bytes.toString('base64'), type, anchor },
        );
      type Listed = {
        id: string;
        type: string;
        props: Record<string, unknown>;
        deleted?: unknown;
      };
      const listed = () =>
        (
          JSON.parse(run(world, colab, ['block', 'ls', pageId, '--all', '--json'])) as {
            blocks: Listed[];
          }
        ).blocks;
      const reference = (block: Listed) =>
        String(
          (block.props.images as { src: string }[] | undefined)?.[0]?.src ??
            (block.props.files as { href: string }[])[0]!.href,
        ).slice('colab-attachment:'.length);
      const readBack = (block: Listed) =>
        fs.readFileSync(
          (
            JSON.parse(
              run(world, colab, [
                'attachment',
                'read',
                pageId,
                reference(block),
                '--output',
                out,
                '--json',
              ]),
            ) as { path: string }
          ).path,
        );

      await add('drop', 'sketch.png', png, 'image/png');
      const image = page.locator('[data-block-id]').getByRole('img', { name: 'sketch.png' });
      try {
        await expect(image).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        // #6274: say which stage the drop stopped at (ignored, tile drawn, upload failed, batch
        // not listed), bounded to one line, then fail as before.
        const view = await page.evaluate((anchor) => {
          const block = document.querySelector(`[data-block-id="${anchor}"]`);
          return {
            anchorFound: !!block,
            anchorReadonly: !!block?.hasAttribute('data-readonly'),
            tiles: document.querySelectorAll('.tmt-block-image-placeholder').length,
            failedTiles: document.querySelectorAll('.tmt-block-image-failed').length,
            images: document.querySelectorAll('[data-block-id] img').length,
            status: document.querySelector('.tmt-block-toast-place')?.textContent?.slice(0, 160),
          };
        }, anchor);
        const blocks = listed().map((block) => ({
          type: block.type,
          images: (block.props.images as unknown[] | undefined)?.length ?? 0,
          files: (block.props.files as unknown[] | undefined)?.length ?? 0,
          deleted: !!block.deleted,
        }));
        console.log(`#6274 drop diagnostics ${JSON.stringify({ view, blocks }).slice(0, 2000)}`);
        throw error;
      }
      await expect.poll(() => image.evaluate((n) => (n as HTMLImageElement).naturalWidth)).toBe(2);
      await page.getByText('Files follow.').click();
      await add('paste', 'notes.png', notes, 'image/png');
      const card = page.locator('.tmt-block-file');
      await expect(card).toContainText('notes.png', { timeout: 30_000 });
      await expect(card.locator('.tmt-block-file-size')).toHaveText('16 B');

      // The serve holds both blocks, each naming a file the page lists, with the same bytes.
      await expect
        .poll(() => listed().filter((block) => block.type === 'image').length, { timeout: 30_000 })
        .toBe(2);
      const blocks = listed();
      const files = blocks.filter((block) => block.type === 'image');
      const drawnImage = files.find((block) => Array.isArray(block.props.images))!;
      const fileCard = files.find((block) => block.props.variant === 'file')!;
      expect(readBack(drawnImage)).toEqual(png);
      expect(readBack(fileCard)).toEqual(notes);
      // Its bytes, not its name, made it a text file card.
      expect((fileCard.props.files as { type: string }[])[0]!.type).toBe('text/plain');
      // The paste went after the focused paragraph; the drop after the paragraph it landed on.
      expect(blocks.filter((block) => !block.deleted).map((block) => block.id)).toEqual([
        anchor,
        fileCard.id,
        drawnImage.id,
      ]);

      // Download asks the page's confirmation bar, then saves the file through the authorized read.
      await card.getByRole('button', { name: 'Download notes.png' }).click();
      const bar = page.getByRole('dialog', { name: 'Download attachment' });
      await expect(bar).toContainText('notes.png');
      const pending = page.waitForEvent('download');
      await bar.getByRole('button', { name: 'Download' }).click();
      const saved = await pending;
      expect(saved.suggestedFilename()).toBe('notes.png');
      expect(fs.readFileSync((await saved.path())!)).toEqual(notes);

      // Delete the card from the block menu, then Undo: the file stayed listed, so it draws again.
      const cardBlock = page.locator(`[data-block-id="${fileCard.id}"]`);
      await cardBlock.hover();
      await cardBlock.getByRole('button', { name: 'Block actions' }).click();
      await page
        .getByRole('menu', { name: 'Block actions' })
        .getByRole('menuitem', { name: /Delete/ })
        .click();
      await expect(cardBlock).toHaveCount(0);
      const state = () => listed().find((block) => block.id === fileCard.id)?.deleted;
      await expect.poll(() => state() !== undefined, { timeout: 30_000 }).toBe(true);
      expect(readBack(fileCard)).toEqual(notes);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(card).toContainText('notes.png', { timeout: 30_000 });
      await expect.poll(state, { timeout: 30_000 }).toBeUndefined();
      await page.close();
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

// #6208: the @ picker opens another of the owner's pages and marks its block with the page; the serve
// admits the `<pageId>/<blockId>` value, and the chip opens that page through the page-link path.
test('@ marks a block on another page, and the serve keeps it', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-at-pages');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const create = (title: string) =>
      JSON.parse(
        run(world, colab, [
          'page',
          'create',
          '--title',
          title,
          '--structured',
          '--json',
          '--no-open',
        ]),
      ) as { pageId: string; path: string };
    const insert = (pageId: string, type: string, text: string) =>
      (
        JSON.parse(
          run(world, colab, ['block', 'insert', pageId, '--type', type, '--text', text, '--json']),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    const other = create('Release checklist');
    const tag = insert(other.pageId, 'todo', 'Tag the release');
    const here = create('Plan');
    const paragraph = insert(here.pageId, 'paragraph', 'See');
    const page = await browser.context.newPage();
    await page.goto(new URL(here.path, `${door.address}/`).href);
    await expect(page.getByText('See', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByText('See', { exact: true }).click();
    const editor = page.locator(`[data-block-id="${paragraph}"] [contenteditable="true"]`);
    await editor.press(textEnd);
    await editor.pressSequentially(' @rel', { delay: 20 });
    const menu = page.getByRole('listbox', { name: '@ mention' });
    await menu.getByRole('option', { name: 'Release checklist' }).click({ timeout: 30_000 });
    await expect(menu.getByRole('option', { name: 'To-do: Tag the release' })).toBeVisible({
      timeout: 30_000,
    });
    for (let i = 0; i < 3; i++) await editor.press('Backspace');
    await editor.press('Enter');
    await expect(menu).toHaveCount(0);
    // The serve holds the mark with the other page's ID, and the HTML export names that page.
    const value = `${other.pageId}/${tag}`;
    await expect
      .poll(
        () =>
          (
            JSON.parse(run(world, colab, ['block', 'get', here.pageId, paragraph, '--json'])) as {
              block: { text?: { marks?: { mark: string; value?: string }[] } };
            }
          ).block.text?.marks?.find((mark) => mark.mark === 'block')?.value,
        { timeout: 30_000 },
      )
      .toBe(value);
    await page.close();
  });
});

// #6194: a person writes a question in the browser on a page an agent made; the serve registers
// it, and the person's answer reaches that agent, the page's creator.
test('a question written in the browser is registered and its answer reaches the page creator', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('answer-agent', { gated: true });
    const browser = await pairBrowser(world, 'structured-question', { talk: true });
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Questions', '--structured', '--json', '--no-open'],
        '',
        agent.pane,
      ),
    ) as { pageId: string; path: string };
    const intro = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          pageId,
          '--type',
          'paragraph',
          '--text',
          'Before the question.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;

    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    await page.locator(`[data-block-id="${intro}"]`).click();
    const editor = page.locator('[contenteditable="true"]');
    await editor.press(textEnd);
    await editor.press('Enter');
    await editor.press('/');
    await editor.pressSequentially('q', { delay: 20 });
    await editor.press('Enter');
    const edit = page.getByRole('group', { name: 'Edit question' });
    // The line names the creator, as words or, for the owner device, on the recipient picker.
    await expect(edit).toContainText('Answers go to');
    await expect(edit).toContainText('answer-agent');
    await edit.getByLabel('Question').fill('Which heading should we use?');
    await edit.getByLabel('Question').press('Enter');
    await page.keyboard.type('Keep it');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Change it');
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit).toHaveCount(0);

    // The serve registered the block with the page's question registry.
    const listed = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', pageId, '--json'])) as {
          blocks: {
            id: string;
            type: string;
            text?: { s: string };
            props: Record<string, unknown>;
          }[];
        }
      ).blocks.find((block) => block.type === 'question');
    // This tab's batches commit one after another (insert, title, each choices edit).
    await expect
      .poll(() => listed()?.props.choices, { timeout: 30_000 })
      .toEqual(['Keep it', 'Change it']);
    const question = listed()!;
    expect(question.text?.s).toBe('Which heading should we use?');
    const registry = JSON.parse(run(world, colab, ['question', 'ls', pageId, '--json'])) as {
      questions: { id: string; state: string }[];
    };
    expect(registry.questions.map((entry) => entry.id)).toEqual([question.id]);

    // The answer goes to the page's creator, the agent.
    const card = page
      .locator(`[data-block-id="${question.id}"]`)
      .getByRole('group', { name: 'Which heading should we use?' });
    await card.getByLabel('Keep it', { exact: true }).check();
    await card.getByRole('button', { name: 'Send' }).click();
    await until(() => agent.received().length === 1, 'the answer reached the agent');
    const answer = agent.received()[0];
    expect(answer.identityId).toBe(agent.id);
    expect(answer.message).toContain('Answer to “Which heading should we use?”: Keep it');
    const threads = JSON.parse(run(world, colab, ['threads', pageId, '--json'])).threads as {
      comments: { questionId?: string }[];
    }[];
    expect(threads.flatMap((thread) => thread.comments.map((c) => c.questionId))).toContain(
      question.id,
    );
    await page.close();
  });
});

// #6197: the person who owns the page picks, on the block question editor's recipient line, which
// agent receives the answers. The serve resolves the agent from the real identity store; the answer
// reaches that agent and not the page's creator, and choosing the creator again takes it back.
test('the agent picked in the question editor receives the answer, and the creator again after a clear', async () => {
  test.setTimeout(300_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const creator = await world.startAgent('question-creator', { gated: true });
    const chosen = await world.startAgent('question-chosen', { gated: true });
    const browser = await pairBrowser(world, 'structured-recipient', { talk: true });
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Recipients', '--structured', '--json', '--no-open'],
        '',
        creator.pane,
      ),
    ) as { pageId: string; path: string };
    const question = crypto.randomUUID();
    run(
      world,
      colab,
      ['block', 'batch', pageId, '--file', '-', '--json'],
      JSON.stringify([
        {
          op: 'insert',
          id: question,
          type: 'question',
          props: { kind: 'single', choices: ['Keep it', 'Change it'], other: false },
          text: 'Which heading should we use?',
        },
      ]),
    );
    const recipient = () =>
      (
        JSON.parse(run(world, colab, ['question', 'ls', pageId, '--json'])) as {
          questions: { id: string; agent?: { id: string; name: string } }[];
        }
      ).questions.find((entry) => entry.id === question)?.agent;
    // Registered with no agent of its own: the page's creator receives the answers.
    expect(recipient()).toBeUndefined();

    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${question}"]`);
    await expect(block).toBeVisible({ timeout: 30_000 });
    await block.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('group', { name: 'Edit question' });
    await expect(edit).toContainText('Answers go to');
    const pick = edit.locator('.question-recipient-trigger');
    // Registered with no agent of its own, the question follows the page's creator.
    await expect(pick).toHaveText(`The page creator (${creator.name})`);
    await expect(pick).toBeEnabled({ timeout: 30_000 });
    await pick.click();
    const options = page.getByRole('listbox').getByRole('option');
    // The page's creator first, then the directory's agents (Remote's order).
    await expect(options.first()).toHaveText(`The page creator (${creator.name})`);
    await expect(options).toHaveCount(3);
    expect(await options.allTextContents()).toEqual(
      expect.arrayContaining([creator.name, chosen.name]),
    );
    await options.filter({ hasText: chosen.name }).click();
    // The serve resolved the identity and registered it; the editor stays open and says who.
    await expect.poll(() => recipient()?.id, { timeout: 30_000 }).toBe(chosen.id);
    expect(recipient()?.name).toBe(chosen.name);
    await expect(pick).toHaveText(chosen.name);
    await expect(edit).toBeVisible();
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit).toHaveCount(0);

    // The answer goes to the chosen agent, not the creator.
    const card = block.getByRole('group', { name: 'Which heading should we use?' });
    await card.getByLabel('Keep it', { exact: true }).check();
    await card.getByRole('button', { name: 'Send' }).click();
    await until(() => chosen.received().length === 1, 'the answer reached the chosen agent');
    expect(chosen.received()[0].identityId).toBe(chosen.id);
    expect(chosen.received()[0].message).toContain(
      'Answer to “Which heading should we use?”: Keep it',
    );
    expect(creator.received()).toHaveLength(0);

    // Choosing the page creator clears the question's own agent: the registry follows the creator.
    // An answered question is one line; pressing it opens the card again, with its Edit.
    await block.getByRole('button', { name: /Which heading should we use\?/ }).click();
    await block.getByRole('button', { name: 'Edit' }).click();
    await expect(pick).toHaveText(chosen.name);
    await pick.click();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: `The page creator (${creator.name})`, exact: true })
      .click();
    await expect.poll(() => recipient(), { timeout: 30_000 }).toBeUndefined();
    await expect(pick).toHaveText(`The page creator (${creator.name})`);
    await page.close();
  });
});

// #6474 (spec 隨口交辦): a comment that asks an agent on a page of blocks becomes a to-do on that
// page once Remote accepts the send; the request names the block to check, the thread shows the
// to-do's progress, and checking the to-do through the CLI is what makes it done.
test('a comment that asks an agent becomes a to-do the agent checks', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('todo-agent');
    const browser = await pairBrowser(world, 'todo-asker', { talk: true });
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(
        world,
        colab,
        [
          'page',
          'create',
          '--title',
          'Toolbar',
          '--html',
          '--reason',
          'Exercise the HTML source path',
          '--layout',
          'column',
          '--file',
          '-',
          '--json',
          '--no-open',
        ],
        '<p>Draft.</p>',
      ),
    ) as { pageId: string; path: string };
    run(world, colab, ['page', 'convert', created.pageId, '--yes', '--json']);
    const paragraph = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'The mockup sits against the switcher.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    // A later section with its own to-do: the Ask's to-do belongs beside the asked block (#6636).
    for (const [type, text] of [
      ['heading', 'Build'],
      ['todo', 'Write the data layer'],
    ])
      run(world, colab, ['block', 'insert', created.pageId, '--type', type!, '--text', text!]);
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toContainText('The mockup sits against the switcher.');
    await page.getByRole('button', { name: 'Selection mode', exact: true }).click();
    await block.click();
    const annotation = page.locator('.annotation-popover');
    const input = annotation.getByRole('combobox', { name: 'Message' });
    await input.fill('@');
    await page
      .getByRole('option', { name: /todo-agent/ })
      .first()
      .click();
    await input.pressSequentially(' add a gap above the switcher');
    await input.press('Enter');
    await until(() => agent.received().length === 1, 'one delivery to the agent');
    const message = String(agent.received()[0]!.message);
    const check = /tmt colab block props ([0-9a-f-]{36}) ([0-9a-f-]{36}) --set checked=true/.exec(
      message,
    );
    expect(check?.[1]).toBe(created.pageId);
    const todoId = check![2]!;
    expect(message).toContain('To-do: add a gap above the switcher\n');
    // The to-do appears on the page after the accepted send, with the agent and the thread.
    const listed = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
          blocks: { id: string; type: string; props?: Record<string, unknown>; text?: string }[];
        }
      ).blocks.find((entry) => entry.id === todoId);
    await until(() => listed() !== undefined, 'the to-do block on the page', 60_000);
    expect(listed()).toMatchObject({
      type: 'todo',
      props: { assignee: 'todo-agent', checked: false },
    });
    const order = (
      JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
        blocks: { id: string }[];
      }
    ).blocks.map((entry) => entry.id);
    expect(order.indexOf(todoId)).toBe(order.indexOf(paragraph) + 1);
    const line = page.locator('.ask-todo-line');
    if (!(await line.isVisible()))
      await block.getByRole('button', { name: 'Open comment 1' }).click();
    await expect(line).toContainText('Added as a to-do · todo-agent');
    // The agent checks it the way the request says; the thread then says done.
    run(world, colab, [
      'block',
      'props',
      created.pageId,
      todoId,
      '--set',
      'checked=true',
      '--json',
    ]);
    await expect(line).toContainText('Done', { timeout: 60_000 });
    // One to-do, however often the page reads the accepted Ask.
    await page.reload();
    await expect(page.locator(`[data-block-id="${todoId}"]`)).toBeVisible();
    const todos = (
      JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
        blocks: { type: string; deleted?: boolean }[];
      }
    ).blocks.filter((entry) => entry.type === 'todo' && !entry.deleted);
    expect(todos).toHaveLength(2);
    expect(agent.received()).toHaveLength(1);
  });
});

async function tabTo(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
) {
  await target.waitFor({ state: 'visible' });
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

for (const task of ['heading actions', 'annotation'] as const)
  test(`keyboard-only structured page: ${task}`, async () => {
    await withWorld(async (world) => {
      const door = await startDoor(world, await freePort());
      const browser = await pairBrowser(world, 'block-keyboard');
      world.linkExtensions();
      const cli = (args: string[]) =>
        JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
      const created = cli(['page', 'create', '--title', 'Keyboard review', '--no-open']);
      for (const title of ['Overview', 'Details', 'Decisions'])
        cli(['block', 'insert', created.pageId, '--type', 'heading', '--text', title]);
      const paragraph = cli([
        'block',
        'insert',
        created.pageId,
        '--type',
        'paragraph',
        '--text',
        'Review the checklist.',
      ]).blockIds[0];
      const todo = cli([
        'block',
        'insert',
        created.pageId,
        '--type',
        'todo',
        '--text',
        'Send the summary',
      ]).blockIds[0];
      const page = await browser.context.newPage();
      await page.goto(new URL(created.path, door.address).href);
      const nav = page.getByRole('navigation', { name: 'Page outline' });
      if (task === 'heading actions') {
        const toggle = nav.locator('.page-outline-toggle');
        await tabTo(page, toggle);
        if ((await toggle.getAttribute('aria-expanded')) === 'false')
          await page.keyboard.press('Enter');
        await tabTo(page, nav.getByRole('button', { name: 'Details', exact: true }));
        await page.keyboard.press('Enter');
        const heading = page
          .locator('[data-block-id]')
          .filter({ has: page.getByRole('heading', { name: 'Details', exact: true }) });
        await expect(heading).toBeFocused();
        await page.keyboard.press('Shift+F10');
        await expect(page.getByRole('menuitem', { name: 'Mark as done' })).toBeVisible();
        await page.keyboard.press('End');
        const menu = page.getByRole('menu', { name: 'Block actions' });
        for (
          let i = 0;
          i < 20 && !(await menu.getAttribute('aria-activedescendant'))?.endsWith('progress-done');
          i++
        )
          await page.keyboard.press('ArrowUp');
        await expect(menu).toHaveAttribute('aria-activedescendant', /progress-done$/);
        await page.keyboard.press('Enter');
        const id = await heading.getAttribute('data-block-id');
        await expect
          .poll(() => cli(['block', 'get', created.pageId, id!]).block.props.progress)
          .toBe('done');
        // Sections follow the page's own blocks at once (#6687), here and in another tab of the
        // owner: the heading marked done by hand says Done, never 0 of something.
        const other = await browser.context.newPage();
        await other.goto(new URL(created.path, door.address).href);
        const row = (view: typeof page, name: string) =>
          view
            .getByRole('navigation', { name: 'Page outline' })
            .getByRole('button', { name: new RegExp(`^${name}`) });
        for (const view of [page, other]) {
          await expect(row(view, 'Details').locator('.page-outline-section-count')).toHaveText(
            /^Done/,
          );
          await expect(row(view, 'Details').locator('.page-outline-mark')).toHaveAttribute(
            'data-shape',
            'dot',
          );
          await expect(view.locator('.page-outline-progress')).toContainText('1/2 done');
        }
        await page.getByRole('checkbox', { name: 'Send the summary' }).check();
        for (const view of [page, other]) {
          await expect(row(view, 'Decisions').locator('.page-outline-section-count')).toHaveText(
            /^1\/1/,
          );
          await expect(view.locator('.page-outline-progress')).toContainText('2/2 done');
          await expect(
            view.locator('.structured-section-heading').filter({ hasText: 'Decisions' }),
          ).toContainText('1/1');
        }
      } else {
        // A heading selected from the outline first: Selection mode does not draw it (#6675).
        const outlineToggle = nav.locator('.page-outline-toggle');
        await tabTo(page, outlineToggle);
        if ((await outlineToggle.getAttribute('aria-expanded')) === 'false')
          await page.keyboard.press('Enter');
        await tabTo(page, nav.getByRole('button', { name: 'Details', exact: true }));
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-selected]')).toHaveCount(1);
        const select = page.getByRole('button', { name: 'Selection mode', exact: true });
        await tabTo(page, select);
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-selected]')).toHaveCount(0);
        // Back from the button: the last block, then block by block, a to-do one stop (#6675).
        await expect(select).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator(`[data-block-id="${todo}"]`)).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        const block = page.locator(`[data-block-id="${paragraph}"]`);
        await expect(block).toBeFocused();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await expect(select).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(block).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Annotate selection' });
        await expect(dialog.getByText('Annotate the block', { exact: true })).toBeVisible();
        await expect(dialog.locator('.annotation-quote')).toContainText('Review the checklist.');
        await page.keyboard.press('Escape');
        await expect(block).toBeFocused();
        // Selection mode stays on after the window closes (#6725): a second Escape leaves it.
        await page.keyboard.press('Escape');
        await expect(select).toHaveAttribute('aria-pressed', 'false');
        await expect(block).toBeFocused();
        await page.keyboard.press('Enter');
        // The editor opens on the block before the caret keys reach it.
        await expect(block.locator('[contenteditable="true"]')).toBeFocused();
        await page.keyboard.press('End');
        for (const _ of 'checklist.') await page.keyboard.press('Shift+ArrowLeft');
        // The page reads the selection on its selectionchange task: let the last one run before
        // Tab leaves the editor, as a person's next key would (it fails 3 in 5 on main without).
        await expect
          .poll(() =>
            page.evaluate(
              () => new Promise((done) => setTimeout(() => done(getSelection()?.toString()), 0)),
            ),
          )
          .toBe('checklist.');
        const annotate = page.getByRole('button', { name: 'Annotate', exact: true });
        await expect(annotate).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(annotate).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog.locator('.annotation-quote')).toHaveText('checklist.');
      }
    });
  });

test('remote deletion preserves typing until the person keeps or discards the draft', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const { page } = await pairBrowser(world, 'concurrent-editor');
    const cli = (...args: string[]) => run(world, world.binaries.colab, [...args, '--json']);
    const created = JSON.parse(
      cli('page', 'create', '--title', 'Release checklist', '--structured', '--no-open'),
    );
    const insert = (text: string): string =>
      JSON.parse(cli('block', 'insert', created.pageId, '--type', 'paragraph', '--text', text))
        .blockIds[0];
    const first = insert('Review launch notes');
    const second = insert('Review rollback plan');
    await page.goto(new URL(created.path, door.address).href);
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'This block was deleted while you were editing it.' });
    for (const [id, action] of [
      [first, 'Keep as a new block'],
      [second, 'Discard'],
    ] as const) {
      const block = page.locator(`[data-block-id="${id}"]`);
      await block.click();
      const editor = block.locator('[contenteditable=true]');
      await editor.press(textEnd);
      await page.keyboard.type(' today');
      cli('block', 'delete', created.pageId, id);
      await expect(notice).toBeVisible();
      await expect(editor).toBeFocused();
      await page.keyboard.type(' before noon');
      await expect(editor).toContainText(' today before noon');
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(notice).toHaveCount(0);
      await expect(block).toHaveCount(0);
      if (action === 'Keep as a new block') {
        const kept = page
          .locator('[contenteditable=true]')
          .filter({ hasText: 'Review launch notes today before noon' });
        await expect(kept).toBeFocused();
        await page.keyboard.type('.');
        const newId = await kept.evaluate((el) =>
          el.closest('[data-block-id]')!.getAttribute('data-block-id')!,
        );
        await expect
          .poll(() => JSON.parse(cli('block', 'get', created.pageId, newId)).block.base)
          .toBe('Review launch notes today before noon.');
      } else {
        await expect(page.locator('body')).not.toBeFocused();
        await page.reload();
        await expect(
          page.getByText('Review launch notes today before noon.', { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('Review rollback plan today before noon')).toHaveCount(0);
      }
    }
    // An editor that holds nothing unsent is no draft (#6725): the block leaves with the toast.
    const opened = insert('Review the press note');
    const block = page.locator(`[data-block-id="${opened}"]`);
    await block.click();
    await expect(block.locator('[contenteditable=true]')).toBeFocused();
    cli('block', 'delete', created.pageId, opened);
    await expect(
      page.getByRole('status').filter({ hasText: 'The block was deleted.' }),
    ).toBeVisible();
    await expect(block).toHaveCount(0);
    await expect(notice).toHaveCount(0);
  });
});

// #6735: once the serve has combined a page's updates into a checkpoint, the page revision a tab
// computes never equals the serve's, and every batch waited 20 s for it in turn. Past that point a
// to-do check, among an agent's inserts and the person's typing, lands at once.
test('past a combine every batch lands at once', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const { page } = await pairBrowser(world, 'combine-author');
    const colab = world.binaries.colab;
    const cli = (...args: string[]) => JSON.parse(run(world, colab, [...args, '--json']));
    const created = cli('page', 'create', '--title', 'Combined', '--structured', '--no-open') as {
      pageId: string;
      path: string;
    };
    const insert = (type: string, text: string) =>
      (
        cli('block', 'insert', created.pageId, '--type', type, '--text', text) as {
          blockIds: string[];
        }
      ).blockIds[0]!;
    const todo = insert('todo', 'Check me');
    const typed = insert('paragraph', 'Notes');
    // Close to the serve's combine point (50 updates on its writer stream) before the page opens.
    for (let n = 0; n < 44; n++) insert('paragraph', `Agent line ${n}`);
    await page.goto(new URL(created.path, door.address).href);
    const checked = () =>
      !!(cli('block', 'get', created.pageId, todo) as { block: { props?: { checked?: boolean } } })
        .block.props?.checked;
    for (let round = 0; round < 8; round++) {
      const block = page.locator(`[data-block-id="${typed}"]`);
      await block.click();
      await block.locator('[contenteditable=true]').press(textEnd);
      await page.keyboard.type(` w${round}`);
      await page.keyboard.press('Escape');
      insert('paragraph', `Agent round ${round}`);
      const was = checked();
      await page.locator(`[data-block-id="${todo}"]`).getByRole('checkbox').click();
      // Well under the 20 s the revision wait took, and with no saving line drawn.
      await expect.poll(checked, { timeout: 5_000 }).toBe(!was);
      await expect(page.getByRole('status').filter({ hasText: 'Saving your change' })).toHaveCount(
        0,
      );
    }
  });
});

test('typing at a block or cell byte limit keeps the last allowed key after reload', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'limited-author');
    world.linkExtensions();
    const cli = (args: string[], input?: string) => run(world, world.binaries.colab, args, input);
    const { pageId, path } = JSON.parse(
      cli(['page', 'create', '--title', 'Full fields', '--no-open', '--json']),
    );
    const paragraph = crypto.randomUUID(),
      table = crypto.randomUUID(),
      row = crypto.randomUUID();
    const almostFull = (bytes: number) =>
      '界'.repeat(Math.floor((bytes - 1) / 3)) + 'a'.repeat((bytes - 1) % 3);
    const longId = crypto.randomUUID();
    const longText = almostFull(65536);
    const blockText = almostFull(32626),
      cellText = almostFull(4096);
    cli(
      ['block', 'batch', pageId, '--file', '-', '--json'],
      JSON.stringify([
        { op: 'insert', type: 'paragraph', parent: 'root', id: paragraph, text: blockText },
        {
          op: 'insert',
          type: 'paragraph',
          parent: 'root',
          id: longId,
          after: paragraph,
          text: longText,
        },
        {
          op: 'insert',
          type: 'table',
          parent: 'root',
          id: table,
          after: paragraph,
          props: { columns: [{ id: 'task', name: 'Task' }] },
        },
        { op: 'table', action: 'add-row', id: table, row, cells: { task: cellText } },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(path, door.address).href);
    for (const [target, initial, notice] of [
      [
        page.locator(`[data-block-id="${paragraph}"]`),
        blockText,
        'This block is too long to edit here. Split it into smaller blocks.',
      ],
      [
        page.locator(`[data-cell-row="${row}"]`),
        cellText,
        'This cell is full. Move part of the text to another cell.',
      ],
    ] as const) {
      await target.click();
      const editor = page.locator('[contenteditable="true"]');
      await editor.press(textEnd);
      await editor.pressSequentially('XY');
      await expect(page.getByText(notice, { exact: true })).toBeVisible();
      await expect(editor).toHaveText(initial + 'X');
      await expect
        .poll(() => editor.evaluate((el) => el.ownerDocument.getSelection()?.anchorOffset))
        .toBe(initial.length + 1);
      await expect
        .poll(
          () => {
            const blocks = JSON.parse(cli(['block', 'ls', pageId, '--json'])).blocks as {
              id: string;
              text?: { s: string };
              cells?: Record<string, { s: string }>;
            }[];
            return initial === blockText
              ? blocks.find((b) => b.id === paragraph)?.text?.s
              : blocks.find((b) => b.id === row)?.cells?.task?.s;
          },
          { timeout: 30000 },
        )
        .toBe(initial + 'X');
      await page.reload();
      await expect(target).toHaveText(initial + 'X');
    }
    const long = page.locator(`[data-block-id="${longId}"]`);
    await long.click();
    const field = long.locator('[contenteditable="true"]');
    await field.press(textEnd);
    await field.pressSequentially('Z');
    await expect(
      page.getByText('This block is too long to edit here. Split it into smaller blocks.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(field).toHaveText(longText);
    await page.reload();
    await expect(long).toHaveText(longText);
  });
});

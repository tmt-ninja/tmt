import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pairBrowser, startDoor } from './harness/browser.js';
import { createPage, freePort, openPage, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import { pageAction, selectDiscussion } from '../test/page-actions.js';

test.afterEach(disposeActiveWorlds);

async function capture(page: Page, stage: string) {
  const directory = process.env.COLAB_CONVERSION_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  for (const width of [390, 1440]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      await page.screenshot({
        path: path.join(directory, `${stage}-${width}-${theme}.png`),
        animations: 'disabled',
      });
    }
  }
}

test('the mounted owner creates a structured sub-page', async () => {
  await withWorld(async (world) => {
    const parent = createPage(world, 'Parent', '<h1>Parent</h1>');
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-subpage-owner');
    const page = await openPage(door, browser, parent);
    const band = page.getByRole('region', { name: 'Work on this page' });
    await band.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a sub-page to “Parent”' });
    await dialog.getByRole('combobox').fill('Structured child');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    const children = colab(['subpage', 'ls', parent.pageId]).children as string[];
    expect(children).toHaveLength(1);
    expect(colab(['show', children[0]]).page.title).toBe('Structured child');
    expect(colab(['block', 'ls', children[0]]).blocks).toEqual([]);
    if (process.env.COLAB_CONVERSION_CAPTURE_DIR) {
      const child = await openPage(door, browser, {
        pageId: children[0]!,
        path: `${parent.path.slice(0, parent.path.lastIndexOf('/') + 1)}${children[0]}`,
      });
      await expect(child.locator('[data-slot="block-doc"]')).toHaveCount(1);
      await capture(child, 'new-subpage');
      await child.close();
    }
  });
});

test('an HTML source save survives creation of another page', async () => {
  await withWorld(async (world) => {
    const original = createPage(world, 'HTML original', '<h1>Original</h1>');
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'html-cross-page');
    const page = await openPage(door, browser, original);
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: 'Original' }),
    ).toBeVisible();
    createPage(world, 'Other page', '<p>Other</p>');
    await (await pageAction(page, 'Source')).click();
    const source = '<h1>Original edited</h1>';
    await page.getByRole('textbox', { name: 'Page source', exact: true }).fill(source);
    await page.getByRole('button', { name: 'Save source', exact: true }).click();
    await expect
      .poll(
        () =>
          JSON.parse(run(world, world.binaries.colab, ['page', 'read', original.pageId, '--json']))
            .source,
      )
      .toBe(source);
  });
});

test('a block added after the revert confirmation opens is not discarded', async () => {
  await withWorld(async (world) => {
    const original = createPage(world, 'Concurrent conversion', '<h1>Original</h1>');
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'conversion-concurrent');
    const page = await openPage(door, browser, original);
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: 'Original' }),
    ).toBeVisible();
    await (await pageAction(page, 'Convert to structured page…')).click();
    await page.getByRole('button', { name: 'Convert page', exact: true }).click();
    await expect(page.locator('[data-slot="block-doc"]')).toBeVisible();
    await (await pageAction(page, 'Switch back to HTML…')).click();
    const dialog = page.getByRole('dialog', { name: 'Switch back to HTML?' });
    await expect(dialog).toBeVisible();
    colab(['block', 'insert', original.pageId, '--type', 'paragraph', '--text', 'Concurrent']);
    await dialog.getByRole('button', { name: 'Switch back', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('page changed');
    await expect(page.getByRole('alert')).toContainText('check the block count');
    expect(colab(['block', 'ls', original.pageId]).blocks).toHaveLength(1);
  });
});

test('revert waits for the just-typed first block before showing its count', async () => {
  await withWorld(async (world) => {
    const original = createPage(world, 'Typing before revert', '<h1>Original</h1>');
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'conversion-pending');
    const page = await openPage(door, browser, original);
    await expect(
      page.frameLocator('iframe').getByRole('heading', { name: 'Original' }),
    ).toBeVisible();
    await (await pageAction(page, 'Convert to structured page…')).click();
    await page.getByRole('button', { name: 'Convert page', exact: true }).click();
    await page.getByRole('button', { name: 'Type / for blocks' }).click();
    await page.getByRole('textbox', { name: 'Empty paragraph' }).pressSequentially('A');
    await (await pageAction(page, 'Switch back to HTML…')).click();
    await expect(page.getByRole('dialog', { name: 'Switch back to HTML?' })).toContainText(
      'removes the 1 block',
    );
  });
});

test('a page converts in place and restores retained HTML after counted confirmation', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'conversion-owner');
    const source = '<h1>Legacy example</h1><p>Keep this source.</p>';
    const created = createPage(world, 'Legacy example', source);
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const originalFile = path.join(world.workspace, 'original.txt');
    writeFileSync(originalFile, 'Attachment stays with this page.');
    const page = await openPage(door, browser, created);
    const heading = page.frameLocator('iframe').getByRole('heading', { name: 'Legacy example' });
    await expect(heading).toBeVisible();
    await capture(page, 'html-before');
    const selection = page.getByRole('button', { name: 'Selection mode', exact: true });
    await selection.click();
    await expect(selection).toHaveAttribute('aria-pressed', 'true');
    await heading.click();
    const annotation = page.getByRole('dialog', { name: 'Annotate selection' });
    await annotation
      .getByRole('combobox', { name: 'Message', exact: true })
      .fill('Keep this discussion.');
    await annotation.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    await expect(annotation.getByTestId('comment-entry').locator('.comment-body')).toHaveText(
      'Keep this discussion.',
    );
    await annotation.getByRole('button', { name: 'Collapse thread', exact: true }).click();
    const attachment = colab(['attachment', 'attach', created.pageId, originalFile]).attachment
      .attachmentId as string;
    const convertAction = await pageAction(page, 'Convert to structured page…');
    await capture(page, 'html-menu');
    await convertAction.click();
    await capture(page, 'convert-dialog');
    await page
      .getByRole('dialog', { name: 'Convert to a structured page?' })
      .getByRole('button', { name: 'Convert page' })
      .click();
    await expect(heading).toHaveCount(0);
    await capture(page, 'converted-empty');
    expect(colab(['page', 'read', created.pageId, '--legacy']).source).toBe(source);
    const afterConversion = path.join(world.workspace, 'after-conversion');
    mkdirSync(afterConversion);
    const convertedFile = colab([
      'attachment',
      'read',
      created.pageId,
      attachment,
      '--output',
      afterConversion,
    ]);
    expect(readFileSync(convertedFile.path, 'utf8')).toBe('Attachment stays with this page.');
    await page.getByRole('button', { name: 'Type / for blocks' }).click();
    await page.getByRole('textbox', { name: 'Empty paragraph' }).pressSequentially('N');
    await expect.poll(() => colab(['block', 'ls', created.pageId]).blocks.length).toBe(1);
    const blockId = colab(['block', 'ls', created.pageId]).blocks[0].id as string;
    const block = page.locator(`[data-block-id="${blockId}"]`);
    const editor = block.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.pressSequentially('ew block edited');
    await expect
      .poll(() => colab(['block', 'get', created.pageId, blockId]).block.base, { timeout: 30_000 })
      .toBe('New block edited');
    await capture(page, 'edited-block');
    const beforeReferencePage = colab(['page', 'read', created.pageId, '--legacy']);
    {
      // The shipped editor on a new blocks page is the reference for the converted page.
      const reference = colab(['page', 'create', '--title', 'Legacy example', '--no-open']);
      const referencePage = await browser.context.newPage();
      await referencePage.goto(new URL(reference.path, `${door.address}/`).href);
      await expect(referencePage.locator('[data-slot="block-doc"]')).toHaveCount(1);
      await capture(referencePage, 'empty-reference');
      const item = colab([
        'block',
        'insert',
        reference.pageId,
        '--type',
        'paragraph',
        '--text',
        'New block edited',
      ]);
      const referenceBlock = referencePage.locator(`[data-block-id="${item.blockIds[0]}"]`);
      await expect(referenceBlock).toHaveText('New block edited');
      await referenceBlock.click();
      await expect(referenceBlock.locator('[contenteditable="true"]')).toBeVisible();
      await capture(referencePage, 'editor-reference');
      await referencePage.close();
    }
    const afterReferencePage = colab(['page', 'read', created.pageId, '--legacy']);
    expect(afterReferencePage.membershipHead).not.toEqual(beforeReferencePage.membershipHead);
    expect(afterReferencePage.revision).not.toBe(beforeReferencePage.revision);
    expect(colab(['block', 'ls', created.pageId]).blocks).toHaveLength(1);
    const dialog = page.getByRole('dialog', { name: 'Switch back to HTML?' });
    const revertAction = await pageAction(page, 'Switch back to HTML…');
    await capture(page, 'blocks-menu');
    await revertAction.click();
    await expect(dialog).toContainText('removes the 1 block');
    await capture(page, 'revert-dialog');
    await dialog.getByRole('button', { name: 'Switch back', exact: true }).click();
    await expect(heading).toBeVisible();
    await capture(page, 'html-restored');
    expect(colab(['page', 'read', created.pageId]).source).toBe(source);
    await (await pageAction(page, 'Comments')).click();
    await selectDiscussion(page, 'Legacy example');
    await expect(page.getByTestId('comment-entry').locator('.comment-body')).toHaveText(
      'Keep this discussion.',
    );
    const afterRevert = path.join(world.workspace, 'after-revert');
    mkdirSync(afterRevert);
    const revertedFile = colab([
      'attachment',
      'read',
      created.pageId,
      attachment,
      '--output',
      afterRevert,
    ]);
    expect(readFileSync(revertedFile.path, 'utf8')).toBe('Attachment stays with this page.');
  });
});

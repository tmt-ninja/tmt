import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pairBrowser, startDoor } from './harness/browser.js';
import { createPage, freePort, openPage, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import { pageAction, selectDiscussion } from '../test/page-actions.js';

test.afterEach(disposeActiveWorlds);

test('a page converts in place and restores retained HTML after counted confirmation', async () => {
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
    await (await pageAction(page, 'Convert to structured page…')).click();
    await page
      .getByRole('dialog', { name: 'Convert to a structured page?' })
      .getByRole('button', { name: 'Convert page' })
      .click();
    await expect(heading).toHaveCount(0);
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
    colab(['block', 'insert', created.pageId, '--type', 'paragraph', '--text', 'New block']);
    const dialog = page.getByRole('dialog', { name: 'Switch back to HTML?' });
    await expect
      .poll(
        async () => {
          await (await pageAction(page, 'Switch back to HTML…')).click();
          const text = await dialog.innerText();
          if (!text.includes('removes the 1 block')) {
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
          }
          return text.includes('removes the 1 block');
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await dialog.getByRole('button', { name: 'Switch back', exact: true }).click();
    await expect(heading).toBeVisible();
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

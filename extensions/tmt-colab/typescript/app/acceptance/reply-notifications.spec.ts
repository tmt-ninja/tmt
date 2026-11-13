import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { commentsRegion } from '../test/comments-region.js';
import { pageAction, selectDiscussion } from '../test/page-actions.js';
import { pairBrowser, startDoor } from './harness/browser.js';
import { createPage, freePort, openPage, selectInRenderer } from './harness/ask.js';
import { until } from './harness/process.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import { captureResponsive } from './harness/captures.js';

test.afterEach(disposeActiveWorlds);

test('an authenticated participant comment notifies the thread author and opens the canonical quote', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const author = await pairBrowser(world, 'thread-notification-author', { talk: true });
    const writer = await pairBrowser(world, 'thread-notification-writer', { talk: true });
    const created = createPage(world, 'Thread notifications', '<p id="quote">Canonical quote.</p>');
    const page = await openPage(door, author, created);
    const other = await openPage(door, writer, created);
    await selectInRenderer(page, '#quote');
    await page.getByTestId('selection-ask').click();
    const compose = page.getByRole('dialog', { name: 'Annotate selection' });
    await compose.getByRole('combobox', { name: 'Message', exact: true }).fill('My own thread.');
    await compose.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    const original = page.getByTestId('comment-thread');
    await expect(original.getByTestId('comment-entry')).toHaveCount(1);
    const id = await original.getAttribute('data-thread-id');
    await original.getByRole('button', { name: 'Collapse thread', exact: true }).click();
    await (await pageAction(other, 'Comments')).click();
    await selectDiscussion(other, 'Canonical quote.');
    const thread = other.getByTestId('comment-thread');
    await thread
      .getByRole('combobox', { name: 'Message', exact: true })
      .fill('A signed participant reply.');
    await thread.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    const card = page.locator('.tmt-ui-notification');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('A signed participant reply.');
    await expect(card.locator('blockquote')).toHaveText('Canonical quote.');
    await captureResponsive(page, 'notification-thread-queue');
    await card.getByRole('button', { name: 'Open Thread', exact: true }).click();
    await expect(original).toHaveAttribute('data-thread-id', id!);
    await expect(original).toHaveAttribute('data-anchor', 'attached');
    await expect(original.locator('.thread-state').first()).toHaveAttribute(
      'title',
      'Canonical quote.',
    );
    await expect(original.getByTestId('comment-entry')).toHaveCount(2);
    await expect(
      original.getByTestId('comment-entry').filter({ hasText: 'A signed participant reply.' }),
    ).toBeInViewport();
    await expect(page.locator('.reply-announcement')).toHaveCount(0);
    await captureResponsive(page, 'notification-thread-target');
    expect(world.coreCalls().filter((call) => call.operation === 'dispatch.create')).toHaveLength(
      0,
    );
    await page.reload();
    await expect(page.locator('.status.live')).toBeVisible();
    await expect(card).toHaveCount(0);
    await (await pageAction(page, 'Comments')).click();
    const panel = commentsRegion(page);
    await expect(panel).toBeVisible();
    await selectDiscussion(page, 'Canonical quote.');
    await expect(original.getByTestId('comment-entry')).toHaveCount(2);
  });
});

test('own admitted Answer follow-up reveals and focuses its block across the served Remote boundary', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('block-notification-agent', { gated: true });
    const author = await pairBrowser(world, 'block-notification-author', { talk: true });
    const viewer = await pairBrowser(world, 'block-notification-viewer');
    const qid = '10000000-0000-4000-8000-000000000090';
    const created = createPage(
      world,
      'Answer notifications',
      `<div style="height:1100px">Context above the block.</div><tmt-question data-id="${qid}" data-kind="short" data-agent="${agent.name}"><p data-question>What should we do next?</p></tmt-question><div style="height:1000px">Context below the block.</div>`,
      agent.pane,
      [{ id: qid, agent: agent.id }],
    );
    const page = await openPage(door, author, created);
    const other = await openPage(door, viewer, created);
    await expect(other.locator('.status.live')).toBeVisible();
    const block = page.locator('.question-card');
    await expect(block).toHaveCount(1);
    const row = page.locator('.question-line');
    await expect(block.getByLabel('Your answer', { exact: true })).toBeVisible();
    await block.getByLabel('Your answer', { exact: true }).fill('Follow this direction.');
    const send = page
      .locator('[data-question-group]')
      .getByRole('button', { name: /^Send answer/ });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(row).toHaveAttribute('data-state', 'answered');
    await expect(row.locator('.question-line-answer')).toHaveText('Follow this direction.');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(
      page
        .locator('[data-question-group]')
        .getByRole('button', { name: 'Change answer', exact: true }),
    ).toBeEnabled();
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await until(() => agent.received().length === 1, 'one admitted block follow-up Ask');
    await page.evaluate(() => window.scrollTo(0, 0));
    const detached = await block.evaluate((node) => !!node.closest('[data-detached]'));
    if (detached) {
      await expect(block).toBeHidden();
      await expect(page.locator('iframe[data-scroll-mode="frame"]')).toBeVisible();
    } else {
      const placement = page.locator('.question-compact-block');
      await expect(placement).toBeVisible();
      await expect
        .poll(() => placement.evaluate((node) => node.getBoundingClientRect().top))
        .toBeGreaterThan(900);
    }
    const requestId = agent.received()[0].requestId as string;
    writeFileSync(path.join(agent.gate, `${requestId}.release`), '');
    await until(
      () => agent.rows().some((row) => row.event === 'replied'),
      'durable block follow-up reply',
    );
    const reply = agent.rows().find((row) => row.event === 'replied')!.body as string;
    const card = page.locator('.tmt-ui-notification');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(reply);
    await expect(other.locator('.tmt-ui-notification')).toHaveCount(0);
    await expect(page.locator('.reply-announcement')).toHaveCount(0);
    await captureResponsive(page, 'notification-answer-queue');
    await card.getByRole('button', { name: 'Open Answer', exact: true }).click();
    const target = block;
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('data-arrived', '');
    await expect(target).toContainText(reply);
    await expect
      .poll(() => target.evaluate((node) => node.getBoundingClientRect().top))
      .toBeGreaterThanOrEqual(48);
    await expect
      .poll(() => target.evaluate((node) => node.getBoundingClientRect().top))
      .toBeLessThan(900);
    await captureResponsive(page, 'notification-answer-target');
    await page.keyboard.press('Tab');
    await expect(target).not.toHaveAttribute('data-arrived', '');
    await page.reload();
    await expect(page.locator('.status.live')).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(agent.received()).toHaveLength(1);
    expect(world.coreCalls().filter((call) => call.operation === 'dispatch.create')).toHaveLength(
      1,
    );
  });
});

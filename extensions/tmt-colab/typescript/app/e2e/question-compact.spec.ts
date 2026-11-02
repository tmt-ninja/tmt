import { expect, test, type Page } from '@playwright/test';
import { rgb, tokens } from './tokens.js';
import { expectAnswered } from './question-line.js';

const fixture = '/test/ask-page-browser.tsx';
async function run(page: Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
async function mount(page: Page, options = {}, session = {}) {
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' }),
  );
  await page.goto('/');
  await run(page, 'mount', session);
  await run(page, 'questionGroup', options);
  const rows = page.locator('.question-line');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toBeVisible();
  await expect(rows.nth(1)).toBeVisible();
  return rows;
}

test('grouped waiting questions preserve drafts and keep one explicit batched Send', async ({
  page,
}) => {
  const rows = await mount(page);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByLabel('Change it', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your answer', { exact: true })).toBeVisible();
  await rows.first().click();
  await page.getByLabel('Change it', { exact: true }).check();
  await rows.nth(1).click();
  await page.getByLabel('Your answer', { exact: true }).fill('Keep this introduction draft.');
  expect(await run(page, 'discussionProof')).toHaveLength(0);
  const send = page.getByRole('button', { name: 'Send 2 answers · to @Agent 1', exact: true });
  await send.click();
  await expectAnswered(rows.first(), 'Change it');
  await expectAnswered(rows.nth(1), 'Keep this introduction draft.');
  await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'false');
  const threads = await run(page, 'discussionProof');
  expect(threads).toHaveLength(2);
  expect(threads.every((thread: { comments: unknown[] }) => thread.comments.length === 1)).toBe(
    true,
  );
  await expect.poll(async () => (await run(page, 'proof')).sends.length).toBe(1);
  const attempts = await run(page, 'answerBatchProof');
  expect(attempts).toHaveLength(1);
  expect(attempts[0].selection.messageIds).toHaveLength(2);
});

test('split Send publishes only its own question and keeps another passage draft', async ({
  page,
}) => {
  const rows = await mount(page, { split: true });
  await expect(page.locator('.question-compact-heading')).toHaveCount(0);
  await rows.first().click();
  await page.getByLabel('Change it', { exact: true }).check();
  await rows.nth(1).click();
  await page.getByLabel('Your answer', { exact: true }).fill('Only this passage is sent.');
  await page.getByRole('button', { name: 'Send answer · to @Agent 1', exact: true }).click();
  await expectAnswered(rows.nth(1), 'Only this passage is sent.');
  await expect(rows.first()).toContainText('Waiting for your answer');
  const threads = await run(page, 'discussionProof');
  expect(threads).toHaveLength(1);
  expect(threads[0].anchor.exact).toBe('What should the introduction say?');
  expect(threads[0].comments[0].body).not.toContain('Change it');
  await expect.poll(async () => (await run(page, 'proof')).sends.length).toBe(1);
  await rows.first().click();
  await expect(page.getByLabel('Change it', { exact: true })).toBeChecked();
  expect(await run(page, 'discussionProof')).toHaveLength(1);
});

test('keyboard choice and text entry preserve local drafts without publishing', async ({
  page,
}) => {
  await mount(page);
  const choice = page.getByLabel('Change it', { exact: true });
  await choice.focus();
  await choice.press('Space');
  const input = page.getByLabel('Your answer', { exact: true });
  await input.fill('Still a local draft.');
  await expect(choice).toBeChecked();
  await expect(input).toHaveValue('Still a local draft.');
  expect(await run(page, 'discussionProof')).toHaveLength(0);
  expect((await run(page, 'proof')).sends).toHaveLength(0);
});

test('split question recipients stay local to their own block', async ({ page }) => {
  const rows = await mount(page, { split: true, agents: ['Agent 1', 'Agent 2'] });
  await rows.first().click();
  await expect(page.getByRole('button', { name: 'Remove @Agent 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove @Agent 2', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove @Agent 1', exact: true }).click();
  await page.getByLabel('Keep it', { exact: true }).check();
  await rows.nth(1).click();
  await expect(page.getByRole('button', { name: 'Remove @Agent 2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove @Agent 1', exact: true })).toHaveCount(0);
  await page.getByLabel('Your answer', { exact: true }).fill('Ask only Agent 2.');
  await page.getByRole('button', { name: 'Send answer · to @Agent 2', exact: true }).click();
  await expectAnswered(rows.nth(1), 'Ask only Agent 2.');
  await expect.poll(async () => (await run(page, 'proof')).sends.length).toBe(1);
  const attempts = await run(page, 'answerBatchProof');
  expect(attempts[0].selection.comment).toContain('@Agent 2');
  expect(attempts[0].selection.comment).not.toContain('@Agent 1');
  await rows.first().click();
  await expect(page.getByLabel('Keep it', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Remove @Agent 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send answer · to thread only', exact: true }).click();
  await expectAnswered(rows.first(), 'Keep it');
  expect(await run(page, 'discussionProof')).toHaveLength(2);
  expect((await run(page, 'proof')).sends).toHaveLength(1);
});

test('a split question cannot bypass the recipient read by pressing Enter', async ({ page }) => {
  const rows = await mount(page, { split: true }, { holdQuestionDirectory: true });
  await rows.nth(1).click();
  const answer = page.getByLabel('Your answer', { exact: true });
  await answer.fill('Keep the directory admission fence.');
  await answer.press('Enter');
  await expect(page.getByRole('button', { name: /^Send answer/ })).toBeDisabled();
  expect(await run(page, 'discussionProof')).toHaveLength(0);
  expect((await run(page, 'proof')).sends).toHaveLength(0);
  await run(page, 'finishQuestionDirectory');
  await expect(
    page.getByRole('button', { name: 'Send answer · to @Agent 1', exact: true }),
  ).toBeEnabled();
  await answer.press('Enter');
  await expectAnswered(rows.nth(1), 'Keep the directory admission fence.');
  await expect(rows.first()).toContainText('Waiting for your answer');
  expect(await run(page, 'discussionProof')).toHaveLength(1);
  await expect.poll(async () => (await run(page, 'proof')).sends.length).toBe(1);
});

for (const width of [1440, 390]) {
  test(`compact rows stay flat and legible at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const rows = await mount(page, { darkPage: true });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const row = rows.first();
    // The block is the page sheet (dark here) with a light rule, whatever the page paints.
    await expect(page.locator('.question-group-row').first()).toHaveCSS(
      'background-color',
      rgb(tokens.browser.surface.sheet.dark),
    );
    await expect(page.locator('.question-group-row').first()).toHaveCSS(
      'border-top-color',
      rgb(tokens.browser.surface.rule.dark),
    );
    await expect(row.locator('.question-line-title')).toBeVisible();
    await expect(
      page
        .getByLabel('One column', { exact: true })
        .or(page.getByLabel('Keep it', { exact: true })),
    ).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(row).toHaveCSS('color', rgb(tokens.browser.color.text.dark));
    await page.getByRole('button', { name: 'Needs you: 2', exact: true }).click();
    await expect(page.getByRole('menu').locator('.needs-you-header-row')).toHaveCount(2);
    const menuRow = page.getByRole('menu').locator('.needs-you-header-row').first();
    const agent = menuRow.locator('.agent-chip-name');
    await expect(agent).toHaveText('Agent 1');
    await expect(agent).toHaveCSS('white-space', 'nowrap');
    // Long attribution ellipsizes on one row instead of wrapping and clipping its first letter.
    await agent.evaluate((node) => {
      node.textContent = 'Agent with a deliberately long display name';
    });
    expect(
      await menuRow.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node.querySelector('.agent-chip-name')!);
        const rects = [...range.getClientRects()];
        return rects.length > 0 && rects.every((rect) => Math.abs(rect.y - rects[0].y) < 1);
      }),
    ).toBe(true);
    await expect(menuRow.locator('.needs-you-header-agent')).toHaveCSS('text-overflow', 'ellipsis');
    expect(await run(page, 'discussionProof')).toHaveLength(0);
    expect((await run(page, 'proof')).sends).toHaveLength(0);
  });

  test(`compact stacks reserve their full trusted height at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/src/main.tsx', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: '' }),
    );
    await page.goto('/');
    await run(page, 'mount');
    await run(page, 'questionGroup', { count: 6 });
    const block = page.locator('.question-compact-block');
    const rows = block.locator('.question-line');
    await expect(rows).toHaveCount(6);
    const after = page.frameLocator('#ask-page-fixture iframe').locator('#after-question');
    const assertSpace = async () => {
      await expect
        .poll(
          async () => {
            const trusted = await block.boundingBox();
            const prose = await after.boundingBox();
            return !!trusted && !!prose && prose.y >= trusted.y + trusted.height - 1;
          },
          { message: 'authored prose must follow the complete trusted stack, not a capped chip' },
        )
        .toBe(true);
    };
    expect((await block.boundingBox())!.height).toBeGreaterThan(200);
    await assertSpace();
    await rows.nth(2).click();
    await page
      .locator('.question-group-row')
      .nth(2)
      .getByLabel('Your answer', { exact: true })
      .fill('Retain this expanded passage.');
    await assertSpace();
    await rows.nth(2).click();
    await assertSpace();
    expect(await run(page, 'discussionProof')).toHaveLength(0);
    expect((await run(page, 'proof')).sends).toHaveLength(0);
  });
}

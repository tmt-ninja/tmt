import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('removes only the admitted question while preserving all other source bytes', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/question-source.ts';
    const { removeQuestion } = await import(modulePath);
    const before = `<!-- <tmt-question data-id="q">fake</tmt-question> -->\n<script>const s = '<tmt-question data-id="q">fake</tmt-question>';</script>\n<tmt-question data-id='q'><p data-title>Title &amp; more</p></tmt-question>\n<p>After</p>`;
    return { before, after: removeQuestion(before, 'q') };
  });
  expect(result.after).toBe(
    result.before.replace(
      "<tmt-question data-id='q'><p data-title>Title &amp; more</p></tmt-question>",
      '',
    ),
  );
});

const fixture = '/test/ask-page-browser.tsx';
async function run(page: import('@playwright/test').Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
async function answered(page: import('@playwright/test').Page) {
  await page.goto('/');
  await run(page, 'mount', { dismissQuestions: true });
  await run(page, 'question', {});
  const card = page.locator('.question-group-card');
  await card.getByLabel('Keep it', { exact: true }).check();
  await card.getByRole('button', { name: /^Send answer/ }).click();
  await card.locator('.answered-strip').click();
  return card;
}

test('the one-line follow-up keeps its recipient and accepts typing', async ({ page }) => {
  const card = await answered(page);
  const editor = card.locator('.message-composer-field');
  await card.getByRole('button', { name: 'Follow up', exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.press('End');
  await page.keyboard.type('Please clarify');
  await expect(editor).toContainText('Please clarify');
  await expect(editor.locator('.agent-chip')).toContainText('Agent 1');
});

test('dismisses through page edit and handle, then Undo restores and reopens', async ({ page }) => {
  const card = await answered(page);
  await card.getByRole('button', { name: 'Remove from page' }).click();
  await expect(page.getByText('Removed from page', { exact: true })).toBeVisible();
  let proof = await run(page, 'questionDismissProof');
  expect(proof.source).not.toContain('<tmt-question data-id=');
  expect(proof.questions[0].state).toBe('handled');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Restored to page', { exact: true })).toBeVisible();
  proof = await run(page, 'questionDismissProof');
  expect(proof.source).toContain('<tmt-question data-id=');
  expect(proof.questions[0].state).toBe('open');
  expect(proof.actions).toEqual(['question.handle', 'question.reopen']);
});

test('success notices expire, while a failed handle retains Retry', async ({ page }) => {
  await page.clock.install();
  let card = await answered(page);
  await card.getByRole('button', { name: 'Remove from page' }).click();
  const notice = page.locator('.question-dismiss-notice');
  await expect(notice.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.clock.fastForward(6001);
  await expect(notice).toHaveCount(0);

  card = await answered(page);
  await card.getByRole('button', { name: 'Remove from page' }).click();
  await notice.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(notice).toContainText('Restored to page');
  await page.clock.fastForward(6001);
  await expect(notice).toHaveCount(0);

  card = await answered(page);
  await run(page, 'failQuestionActionOnce', 'question.handle');
  await card.getByRole('button', { name: 'Remove from page' }).click();
  await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.clock.fastForward(12000);
  await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

test('keeps removal when handle fails and retries only handle', async ({ page }) => {
  const card = await answered(page);
  await run(page, 'failQuestionActionOnce', 'question.handle');
  await card.getByRole('button', { name: 'Remove from page' }).click();
  await expect(page.getByText('Removed from page, but could not mark handled.')).toBeVisible();
  expect((await run(page, 'questionDismissProof')).source).not.toContain('<tmt-question data-id=');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect((await run(page, 'questionDismissProof')).actions).toEqual(['question.handle']);
});

test('keeps restoration when reopen fails and retries only reopen', async ({ page }) => {
  const card = await answered(page);
  await card.getByRole('button', { name: 'Remove from page' }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await run(page, 'failQuestionActionOnce', 'question.reopen');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Restored to page, but could not reopen.')).toBeVisible();
  expect((await run(page, 'questionDismissProof')).source).toContain('<tmt-question data-id=');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect((await run(page, 'questionDismissProof')).actions).toEqual([
    'question.handle',
    'question.reopen',
  ]);
});

test('a question group shows all unanswered fields and folds each answer to its own strip', async ({
  page,
}) => {
  await page.goto('/');
  await run(page, 'mount', {});
  await run(page, 'questionGroup', { count: 2 });
  const group = page.locator('[data-question-group]').first();
  await group.getByLabel('Keep it', { exact: true }).check();
  await group.getByLabel('Your answer', { exact: true }).fill('A clear introduction');
  await group.getByRole('button', { name: /^Send 2 answers/ }).click();
  await expect(group.locator('.answered-strip')).toHaveCount(2);
  for (const row of await group.locator('.question-group-row').all())
    await expect(row).toHaveCSS('height', '32px');
});

test('a partial group answer leaves the other questions together with one Send footer', async ({
  page,
}) => {
  await page.goto('/');
  await run(page, 'mount', {});
  await run(page, 'questionGroup', { count: 3 });
  const group = page.locator('[data-question-group]').first();
  await group.getByLabel('Your answer', { exact: true }).first().fill('The middle answer');
  await group.getByRole('button', { name: /^Send 1 answer/ }).click();
  await expect(group.locator('.answered-strip')).toHaveCount(1);
  await expect(group.locator('.question-group-row').first()).toHaveAttribute(
    'data-answered',
    'true',
  );
  await expect(group.locator('.question-group-row:not([data-answered])')).toHaveCount(2);
  await expect(group.getByRole('button', { name: /^Send/ })).toHaveCount(1);
});

for (const width of [390, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`question redesign captures ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await run(page, 'mount', { dismissQuestions: true });
      await run(page, 'question', {});
      const card = page.locator('.question-group-card');
      await expect(card.getByLabel('Keep it', { exact: true })).toBeVisible();
      const folder = process.env.COLAB_CAPTURE_DIR ?? info.outputDir;
      mkdirSync(folder, { recursive: true });
      const capture = (state: string) =>
        page.screenshot({ path: `${folder}/question-${state}-${width}-${theme}.png` });
      await capture('waiting');
      await card.getByLabel('Keep it', { exact: true }).check();
      await card.getByRole('button', { name: /^Send answer/ }).click();
      const strip = card.locator('.answered-strip');
      await expect(strip).toHaveAttribute('aria-expanded', 'false');
      await capture('answered');
      await strip.click();
      await expect(card.getByRole('button', { name: 'Remove from page' })).toBeVisible();
      const header = card.locator('.answered-strip-row');
      const entry = card.getByTestId('comment-entry');
      await expect(entry).toHaveCount(1);
      expect((await entry.boundingBox())!.height).toBeLessThan(90);
      const editor = card.locator('.message-composer-field');
      await expect(editor).toBeVisible();
      const editorBox = (await editor.boundingBox())!;
      expect(editorBox.height).toBeLessThan(45);
      const recipient = editor.locator('.agent-chip-name');
      await expect(recipient).toHaveText('@Agent 1');
      expect(await recipient.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      );
      const replySend = (await card.locator('.message-toolbar-end button').last().boundingBox())!;
      expect(
        Math.abs(editorBox.y + editorBox.height / 2 - (replySend.y + replySend.height / 2)),
      ).toBeLessThan(8);
      await expect(card.locator('.annotation-notice-slot:empty')).toBeHidden();
      const actions = await header.locator('.tmt-ui-icon-action-control').all();
      let previousRight = 0;
      for (const action of actions) {
        const box = (await action.boundingBox())!;
        expect(box.width).toBe(24);
        expect(box.height).toBe(24);
        if (previousRight) expect(box.x - previousRight).toBeGreaterThanOrEqual(2);
        previousRight = box.x + box.width;
      }
      await capture('expanded');
      await card.getByRole('button', { name: 'Remove from page' }).click();
      const undo = page.getByRole('button', { name: 'Undo', exact: true });
      await expect(undo).toBeVisible();
      const box = (await undo.boundingBox())!;
      const dock = (await page.locator('#ask-page-fixture .page-floating-actions').boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
      await capture('dismissed');
    });
  }
}

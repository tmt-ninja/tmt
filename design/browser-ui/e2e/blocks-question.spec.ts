import { expect, test } from '@playwright/test';

test('a choice question requires text for Other and sends the selected answer', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountQuestion();
  });
  const question = page.getByRole('group', { name: 'Which screen first?' });
  await question.getByLabel('Other…').check();
  const field = question.getByRole('textbox', { name: 'Other: your answer' });
  await expect(field).toBeFocused();
  await expect(question.getByRole('button', { name: 'Send' })).toBeDisabled();
  await field.fill('Start with the phone');
  await field.press('Control+Enter');
  await expect(page.locator('[data-answer]')).toHaveText(
    '{"choices":[],"other":"Start with the phone"}',
  );
  await question.getByLabel('Insert menu').check();
  await expect(field).toHaveCount(0);
  await question.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-answer]')).toHaveText('{"choices":["Insert menu"]}');
});

test('multiple choice keeps other selections when Other is cleared', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountQuestion('multiple');
  });
  const question = page.getByRole('group', { name: 'Which screen first?' });
  await question.getByLabel('Insert menu').check();
  await question.getByLabel('Other…').check();
  const field = question.getByRole('textbox', { name: 'Other: your answer' });
  await field.fill('Additional idea');
  await field.fill('');
  await expect(question.getByLabel('Other…')).not.toBeChecked();
  await expect(question.getByLabel('Other…')).toBeFocused();
  await expect(question.getByLabel('Insert menu')).toBeChecked();
  await question.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-answer]')).toHaveText('{"choices":["Insert menu"]}');
});

test('a short answer is bounded by characters and sends with a keyboard shortcut', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountQuestion('short');
  });
  const question = page.getByRole('group', { name: 'Which screen first?' });
  const field = question.getByRole('textbox', { name: 'Your answer' });
  await field.fill('🟢'.repeat(205));
  await expect(field).toHaveValue('🟢'.repeat(200));
  await field.press('Control+Enter');
  await expect(page.locator('[data-answer]')).toHaveText(
    JSON.stringify({ choices: [], text: '🟢'.repeat(200) }),
  );
});

test('an answered question expands and collapses with the answer retained', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountAnsweredQuestion();
  });
  const strip = page.getByRole('button', { name: /Which screen first.*Insert menu/ });
  await expect(strip).toHaveAttribute('aria-expanded', 'false');
  await strip.click();
  await expect(strip).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Follow up' })).toBeVisible();
  await strip.click();
  await expect(strip).toHaveAttribute('aria-expanded', 'false');
});

test('number shortcuts select choices and focus Other', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const fixture = '/blocks-harness.tsx';
    (await import(fixture)).mountQuestion();
  });
  const question = page.getByRole('group', { name: 'Which screen first?' });
  const first = question.getByLabel('Insert menu');
  await first.focus();
  await first.press('2');
  await expect(question.getByLabel('Block handle')).toBeChecked();
  await first.press('3');
  await expect(question.getByRole('textbox', { name: 'Other: your answer' })).toBeFocused();
  await expect(question.getByLabel('Block handle')).not.toBeChecked();
});

import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderForm } from '../src/forms.js';
import { buildOpsHarness, serveOpsHarness, type OpsHarness } from './ops-harness-page.js';

// Provider forms in web Ops (#6445): what a member's DM shows, and how an answer is kept and recovered.
const origin = 'https://ops-forms.test';
// Captures show the forms area's own scrollbar, as a person's browser draws it.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
const member = '00000000-0000-4000-8000-000000000002';
let built: OpsHarness | undefined;
test.beforeAll(async () => {
  built = await buildOpsHarness();
});
test.afterAll(async () => {
  await built?.dispose();
});

const long =
  'Move the release checklist into the shared runbook so every squad reads the same steps, and keep the old page as a pointer until the next release has shipped from it without questions';
const forms: ProviderForm[] = [
  {
    formId: 'form-question',
    identityId: member,
    openedMs: 0,
    kind: 'question',
    questions: [
      {
        header: 'Release',
        text: 'Where should the release checklist live?',
        choice: 'single',
        options: [
          { label: 'Shared runbook', description: long },
          { label: 'Each squad keeps its own' },
        ],
        freeText: true,
      },
    ],
    truncated: false,
    answerable: true,
    answerIn: 'client',
  },
  {
    formId: 'form-plan',
    identityId: member,
    openedMs: 0,
    kind: 'planApproval',
    plan: `## Plan\n\n1. ${long}.\n2. ${'A_very_long_unbroken_identifier_'.repeat(6)}\n${Array.from({ length: 30 }, (_, i) => `- step ${i + 1}`).join('\n')}`,
    truncated: false,
    answerable: true,
    answerIn: 'client',
  },
  {
    formId: 'form-permission',
    identityId: member,
    openedMs: 0,
    kind: 'permission',
    tool: { name: 'Bash', summary: 'pnpm --filter @tmt/remote-client test' },
    truncated: false,
    answerable: false,
    answerIn: 'terminal',
  },
  {
    formId: 'form-truncated',
    identityId: member,
    openedMs: 0,
    kind: 'question',
    questions: [
      {
        text: 'Which of these checks should run first?',
        choice: 'multiple',
        options: [{ label: 'Unit' }, { label: 'Browser' }],
        freeText: false,
      },
    ],
    truncated: true,
    answerable: false,
    answerIn: 'terminal',
  },
];

async function open(page: Page, width: number, theme: string) {
  await serveOpsHarness(page, built!, origin, width, theme);
  await page.goto(`${origin}/ops/#dm/${member}/sample`);
  await expect(page.locator('.ops-channel-name')).toHaveText('sample-1');
}
/** Core's cursor moves with the forms; the page reads the list on its next visible tick. */
async function show(page: Page, list: ProviderForm[]) {
  await page.evaluate((list) => {
    const now = Date.now();
    window.formsList = list.map((form) => ({ ...form, openedMs: now - 3 * 60_000 }));
    window.formsCursor++;
  }, list);
  await page.clock.runFor(5001);
}
const card = (page: Page, id: string) => page.locator(`.ops-form[data-form-id="${id}"]`);

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'])
    test(`a member's forms read whole and stay inside the column at ${width} ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await open(page, width, theme);
      await show(page, forms);
      await expect(page.locator('.ops-channel-chips')).toContainText('4 forms waiting');
      const root =
        process.env.TMT_OPS_FORMS_CAPTURE_DIR ?? join('test-results', 'ops-forms-captures');
      await mkdir(root, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(root, `dm-${width}-${theme}.png`) });
      await expect(card(page, 'form-question')).toContainText(
        'Where should the release checklist live?',
      );
      await expect(card(page, 'form-question').getByRole('radio')).toHaveCount(2);
      // The oldest form is open; the rest are one line each and open on a click.
      for (const id of ['form-plan', 'form-permission', 'form-truncated']) {
        await expect(card(page, id)).toHaveAttribute('data-folded', '');
        await card(page, id).getByRole('button', { expanded: false }).click();
        await expect(card(page, id)).not.toHaveAttribute('data-folded', '');
      }
      // A permission form is a terminal action: never an allow or deny control.
      await expect(card(page, 'form-permission').getByRole('button')).toHaveCount(0);
      await expect(card(page, 'form-permission')).toContainText(
        'Answer this in the terminal where sample-1 runs.',
      );
      // A form the board did not see whole is never answered from it.
      await expect(card(page, 'form-truncated').locator('input, button')).toHaveCount(0);
      await expect(card(page, 'form-truncated')).toContainText(
        'Only part of this form is shown here.',
      );
      // Every card can be scrolled into view; none is clipped away.
      for (const id of ['form-question', 'form-plan', 'form-permission', 'form-truncated']) {
        await card(page, id).scrollIntoViewIfNeeded();
        await expect(card(page, id)).toBeInViewport();
      }
      await page
        .locator('.ops-forms-open')
        .evaluate((host) => (host.scrollTop = host.scrollHeight));
      await page.screenshot({ path: join(root, `dm-end-${width}-${theme}.png`) });
      await page.locator('.ops-forms-open').evaluate((host) => (host.scrollTop = 0));
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - innerWidth,
        cards: [...document.querySelectorAll('.ops-form')].map(
          (node) => node.getBoundingClientRect().right - innerWidth,
        ),
      }));
      expect(overflow.page).toBeLessThanOrEqual(0);
      for (const right of overflow.cards) expect(right).toBeLessThanOrEqual(0);
      await page.screenshot({ path: join(root, `dm-open-${width}-${theme}.png`) });
      for (const id of ['form-question', 'form-plan', 'form-permission', 'form-truncated'])
        await card(page, id).screenshot({ path: join(root, `${id}-${width}-${theme}.png`) });
      await page.evaluate(() => (location.hash = '#channel/sample'));
      await expect(page.locator('.ops-member-row', { hasText: 'sample-1' })).toContainText(
        '4 forms waiting',
      );
      await page.screenshot({ path: join(root, `channel-${width}-${theme}.png`) });
      expect(errors).toEqual([]);
    });

test('an answer is kept before it is sent and recovered only by its own ID', async ({ page }) => {
  await open(page, 1440, 'light');
  await show(page, [forms[0]!]);
  const question = card(page, 'form-question');
  const send = question.getByRole('button', { name: 'Send answer' });
  await expect(send).toBeDisabled();
  await question.getByRole('radio', { name: /Shared runbook/ }).check();
  await page.evaluate(() => (window.formsOutcome = 'hold'));
  await send.click();
  // In flight: nothing can send a second time.
  await expect(question).toContainText('Sending…');
  await expect(question.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  await expect(question.getByRole('radio').first()).toBeDisabled();
  await page.evaluate(() => {
    window.formsOutcome = 'lost';
    window.formsRelease();
  });
  await expect(question).toContainText('Not sure it arrived.');
  const [sent] = await page.evaluate(() => window.formsAnswers);
  expect(sent!.answer).toEqual({ choices: [[0]] });
  expect(JSON.parse(sent!.storedFirst!)).toMatchObject({
    operationId: sent!.operationId,
    answer: { choices: [[0]] },
  });
  await expect(question.getByRole('button', { name: 'Send answer' })).toBeDisabled();
  // The form closes while the outcome is unknown: the answer stays until its own ID settles.
  await show(page, []);
  const left = page.locator('.ops-form[aria-label="Answered form"]');
  await expect(left).toContainText('Not sure it arrived.');
  await page.evaluate(() => (window.formsOutcome = 'uncertain'));
  await page.reload();
  await expect(left).toContainText('Not sure it arrived.');
  await page.evaluate(() => (window.formsOutcome = 'accepted'));
  await left.getByRole('button', { name: 'Check again' }).click();
  await expect(left).toHaveCount(0);
  const checks = await page.evaluate(() => window.formsChecks);
  expect(checks.length).toBeGreaterThanOrEqual(2);
  expect(new Set(checks)).toEqual(new Set([sent!.operationId]));
  expect(await page.evaluate(() => window.formsAnswers.length)).toBe(0);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('tmt-ops-form-answer:')),
    ),
  ).toEqual([]);
});

test('a refused browser answer points to the terminal and offers no second send', async ({
  page,
}) => {
  await open(page, 1440, 'light');
  await show(page, [forms[1]!]);
  const plan = card(page, 'form-plan');
  await page.evaluate(() => (window.formsOutcome = 'unsupported'));
  await plan.getByRole('button', { name: 'Approve' }).click();
  await expect(plan).toContainText("can't be answered from the browser yet");
  await expect(plan.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(plan.getByRole('button', { name: 'Keep planning' })).toBeDisabled();
  expect(await page.evaluate(() => window.formsAnswers.map((sent) => sent.answer))).toEqual([
    { decision: 'allow' },
  ]);
});

test('forms that cannot be read say so instead of looking empty', async ({ page }) => {
  await open(page, 1440, 'light');
  await show(page, [forms[2]!]);
  await expect(card(page, 'form-permission')).toBeVisible();
  await page.evaluate(() => (window.formsFail = true));
  await page.clock.runFor(5001);
  await expect(page.locator('.ops-forms')).toContainText('Provider forms unavailable.');
  await expect(card(page, 'form-permission')).toHaveCount(0);
  await page.evaluate(() => (location.hash = '#channel/sample'));
  await expect(page.locator('.ops-channel-summary')).toContainText('Forms unavailable');
});

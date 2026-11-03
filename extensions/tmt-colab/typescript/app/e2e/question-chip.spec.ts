import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { captureDirectory } from './captures.js';
import { expectAnswered } from './question-line.js';

const fixture = '/test/ask-page-browser.tsx';
async function run(page: Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
async function mount(page: Page, options = {}) {
  await page.goto('/');
  await run(page, 'mount');
  await run(page, 'chipPage', options);
  const rows = page.locator('.question-line');
  await expect(rows.first()).toBeVisible();
  return rows;
}
const panel = (page: Page) => page.locator('[data-question-group]');
const frame = (page: Page) => page.frameLocator('#ask-page-fixture iframe');

/** The compact block starts at the existing after spacer in the authored column. */
async function settled(page: Page) {
  await expect
    .poll(async () => {
      const block = await page.locator('.question-compact-block').boundingBox();
      const spacer = await frame(page).locator('[data-colab-block-slot]').boundingBox();
      return !!block && !!spacer && Math.abs(block.y - spacer.y) <= 1;
    })
    .toBe(true);
  await expect(page.getByText('waiting for the verified view')).toHaveCount(0);
}

test('chip-form markup presents all waiting questions and reserves their measured height', async ({
  page,
}) => {
  const rows = await mount(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Which list version?');
  await expect(panel(page).getByLabel('One column', { exact: true })).toBeVisible();
  await expect(panel(page).getByLabel('Your answer', { exact: true })).toBeVisible();
  await settled(page);
  const block = await page.locator('.question-compact-block').boundingBox();
  const after = await frame(page).locator('#after-question').boundingBox();
  expect(after!.y).toBeGreaterThanOrEqual(block!.y + block!.height - 1);
});

test('recipient popup Escape preserves the visible answer draft', async ({ page }) => {
  await mount(page);
  await panel(page).getByLabel('Side categories', { exact: true }).check();
  await panel(page).getByRole('button', { name: 'Add recipient', exact: true }).click();
  const search = page.getByRole('combobox', { name: 'Find an agent' });
  await expect(search).toBeVisible();
  await search.press('Escape');
  await expect(search).toBeHidden();
  await expect(panel(page).getByLabel('Side categories', { exact: true })).toBeChecked();
});

test('verified answers fold independently and remain openable after reload', async ({ page }) => {
  await mount(page);
  await panel(page).getByLabel('Side categories', { exact: true }).check();
  await panel(page).getByLabel('Your answer', { exact: true }).fill('Fade them');
  await panel(page)
    .getByRole('button', { name: /^Send 2 answers/ })
    .press('Enter');
  const rows = page.locator('.answered-strip');
  await expectAnswered(rows.first(), 'Side categories');
  await expectAnswered(rows.nth(1), 'Fade them');
  await expect.poll(async () => (await run(page, 'discussionProof')).length).toBe(2);
  await run(page, 'saveQuestionPage');
  await page.reload();
  await run(page, 'mount');
  await run(page, 'restoreQuestionPage');
  const restored = page.locator('.answered-strip');
  await expectAnswered(restored.first(), 'Side categories');
  await expectAnswered(restored.nth(1), 'Fade them');
  await restored.first().click();
  await expect(panel(page).getByRole('button', { name: 'Change answer' })).toBeVisible();
  await expect(panel(page).locator('.question-answer > p').first()).toHaveText('Side categories');
  expect((await run(page, 'proof')).sends).toHaveLength(0);
});

test('a standalone chip-form question presents its waiting card', async ({ page }) => {
  const rows = await mount(page, { count: 1 });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Which list version?');
  await expect(panel(page).getByLabel('One column', { exact: true })).toBeVisible();
});

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`details question slots ${width} ${theme}: hide, reopen and retain drafts`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const directory = `${captureDirectory()}/question-details`;
      mkdirSync(directory, { recursive: true });
      for (const count of [1, 2] as const) {
        await page.goto('/');
        await run(page, 'mount');
        await run(page, 'detailsQuestions', { count, darkPage: theme === 'dark' });
        const outer = frame(page).locator('#outer');
        const inner = frame(page).locator('#inner');
        const rows = page.locator('.question-line');
        const slot = page.locator('.question-compact-inline').first();
        await expect(rows).toHaveCount(count);
        const hidden = async () => {
          await expect(slot).toHaveCSS('display', 'none');
          await expect(rows.first()).toBeHidden();
          // Explicit focus attempts must fail as well as ordinary Tab navigation.
          expect(
            await rows.first().evaluate((node) => {
              (node as HTMLElement).focus();
              return document.activeElement === node;
            }),
          ).toBe(false);
        };
        await hidden();
        const capture = async (state: string) => {
          const name = `${state}-${count}-${width}-${theme}.png`;
          const body = await page.screenshot({ path: `${directory}/${name}` });
          await test.info().attach(name, { body, contentType: 'image/png' });
        };
        await capture('closed');
        await outer.locator(':scope > summary').click();
        await expect(rows.first()).toBeVisible();
        await settled(page);
        const answer =
          count === 1
            ? panel(page).getByLabel('Side categories', { exact: true })
            : panel(page).getByLabel('Your answer', { exact: true });
        if (count === 1) await answer.check();
        else await answer.fill('Keep this unsent draft');
        await expect
          .poll(async () => {
            const block = await page.locator('.question-compact-block').boundingBox();
            const before = await frame(page).locator('#host-text').boundingBox();
            const after = await frame(page).locator('#inside-after').boundingBox();
            return (
              !!block &&
              !!before &&
              !!after &&
              block.y >= before.y &&
              after.y >= block.y + block.height - 1
            );
          })
          .toBe(true);
        await capture('open');
        // Close the inner disclosure while the outer remains open, then hide both.
        await inner.locator(':scope > summary').click();
        await hidden();
        await outer.locator(':scope > summary').click();
        await outer.locator(':scope > summary').click();
        await hidden();
        await inner.locator(':scope > summary').click();
        await expect(rows.last()).toBeVisible();
        if (count === 1) await expect(answer).toBeChecked();
        else await expect(answer).toHaveValue('Keep this unsent draft');
        await settled(page);
        // Programmatic open changes must also invalidate cached visible geometry.
        await outer.evaluate((node) => {
          (node as HTMLDetailsElement).open = false;
        });
        await hidden();
        await outer.evaluate((node) => {
          (node as HTMLDetailsElement).open = true;
        });
        await expect(answer).toBeVisible();
        if (count === 1) await expect(answer).toBeChecked();
        else await expect(answer).toHaveValue('Keep this unsent draft');
        expect(await run(page, 'discussionProof')).toHaveLength(0);
        expect((await run(page, 'proof')).sends).toHaveLength(0);
      }
    });

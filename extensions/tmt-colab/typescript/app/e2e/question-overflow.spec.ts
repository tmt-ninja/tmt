import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
const fixture = '/test/ask-page-browser.tsx';
async function run(page: Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
for (const width of [390, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`question blocks reflow without overlap at ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await run(page, 'mount', {});
      // No data-group: Ben's original case, at the full 200-code-point title limit.
      await run(page, 'question', {
        title: 'W'.repeat(200),
        choices: Array.from({ length: 20 }, (_, i) => `${i} ${'x'.repeat(195)}`),
      });
      const frame = page.frameLocator('#ask-page-fixture iframe');
      const card = page.locator('[data-inline-question] .question-compact-block');
      const after = frame.locator('#after-question');
      await expect(card).toBeVisible();
      const noOverlap = async () => {
        await expect
          .poll(async () => {
            const box = await card.boundingBox(),
              below = await after.boundingBox();
            return !!box && !!below && below.y >= box.y + box.height - 1;
          })
          .toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await frame.locator('html').evaluate((node) => node.scrollWidth <= node.clientWidth),
        ).toBe(true);
      };
      await noOverlap();
      for (const selector of ['.question-compact-block', '.question-controls'])
        expect(
          await page
            .locator(`[data-inline-question] ${selector}`)
            .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
        ).toBe(true);
      const captures = process.env.COLAB_CAPTURE_DIR ?? info.outputDir;
      mkdirSync(captures, { recursive: true });
      await page.screenshot({
        path: `${captures}/question-long-${width}-${theme}.png`,
        fullPage: true,
      });
    });
    test(`long answered block moves following text at ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await run(page, 'mount', {});
      await run(page, 'question', { kind: 'long', title: 'T'.repeat(200) });
      const group = page.locator('.question-group-card');
      await group.getByLabel('Your answer').fill('A'.repeat(8000));
      await group.getByRole('button', { name: /^Send answer/ }).click();
      const strip = group.locator('.answered-strip');
      await expect(strip).toHaveAttribute('aria-expanded', 'false');
      const after = page.frameLocator('#ask-page-fixture iframe').locator('#after-question');
      const collapsed = (await after.boundingBox())!.y;
      await strip.click();
      const block = group.locator('.question-compact-block');
      await expect
        .poll(async () => {
          const a = await after.boundingBox(),
            b = await block.boundingBox();
          return !!a && !!b && a.y >= b.y + b.height - 1 && a.y > collapsed;
        })
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await block.evaluate(
          (node) =>
            node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      for (const turn of await group.locator('.conversation-turn').all())
        expect(await turn.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const captures = process.env.COLAB_CAPTURE_DIR ?? info.outputDir;
      mkdirSync(captures, { recursive: true });
      await page.screenshot({
        path: `${captures}/question-answer-long-${width}-${theme}.png`,
        fullPage: true,
      });
      await strip.click();
      await expect
        .poll(async () => Math.abs((await after.boundingBox())!.y - collapsed))
        .toBeLessThanOrEqual(1);
    });
  }
}

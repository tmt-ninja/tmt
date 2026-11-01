import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
const captures = process.env.TUI_DOCS_CAPTURE_DIR ?? '/tmp/tmt-tui-docs-captures';
for (const width of [1440, 390])
  for (const theme of ['light', 'dark']) {
    for (const route of ['roles', 'glyphs', 'components', 'patterns', 'agents']) {
      test(`${route}, ${width}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript((value) => localStorage.setItem('tmt-docs-theme', value), theme);
        const look = theme === 'light' ? 'tmt-light' : 'tmt';
        await page.goto(
          route === 'agents'
            ? `/mock/tui/agents?state=agents&look=${look}&size=100x36`
            : `/docs/tui/${route}`,
        );
        if (route !== 'agents')
          await page
            .getByRole('combobox', { name: 'Terminal rendering', exact: true })
            .selectOption(look);
        if (route === 'agents') {
          const states = page.getByRole('button', { name: 'States', exact: true });
          const paint = await states.evaluate((node) => {
            const style = getComputedStyle(node);
            return {
              appearance: style.appearance,
              height: node.getBoundingClientRect().height,
              radius: parseFloat(style.borderTopLeftRadius),
              scoped: !!node.closest('[data-tmt-ui]'),
            };
          });
          expect(paint.scoped).toBe(true);
          expect(paint.appearance).toBe('none');
          expect(paint.height).toBeGreaterThanOrEqual(32);
          expect(paint.radius).toBeGreaterThanOrEqual(paint.height / 2);
        }
        const frame = page.locator('tmt-tui-frame').first();
        await expect(frame).toHaveAttribute('data-look', look);
        await expect(frame.locator('.tui-frame-row')).not.toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        const dimensions = await frame.evaluate((node) => {
          const row = node.querySelector('.tui-frame-row')!;
          const spans = Array.from(row.children) as HTMLElement[];
          return {
            columns: Number((node as HTMLElement).dataset.columns),
            cells: spans.length,
            rowWidth: row.getBoundingClientRect().width,
            cellWidth: spans[0]!.getBoundingClientRect().width,
            scrollable: node.parentElement!.scrollWidth > node.parentElement!.clientWidth,
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
          };
        });
        expect(dimensions.cells).toBe(dimensions.columns);
        expect(
          Math.abs(dimensions.rowWidth - dimensions.cellWidth * dimensions.columns),
        ).toBeLessThan(1);
        expect(dimensions.pageOverflow).toBeLessThanOrEqual(1);
        if (width === 390) expect(dimensions.scrollable).toBe(true);
        await page.evaluate(() => document.fonts.ready);
        mkdirSync(captures, { recursive: true });
        await page.screenshot({
          path: join(captures, `${route}-${width}-${theme}.png`),
          fullPage: true,
        });
        const figures = page.locator('.tui-figure');
        for (let i = 0; i < (await figures.count()); i++) {
          await figures.nth(i).scrollIntoViewIfNeeded();
          await figures
            .nth(i)
            .screenshot({ path: join(captures, `${route}-${width}-${theme}-frame${i + 1}.png`) });
        }
      });
    }
  }
test('Agents state, rendering, size and States disclosure are reproducible and inert', async ({
  page,
}) => {
  await page.goto('/mock/tui/agents');
  const frame = page.locator('tmt-tui-frame');
  const names = await page
    .getByRole('combobox', { name: 'State', exact: true })
    .locator('option')
    .allTextContents();
  expect(names.length).toBe(40);
  for (const state of names) {
    await page.getByRole('combobox', { name: 'State', exact: true }).selectOption(state);
    await expect(frame).toHaveAttribute('data-state', state);
    expect(new URL(page.url()).searchParams.get('state')).toBe(state);
  }
  await page.getByRole('combobox', { name: 'State', exact: true }).selectOption('agents');
  for (const look of ['tmt', 'tmt-light', 'terminal', 'NO_COLOR']) {
    await page.getByRole('combobox', { name: 'Rendering', exact: true }).selectOption(look);
    await expect(frame).toHaveAttribute('data-look', look);
  }
  await page.getByRole('combobox', { name: 'Terminal size', exact: true }).selectOption('60x8');
  await expect(frame).toHaveAttribute('data-columns', '60');
  await expect(frame.locator('.tui-frame-row')).toHaveCount(8);
  const url = page.url();
  await page.getByRole('button', { name: 'States', exact: true }).click();
  await expect(page.locator('#tui-states')).toHaveCount(0);
  await page.reload();
  expect(page.url()).toBe(url);
  await expect(frame).toHaveAttribute('data-columns', '60');
  await expect(frame).toHaveAttribute('data-look', 'NO_COLOR');
  await page.goto('/mock/tui/agents?state=invented');
  await expect(page.getByRole('alert')).toContainText('No recorded state');
  await expect(frame).toHaveCount(0);
});

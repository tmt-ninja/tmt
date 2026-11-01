import { test, expect, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { componentDocs, resolveSample, locatePart, tuiRoot } from './catalog.js';
import { tuiMockBase } from '../routes.js';
import { oracle, states } from './model.js';
const captures = process.env.TUI_DOCS_CAPTURE_DIR ?? '/tmp/tmt-tui-docs-captures';
const cliSource = readFileSync(new URL('../../../../design/cli-style.md', import.meta.url), 'utf8');

async function checkSample(page: Page, sample: Locator) {
  await sample.scrollIntoViewIfNeeded();
  const iframe = sample.locator('iframe');
  await expect(iframe).toBeVisible();
  const query = new URL((await iframe.getAttribute('src'))!, page.url()).searchParams;
  const source = oracle.frames.find(
    (frame) =>
      frame.state === query.get('state') &&
      frame.look === query.get('look') &&
      frame.width === Number(query.get('columns')) &&
      frame.height === Number(query.get('rows')),
  );
  expect(source, 'preview must select an existing oracle frame').toBeDefined();
  const from = Number(query.get('from')),
    to = Number(query.get('to'));
  const frame = iframe.contentFrame().locator('tmt-tui-frame');
  await expect(frame).toHaveAttribute('data-state', source!.state);
  await expect(frame).toHaveAttribute('data-look', source!.look);
  await expect(frame).toHaveAttribute('data-columns', String(source!.width));
  await expect(frame).toHaveAttribute('data-rows', String(to - from));
  const lines = await frame
    .locator('.tui-frame-row')
    .evaluateAll((rows) => rows.map((row) => row.textContent!.trimEnd()));
  expect(lines).toEqual(source!.lines.slice(from, to));
  return frame;
}
async function checkPreviewBounds(page: Page) {
  const faults = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const faults: string[] = [];
    for (const frame of document.querySelectorAll<HTMLElement>('[data-preview-frame]')) {
      const box = frame.getBoundingClientRect(),
        cell = frame.parentElement!.getBoundingClientRect(),
        view = frame.querySelector('iframe')!.getBoundingClientRect();
      if (
        box.left < cell.left - 0.5 ||
        box.right > cell.right + 0.5 ||
        box.right > innerWidth + 0.5 ||
        view.right > box.right + 0.5 ||
        view.bottom > box.bottom + 0.5
      )
        faults.push(frame.querySelector('iframe')!.title);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1)
      faults.push('horizontal page overflow');
    return faults;
  });
  expect(faults).toEqual([]);
}
for (const width of [1440, 390])
  for (const theme of ['light', 'dark']) {
    for (const route of ['roles', 'glyphs', 'list', 'patterns', 'agents']) {
      test(`${route}, ${width}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript((value) => localStorage.setItem('tmt-docs-theme', value), theme);
        const look = theme === 'light' ? 'tmt-light' : 'tmt';
        await page.goto(
          route === 'agents'
            ? `${tuiMockBase}/agents?state=agents&look=${look}&size=100x36`
            : `${tuiRoot}/${route}`,
        );
        let frame: Locator;
        if (route === 'agents') {
          const button = page.getByRole('button', { name: 'States', exact: true });
          const paint = await button.evaluate((node) => ({
            appearance: getComputedStyle(node).appearance,
            height: node.getBoundingClientRect().height,
            radius: parseFloat(getComputedStyle(node).borderTopLeftRadius),
            scoped: !!node.closest('[data-tmt-ui]'),
          }));
          expect(paint.scoped).toBe(true);
          expect(paint.appearance).toBe('none');
          expect(paint.height).toBeGreaterThanOrEqual(32);
          expect(paint.radius).toBeGreaterThanOrEqual(paint.height / 2);
          frame = page.locator('tmt-tui-frame');
          await expect(frame).toHaveAttribute('data-look', look);
        } else {
          const samples = page.locator('.tui-sample');
          expect(await samples.count()).toBeGreaterThan(0);
          for (let i = 0; i < (await samples.count()); i++) await checkSample(page, samples.nth(i));
          frame = await checkSample(page, samples.first());
        }
        const geometry = await frame.evaluate((node) => {
          const row = node.querySelector('.tui-frame-row')!,
            first = row.firstElementChild!;
          return {
            columns: Number((node as HTMLElement).dataset.columns),
            cells: row.children.length,
            rowWidth: row.getBoundingClientRect().width,
            cellWidth: first.getBoundingClientRect().width,
          };
        });
        expect(geometry.cells).toBe(geometry.columns);
        expect(Math.abs(geometry.rowWidth - geometry.cellWidth * geometry.columns)).toBeLessThan(1);
        await checkPreviewBounds(page);
        await page.evaluate(() => document.fonts.ready);
        mkdirSync(captures, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: join(captures, `${route}-${width}-${theme}.png`),
          fullPage: true,
        });
        const examples = page.locator(route === 'agents' ? '.tui-figure' : '.tui-sample');
        for (let i = 0; i < (await examples.count()); i++) {
          await examples.nth(i).scrollIntoViewIfNeeded();
          await examples
            .nth(i)
            .screenshot({ path: join(captures, `${route}-${width}-${theme}-frame${i + 1}.png`) });
        }
      });
    }
  }
for (const doc of componentDocs)
  test(`TUI component library: ${doc.slug}`, async ({ page }) => {
    // Data and DOM both prove that each page uses real anatomy/state records, not placeholders.
    const anchors = [...cliSource.matchAll(/^#{2,3} (.+)$/gm)].map(([, heading]) =>
      heading!
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-'),
    );
    expect(anchors).toContain(doc.section);
    for (const look of ['tmt', 'tmt-light', 'terminal', 'NO_COLOR']) {
      const { frame, from, to } = resolveSample(doc.anatomy, look);
      for (const part of doc.parts) {
        expect(part.row).toBeGreaterThan(from);
        expect(part.row).toBeLessThanOrEqual(to);
        expect(locatePart(frame, part).column).toBeGreaterThan(0);
      }
      expect(doc.states.length).toBeGreaterThan(0);
      for (const state of doc.states) expect(resolveSample(state.sample, look).frame).toBeDefined();
    }
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript((value) => localStorage.setItem('tmt-docs-theme', value), theme);
        await page.goto(`${tuiRoot}/${doc.slug}`);
        const body = page.locator(`[data-tui-component="${doc.slug}"]`);
        for (const title of ['Anatomy', 'States', 'Missing frames', 'Keys', 'Roles'])
          await expect(body.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(body.locator('.tui-rule-link a')).toHaveAttribute(
          'href',
          new RegExp(`/design/cli-style.md#${doc.section}$`),
        );
        await checkSample(page, body.locator('[data-tui-anatomy] .tui-sample'));
        await checkSample(page, body.locator('[data-tui-states] .tui-sample'));
        expect(await body.locator('.tui-part-list li').count()).toBe(doc.parts.length);
        await checkPreviewBounds(page);
        mkdirSync(captures, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: join(captures, `component-${doc.slug}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
  });
test('Agents URL states persist without driving a real terminal', async ({ page }) => {
  await page.goto(`${tuiMockBase}/agents`);
  const frame = page.locator('tmt-tui-frame');
  const stateControl = page.getByRole('combobox', { name: 'State', exact: true });
  const names = await stateControl.locator('option').allTextContents();
  expect(names).toEqual(states);
  for (const state of names) {
    await stateControl.selectOption(state);
    await expect(frame).toHaveAttribute('data-state', state);
    expect(new URL(page.url()).searchParams.get('state')).toBe(state);
  }
  await stateControl.selectOption('agents');
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
  await expect(frame).toHaveAttribute('data-look', 'NO_COLOR');
  await page.goto(`${tuiMockBase}/agents?state=invented`);
  await expect(page.getByRole('alert')).toContainText('No recorded state');
  await expect(frame).toHaveCount(0);
});

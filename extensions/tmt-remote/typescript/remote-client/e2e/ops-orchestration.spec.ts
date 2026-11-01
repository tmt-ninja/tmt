import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildOpsHarness, serveOpsHarness, type OpsHarness } from './ops-harness-page.js';

const origin = 'https://ops-orchestration.test';
let built: OpsHarness | undefined;
test.beforeAll(async () => {
  built = await buildOpsHarness();
});
test.afterAll(async () => {
  await built?.dispose();
});
async function open(page: Page, width: number, theme: string) {
  await serveOpsHarness(page, built!, origin, width, theme);
  await page.goto(`${origin}/ops/#orchestration`);
  await expect(page.getByRole('heading', { name: 'Who may message whom' })).toBeVisible();
}
async function shot(page: Page, name: string) {
  const root =
    process.env.TMT_OPS_ORCHESTRATION_CAPTURE_DIR ??
    join('test-results', 'ops-orchestration-captures');
  await mkdir(root, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, name + '.png'), fullPage: true });
}
const calls = (page: Page) => page.evaluate(() => structuredClone(window.orchCalls));

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'])
    test(`orchestration shows Core's values and sources at ${width} ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await open(page, width, theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / Orchestration');
      const matrix = page.locator('.ops-orchestration-matrix');
      await expect(
        matrix.getByRole('button', { name: /^sample-1 to sample-lead: / }),
      ).toBeVisible();
      await expect(page.getByRole('list', { name: 'Talks this hour' })).toContainText(
        'sample-lead ⇄ sample-1',
      );
      await expect(page.getByRole('list', { name: 'Talks this hour' })).toContainText('◆ 2 held');
      const inspector = page.getByRole('region', { name: 'Selected member and route' });
      await expect(inspector).toContainText('Receiving');
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await shot(page, `orchestration-${width}-${theme}`);
      expect((await calls(page)).filter((call) => call.kind === 'write')).toEqual([]);
      expect(errors).toEqual([]);
    });

test('a change shows Core’s preview and saves only that preview after Save', async ({ page }) => {
  await open(page, 1440, 'light');
  const inspector = page.getByRole('region', { name: 'Selected member and route' });
  await inspector.getByRole('button', { name: 'Focus now 1h', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('sample-1 · state, receiving');
  await expect(dialog).toContainText('Running work is never interrupted.');
  await shot(page, 'orchestration-preview');
  // Cancel sends nothing beyond the preview.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  let writes = (await calls(page)).filter((call) => call.kind === 'write');
  expect(writes.map((call) => call.input.phase)).toEqual(['preview']);
  await inspector.getByRole('button', { name: 'Focus now 1h', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Orchestration saved.');
  writes = (await calls(page)).filter((call) => call.kind === 'write');
  expect(writes.map((call) => call.input.phase)).toEqual(['preview', 'preview', 'apply']);
  expect(writes[2]!.input).toMatchObject({
    phase: 'apply',
    mutation: writes[1]!.input.mutation,
    expectedConfigurationRevision: 3,
    previewDigest: 'digest-1',
    consent: true,
  });
});

test('a stale apply saves nothing and says so', async ({ page }) => {
  await open(page, 1440, 'light');
  await page.evaluate(() => {
    window.orchRefuseApply = 'ORCH_CONFLICT';
  });
  const inspector = page.getByRole('region', { name: 'Selected member and route' });
  await inspector.getByRole('button', { name: 'End focus', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Orchestration changed since the preview; nothing was saved. Try again.',
  );
  await expect(page.getByRole('dialog')).toBeHidden();
});

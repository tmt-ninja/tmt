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
async function shot(page: Page, name: string, fullPage = true) {
  const root =
    process.env.TMT_OPS_ORCHESTRATION_CAPTURE_DIR ??
    join('test-results', 'ops-orchestration-captures');
  await mkdir(root, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, name + '.png'), fullPage });
}
const calls = (page: Page) => page.evaluate(() => structuredClone(window.orchCalls));

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'])
    test(`orchestration shows Core's values and sources at ${width} ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await open(page, width, theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / Orchestration');
      const plans = page.getByRole('region', { name: 'Plan list' });
      await expect(plans.getByRole('button', { name: 'Release freeze', exact: true })).toHaveText(
        'Off',
      );
      await expect(
        plans.locator('.ops-orchestration-plan-select').filter({ hasText: 'Shift B · Night' }),
      ).toContainText('every other week Tue Thu 22:00–06:00 · night-*');
      await expect(plans.getByRole('button', { name: 'Shift B · Night', exact: true })).toHaveText(
        '✓On',
      );
      await expect(
        plans.getByRole('button', { name: 'Release freeze', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
      const matrix = page.locator('.ops-orchestration-matrix');
      await expect(
        matrix.getByRole('button', { name: /^sample-1 to sample-lead: / }),
      ).toBeVisible();
      await expect(page.getByRole('list', { name: 'Talks this hour' })).toContainText(
        'sample-lead ⇄ sample-1',
      );
      await expect(page.getByRole('list', { name: 'Talks this hour' })).toContainText(
        '12/12 · 2 held · needs a person',
      );
      await expect(page.getByRole('region', { name: 'Selected member and route' })).toContainText(
        'Allowed · Batch 30 min',
      );
      // The timeline names the date and Core's zone, and the plans in effect at the selected time.
      await expect(page.getByRole('group', { name: 'Time range' })).toBeVisible();
      await expect(page.locator('.ops-orchestration-when')).toHaveText('Tue 10-27Asia/Tokyo');
      const legend = page.getByRole('list', { name: 'Plans at the selected time' });
      await expect(legend).toContainText('Shift B · Night');
      await expect(legend.getByRole('listitem').filter({ hasText: 'Quiet hours' })).toContainText(
        'every day 22:00–08:00 · everyone',
      );
      // A cell selects both sides: the route, then the sender's own values with their sources.
      await matrix.getByRole('button', { name: /^night-1 to core-1: / }).click();
      const inspector = page.getByRole('region', { name: 'Selected member and route' });
      // Stacked at 390 the panel is below the matrix: a choice brings it into view with focus.
      if (width === 390) {
        const heading = inspector.getByRole('heading', { name: 'night-1 → core-1' });
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
      } else {
        await expect(matrix.getByRole('button', { name: /^night-1 to core-1: / })).toBeFocused();
      }
      await expect(inspector).toContainText('SendingLeads only ← Shift B · Night');
      await expect(inspector).toContainText('Blocked · explained');
      await expect(inspector).toContainText('State● Awake ← Shift B · Night');
      await expect(inspector).toContainText('Talk limit20 / h ← Shift B · Night');
      await expect(page.getByRole('list', { name: 'Jobs · night-1' })).toContainText(
        'Night review● readyevery 1h · next 00:00',
      );
      await expect(matrix.locator('th[data-cross]')).toHaveText(['core-1', 'night-1']);
      // At any width the matrix scrolls inside its card and the row names stay on its left edge.
      const scroller = page.getByRole('region', { name: 'Route matrix, scrolls both ways' });
      await scroller.evaluate((node) => node.scrollTo({ left: node.scrollWidth }));
      const [box, name] = await Promise.all([
        scroller.boundingBox(),
        matrix.getByRole('rowheader', { name: 'night-1' }).boundingBox(),
      ]);
      expect(Math.abs(name!.x - box!.x)).toBeLessThanOrEqual(1);
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      // Every action row: one-line labels and one shared height; the row wraps, not the text.
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.ops-orchestration-page .tmt-ui-actions')].map((row) =>
          [...row.querySelectorAll<HTMLElement>(':scope > .tmt-ui-action')].map((button) => {
            // The label's text boxes all sit on one line.
            const tops = new Set<number>();
            const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const text = document.createRange();
              text.selectNodeContents(node);
              for (const rect of text.getClientRects())
                if (rect.width > 0) tops.add(Math.round(rect.top));
            }
            return {
              height: Math.round(button.getBoundingClientRect().height),
              oneLine: tops.size <= 1,
            };
          }),
        ),
      );
      for (const row of rows) {
        expect(row.every((button) => button.oneLine)).toBe(true);
        expect(new Set(row.map((button) => button.height)).size).toBeLessThanOrEqual(1);
      }
      await shot(page, `orchestration-${width}-${theme}`);
      expect((await calls(page)).filter((call) => call.kind === 'write')).toEqual([]);
      // The preview dialog, captured once it has settled.
      await inspector.getByRole('button', { name: 'Focus now 1h', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Running work is never interrupted.');
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector('dialog[open]')!).opacity === '1',
      );
      // The modal covers the viewport; a full-page capture would stitch its backdrop.
      await shot(page, `orchestration-preview-${width}-${theme}`, false);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(errors).toEqual([]);
    });

test('the timeline follows the range, the plan filter and the steps', async ({ page }) => {
  await open(page, 1440, 'light');
  const overviews = async () =>
    (await calls(page)).filter((call) => call.kind === 'read' && call.input.view === 'overview');
  await page
    .getByRole('group', { name: 'Time range' })
    .getByRole('button', { name: '7 days' })
    .click();
  await expect(page.locator('.ops-orchestration-when')).toHaveText(
    'Tue 10-27 – Mon 11-02Asia/Tokyo',
  );
  const selected = page
    .getByRole('region', { name: 'Plan list' })
    .locator('.ops-orchestration-plan-select')
    .filter({ hasText: 'Shift B · Night' });
  await selected.click();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const legend = page.getByRole('list', { name: 'Plans at the selected time' });
  await expect(legend).toHaveText('Shift B · Nightevery other week Tue Thu 22:00–06:00 · night-*');
  expect((await overviews()).at(-1)!.input).toMatchObject({ rangeDays: 7, plan: 'plan-shift-b' });
  // Later moves to Core's next change, and the matrix says its verdicts are still for now.
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(page.locator('.ops-orchestration-at')).toContainText('Wed 10-28 01:00');
  await expect(page.locator('.ops-orchestration-matrix-body')).toContainText(
    '✕ and ◆ are Core’s verdicts for now; receiving is at Wed 10-28 01:00.',
  );
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('.ops-orchestration-at')).toContainText('Tue 10-27 23:00');
  expect((await overviews()).at(-1)!.input).not.toHaveProperty('atMs');
});

test('a change shows Core’s preview and saves only that preview after Save', async ({ page }) => {
  await open(page, 1440, 'light');
  const inspector = page.getByRole('region', { name: 'Selected member and route' });
  await inspector.getByRole('button', { name: 'Focus now 1h', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('sample-1 · state, receiving');
  await expect(dialog).toContainText('Running work is never interrupted.');
  // Cancel sends nothing beyond the preview.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  let writes = (await calls(page)).filter((call) => call.kind === 'write');
  expect(writes.map((call) => call.input.phase)).toEqual(['preview']);
  await inspector.getByRole('button', { name: 'Focus now 1h', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Orchestration saved.');
  // Each reread (here the next 30 s refresh after the save) reads the shown member’s jobs again.
  const jobReads = async () =>
    (await calls(page)).filter((call) => call.input.view === 'jobs').length;
  const before = await jobReads();
  await page.clock.runFor(61_000);
  await expect.poll(jobReads).toBe(before + 1);
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

test('a plan switch previews the exact plans-view row and applies only after consent', async ({
  page,
}) => {
  await open(page, 1440, 'light');
  await page.getByRole('button', { name: 'Release freeze', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Running work is never interrupted.');
  let all = await calls(page);
  const read = all.find((call) => call.input.view === 'plans');
  expect(read).toBeDefined();
  const writes = all.filter((call) => call.kind === 'write');
  expect(writes).toHaveLength(1);
  expect(writes[0]!.input).toMatchObject({
    phase: 'preview',
    mutation: {
      kind: 'plan.set',
      plan: 'plan-freeze',
      candidate: { enabled: true, plansViewOnly: 'retained', revision: 1 },
    },
  });
  expect((writes[0]!.input.mutation as { candidate: unknown }).candidate).toEqual({
    id: 'plan-freeze',
    name: 'Release freeze',
    revision: 1,
    priority: 30,
    enabled: true,
    targets: [{ kind: 'identity', id: '00000000-0000-4000-8000-000000000012' }],
    schedule: {
      kind: 'once',
      startMs: Date.UTC(2026, 9, 26, 15) + 2 * 86_400_000 + 9 * 3_600_000,
      endMs: Date.UTC(2026, 9, 26, 15) + 2 * 86_400_000 + 18 * 3_600_000,
    },
    fields: { routine: 'hold', sending: 'leads' },
    members: [],
    plansViewOnly: 'retained',
  });
  await expect(page.getByRole('combobox', { name: 'Plans' })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await calls(page)).filter((call) => call.kind === 'write')).toHaveLength(1);
  await page.getByRole('button', { name: 'Release freeze', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Release freeze', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  all = await calls(page);
  expect(all.filter((call) => call.kind === 'write').at(-1)!.input).toMatchObject({
    phase: 'apply',
    expectedConfigurationRevision: 3,
    consent: true,
  });
});

test('a conflicting plan apply re-reads and does not retry the write', async ({ page }) => {
  await open(page, 1440, 'light');
  await page.evaluate(() => {
    window.orchRefuseApply = 'ORCH_CONFLICT';
  });
  await page.getByRole('button', { name: 'Release freeze', exact: true }).click();
  const before = (await calls(page)).filter((call) => call.input.view === 'overview').length;
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Orchestration changed since the preview; nothing was saved. Try again.',
  );
  const callsAfter = await calls(page);
  expect(callsAfter.filter((call) => call.input.view === 'overview').length).toBeGreaterThan(
    before,
  );
  expect(
    callsAfter.filter((call) => call.kind === 'write').map((call) => call.input.phase),
  ).toEqual(['preview', 'apply']);
  await expect(page.getByRole('button', { name: 'Release freeze', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

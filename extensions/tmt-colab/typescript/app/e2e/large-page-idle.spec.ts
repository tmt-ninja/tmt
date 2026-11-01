import { expect, test, type Page } from '@playwright/test';

/**
 * A large page settles (#4089): once it has opened, an idle page does no work, and scrolling it sends
 * the app nothing. The frame's messages and the frame's height are counted, never timed. The page
 * ends in a paragraph whose bottom margin collapses through the body's, which used to make the frame
 * measure two heights in turn for as long as the page stayed open.
 */
const fixture = '/test/ask-page-browser.tsx';
const run = (page: Page, method: string, argument?: unknown) =>
  page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );

/** Counts what the frame sends the app, by type. */
async function countFrameMessages(page: Page) {
  await page.addInitScript(() => {
    const counts: Record<string, number> = {};
    Object.defineProperty(window, 'fromFrame', { value: counts });
    const Channel = window.MessageChannel;
    window.MessageChannel = class extends Channel {
      constructor() {
        super();
        this.port1.addEventListener('message', (event) => {
          const type = (event.data as { type?: string } | null)?.type;
          if (type?.startsWith('colab.render.')) counts[type] = (counts[type] ?? 0) + 1;
        });
      }
    } as typeof Channel;
  });
}
const sent = (page: Page) =>
  page.evaluate(() => ({
    ...(window as unknown as { fromFrame: Record<string, number> }).fromFrame,
  }));
const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
const frameHeight = (page: Page) =>
  page.locator('#ask-page-fixture iframe').evaluate((node) => node.getBoundingClientRect().height);

async function open(page: Page, width: number) {
  await countFrameMessages(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await run(page, 'mount', {});
  await run(page, 'largePage', { paragraphs: 400, threads: 120 });
  await expect(
    page.frameLocator('#ask-page-fixture iframe').locator('[data-colab-thread]'),
  ).toHaveCount(120);
  // The opening work finishes: the frame has measured and drawn everything it will.
  for (let i = 0; i < 40; i++) await nextFrame(page);
}

for (const width of [1440, 390]) {
  test(`an idle large page sends nothing and keeps one height at ${width}`, async ({ page }) => {
    await open(page, width);
    const before = await sent(page);
    const heights = new Set([await frameHeight(page)]);
    for (let i = 0; i < 60; i++) {
      await nextFrame(page);
      heights.add(await frameHeight(page));
    }
    expect(await sent(page)).toEqual(before);
    expect([...heights]).toHaveLength(1);
  });

  test(`scrolling a large page sends the app nothing and keeps the height at ${width}`, async ({
    page,
  }) => {
    await open(page, width);
    const before = await sent(page);
    const height = await frameHeight(page);
    for (let step = 1; step <= 30; step++) {
      await page.evaluate((top) => window.scrollTo(0, top), step * 200);
      await nextFrame(page);
    }
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(3000);
    expect(await sent(page)).toEqual(before);
    expect(await frameHeight(page)).toBe(height);
  });
}

// #5872: while an ask is open, its observation loop reads the page's ask views every few seconds.
// Each read used to decode and verify every signed ask again; on a page with many asks that was a
// quarter-second main-thread task per read, which blocked typing. The store verifies each unchanged
// ask once, so repeated reads verify nothing. The verify count is the guard; times are recorded.
test('repeated ask view reads on a page with many asks verify nothing again', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const result = await page.evaluate(
    async ({ fixture }) =>
      (await import(fixture)).askViewReads({ asks: 120, reads: 10, quote: 8 * 1024 }),
    { fixture: '/test/ask-browser-attempt.ts' },
  );
  test.info().annotations.push({ type: 'colab-ask-reads', description: JSON.stringify(result) });
  expect(result.views).toBe(120);
  expect(result.verified).toBe(0);
});

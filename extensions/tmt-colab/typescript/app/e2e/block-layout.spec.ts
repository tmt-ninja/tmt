import { expect, test, type Page } from '@playwright/test';

// #6257: how a block page lays out, measured from computed geometry. A night page's blocks are
// drawn by the design system's blocks; these specs read each box's position and size.
async function mountLayout(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/structured-page-browser.tsx';
    (await import(path)).mount('layout');
  });
  const host = page.locator('#structured-page-fixture');
  await host.locator('[data-block-id="top"]').waitFor();
  return host;
}

type Box = { top: number; bottom: number; left: number; right: number; width: number };
/** The border box of the first element matching `selector` inside `scope`, in page pixels. */
async function box(page: Page, scope: string, selector = ':scope'): Promise<Box> {
  return page.evaluate(
    ([scope, selector]) => {
      const root = document.querySelector(scope!)!;
      const el = selector === ':scope' ? root : root.querySelector(selector!)!;
      if (!el) throw new Error(`${scope} ${selector} not found`);
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
    },
    [scope, selector],
  );
}
const block = (id: string) => `#structured-page-fixture [data-block-id="${id}"]`;
/** The space between the end of one block and the start of the next. */
const gapBetween = async (page: Page, above: string, below: string) =>
  Math.round(((await box(page, block(below))).top - (await box(page, block(above))).bottom) * 10) /
  10;

test('a section card draws as a section, with its meta', async ({ page }) => {
  const host = await mountLayout(page);
  const card = host.locator('[data-block-id="sec"] > [data-slot="card-block"]');
  await expect(card).toHaveAttribute('data-variant', 'section');
  await expect(card.locator('.tmt-block-card-meta')).toHaveText('3 項未完成');
  // A card with no variant stays the framed card, and shows no meta.
  const plain = host.locator('[data-block-id="plain"] > [data-slot="card-block"]');
  await expect(plain).toHaveAttribute('data-variant', 'card');
  await expect(plain.locator('.tmt-block-card-meta')).toHaveCount(0);
});

test('blocks in a card keep the page rhythm: tight runs and the heading space above', async ({
  page,
}) => {
  await mountLayout(page);
  // Each pair of neighbours, at the root and in the card: the same space between them.
  const pairs = [
    ['p', 'l1'],
    ['l1', 'l2'],
    ['l3', 't1'],
    ['t1', 't2'],
    ['t2', 'h2'],
    ['h2', 'h3'],
    ['h3', 'after'],
  ] as const;
  for (const [a, b] of pairs) {
    const root = await gapBetween(page, `root-${a}`, `root-${b}`);
    const card = await gapBetween(page, `in-${a}`, `in-${b}`);
    expect(card, `${a} to ${b} in the card, like the page's ${root}px`).toBe(root);
  }
  // The rhythm itself: a run of list items is tight, a heading has its space above.
  expect(await gapBetween(page, 'in-l1', 'in-l2')).toBe(0);
  expect(await gapBetween(page, 'in-t1', 'in-t2')).toBe(0);
  expect(await gapBetween(page, 'in-t2', 'in-h2')).toBe(32);
  expect(await gapBetween(page, 'in-h2', 'in-h3')).toBe(22);
});

test('prose keeps a 720px measure, and tables and cards keep the stage width', async ({ page }) => {
  await mountLayout(page);
  const stage = (await box(page, '#structured-page-fixture .tmt-block-doc-body')).width;
  expect(stage).toBeGreaterThan(900);
  expect(stage).toBeLessThan(1100);
  for (const id of ['prose', 'root-p', 'root-l1', 'root-t1', 'root-h2', 'in-p', 'in-l1', 'in-t1'])
    expect((await box(page, block(id))).width, id).toBeLessThanOrEqual(720);
  // The long paragraph fills the measure rather than a narrower column.
  expect((await box(page, block('prose'))).width).toBeGreaterThan(680);
  for (const id of ['sec', 'plain', 'table'])
    expect((await box(page, block(id))).width, id).toBeGreaterThan(900);
});

test('consecutive questions are 16px apart, on the page and in a card', async ({ page }) => {
  await mountLayout(page);
  expect(await gapBetween(page, 'q1', 'q2')).toBe(16);
  expect(await gapBetween(page, 'sq1', 'sq2')).toBe(16);
});

for (const width of [1440, 390])
  test(`a question's rows keep one ladder at ${width}`, async ({ page }) => {
    await mountLayout(page, width);
    const q = block('q1');
    const eyebrow = await box(page, q, '.tmt-block-question-eyebrow');
    const heading = await box(page, q, '.tmt-block-question-heading');
    const choices = await page.evaluate(
      (q) =>
        [...document.querySelectorAll(`${q} .tmt-block-question-choices > label`)].map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }),
      q,
    );
    const send = await box(page, q, 'button');
    expect(choices.length).toBe(3);
    const round = (n: number) => Math.round(n * 10) / 10;
    // Eyebrow to question 8, question to the choices 12 (no visible Choices legend between).
    expect(round(heading.top - eyebrow.bottom)).toBe(8);
    expect(round(choices[0]!.top - heading.bottom)).toBe(12);
    // The choices are 8 apart, in a row or stacked.
    const next = choices[1]!;
    const stacked = next.top >= choices[0]!.bottom - 1;
    expect(round(stacked ? next.top - choices[0]!.bottom : next.left - choices[0]!.right)).toBe(8);
    // The last choice to Send 16.
    expect(round(send.top - Math.max(...choices.map((c) => c.bottom)))).toBe(16);
    // The legend stays for assistive technology.
    await expect(page.locator(`${q} legend`)).toHaveText('Choices');
    expect((await box(page, q, 'legend')).width).toBeLessThanOrEqual(1);
  });

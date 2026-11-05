import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';
import { expectOnePrimaryPerGroup } from './primary-groups.js';
import { rgb, tokens } from './tokens.js';

/** Waiting questions use a rounded sheet; recorded answers fold to compact strips. */
const fixture = '/test/ask-page-browser.tsx';
async function run(page: Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
async function mount(page: Page, width: number, scheme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto('/');
  await run(page, 'mount', {});
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The shard model has no room for more cases: two views cover both widths and both schemes.
for (const [width, scheme] of [
  [1440, 'light'],
  [390, 'dark'],
] as const) {
  test(`the question card has a waiting surface, choices and answered strip ${width} ${scheme}`, async ({
    page,
  }) => {
    await mount(page, width, scheme);
    await run(page, 'question', {
      kind: 'single',
      choices: ['Keep it', 'Change it'],
      other: true,
      darkPage: scheme === 'dark',
    });
    const card = page.locator('.question-group-card');
    const line = card.locator('.question-line');
    const block = card.locator('.question-compact-block');
    const sheet = tokens.browser.surface.sheet[scheme];

    // Waiting cards show the asking agent, title and choice controls immediately.
    await expect(line.locator('.question-waiting-eyebrow')).toContainText('Agent 1 asks you');
    await expect(line.locator('.question-line-title')).toHaveText('Which heading should we use?');
    const controls = card.locator('.question-compact-controls:not([hidden])');
    await expect(controls).toBeVisible();
    await expect(block).toHaveCSS('background-color', rgb(sheet));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      await expect(block).toHaveCSS(`border-${side}-width`, '1px');
      await expect(block).toHaveCSS(
        `border-${side}-color`,
        rgb(tokens.browser.surface.rule[scheme]),
      );
    }
    await expect(block).toHaveCSS('border-top-left-radius', '2px');
    await expect(block).toHaveCSS('box-shadow', 'none');
    const legend = card.locator('.tmt-ui-choices-legend');
    await expect(legend).toHaveText('Choose one answer, or write your own.');
    const radios = ['Keep it', 'Change it', 'Other'].map((name) =>
      card.getByRole('radio', { name, exact: true }),
    );
    const radioBoxes = await Promise.all(radios.map((radio) => radio.boundingBox()));
    // Other: its field is not drawn until Other is picked, then it sits under the choices.
    const field = card.getByLabel('Your other answer', { exact: true });
    await expect(field).toHaveCount(0);
    await radios[2].check();
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('placeholder', 'Tell us what is missing…');
    expect((await field.boundingBox())!.y).toBeGreaterThan(
      radioBoxes[2]!.y + radioBoxes[2]!.height,
    );
    await radios[0].check();
    await expect(field).toHaveCount(0);

    // Recipients and the one primary action share the footer.
    const footer = card.locator('.question-group-footer');
    await expect(footer).toHaveCSS('border-top-width', '0px');
    await expect(card.locator('.question-goes-to')).toHaveText('Goes to');
    const send = card.getByRole('button', { name: /^Send answer/ });
    await expect(send).toBeEnabled();
    await expect(send).toHaveAttribute('data-variant', 'primary');
    await expect(send).toHaveCSS(
      'background-color',
      rgb(tokens.browser.color['accent-fill'][scheme]),
    );
    await expect(send).toHaveCSS('text-decoration-line', 'none');
    await expect(card.locator('.tmt-ui-action[data-variant="primary"]')).toHaveCount(1);
    await expectOnePrimaryPerGroup(page, 'question card');
    const [goesBox, sendBox, afterBox] = [
      await card.locator('.question-goes-to').boundingBox(),
      await send.boundingBox(),
      await block.boundingBox(),
    ];
    expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(afterBox!.x + afterBox!.width - 4);
    expect(sendBox!.x + sendBox!.width).toBeGreaterThan(afterBox!.x + afterBox!.width - 24);
    expect(goesBox!.y).toBeLessThanOrEqual(sendBox!.y);

    // Keyboard focus remains visible on the native choice.
    await radios[0].focus();
    await expect(radios[0]).toBeFocused();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: capturePath(`question-card-v2-${width}-${scheme}.png`) });

    await send.click();
    const strip = card.locator('.answered-strip');
    await expect(strip).toHaveAttribute('aria-expanded', 'false');
    await expect(strip.locator('.lucide-check')).toHaveCount(1);
    await expect(strip.locator('.question-line-answer')).toHaveText('Keep it');
    await expect(strip.locator('.lucide-chevron-down')).toHaveCount(1);
    await expect(block).toHaveCSS('height', '32px');
    await strip.click();
    await expect(card.getByRole('button', { name: 'Change answer' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Follow up' })).toBeVisible();
  });
}

test('waiting and answered colours meet contrast on the sheet', () => {
  for (const scheme of ['light', 'dark'] as const)
    for (const role of ['waiting', 'working'] as const)
      expect(
        contrast(tokens.browser.color[role][scheme], tokens.browser.surface.sheet[scheme]),
        `${role} ${scheme}`,
      ).toBeGreaterThanOrEqual(4.5);
});

test('a batch card stacks waiting questions and keeps one primary Send', async ({ page }) => {
  await mount(page, 1440, 'light');
  await run(page, 'questionGroup', { count: 3 });
  const card = page.locator('.question-group-card');
  await card.locator('.question-line').first().click();
  await expect(card.locator('.question-waiting-heading')).toHaveCount(3);
  // Each question stays a separate row in the shared card.
  await expect(card.locator('.question-line-eyebrow')).toHaveCount(0);
  // Waiting questions share one card and one primary action.
  const rows = card.locator('.question-compact-block > div');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveCSS('border-top-width', '0px');
  await expect(card.locator('.question-compact-controls:not([hidden])')).toHaveCount(3);
  await expect(card.getByRole('button', { name: /^Send answers/ })).toHaveAttribute(
    'data-variant',
    'primary',
  );
  await expectOnePrimaryPerGroup(page, 'question batch card');
});

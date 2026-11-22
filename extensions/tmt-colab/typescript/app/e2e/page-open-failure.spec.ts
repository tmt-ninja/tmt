import { expect, test, type Page } from '@playwright/test';
import { capturePath } from './captures.js';

/**
 * #4012: a page that cannot open says so in plain words. A failure that reopening may cure (a closed
 * connection, a protocol violation, an ended Remote session, anything unclassified) shows "This page
 * could not open." with a Retry that runs the open again, and the raw token as a small reference;
 * the red card stays for a refusal that ends access. The open has no deadline (#3975), so these are
 * the only ways it ends.
 */
async function mount(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/test/page-reentry-browser.tsx';
    (await import(/* @vite-ignore */ path)).mount();
  });
  await expect(app(page).getByRole('link', { name: 'Alpha plan' })).toBeVisible();
}

const draftValue = 'Retry this draft exactly.\n\nTrailing space: ';
const copyLabel = 'Copy draft text';
const pairingDisclosure =
  'Colab can recover your drafts after you pair again as this space’s owner.';
const draftKept =
  'What you typed on this page is kept on this device and offered when the page opens again.';

async function endDraftPage(
  page: Page,
  mode: 'readable' | 'unreadable' | 'empty',
  code = 'REMOTE_DEVICE_REVOKED',
) {
  await page.goto('/');
  await page.evaluate(
    async (draft) => {
      const path = '/test/page-reentry-browser.tsx';
      await (await import(/* @vite-ignore */ path)).mount(draft);
    },
    { mode, value: draftValue },
  );
  await app(page).getByRole('link', { name: 'Alpha plan' }).click();
  await page.waitForFunction(() => typeof window.endDraftPage === 'function');
  await page.evaluate((reason) => window.endDraftPage?.(reason), code);
  await expect(app(page).getByRole('heading', { name: 'Preview stopped' })).toBeVisible();
}
const app = (page: Page) => page.locator('#reentry-fixture');
const endedCard = (page: Page) => app(page).locator('.notice-card');
const failure = (page: Page) => app(page).getByTestId('page-open-failure');
const retry = (page: Page) => app(page).getByRole('button', { name: 'Retry' });
const body = (page: Page) =>
  page.frameLocator('#reentry-fixture iframe').getByText('Body of Alpha plan.');

test('a pairing end offers the kept block text on Copy only', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(() => navigator.clipboard.writeText('Before Copy'));
  await endDraftPage(page, 'readable');
  const card = endedCard(page);
  await expect(card.getByText(pairingDisclosure, { exact: false })).toBeVisible();
  await expect(app(page)).not.toContainText(draftValue.trim());
  await expect(app(page)).not.toContainText(draftKept);
  const sealed = await page.evaluate(() => window.fixtureSealedDraft?.());
  expect(sealed?.ciphertext).toBeTruthy();
  const copy = card.getByRole('button', { name: copyLabel });
  await copy.dispatchEvent('click');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Before Copy');
  await copy.click();
  await expect(card.getByText('Draft text copied.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(draftValue);
  expect(await page.evaluate(() => window.fixtureSealedDraft?.())).toEqual(sealed);
});

for (const mode of ['unreadable', 'empty'] as const)
  test(`a pairing end offers no copy with an ${mode} draft store`, async ({ page }) => {
    await endDraftPage(page, mode);
    await page.evaluate(() => window.draftProbe);
    await expect(app(page).getByRole('button', { name: copyLabel })).toHaveCount(0);
    await expect(app(page)).not.toContainText(pairingDisclosure);
    expect(await page.evaluate(() => window.fixtureDraftKeyExists?.())).toBe(false);
  });

test('an ended page that can reopen keeps its existing draft sentence', async ({ page }) => {
  await endDraftPage(page, 'readable', 'Access ended');
  await expect(endedCard(page).getByText(draftKept, { exact: true })).toBeVisible();
  await expect(app(page).getByRole('button', { name: copyLabel })).toHaveCount(0);
});

test('a missing old draft key shows the recovery notice and preserves the sealed draft', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async (value) => {
    const path = '/test/page-reentry-browser.tsx';
    await (await import(/* @vite-ignore */ path)).mount({ mode: 'missing-key-recovery', value });
  }, draftValue);
  const sealed = await page.evaluate(() => window.fixtureSealedDraft?.());
  expect(sealed?.ciphertext).toBeTruthy();
  await app(page).getByRole('link', { name: 'Alpha plan' }).click();
  const notice = app(page)
    .getByRole('status')
    .getByText('Some draft text from an earlier pairing could not be recovered.', { exact: true });
  await expect(notice).toBeVisible();
  await expect(app(page).getByText('Text already on the page.', { exact: true })).toBeVisible();
  await expect(app(page)).not.toContainText('Retry this draft exactly.');
  await expect(app(page).getByRole('button', { name: 'Keep and continue' })).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureSealedDraft?.())).toEqual(sealed);
  expect(await page.evaluate(() => window.fixtureDraftKeyExists?.())).toBe(false);
  if (process.env.COLAB_CAPTURE_DIR)
    for (const theme of ['light', 'dark'] as const)
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await expect(notice).toBeVisible();
        await page.screenshot({
          path: capturePath(`6796-missing-key-${width}-${theme}.png`),
          animations: 'disabled',
        });
      }
});

for (const theme of ['light', 'dark'] as const)
  for (const width of [1440, 390])
    test(`captures: an ended pairing with kept block text at ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await endDraftPage(page, 'readable');
      if (!process.env.COLAB_DRAFT_PAIRING_REFERENCE)
        await expect(app(page).getByRole('button', { name: copyLabel })).toBeVisible();
      await page.screenshot({
        path: capturePath(`6796-ended-pairing-${width}-${theme}.png`),
        animations: 'disabled',
      });
    });
async function openAlphaFailing(page: Page, message: string) {
  await page.evaluate((message) => {
    window.failPages = message;
  }, message);
  await app(page).getByRole('link', { name: 'Alpha plan' }).click();
}

for (const message of [
  'Sync disconnected',
  'INVALID',
  'Remote session ended',
  'Something nobody classified',
])
  test(`"${message}" while opening is plain copy with Retry, not a red failure`, async ({
    page,
  }) => {
    await mount(page);
    await openAlphaFailing(page, message);
    await expect(failure(page)).toBeVisible();
    await expect(failure(page)).toContainText('This page could not open.');
    await expect(failure(page)).toContainText('The page did not finish opening. Try again.');
    // Retry is the filled first action; Return to space is the text link beside it.
    await expect(retry(page)).toBeVisible();
    await expect(retry(page)).toHaveAttribute('data-variant', 'primary');
    await expect(app(page).getByRole('link', { name: 'Return to space' })).toBeVisible();
    // The technical detail is a small reference, never the sentence, and nothing is red or failed.
    await expect(failure(page).locator('[data-failure-reference]')).toHaveText(message);
    await expect(failure(page)).not.toContainText('failed');
    await expect(app(page).getByRole('alert')).toHaveCount(0);
    await expect(app(page).getByRole('heading', { level: 1 })).toHaveText(
      'This page could not open.',
    );
  });

test('Retry runs the open again and the page opens when it works', async ({ page }) => {
  await mount(page);
  await openAlphaFailing(page, 'Sync disconnected');
  await expect(failure(page)).toBeVisible();
  expect(await page.evaluate(() => window.pageOpens.length)).toBe(1);
  await page.evaluate(() => {
    window.failPages = undefined;
  });
  await retry(page).click();
  await expect(body(page)).toBeVisible();
  await expect(failure(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.pageOpens.length)).toBe(2);
});

test('a Retry that fails again keeps the card and offers Retry again', async ({ page }) => {
  await mount(page);
  await openAlphaFailing(page, 'Sync disconnected');
  await expect(failure(page)).toBeVisible();
  await retry(page).click();
  await expect.poll(() => page.evaluate(() => window.pageOpens.length)).toBe(2);
  await expect(failure(page)).toBeVisible();
  await expect(retry(page)).toBeEnabled();
  await retry(page).click();
  await expect.poll(() => page.evaluate(() => window.pageOpens.length)).toBe(3);
  await expect(failure(page)).toContainText('This page could not open.');
});

for (const [message, sentence, label] of [
  ['Access ended', 'Your access to this page ended.', 'Access denied'],
  ['REMOTE_DEVICE_REVOKED', "This browser's pairing was removed.", 'Pairing removed'],
  ['Page unavailable', 'This page is unavailable.', 'Page unavailable'],
] as const)
  test(`"${message}" while opening is a refusal: the red card, its sentence and no Retry`, async ({
    page,
  }) => {
    await mount(page);
    await openAlphaFailing(page, message);
    const alert = app(page).getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Page unavailable');
    await expect(alert).toContainText('failed');
    await expect(alert).toContainText(sentence);
    await expect(alert.locator('[data-failure-reference]')).toHaveText(label);
    await expect(alert.locator('[data-failure-reference]')).toHaveAttribute('title', message);
    await expect(retry(page)).toHaveCount(0);
    await expect(app(page).getByRole('link', { name: 'Return to space' })).toBeVisible();
  });

test('a page over the read limits says so and offers no Retry', async ({ page }) => {
  await mount(page);
  await openAlphaFailing(page, 'CAPACITY');
  await expect(failure(page)).toContainText('This page is too large to open here.');
  await expect(failure(page)).toContainText(
    'Export it with tmt colab export and open the copy as a new page.',
  );
  await expect(retry(page)).toHaveCount(0);
  await expect(app(page).getByRole('link', { name: 'Return to space' })).toBeVisible();
  // A readable label, not the raw token; the header says what the card says.
  await expect(failure(page).locator('[data-failure-reference]')).toHaveText('Page too large');
  await expect(app(page).getByRole('heading', { level: 1 })).toHaveText(
    'This page is too large to open here.',
  );
});

test('while Retry runs the page shows the same opening frame as a first open', async ({ page }) => {
  await mount(page);
  await openAlphaFailing(page, 'Sync disconnected');
  await expect(failure(page)).toBeVisible();
  await page.evaluate(() => {
    window.failPages = undefined;
    window.holdPages = new Promise<void>((resolve) => {
      (window as unknown as { releasePages: () => void }).releasePages = resolve;
    });
  });
  await retry(page).click();
  await expect(app(page).getByRole('status', { name: 'Opening page' })).toBeVisible();
  await expect(failure(page)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { releasePages: () => void }).releasePages());
  await expect(body(page)).toBeVisible();
});

for (const theme of ['light', 'dark'] as const)
  for (const width of [1440, 390])
    for (const [name, message] of [
      ['retry', 'Sync disconnected'],
      ['retrying', 'Sync disconnected'],
      ['large', 'CAPACITY'],
      ['refused', 'Access ended'],
    ])
      test(`captures: the ${name} open failure at ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await mount(page);
        await openAlphaFailing(page, message);
        await expect(app(page).getByRole('heading', { level: 1 })).toBeVisible();
        await expect(app(page).locator('.tmt-ui-notice')).toBeVisible();
        if (name === 'retrying') {
          await page.evaluate(() => {
            window.failPages = undefined;
            window.holdPages = new Promise<void>(() => {});
          });
          await retry(page).click();
          await expect(app(page).getByRole('status', { name: 'Opening page' })).toBeVisible();
        }
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: capturePath(`4012-open-failure-${name}-${width}-${theme}.png`),
        });
      });

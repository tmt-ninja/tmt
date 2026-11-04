import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { commentsRegion } from '../test/comments-region.js';
const fixture = '/test/ask-page-browser.tsx';
async function run(page: import('@playwright/test').Page, method: string, argument?: unknown) {
  return page.evaluate(
    async ({ fixture, method, argument }) => (await import(fixture))[method](argument),
    { fixture, method, argument },
  );
}
for (const width of [390, 1440])
  for (const theme of ['light', 'dark'] as const)
    test(`a reference opens its admitted thread and missing or Chat references remain inert ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      await run(page, 'mount', {});
      await run(page, 'authored', '<p>Exact selected text</p>');
      await run(page, 'seedThread');
      const [thread] = await run(page, 'discussionProof');
      const missing = '10000000-0000-4000-8000-000000000099';
      const refs = await run(page, 'referenceFixtureThreads');
      await run(
        page,
        'change',
        `<p>Exact selected text</p><p>See <tmt-thread-ref data-writer="${thread.ref.writer}" data-thread="${thread.ref.id}">ignored</tmt-thread-ref> and <tmt-thread-ref data-writer="${thread.ref.writer}" data-thread="${missing}">wrong</tmt-thread-ref> <tmt-thread-ref data-writer="${refs.chat.writer}" data-thread="${refs.chat.id}"></tmt-thread-ref> <tmt-thread-ref data-writer="${refs.deleted.writer}" data-thread="${refs.deleted.id}"></tmt-thread-ref> <tmt-thread-ref data-writer="${thread.ref.writer}" data-thread="${thread.ref.id}" title="extra"></tmt-thread-ref>.</p>`,
      );
      const frame = page.frameLocator('#ask-page-fixture iframe');
      const reference = frame.getByRole('button', { name: /Open thread \d+: Exact selected text/ });
      await expect(reference).toBeVisible();
      await expect(frame.getByText('Thread not found')).toHaveCount(4);
      await expect(frame.getByText('ignored')).toBeHidden();
      const folder = process.env.COLAB_CAPTURE_DIR ?? info.outputDir;
      mkdirSync(folder, { recursive: true });
      await page.screenshot({ path: `${folder}/thread-reference-${width}-${theme}.png` });
      await reference.click();
      await expect(page.locator('#ask-page-fixture').getByTestId('comments-panel')).toBeVisible();
      await expect(page.locator('#ask-page-fixture').getByText('Opening note')).toBeVisible();
      await expect(frame.locator('.annotation-number[data-colab-selected]')).toHaveCount(1);
      await page.screenshot({ path: `${folder}/thread-reference-open-${width}-${theme}.png` });
    });

test('a reference to a resolved thread opens it even when Open is the current filter', async ({
  page,
}) => {
  await page.goto('/');
  await run(page, 'mount', {});
  await run(page, 'authored', '<p>Exact selected text</p>');
  await run(page, 'seedThread');
  const [thread] = await run(page, 'discussionProof');
  await run(
    page,
    'change',
    `<p>Exact selected text</p><tmt-thread-ref data-writer="${thread.ref.writer}" data-thread="${thread.ref.id}"></tmt-thread-ref>`,
  );
  const reference = page
    .frameLocator('#ask-page-fixture iframe')
    .getByRole('button', { name: /Open thread/ });
  await reference.click();
  const panel = commentsRegion(page);
  await panel.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(panel.getByTestId('comments-empty')).toBeVisible();
  await panel.getByRole('button', { name: 'Close (Esc)', exact: true }).click();
  await reference.click();
  await expect(panel.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await expect(panel.getByText('Opening note')).toBeVisible();
});

test('a frame message cannot open a reference without user activation', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = MessageChannel;
    Object.assign(window, {
      referenceProbe: {},
      MessageChannel: class extends Original {
        constructor() {
          super();
          const post = this.port1.postMessage.bind(this.port1);
          this.port1.postMessage = (value: unknown) => {
            const message = value as { type?: string };
            if (message?.type === 'colab.render.thread-references')
              Object.assign((window as unknown as { referenceProbe: object }).referenceProbe, {
                port: this.port1,
                request: value,
              });
            post(value);
          };
        }
      },
    });
  });
  await page.goto('/');
  await run(page, 'mount', {});
  await run(page, 'authored', '<p>Exact selected text</p>');
  await run(page, 'seedThread');
  const [thread] = await run(page, 'discussionProof');
  const seenBefore = await run(page, 'seenProof');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = (
          window as unknown as { referenceProbe: { request?: { entries: unknown[] } } }
        ).referenceProbe;
        return probe.request?.entries.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.evaluate((id) => {
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive: false },
      configurable: true,
    });
    const probe = (
      window as unknown as {
        referenceProbe: { port: MessagePort; request: { renderId: string; requestId: string } };
      }
    ).referenceProbe;
    probe.port.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'colab.render.open-reference',
          renderId: probe.request.renderId,
          requestId: probe.request.requestId,
          id,
        },
      }),
    );
  }, `${thread.ref.writer}:${thread.ref.id}`);
  expect(await run(page, 'seenProof')).toBe(seenBefore);
});

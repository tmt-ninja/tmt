import { expect, test } from '@playwright/test';
import vectors from '../../../contracts/vectors/needs-you-v1.json' with { type: 'json' };

for (const vector of vectors.cases) {
  test(`native/browser legacy pending parity: ${vector.name}`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (vector) => {
      const fixture = '/test/ask-page-browser.tsx';
      const app = await import(/* @vite-ignore */ fixture);
      await app.mount();
      app.pendingVector(vector);
    }, vector);
    const host = page.locator('#ask-page-fixture');
    const expected = vector.expected;
    const count = expected.length;
    if (count) {
      const trigger = host.getByRole('button', { name: `Needs you: ${count}`, exact: true });
      await expect(trigger).toBeVisible();
      await trigger.click();
      const items = page.getByRole('menu').locator('[role=menuitem][data-needs-you-kind]');
      await expect(items).toHaveCount(count);
      // #5814 adds one command, not another pending target or another header count.
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveCount(count + 1);
      await expect(page.getByRole('menuitem', { name: 'Clear all', exact: true })).toHaveCount(1);
      expect(
        await items.evaluateAll((nodes) =>
          nodes.map((node) => ({
            kind: (node as HTMLElement).dataset.needsYouKind,
            id: (node as HTMLElement).dataset.needsYouId,
          })),
        ),
      ).toEqual(expected);
    } else {
      await expect(host.getByLabel('✓ Nothing waits', { exact: true })).toBeVisible();
      await expect(host.locator('.needs-you-header button')).toHaveCount(0);
    }
  });
}

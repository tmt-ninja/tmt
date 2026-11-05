import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(
  readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
);
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const b = (role: string, theme: 'dark' | 'light') => rgb(tokens.browser.surface[role][theme]);

/** Paints a probe with a role inside an element built from `markup`, and reads it back. */
async function probe(page: import('@playwright/test').Page, markup: string, style: string) {
  return page.evaluate(
    ({ markup, style }) => {
      const host = document.createElement('div');
      host.innerHTML = markup;
      document.body.append(host);
      const target = host.querySelector('[data-probe]') as HTMLElement;
      target.setAttribute('style', style);
      const computed = getComputedStyle(target);
      const result = { background: computed.backgroundColor, radius: computed.borderTopLeftRadius };
      host.remove();
      return result;
    },
    { markup, style },
  );
}

for (const scheme of ['dark', 'light'] as const)
  test(`the selected palette is global and respects explicit themes on system ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?frame=glyphs');
    const paper = 'background: var(--tmt-ui-surface-paper)';
    expect((await probe(page, '<div data-probe></div>', paper)).background).toBe(
      b('paper', scheme),
    );
    expect(
      (await probe(page, '<div data-theme="dark"><div data-probe></div></div>', paper)).background,
    ).toBe(b('paper', 'dark'));
    expect(
      (
        await probe(
          page,
          '<div data-theme="dark"><div data-theme="light"><div data-probe></div></div></div>',
          paper,
        )
      ).background,
    ).toBe(b('paper', 'light'));
  });

test('the shared controls use the selected palette and retain the local radius preview', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?frame=theme-b&theme=dark&radius=2');
  const send = page.getByRole('button', { name: 'Send', exact: true }).first();
  // red-600, not the brand red-500: white text on a filled control keeps 4.5:1.
  await expect(send).toHaveCSS('background-color', rgb(tokens.browser.ref['red-600']));
  await expect(send).toHaveCSS('border-top-left-radius', '2px');
  await page.getByRole('button', { name: '4 / 6' }).click();
  await expect(send).toHaveCSS('border-top-left-radius', '4px');
  await page.getByRole('button', { name: 'Current' }).click();
  await expect(send).toHaveCSS('border-top-left-radius', '8px');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('main.theme-b')).toHaveCSS('background-color', b('paper', 'light'));
});

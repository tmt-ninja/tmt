import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixedOrder = '@layer colab-frame,tmt-starter,theme,base,tmt-ui;';
const previousOrder = '@layer colab-frame,tmt-starter,tmt-ui;';
const captures = process.env.COLAB_DESIGN_CAPTURE_DIR;
for (const kind of ['plain', 'tailwind'] as const) {
  test(`layer prelude before and after on an existing ${kind} author page`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: 'light' });
    const source = `${kind === 'tailwind' ? '<meta name="tmt-colab-runtime" content="react tailwind">' : ''}
<h1>Existing author page</h1><p>A paragraph with <strong>emphasis</strong> and an ordinary link.</p>
${kind === 'tailwind' ? '<button id="ds" class="tmt-ui-action" data-variant="primary">Design action</button><button id="tw" class="rounded bg-focus px-4 py-2 text-white">Tailwind action</button>' : '<button id="plain">Plain action</button>'}`;
    for (const name of ['colab-runtime.js', 'colab-runtime.css'])
      await page.route(`**/assets/${name}`, (route) =>
        route.fulfill({
          contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css',
          body: readFileSync(new URL(`../dist/assets/${name}`, import.meta.url), 'utf8'),
        }),
      );
    await page.route('**/src/main.tsx', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
import { mountRenderer } from '/src/renderer.ts';
import '/src/style.css';
const host = document.getElementById('root');
host.className = 'frame-host';
void mountRenderer(host, ${JSON.stringify(source)}, {signal: new AbortController().signal});`,
      }),
    );
    const paint: Record<string, unknown> = {};
    const images: Buffer[] = [];
    for (const mode of ['before', 'after'] as const) {
      await page.unroute('**/renderer.html');
      await page.route('**/renderer.html', async (route) => {
        const response = await route.fetch();
        const html = await response.text();
        expect(html.includes(fixedOrder)).toBe(true);
        // A controlled baseline: the exact current frame, with only the approved prelude removed.
        await route.fulfill({
          response,
          body: mode === 'before' ? html.replace(fixedOrder, previousOrder) : html,
        });
      });
      await page.goto('/');
      const frame = page.locator('iframe').contentFrame();
      await expect(
        frame.getByRole('heading', { name: 'Existing author page', exact: true }),
      ).toBeVisible();
      if (kind === 'tailwind') await expect(frame.locator('#tw')).toHaveCSS('padding-left', '16px');
      paint[mode] = await frame.locator('body').evaluate((body) =>
        Object.fromEntries(
          ['h1', 'p', 'strong', 'button'].map((selector) => [
            selector,
            [...body.querySelectorAll(selector)].map((element) => {
              const style = getComputedStyle(element);
              return Object.fromEntries(
                [
                  'font-size',
                  'font-weight',
                  'margin-top',
                  'margin-bottom',
                  'padding',
                  'height',
                  'color',
                  'background-color',
                  'border-radius',
                ].map((name) => [name, style.getPropertyValue(name)]),
              );
            }),
          ]),
        ),
      );
      await frame.locator('body').evaluate(() => document.fonts.ready);
      if (captures) mkdirSync(captures, { recursive: true });
      const png = await page
        .locator('iframe')
        .screenshot(
          captures ? { path: join(captures, `existing-${kind}-${mode}-1440-light.png`) } : {},
        );
      images.push(png);
    }
    await test.info().attach(`existing-${kind}-computed-before-after`, {
      body: JSON.stringify(paint, null, 2),
      contentType: 'application/json',
    });
    if (kind === 'plain') {
      expect(paint.after).toEqual(paint.before);
      expect(images[1]!.equals(images[0]!)).toBe(true);
    } else {
      const before = paint.before as Record<string, Record<string, string>[]>;
      const after = paint.after as Record<string, Record<string, string>[]>;
      for (const selector of ['h1', 'p', 'strong'])
        expect(after[selector], selector).toEqual(before[selector]);
      const rows = after.button!;
      expect(rows[0]!['background-color']).not.toBe('rgba(0, 0, 0, 0)');
      expect(rows[1]!['background-color']).not.toBe('rgba(0, 0, 0, 0)');
      expect(rows[1]).toEqual(
        (paint.before as Record<string, Record<string, string>[]>).button![1],
      );
    }
  });
}

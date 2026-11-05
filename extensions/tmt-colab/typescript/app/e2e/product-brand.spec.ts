import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { servePageRuntime } from './page-runtime.js';

const selected = readFileSync(
  new URL('../../../../../design/browser-ui/src/brand-mark.svg', import.meta.url),
  'utf8',
);
const shape = selected.match(/<path[^>]* d="([^"]+)"/)![1]!;
const captures = process.env.COLAB_BRAND_CAPTURE_DIR;

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    for (const path of ['/colab/', '/design/ds/gui', '/design/ds/gui/tokens/brand'])
      test(`selected ninja: ${path} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((theme) => {
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.dataset.theme = theme;
          });
        }, theme);
        // The existing private in-memory space mounts the real router and shell, with no host data.
        // Design draws the built-in tmt GUI's pages in its page frame (#6060).
        await page.route('**/colab/renderer.html', async (route) =>
          route.fulfill({
            response: await route.fetch({
              url: new URL('/renderer.html', route.request().url()).href,
            }),
          }),
        );
        await servePageRuntime(page);
        await page.route('**/src/main.tsx', (route) =>
          route.fulfill({
            contentType: 'text/javascript',
            body: `import {mountDesign} from '/test/design-route-browser.tsx'; void mountDesign('${path}', true);`,
          }),
        );
        await page.goto(path);
        const current = page.locator('.tmt-ui-rail [aria-current="page"]');
        await expect(current).toHaveCount(1);
        if (path.startsWith('/design')) await expect(current).toHaveText('Design');
        else await expect(current).toHaveAttribute('data-id', 'all');
        const frame = page.locator('.design-workspace iframe').first().contentFrame();
        if (path.startsWith('/design'))
          await expect(frame.locator('.docs-article h1').first()).toBeVisible();
        else await expect(page.getByRole('heading', { name: /All pages$/ })).toBeVisible();
        if (path.endsWith('/brand')) {
          await expect(frame.locator('.docs-article h1').first()).toHaveText('Brand');
          await expect(frame.locator('.docs-canvas svg.tmt-brand-mark')).toHaveCount(4);
        }
        const mark = page.locator('.tmt-ui-shell-brand > svg');
        expect(await mark.locator('path').first().getAttribute('d')).toBe(shape);
        const marks = [page.locator('svg.tmt-brand-mark')];
        if (path.endsWith('/brand')) marks.push(frame.locator('svg.tmt-brand-mark'));
        for (const marked of marks) {
          const paints = await marked.evaluateAll((elements) =>
            elements.map((element) => ({
              tile: getComputedStyle(element.querySelector('.tmt-brand-mark-tile')!).fill,
              ink: getComputedStyle(element.querySelector('path')!).fill,
              prompt: getComputedStyle(element.querySelector('path[stroke]')!).stroke,
              ids: element.querySelectorAll('[id]').length,
            })),
          );
          for (const paint of paints)
            expect(paint).toEqual({
              tile: 'rgb(10, 10, 10)',
              ink: 'rgb(242, 239, 233)',
              prompt: 'rgb(242, 239, 233)',
              ids: 0,
            });
        }
        await page.evaluate(() => document.fonts.ready);
        if (captures) {
          mkdirSync(captures, { recursive: true });
          const routeName = path.endsWith('/brand')
            ? 'brand'
            : path.startsWith('/design')
              ? 'design'
              : 'colab';
          const name = `${routeName}-${width}-${theme}`;
          await page.screenshot({ path: join(captures, `${name}.png`), fullPage: true });
          if (width === 390)
            await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
          // The existing phone drawer hides its brand head; retain that layout contract.
          if (width === 390) await expect(mark).toBeHidden();
          else await expect(mark).toBeVisible();
          await page
            .locator('.tmt-ui-rail')
            .screenshot({ path: join(captures, `${name}-rail.png`) });
        }
      });

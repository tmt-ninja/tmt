import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const nativePolicy = readFileSync(
  new URL('../../../rust/tmt-colab/src/browser_policy.rs', import.meta.url),
  'utf8',
).match(/pub const POLICY: &str = "([^"]+)";/)![1]!;
const base = '/colab/design';
const captures = process.env.COLAB_DESIGN_CAPTURE_DIR;
async function capture(page: Page, name: string) {
  if (!captures) return;
  mkdirSync(captures, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(captures, name), fullPage: true });
}
async function open(page: Page, owner = true) {
  // Match the native door's renderer entry; Vite otherwise returns the parent SPA.
  await page.route('**/colab/renderer.html', async (route) =>
    route.fulfill({
      response: await route.fetch({ url: new URL('/renderer.html', route.request().url()).href }),
    }),
  );
  // The dev fixture serves the exact runtime built and pin-checked before this suite.
  for (const name of ['colab-runtime.js', 'colab-runtime.css'])
    await page.route(`**/assets/${name}`, (route) =>
      route.fulfill({
        contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css',
        body: readFileSync(new URL(`../dist/assets/${name}`, import.meta.url), 'utf8'),
      }),
    );
  await page.addInitScript((policy) => {
    (
      window as unknown as { designParentPolicy: string; designViolations: string[] }
    ).designParentPolicy = policy;
    (window as unknown as { designViolations: string[] }).designViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { designViolations: string[] }).designViolations.push(
        `${event.effectiveDirective}: ${event.blockedURI}`,
      );
    });
  }, nativePolicy);
  await page.route('**/src/main.tsx', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `import {mountDesign} from '/test/design-route-browser.tsx'; void mountDesign('${base}/',${owner});`,
    }),
  );
  await page.goto(`${base}/`);
  await expect(
    page
      .getByRole('combobox', { name: 'Design system', exact: true })
      .getByRole('option', { name: 'Acme', exact: true }),
  ).toHaveCount(1);
}
async function chromePaint(page: Page) {
  return page
    .locator('.tmt-ui-topbar-common button')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        [
          'color',
          'backgroundColor',
          'fontFamily',
          'fontSize',
          'lineHeight',
          'padding',
          'borderRadius',
          'height',
          'width',
        ].map((key) => [
          key,
          style.getPropertyValue(key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
        ]),
      );
    });
}
async function docsMenu(page: Page) {
  await expect(page.locator('.tmt-design-docs .docs-main')).toBeVisible();
  const menu = page.locator('.docs-menu-button');
  if (page.viewportSize()!.width <= 900) {
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('.docs-nav')).toBeVisible();
  }
}
async function railMenu(page: Page) {
  const menu = page.locator('.tmt-ui-shell-open');
  if (await menu.isVisible()) await menu.click();
}
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`Design owns docs, user trees and header actions, ${width}, ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript((value) => {
        if (window === window.top) localStorage.setItem('tmt-docs-theme', value);
      }, theme);
      await page.emulateMedia({ colorScheme: theme });
      await open(page);
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveText('Design');
      await expect(page.locator('.colab-route .tmt-ui-rail-sub')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'New design system', exact: true }),
      ).toBeVisible();
      await docsMenu(page);
      await page.locator('.docs-nav').getByRole('link', { name: 'Button', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/ds/gui/components/button$`));
      await expect(page.locator('.docs-main h1')).toHaveText('Button');
      const withDesignDocs = await chromePaint(page);
      await capture(page, `design-gui-button-${width}-${theme}.png`);
      await page.getByRole('combobox', { name: 'Design system', exact: true }).selectOption('tui');
      await docsMenu(page);
      await page.locator('.docs-nav a[href$="/ds/tui/roles"]').click();
      await expect(page).toHaveURL(new RegExp(`${base}/ds/tui/roles$`));
      await expect(page.locator('.docs-main h1')).toContainText('Roles');
      await expect(page.locator('tmt-tui-frame').first()).toContainText('worker');
      await capture(page, `design-tui-roles-${width}-${theme}.png`);
      await page.getByRole('button', { name: 'New design system', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Brio');
      await dialog.getByRole('textbox', { name: 'Tag prefix', exact: true }).fill('brio');
      await capture(page, `design-new-${width}-${theme}.png`);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page
          .getByRole('combobox', { name: 'Design system', exact: true })
          .getByRole('option', { name: 'Brio', exact: true }),
      ).toHaveCount(1);
      const source = page.locator('.design-page iframe').contentFrame();
      await expect(source.getByRole('heading', { name: 'Brio', exact: true })).toBeVisible();
      const pickerBox = await page
        .getByRole('combobox', { name: 'Design system', exact: true })
        .boundingBox();
      expect(pickerBox!.width).toBeGreaterThan(60);
      const frameBox = await page.locator('.design-page iframe').boundingBox();
      const hostBox = await page.locator('.design-page-renderer').boundingBox();
      expect(frameBox!.width).toBeCloseTo(hostBox!.width, 0);
      await capture(page, `design-user-home-${width}-${theme}.png`);
      await page.getByRole('button', { name: 'Publish 0.1.1', exact: true }).click();
      await expect(page.locator('.design-feedback[role="status"]')).toContainText(
        'Published 0.1.1.',
      );
      await expect(page.getByRole('button', { name: 'Publish 0.1.2', exact: true })).toBeEnabled();
      if (width === 390) await page.getByRole('button', { name: 'Pages', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Brio pages', exact: true })
        .getByRole('link', { name: 'brio-button', exact: true })
        .click();
      await expect(
        page
          .locator('.design-page iframe')
          .contentFrame()
          .getByRole('heading', { name: '<brio-button>', exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('.design-page iframe').contentFrame().getByRole('button').first(),
      ).toBeVisible();
      await capture(page, `design-user-component-${width}-${theme}.png`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false,
      );
      const tree = await page.evaluate(() => {
        const f = (
          window as unknown as {
            designFixture: { pages: Map<string, { title: string; order: string[] }> };
          }
        ).designFixture;
        const root = [...f.pages].find(([, p]) => p.title === 'Brio')![0];
        return [...f.pages.values()].some((p) => p.order.includes(root));
      });
      expect(tree, 'the new design system is not nested under another page').toBe(false);
      await railMenu(page);
      await page.locator('.tmt-ui-rail').getByRole('link', { name: 'Colab', exact: true }).click();
      await expect(page.locator('.design-workspace')).toHaveCount(0);
      await expect(page).toHaveURL(/\/colab\/$/);
      expect(
        await chromePaint(page),
        'scoped docs CSS leaves Colab common controls unchanged',
      ).toEqual(withDesignDocs);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { designFixture: { counts: { active: number } } }).designFixture
                .counts.active,
          ),
        )
        .toBe(0);
      await page.goBack();
      await expect(
        page
          .locator('.design-page iframe')
          .contentFrame()
          .getByRole('heading', { name: '<brio-button>', exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as { designViolations: string[] }).designViolations,
        ),
      ).toEqual([]);
    });
test('read-only Design viewers can select a tree but cannot create or publish', async ({
  page,
}) => {
  await open(page, false);
  await expect(page.getByRole('button', { name: 'New design system', exact: true })).toHaveCount(0);
  const picker = page.getByRole('combobox', { name: 'Design system', exact: true });
  const id = await picker.getByRole('option', { name: 'Acme', exact: true }).getAttribute('value');
  await picker.selectOption(id!);
  await expect(
    page
      .locator('.design-page iframe')
      .contentFrame()
      .getByRole('heading', { name: 'Acme', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Publish / })).toHaveCount(0);
});

test('a refused Publish remains visible, keeps the version and supports an explicit retry', async ({
  page,
}) => {
  await open(page);
  const picker = page.getByRole('combobox', { name: 'Design system', exact: true });
  await picker.selectOption(
    (await picker.getByRole('option', { name: 'Acme', exact: true }).getAttribute('value'))!,
  );
  await expect(page.getByRole('button', { name: 'Publish 0.1.1', exact: true })).toBeEnabled();
  await page.evaluate(
    () =>
      ((
        window as unknown as { designFixture: { controls: { failUpload: boolean } } }
      ).designFixture.controls.failUpload = true),
  );
  await page.getByRole('button', { name: 'Publish 0.1.1', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fixture upload refused');
  await expect(page.getByRole('button', { name: 'Publish 0.1.1', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.evaluate(
    () =>
      ((
        window as unknown as { designFixture: { controls: { failUpload: boolean } } }
      ).designFixture.controls.failUpload = false),
  );
  await page.getByRole('button', { name: 'Reload design systems', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish 0.1.1', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish 0.1.1', exact: true }).click();
  await expect(page.locator('.design-feedback[role="status"]')).toContainText('Published 0.1.1.');
  await expect(page.getByRole('button', { name: 'Publish 0.1.2', exact: true })).toBeEnabled();
});

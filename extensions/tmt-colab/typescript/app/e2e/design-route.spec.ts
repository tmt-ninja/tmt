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
async function open(page: Page, owner = true, routeBase = base) {
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
      body: `import {mountDesign} from '/test/design-route-browser.tsx'; void mountDesign('${routeBase}/',${owner});`,
    }),
  );
  await page.goto(`${routeBase}/`);
  await expect.poll(() => systemNames(page)).toContain('Acme');
}
/** The header crumb's DS menu: open it, choose a system by name, or read its names. */
const systemMenu = (page: Page) => page.getByRole('button', { name: /^Design system/ });
async function systemNames(page: Page): Promise<string[]> {
  await systemMenu(page).click();
  const names = await page.getByRole('menuitemradio').allTextContents();
  await page.keyboard.press('Escape');
  // A checked row draws its mark after the name.
  return names.map((name) => name.replace(/✓$/, '').trim());
}
async function pickSystem(page: Page, name: string) {
  await systemMenu(page).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
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
/** The reader frame of the open Design page. */
const designFrame = (page: Page) => page.locator('.design-workspace iframe').first().contentFrame();
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
      // The docs follow the GUI theme (#5866): here the device's, since nothing is stored.
      await page.emulateMedia({ colorScheme: theme });
      await open(page);
      await expect(page.locator('.tmt-design-docs')).toHaveAttribute('data-theme', theme);
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
      await pickSystem(page, 'tmt TUI');
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
      await expect.poll(() => systemNames(page)).toContain('Brio');
      // A Design page is the Colab page in its reader frame, with Chat and the discussion (#5866).
      await expect(
        designFrame(page).getByRole('heading', { name: 'Brio', exact: true }),
      ).toBeVisible();
      await expect(
        designFrame(page).getByRole('heading', { name: 'Components', exact: true }),
      ).toBeVisible();
      await expect(designFrame(page).getByRole('link', { name: /brio-button/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Comments/ })).toBeVisible();
      // The crumb shows the whole system name, not a clipped stub.
      await expect(systemMenu(page)).toContainText('Brio');
      expect(
        await systemMenu(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
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
        designFrame(page).getByRole('heading', { name: '<brio-button>', exact: true }),
      ).toBeVisible();
      await expect(
        designFrame(page).getByRole('heading', { name: 'Props', exact: true }),
      ).toBeVisible();
      await expect(designFrame(page).locator('table')).toContainText('variant');
      await expect(page.getByRole('link', { name: 'Open in Colab', exact: true })).toHaveAttribute(
        'href',
        /\/colab\/pages\/[0-9a-f-]+$/,
      );
      const bundlePaint = await designFrame(page)
        .locator('[data-ds-example="button:primary"]')
        .getByRole('button', { name: 'Save', exact: true })
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const swatch = document.createElement('span');
          swatch.style.color = 'var(--tmt-ui-color-accent-fill)';
          document.body.append(swatch);
          const accentPaint = getComputedStyle(swatch).color;
          swatch.remove();
          return {
            accentPaint,
            display: style.display,
            height: style.height,
            background: style.backgroundColor,
            classes: element.className,
            controlSize: style.getPropertyValue('--tmt-ui-control-size-l'),
            accent: style.getPropertyValue('--tmt-ui-color-accent-fill'),
            layers: [...document.styleSheets].map((sheet) => {
              try {
                return [...sheet.cssRules].map((rule) => rule.cssText.slice(0, 200));
              } catch {
                return [];
              }
            }),
          };
        });
      await test.info().attach('published-bundle-computed-style', {
        body: JSON.stringify(bundlePaint, null, 2),
        contentType: 'application/json',
      });
      expect(bundlePaint.display).toMatch(/^(inline-)?flex$/);
      expect(bundlePaint.height).toBe(bundlePaint.controlSize.trim());
      expect(bundlePaint.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(bundlePaint.background).toBe(bundlePaint.accentPaint);
      // Each example is a live element of the page, anchored by `<component>:<example id>`.
      const examples = designFrame(page).locator('[data-ds-example]');
      await expect(examples).toHaveCount(7);
      expect(
        await examples.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-ds-example')),
        ),
      ).toEqual([
        'button:primary',
        'button:secondary',
        'button:outline',
        'button:ghost',
        'button:sizes',
        'button:with-an-icon',
        'button:disabled',
      ]);
      for (let index = 0; index < 7; index++) {
        const button = examples.nth(index).getByRole('button').first();
        await expect(button).toHaveClass(/tmt-ui-button/);
        await expect(button).toHaveCSS('display', /^(inline-)?flex$/);
        if (index === 6) await expect(button).toBeDisabled();
      }
      await page.locator('.design-workspace').evaluate((element) => element.scrollTo({ top: 0 }));
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
        designFrame(page).getByRole('heading', { name: '<brio-button>', exact: true }),
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
  await pickSystem(page, 'Acme');
  await expect(designFrame(page).getByRole('heading', { name: 'Acme', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Publish / })).toHaveCount(0);
});

test('a refused Publish remains visible, keeps the version and supports an explicit retry', async ({
  page,
}) => {
  await open(page);
  await pickSystem(page, 'Acme');
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
  await expect(page.locator('.design-feedback[role="status"]')).toHaveCount(0);
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

test('standalone Design keeps its docs, system cards and editing links on their owning mounts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, true, '/design');
  await expect(page).toHaveURL(/\/design\/ds\/gui$/);
  await page.locator('.docs-nav').getByRole('link', { name: 'Button', exact: true }).click();
  await expect(page).toHaveURL(/\/design\/ds\/gui\/components\/button$/);
  await pickSystem(page, 'Acme');
  await expect(designFrame(page).getByRole('heading', { name: 'Acme', exact: true })).toBeVisible();
  // A link in the system's home page to one of its pages stays in Design.
  await designFrame(page)
    .getByRole('link', { name: /acme-button/ })
    .click();
  await expect(page).toHaveURL(/\/design\/systems\/[0-9a-f-]+\/[0-9a-f-]+$/);
  await expect(
    designFrame(page).getByRole('heading', { name: '<acme-button>', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Colab', exact: true })).toHaveAttribute(
    'href',
    /^http:\/\/127\.0\.0\.1:[0-9]+\/colab\/pages\/[0-9a-f-]+$/,
  );
});

test('the header crumb opens the DS menu from the keyboard and closes on Escape', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('.design-header-title select')).toHaveCount(0);
  const trigger = systemMenu(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const items = page.getByRole('menuitemradio');
  await expect(items.first()).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'tmt GUI', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('ArrowDown');
  await expect(page.locator(':focus')).toHaveAttribute('role', 'menuitemradio');
  await page.keyboard.press('Escape');
  await expect(items).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('a click on a design-system example in selection mode quotes the whole example', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await pickSystem(page, 'Acme');
  await designFrame(page)
    .getByRole('link', { name: /acme-button/ })
    .click();
  const example = designFrame(page).locator('[data-ds-example="button:secondary"]');
  await expect(example.getByRole('button', { name: 'Draft', exact: true })).toBeVisible();
  // C in the page toggles selection mode, as on any Colab page.
  await designFrame(page).locator('h1').click();
  await page.keyboard.press('c');
  await example.getByRole('button', { name: 'Draft', exact: true }).click();
  const popover = page.locator('.annotation-popover');
  await expect(popover).toBeVisible();
  // The anchor is the example's text: its live label and the markup that draws it.
  await expect(popover).toContainText('<acme-button variant="secondary">Draft</acme-button>');
  await page.keyboard.type('Make this the outline variant');
  await page.keyboard.press('Enter');
  const anchors = () =>
    page.evaluate(
      () =>
        (window as unknown as { designFixture: { anchors: { anchor: { exact: string } }[] } })
          .designFixture.anchors,
    );
  await expect.poll(async () => (await anchors()).length).toBe(1);
  const [{ anchor }] = await anchors();
  expect(anchor.exact).toBe('Draft<acme-button variant="secondary">Draft</acme-button>');
});

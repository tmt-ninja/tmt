import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { servePageRuntime } from './page-runtime.js';
/** The selected product mark's shape, as product-brand.spec reads it. */
const brandShape = readFileSync(
  new URL('../../../../../design/browser-ui/src/brand-mark.svg', import.meta.url),
  'utf8',
).match(/<path[^>]* d="([^"]+)"/)![1]!;
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
  await servePageRuntime(page);
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
/** The built-in tmt GUI as pages (#5969): the owner's first Design visit makes them, and `/ds/gui`
 * shows them. Open Button from the page tree. */
async function openGuiButton(page: Page) {
  const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
  const toggle = page.locator('.design-nav-toggle');
  if (page.viewportSize()!.width <= 900) {
    await expect(toggle).toBeVisible({ timeout: 60_000 });
    await toggle.click();
  }
  await expect(tree).toBeVisible({ timeout: 60_000 });
  await tree.getByRole('link', { name: /^Button/ }).click();
  await expect(page).toHaveURL(/\/ds\/gui\/components\/button$/);
  const frame = designFrame(page);
  await expect(frame.getByRole('heading', { name: 'Button', exact: true })).toBeVisible();
  // One quiet line: the files stay in the origin block (#6060).
  await expect(frame.locator('[data-tmt-ds-generated]')).toHaveText(
    'Generated from design/browser-ui; change it through a PR, since edits here are replaced.',
  );
  // A Design page is only the renderer, annotations and Chat: no page header, ... row or work band.
  const workspace = page.locator('.design-workspace');
  await expect(workspace.locator('.colab-embedded-bar')).toHaveCount(0);
  await expect(workspace.locator('.page-header-actions')).toHaveCount(0);
  await expect(workspace.locator('.work-band')).toHaveCount(0);
  // The header names the system; the tree's root reads Introduction (the tree may be collapsed).
  await expect(page.locator('.design-page-tree a').first()).toHaveText('Introduction');
}
/** The owner's generated Brand page draws the product mark (the brand spec covers the viewer's
 * code docs). */
async function expectGuiBrand(page: Page) {
  const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
  const toggle = page.locator('.design-nav-toggle');
  if (!(await tree.isVisible())) await toggle.click();
  await tree.getByRole('link', { name: 'Brand', exact: true }).click();
  await expect(page).toHaveURL(/\/ds\/gui\/[a-z-]+\/brand$/);
  const marks = designFrame(page).locator('svg.tmt-brand-mark');
  await expect(marks.first()).toBeVisible();
  expect(await marks.first().locator('path').first().getAttribute('d')).toBe(brandShape);
}
async function railMenu(page: Page) {
  const menu = page.locator('.tmt-ui-shell-open');
  if (await menu.isVisible()) await menu.click();
}
test('a Browser component page opens with a live chart example', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
  await expect(tree).toBeVisible({ timeout: 60_000 });
  await tree.getByRole('link', { name: /^Chart/ }).click();
  const frame = designFrame(page);
  await expect(frame.getByRole('heading', { name: 'Chart', exact: true })).toBeVisible();
  await expect(frame.getByRole('img', { name: /Activity/ })).toBeVisible();
});
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
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveText('Design');
      await expect(page.locator('.colab-route .tmt-ui-rail-sub')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'New design system', exact: true }),
      ).toBeVisible();
      await openGuiButton(page);
      await capture(page, `design-gui-button-${width}-${theme}.png`);
      await expectGuiBrand(page);
      const withDesignDocs = await chromePaint(page);
      await capture(page, `design-gui-brand-${width}-${theme}.png`);
      await pickSystem(page, 'tmt TUI');
      await docsMenu(page);
      await page.locator('.docs-nav a[href$="/ds/tui/roles"]').click();
      await expect(page).toHaveURL(new RegExp(`${base}/ds/tui/roles$`));
      await expect(page.locator('.tmt-design-docs')).toHaveAttribute('data-theme', theme);
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
        .getByRole('link', { name: /^Colour/ })
        .click();
      await expect(
        designFrame(page).getByRole('heading', { name: 'Colour', exact: true }),
      ).toBeVisible();
      await expect(designFrame(page).locator('.docs-swatch .docs-value').first()).toHaveText(
        /^#[0-9a-f]{6}/,
      );
      if (width === 390) await page.getByRole('button', { name: 'Pages', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Brio pages', exact: true })
        .getByRole('link', { name: /^Tabs row with actions/ })
        .click();
      await expect(
        designFrame(page).getByRole('heading', { name: 'Tabs row with actions', exact: true }),
      ).toBeVisible();
      await designFrame(page)
        .getByRole('tab', { name: /Needs you/ })
        .click();
      await expect(designFrame(page).getByRole('tab', { name: /Needs you/ })).toHaveAttribute(
        'data-state',
        'active',
      );
      await capture(page, `design-user-pattern-${width}-${theme}.png`);
      if (width === 390) await page.getByRole('button', { name: 'Pages', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Brio pages', exact: true })
        // The tree shows each page's title, and a component page's tag under it.
        .getByRole('link', { name: /^Button\s*brio-button$/ })
        .click();
      await expect(
        designFrame(page).getByRole('heading', { name: 'Button', exact: true }),
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
        .getByRole('button', { name: 'Send', exact: true })
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
      await expect(examples).toHaveCount(10);
      expect(
        await examples.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-ds-example')),
        ),
      ).toEqual([
        'button:primary',
        'button:outline',
        'button:secondary',
        'button:ghost',
        'button:destructive',
        'button:sizes',
        'button:with-an-icon',
        'button:disabled',
        'button:variants',
        'button:collapsing-action',
      ]);
      for (let index = 0; index < 10; index++) {
        const button = examples.nth(index).getByRole('button').first();
        // The port of browser-ui's ui Button (#5866): its slot and the ui utility classes.
        await expect(button).toHaveAttribute('data-slot', 'button');
        await expect(button).toHaveClass(/tmt:inline-flex/);
        await expect(button).toHaveCSS('display', /^(inline-)?flex$/);
        if (index === 7) await expect(button).toBeDisabled();
      }
      // A point-and-fix link opens the page at its example (#5961 review): the anchor reaches the page.
      if (width === 1440 && theme === 'light') {
        const last = designFrame(page).locator('[id="button:disabled"]');
        // In page coordinates: whichever box scrolls (the frame or the workspace), it is on screen.
        const inView = async () => {
          const box = await last.boundingBox();
          return !!box && box.y >= 0 && box.y < page.viewportSize()!.height;
        };
        const component = page.url();
        await page.goto(`${component}#${encodeURIComponent('button:disabled')}`);
        await expect.poll(inView).toBe(true);
        // Back within the same document: the fixture space lives in this page.
        await page.goBack();
        await expect(page).toHaveURL(component);
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
        designFrame(page).getByRole('heading', { name: 'Button', exact: true }),
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
  await openGuiButton(page);
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
  // The label line keeps the quote unique; then the live label and the markup.
  expect(anchor.exact).toBe(
    'button:secondaryDraft<acme-button variant="secondary">Draft</acme-button>',
  );
});

test('an agent patch of an example re-renders the open Design page live', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await pickSystem(page, 'Acme');
  await designFrame(page)
    .getByRole('link', { name: /acme-button/ })
    .click();
  const example = designFrame(page).locator('[data-ds-example="button:secondary"]');
  await expect(example.getByRole('button', { name: 'Draft', exact: true })).not.toHaveAttribute(
    'data-variant',
    'outline',
  );
  // The anchored edit the agent makes from the example's quote: its live markup and its snippet.
  const pageId = page.url().split('/').pop()!;
  await page.evaluate((id) => {
    const fixture = (
      window as unknown as {
        designFixture: { patch(id: string, find: string, replace: string): void };
      }
    ).designFixture;
    fixture.patch(
      id,
      '<acme-button variant="secondary">Draft</acme-button>',
      '<acme-button variant="outline">Draft</acme-button>',
    );
    fixture.patch(
      id,
      '&lt;acme-button variant=&quot;secondary&quot;&gt;Draft',
      '&lt;acme-button variant=&quot;outline&quot;&gt;Draft',
    );
  }, pageId);
  await expect(example.getByRole('button', { name: 'Draft', exact: true })).toHaveAttribute(
    'data-variant',
    'outline',
  );
  await expect(example.locator('pre')).toContainText(
    '<acme-button variant="outline">Draft</acme-button>',
  );
  // One place holds each example: the page's block keeps only what publish compiles.
  const block = await page.evaluate((id) => {
    const source = (
      window as unknown as { designFixture: { pages: Map<string, { source: string }> } }
    ).designFixture.pages.get(id)!.source;
    return JSON.parse(/data-tmt-ds="component">([\s\S]*?)<\/script>/.exec(source)![1]);
  }, pageId);
  expect(Object.keys(block)).not.toContain('examples');
  expect(Object.keys(block)).not.toContain('notes');
});

test('a component edit shows at once on the draft, and the header can show a release (#5967)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await pickSystem(page, 'Acme');
  await designFrame(page)
    .getByRole('link', { name: /acme-button/ })
    .click();
  const button = designFrame(page)
    .locator('[data-ds-example="button:secondary"]')
    .getByRole('button', { name: 'Draft', exact: true });
  await expect(button).toBeVisible();
  const outline = () => button.evaluate((element) => getComputedStyle(element).outlineColor);
  const marked = 'rgb(1, 2, 3)';
  expect(await outline()).not.toBe(marked);
  // A Design author's edit of the component's CSS, unpublished: the draft draws it.
  const pageId = page.url().split('/').pop()!;
  await page.evaluate((id) => {
    (
      window as unknown as {
        designFixture: { patch(id: string, find: string, replace: string): void };
      }
    ).designFixture.patch(id, '"css": "', '"css": "[data-variant]{outline:3px solid rgb(1, 2, 3)}');
  }, pageId);
  await expect.poll(outline).toBe(marked);
  const shown = page.getByRole('button', { name: /^Shown version/ });
  await expect(shown).toContainText('Draft');
  // The release view shows what 0.1.0 locked, without the edit, and Draft brings it back.
  await shown.click();
  await page.getByRole('menuitemradio', { name: 'Release 0.1.0', exact: true }).click();
  await expect(shown).toContainText('Release 0.1.0');
  await expect.poll(outline).not.toBe(marked);
  await shown.click();
  await page.getByRole('menuitemradio', { name: 'Draft', exact: true }).click();
  await expect.poll(outline).toBe(marked);
});

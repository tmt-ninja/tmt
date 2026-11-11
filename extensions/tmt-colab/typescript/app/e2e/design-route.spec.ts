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
async function open(page: Page, owner = true, routeBase = base, terminal = false) {
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
      body: `import {mountDesign} from '/test/design-route-browser.tsx'; void mountDesign('${routeBase}/',${owner},{terminal:${terminal}});`,
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
/** The built-in tmt GUI, drawn from what the build ships (#6060). Open Button from the page tree. */
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
  // The docs' own scenes: the hero groups Send, New timer and Cancel as on the docs site.
  for (const name of ['Send', 'New timer', 'Cancel'])
    await expect(frame.getByRole('button', { name, exact: true }).first()).toBeVisible();
  // A Design page is only the renderer, annotations and Chat: no page header, ... row or work band.
  const workspace = page.locator('.design-workspace');
  await expect(workspace.locator('.colab-embedded-bar')).toHaveCount(0);
  await expect(workspace.locator('.page-header-actions')).toHaveCount(0);
  await expect(workspace.locator('.work-band')).toHaveCount(0);
  // The header names the system; the tree, the docs nav, starts at Introduction (it may be collapsed).
  await expect(page.locator('.design-page-tree a').first()).toHaveText('Introduction');
}
/** The built-in Brand page draws the product mark (the brand spec covers the viewer's
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
/** The fixture's pages that hold a built-in page's discussion. */
const discussionPages = (page: Page) =>
  page.evaluate(() =>
    [
      ...(
        window as unknown as {
          designFixture: { pages: Map<string, { id: string; title: string; source: string }> };
        }
      ).designFixture.pages.values(),
    ]
      .filter((item) => item.source.includes('data-tmt-ds="annotates"'))
      .map((item) => ({ id: item.id, title: item.title })),
  );
/** Turn on selection mode once the page can select (its discussion verified). */
async function selectionOn(page: Page) {
  const toggle = page.getByRole('button', { name: 'Selection mode', exact: true });
  await expect(async () => {
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass();
}
test('tmt GUI draws the shipped pages and makes a discussion page only on the first Comment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    // No docs fallback and no updating state may ever show in the workspace.
    const state = window as unknown as { designSeen: string[] };
    state.designSeen = [];
    new MutationObserver(() => {
      const workspace = document.querySelector('.design-workspace');
      if (!workspace) return;
      if (workspace.querySelector(':scope .tmt-design-docs')) state.designSeen.push('docs');
      if (/Updating|Making|Preparing/.test(workspace.textContent ?? ''))
        state.designSeen.push(workspace.textContent!.slice(0, 80));
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await open(page);
  const before = await page.evaluate(
    () =>
      (window as unknown as { designFixture: { pages: Map<string, unknown> } }).designFixture.pages
        .size,
  );
  await openGuiButton(page);
  expect(await discussionPages(page)).toEqual([]);
  // The first Comment makes the page's discussion page; the page still draws the shipped source.
  await page.getByRole('button', { name: 'Selection mode', exact: true }).click();
  await expect
    .poll(() => discussionPages(page))
    .toEqual([{ id: expect.any(String), title: 'Button · tmt GUI' }]);
  const [made] = await discussionPages(page);
  await expect(
    designFrame(page).getByRole('heading', { name: 'Button', exact: true }),
  ).toBeVisible();
  // Comments now work as on any page, once the discussion page has opened.
  await selectionOn(page);
  // An edit to the stored copy never reaches Design: it draws what the build ships.
  await page.evaluate((id) => {
    const fixture = (
      window as unknown as {
        designFixture: { patch(id: string, find: string, replace: string): void };
      }
    ).designFixture;
    fixture.patch(
      id,
      '<tmt-ui-component-docs page="components/button">',
      '<tmt-ui-component-docs page="components/badge">',
    );
  }, made!.id);
  await page.waitForTimeout(300);
  await expect(
    designFrame(page).getByRole('heading', { name: 'Button', exact: true }),
  ).toBeVisible();
  // Another visit finds the same page.
  const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
  await tree.getByRole('link', { name: /^Badge/ }).click();
  await expect(
    designFrame(page).getByRole('heading', { name: 'Badge', exact: true }),
  ).toBeVisible();
  await tree.getByRole('link', { name: /^Button/ }).click();
  await expect(
    designFrame(page).getByRole('heading', { name: 'Button', exact: true }),
  ).toBeVisible();
  await selectionOn(page);
  expect(await discussionPages(page)).toEqual([made]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { designFixture: { pages: Map<string, unknown> } }).designFixture
          .pages.size,
    ),
  ).toBe(before + 1);
  expect(
    await page.evaluate(() => (window as unknown as { designSeen: string[] }).designSeen),
  ).toEqual([]);
});

for (const width of [1440, 390])
  test(`the Design nav scrolls on its own, apart from the page, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await open(page);
    const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
    if (width === 390) await page.locator('.design-nav-toggle').click();
    await expect(tree).toBeVisible();
    // Scroll the nav part way, then the page: the nav keeps its place, scroll and items.
    await tree.evaluate((nav) => {
      nav.scrollTop = 200;
    });
    const read = () =>
      tree.evaluate((nav) => {
        const box = nav.getBoundingClientRect();
        const visible = [...nav.querySelectorAll('a')]
          .filter((link) => {
            const item = link.getBoundingClientRect();
            return item.bottom > box.top && item.top < box.bottom;
          })
          .map((link) => link.textContent);
        return { scroll: nav.scrollTop, visible, top: Math.round(box.top) };
      });
    const before = await read();
    expect(before.scroll).toBeGreaterThan(0);
    await page.locator('.design-workspace').evaluate((workspace) => {
      workspace.scrollTop = 600;
    });
    await expect
      .poll(() => page.locator('.design-workspace').evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    // On a phone the open nav sticks to the workspace's top; on a desktop it never moves.
    const after = await read();
    expect({ ...after, top: width === 390 ? 0 : after.top }).toEqual({
      ...before,
      top: width === 390 ? 0 : before.top,
    });
  });

/** The docs site's own nav, as compile.mjs writes it from design/browser-ui/docs/app.tsx. */
const docsNav = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/nav.json', import.meta.url),
    'utf8',
  ),
) as { sections: { title: string; pages: { title: string }[] }[] };

for (const width of [1440, 390])
  test(`the Design nav is the docs nav in its type, and the title sits where 5100's does, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await openGuiButton(page);
    const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
    const toggle = page.locator('.design-nav-toggle');
    if (width === 390 && (await toggle.getAttribute('aria-expanded')) !== 'true')
      await toggle.click();
    await expect(tree).toBeVisible();
    // The same sections, names and pages as the docs nav (Principles included), and no tag lines.
    const drawn = await tree.evaluate((nav) =>
      [...nav.querySelectorAll('.design-page-tree-section')].map((section) => ({
        title: section.querySelector(':scope > p')!.textContent,
        pages: [...section.querySelectorAll('a')].map((link) => ({ title: link.textContent })),
      })),
    );
    expect(drawn).toEqual(
      docsNav.sections.map((section) => ({
        title: section.title,
        pages: section.pages.map(({ title }) => ({ title })),
      })),
    );
    await expect(tree.locator('.design-page-tree-tag')).toHaveCount(0);
    // The docs nav's type (docs.css .docs-nav): 14 px headings and links, quiet links, a bold
    // selected link on the selection surface.
    const type = await tree.evaluate((nav) => {
      const style = (element: Element) => getComputedStyle(element);
      const root = style(document.documentElement);
      const link = nav.querySelector('a:not([aria-current])')!;
      const current = nav.querySelector('a[aria-current="page"]')!;
      const probe = document.createElement('i');
      nav.append(probe);
      const paint = (value: string) => {
        probe.style.color = value;
        return style(probe).color;
      };
      const read = {
        heading: [
          style(nav.querySelector('.design-page-tree-section > p')!).fontSize,
          style(nav.querySelector('.design-page-tree-section > p')!).fontWeight,
        ],
        link: [style(link).fontSize, style(link).fontWeight, style(link).color],
        current: [
          current.textContent,
          style(current).fontWeight,
          style(current).color,
          style(current).backgroundColor,
        ],
        expected: {
          size: root.getPropertyValue('--tmt-ui-ref-size-3').trim(),
          secondary: paint('var(--tmt-ui-color-secondary)'),
          text: paint('var(--tmt-ui-color-text)'),
          selection: (() => {
            probe.style.color = '';
            probe.style.backgroundColor = 'var(--tmt-ui-surface-selection)';
            return style(probe).backgroundColor;
          })(),
        },
      };
      probe.remove();
      return read;
    });
    const { size, secondary, text, selection } = type.expected;
    expect(type.heading).toEqual([size, '600']);
    expect(type.link).toEqual([size, '400', secondary]);
    expect(type.current).toEqual(['Button', '600', text, selection]);
    // The title's gap below the bar above it: 5100's .docs-main top padding (32 px; 24 px at 760 px
    // and under), measured from the Pages bar on a phone.
    if (width === 390) await toggle.click();
    await expect(tree)
      .toBeHidden({ timeout: width === 390 ? 5000 : 1 })
      .catch(() => {});
    const bar = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('.design-nav-toggle')!;
      return getComputedStyle(button).display === 'none'
        ? document.querySelector('.design-workspace')!.getBoundingClientRect().top
        : button.getBoundingClientRect().bottom;
    });
    const frameTop = await page
      .locator('.design-workspace iframe')
      .first()
      .evaluate((frame) => frame.getBoundingClientRect().top);
    const title = await designFrame(page)
      .getByRole('heading', { name: 'Button', exact: true })
      .evaluate((heading) => heading.getBoundingClientRect().top);
    expect(Math.round(frameTop + title - bar)).toBe(width === 390 ? 24 : 32);
  });

for (const width of [1440, 390]) {
  test(`block document uses its canvas width in Design at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
    if (width === 390) await page.locator('.design-nav-toggle').click();
    await tree.locator('a[href$="/components/block-document"]').click();
    const frame = designFrame(page);
    const document = frame.locator('.docs-canvas-hero .tmt-block-doc').first();
    await expect(document).toBeVisible();
    await expect.poll(async () => (await document.boundingBox())?.width ?? 0).toBeGreaterThan(150);
    // Its text runs across the line, not one letter per line.
    const title = document.locator(':is(h1, h2, h3, p)').first();
    await expect(title).toBeVisible();
    await expect.poll(async () => (await title.boundingBox())?.width ?? 0).toBeGreaterThan(150);
  });
}

test('a Browser component page opens with a live chart example', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const tree = page.getByRole('navigation', { name: 'tmt GUI pages', exact: true });
  await expect(tree).toBeVisible({ timeout: 60_000 });
  await tree.getByRole('link', { name: /^Chart/ }).click();
  const frame = designFrame(page);
  await expect(frame.getByRole('heading', { name: 'Chart', exact: true })).toBeVisible();
  await expect(frame.getByRole('img', { name: /Activity/ }).first()).toBeVisible();
});
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const)
    test(`Design owns docs, user trees and header actions, ${width}, ${theme}`, async ({
      page,
    }) => {
      test.skip(!captures && (width === 1440 ? theme !== 'light' : theme !== 'dark'));
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
      await expect(page.locator('.tmt-ui-topbar-status [role="status"]')).toContainText(
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
      const patternStage = designFrame(page).locator(
        'figure[data-width="1440"][data-theme="light"]',
      );
      await patternStage.getByRole('tab', { name: /Needs you/ }).click();
      await expect(patternStage.getByRole('tab', { name: /Needs you/ })).toHaveAttribute(
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
  await expect(page.locator('.tmt-ui-topbar-status [role="status"]')).toHaveCount(0);
  await page.evaluate(
    () =>
      ((
        window as unknown as { designFixture: { controls: { failUpload: boolean } } }
      ).designFixture.controls.failUpload = false),
  );
  await page.getByRole('button', { name: 'Reload design systems', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish 0.1.1', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish 0.1.1', exact: true }).click();
  await expect(page.locator('.tmt-ui-topbar-status [role="status"]')).toContainText(
    'Published 0.1.1.',
  );
  await expect(page.getByRole('button', { name: 'Publish 0.1.2', exact: true })).toBeEnabled();
});

test('the Published notice sits in the header over the content, then goes away (#6272)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await pickSystem(page, 'Acme');
  await page.getByRole('button', { name: 'Publish 0.1.1', exact: true }).click();
  const notice = page.getByRole('status').filter({ hasText: 'Published 0.1.1.' });
  await expect(notice).toBeVisible();
  // It is the header's own status line, in the bar and not a paragraph above the page tree.
  await expect(page.locator('.tmt-ui-topbar-status').getByRole('status')).toHaveText(
    'Published 0.1.1.',
  );
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const status = [...document.querySelectorAll('[role="status"]')].find((node) =>
      node.textContent?.includes('Published 0.1.1.'),
    )!;
    const note = status.getBoundingClientRect();
    return {
      note: { left: note.left, right: note.right, top: note.top, bottom: note.bottom },
      bar: box('.tmt-ui-topbar'),
      title: box('.design-header-title'),
      viewport: innerWidth,
    };
  });
  // Inside the bar's height, clear of the window edge and past the title it follows.
  expect(geometry.note.top).toBeGreaterThanOrEqual(geometry.bar.top - 1);
  expect(geometry.note.bottom).toBeLessThanOrEqual(geometry.bar.bottom + 1);
  expect(geometry.note.left).toBeGreaterThanOrEqual(geometry.title.right);
  expect(geometry.note.right).toBeLessThanOrEqual(geometry.viewport - 16);
  // Like the page's other status lines it goes after a while; the Publish button stays.
  await expect(notice).toHaveCount(0, { timeout: 12_000 });
  await expect(page.getByRole('button', { name: 'Publish 0.1.2', exact: true })).toBeEnabled();
});

test('a page titled by its own tag shows the tag once in the Design sidebar (#6272)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, true, base, true);
  await pickSystem(page, 'tmt-tui');
  const tree = page.getByRole('navigation', { name: 'tmt-tui pages', exact: true });
  const mark = tree.getByRole('link', { name: /^tui-mark/ });
  await expect(mark).toBeVisible();
  // The title is the tag: one line, not the same word twice.
  await expect(mark).toHaveText('tui-mark');
  await expect(mark.locator('.design-page-tree-tag')).toHaveCount(0);
  // A page with a name of its own keeps its tag under it.
  const gauge = tree.getByRole('link', { name: /^Gauge/ });
  await expect(gauge.locator('.design-page-tree-tag')).toHaveText('tui-gauge');
});

test('a system with no CSS of its own still draws its docs pages in the Design docs chrome (#6272)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, true, base, true);
  await pickSystem(page, 'tmt-tui');
  const tree = page.getByRole('navigation', { name: 'tmt-tui pages', exact: true });
  await tree.getByRole('link', { name: /^tui-mark/ }).click();
  const frame = designFrame(page);
  await expect(frame.getByRole('heading', { name: 'Terminal mark', exact: true })).toBeVisible();
  const canvas = frame.locator('.docs-canvas').first();
  const snippet = frame.locator('.docs-snippet').first();
  await expect(canvas).toBeVisible();
  // The canvas is a bordered, padded stage and the snippet a mono code box, as on the docs site.
  const paint = async () => ({
    canvas: await canvas.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        display: style.display,
        padding: style.paddingTop,
        border: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
      };
    }),
    snippet: await snippet.evaluate((node) => {
      const style = getComputedStyle(node);
      const pre = getComputedStyle(node.querySelector('pre')!);
      return {
        border: style.borderTopWidth,
        font: pre.fontFamily,
        padding: pre.paddingTop,
        white: pre.whiteSpace,
      };
    }),
  });
  const drawn = await paint();
  expect(drawn.canvas.display).toBe('flex');
  expect(Number.parseFloat(drawn.canvas.padding)).toBeGreaterThanOrEqual(16);
  expect(Number.parseFloat(drawn.canvas.border)).toBeGreaterThan(0);
  expect(Number.parseFloat(drawn.canvas.radius)).toBeGreaterThan(0);
  expect(Number.parseFloat(drawn.snippet.border)).toBeGreaterThan(0);
  expect(drawn.snippet.font).toMatch(/mono|Menlo|Consolas|monospace/i);
  expect(drawn.snippet.white).toBe('pre');
  // The tmt GUI draws the same chrome, so one set of rules serves every system.
  await pickSystem(page, 'Acme');
  const gui = page.getByRole('navigation', { name: 'Acme pages', exact: true });
  await gui.getByRole('link', { name: /^Button/ }).click();
  await expect(designFrame(page).locator('.docs-canvas').first()).toBeVisible();
  const reference = await designFrame(page)
    .locator('.docs-canvas')
    .first()
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return { padding: style.paddingTop, border: style.borderTopWidth };
    });
  expect(reference).toEqual({ padding: drawn.canvas.padding, border: drawn.canvas.border });
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
    designFrame(page).getByRole('heading', { name: 'Button', exact: true }),
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
  const designHeader = page.locator('.tmt-ui-shell-bar');
  await expect
    .poll(async () => {
      const [bar, actions] = await Promise.all([
        designHeader.boundingBox(),
        page.locator('.page-floating-actions').boundingBox(),
      ]);
      return !!bar && !!actions && actions.y >= bar.y + bar.height;
    })
    .toBe(true);
  await example.getByRole('button', { name: 'Draft', exact: true }).click();
  const popover = page.locator('.annotation-popover');
  await expect(popover).toBeVisible();
  await expect
    .poll(async () => {
      const [bar, input] = await Promise.all([designHeader.boundingBox(), popover.boundingBox()]);
      return !!bar && !!input && input.y >= bar.y + bar.height;
    })
    .toBe(true);
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

test('Design attachment confirmation is placed below the Design header', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await openGuiButton(page);
  // A built-in page holds files on its discussion page, made by the first Comment.
  await page.getByRole('button', { name: 'Selection mode', exact: true }).click();
  await expect.poll(async () => (await discussionPages(page)).length).toBe(1);
  const id = '11111111-1111-4111-8111-111111111111';
  await page.evaluate((attachmentId) => {
    const fixture = (
      window as unknown as {
        designFixture: {
          pages: Map<string, { title: string; source: string }>;
          addAttachment(page: string, id: string): void;
        };
      }
    ).designFixture;
    const selected = [...fixture.pages].find(([, item]) => item.title === 'Button · tmt GUI')![0];
    fixture.addAttachment(selected, attachmentId);
  }, id);
  await designFrame(page)
    .locator('body')
    .evaluate((body, attachmentId) => {
      const link = body.ownerDocument.createElement('a');
      link.href = `colab-attachment:${attachmentId}`;
      link.download = 'example.txt';
      link.textContent = 'Download example';
      body.prepend(link);
    }, id);
  await designFrame(page).getByRole('link', { name: 'Download example' }).click();
  const dialog = page.getByRole('dialog', { name: 'Download attachment' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const [bar, box] = await Promise.all([
        page.locator('.tmt-ui-shell-bar').boundingBox(),
        dialog.boundingBox(),
      ]);
      return !!bar && !!box && box.y >= bar.y + bar.height;
    })
    .toBe(true);
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
  // A draft edit redraws the page in a new frame; a read during that swap is not an answer yet.
  const outline = () =>
    button.evaluate((element) => getComputedStyle(element).outlineColor).catch(() => 'detached');
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

for (const stage of ['progress', 'stalled'] as const) {
  test(`a ${stage} design-system create can close without cancelling`, async ({ page }) => {
    await open(page);
    const before = page.url();
    await page.evaluate(() => {
      const fixture = (window as any).designFixture;
      fixture.controls.holdCreate = true;
      const original = window.setTimeout;
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
        original(callback, delay === 60_000 ? 1_000 : delay, ...args)) as typeof window.setTimeout;
    });
    await page.getByRole('button', { name: 'New design system', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Brio');
    await dialog.getByRole('textbox', { name: 'Tag prefix', exact: true }).fill('brio');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Creating pages: 0 of 109');
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Tag prefix', exact: true })).toBeDisabled();
    const ink = await dialog
      .locator('p')
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveCSS(
      'color',
      ink,
    );
    await expect(dialog.getByRole('textbox', { name: 'Tag prefix', exact: true })).toHaveCSS(
      'color',
      ink,
    );
    await expect(dialog.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
    if (stage === 'stalled')
      await expect(dialog.getByRole('status')).toHaveText(
        'Still creating (0 of 109). This can take a while.',
      );
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'New design system', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Brio');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => (window as any).designFixture.controls.releaseCreate());
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...(window as any).designFixture.pages.values()].some(
              (entry: any) =>
                entry.title === 'Brio' &&
                entry.source.includes('"releases"') &&
                entry.attachments.length > 0,
            ),
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(page).toHaveURL(before);
  });
}

test('a refused create offers retry; an unknown outcome offers a status check', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    (window as any).designFixture.controls.refuseCreate = true;
  });
  await page.getByRole('button', { name: 'New design system', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Fixture creation refused');
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).designFixture.controls.unknownCreate = true;
  });
  await page.getByRole('button', { name: 'New design system', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Could not confirm a page. Resume to check the result before continuing.',
  );
  await expect(dialog.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  const beforeResume = await page.evaluate(() => (window as any).designFixture.pages.size);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'New design system', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
  await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Could not confirm a page. Resume to check the result before continuing.',
  );
  expect(await page.evaluate(() => (window as any).designFixture.pages.size)).toBe(beforeResume);
});

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`capture uncertain creation resume ${width} ${theme}`, async ({ page }) => {
      test.skip(!captures);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await open(page);
      await page.evaluate(() => {
        (window as any).designFixture.controls.unknownCreate = true;
      });
      await page.getByRole('button', { name: 'New design system', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
      await capture(page, `resume-${width}-${theme}.png`);
    });
    for (const stage of ['progress', 'stalled'] as const) {
      test(`capture ${stage} creation ${width} ${theme}`, async ({ page }) => {
        test.skip(!captures);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await open(page);
        await page.evaluate(() => {
          (window as any).designFixture.controls.holdCreate = true;
          const original = window.setTimeout;
          window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
            original(
              callback,
              delay === 60_000 ? 1_000 : delay,
              ...args,
            )) as typeof window.setTimeout;
        });
        await page.getByRole('button', { name: 'New design system', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
        await dialog.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(dialog.getByRole('status')).toHaveText(
          stage === 'stalled'
            ? 'Still creating (0 of 109). This can take a while.'
            : 'Creating pages: 0 of 109',
        );
        await capture(page, `${stage}-${width}-${theme}.png`);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(() => (window as any).designFixture.controls.releaseCreate());
      });
    }
  }
}

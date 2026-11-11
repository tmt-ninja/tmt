import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

// #5821 / epic #5866: a page that pins a design system release gets its components as custom
// elements in the frame. The bundle here is the repo template's, handed to mountRenderer through
// its designSystem source, as the app hands the attachment it reads.
const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
) as { hash: string };
const pin = `tmt-gui@0.1.0#${bundle.hash}`;

async function mount(page: Page, source: string, served: unknown = bundle, layout?: 'column') {
  await servePageRuntime(page);
  return render(page, source, served, layout);
}
/** Mounts the page against whatever runtime the test already routed. */
async function render(page: Page, source: string, served: unknown = bundle, layout?: 'column') {
  await page.goto('/');
  await page.evaluate(
    async ({ source, served, layout }) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      host.id = 'probe';
      document.body.prepend(host);
      await mountRenderer(host, source, {
        signal: new AbortController().signal,
        onState: (state: string) => {
          host.dataset.state = state;
        },
        designSystem: {
          release: async () => served,
          draft: async () => {
            if (!served) throw new Error('No draft');
            return served;
          },
          watch: () => () => {},
        },
        ...(layout ? { layout } : {}),
      });
    },
    { source, served, layout },
  );
  await expect(page.locator('#probe')).toHaveAttribute('data-state', 'ready');
  return page.frameLocator('#probe iframe');
}

test('a pinned frame reports settlement once per render', async ({ page }) => {
  await page.addInitScript(() => {
    const settled: string[] = [];
    Object.assign(window, { settledRenders: settled });
    addEventListener('message', (event) => {
      if (event.data?.type === 'colab.render.settled') settled.push(event.data.renderId);
    });
  });
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><p id="content">Before</p><tmt-ui-button>Save</tmt-ui-button>`,
  );
  await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
  const renderId = await page.locator('#probe iframe').getAttribute('data-render-id');
  const settled = () =>
    page.evaluate(() => (window as unknown as { settledRenders: string[] }).settledRenders);
  await expect.poll(settled).toEqual([renderId]);
  await frame.getByRole('button', { name: 'Save' }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await settled()).toEqual([renderId]);
});

test('a pinned page draws its components with their props, slots and tokens', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-button>Save</tmt-ui-button>
     <tmt-ui-button variant="outline" size="sm"><tmt-icon slot="icon" name="plus"></tmt-icon>New page</tmt-ui-button>
     <tmt-ui-button disabled>Send</tmt-ui-button>`,
  );
  const save = frame.getByRole('button', { name: 'Save' });
  await expect(save).toHaveAttribute('data-variant', 'default');
  expect((await save.boundingBox())!.height).toBe(36);
  const create = frame.getByRole('button', { name: 'New page' });
  await expect(create).toHaveAttribute('data-variant', 'outline');
  await expect(create).toHaveAttribute('data-size', 'sm');
  expect((await create.boundingBox())!.height).toBe(32);
  // The icon slot lands inside the button, before the label.
  await expect(create.locator('tmt-icon svg')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(frame.locator('[data-tmt-ds-notice]')).toHaveCount(0);
});

test('Browser action examples show busy, disabled and pressed states', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-action label="Saving" variant="primary" busy></tmt-ui-action>
     <tmt-ui-action label="Unavailable" variant="secondary" disabled></tmt-ui-action>
     <tmt-ui-icon-action label="Pin" variant="text" pressed><tmt-icon name="plus"></tmt-icon></tmt-ui-icon-action>`,
  );
  await expect(frame.getByRole('button', { name: 'Saving' })).toHaveAttribute('aria-busy', 'true');
  await expect(frame.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  await expect(frame.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true');
});

test('listed pattern parts render and interact as Browser components', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-page-row label="Release" tags="spec" updated="Today" unread></tmt-ui-page-row>
     <tmt-ui-work-band stage="Open" done="0" total="1" pages='[{"title":"Review","stage":"Open","done":0,"total":1}]'></tmt-ui-work-band>
     <tmt-ui-message-row author="Alex" state="failed" detail="Not sent" action="Retry">Please review</tmt-ui-message-row>
     <tmt-ui-status-line items='[{"tone":"blocked","label":"Blocked"}]'></tmt-ui-status-line>`,
  );
  await expect(frame.getByRole('link', { name: /Release/ })).toBeVisible();
  await frame.getByRole('button', { name: /Open/ }).click();
  await expect(frame.getByText('Review', { exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Retry' }).click();
  await expect(frame.getByText('Sending', { exact: true })).toBeVisible();
  await expect(frame.getByText('Blocked', { exact: false })).toBeVisible();
});

test('Browser catalog examples render their states and interactive controls', async ({ page }) => {
  const template = JSON.parse(
    readFileSync(
      new URL('../../../../../design/systems/tmt-gui/generated/template.json', import.meta.url),
      'utf8',
    ),
  ) as { components: { tag: string; examples: { markup: string }[] }[] };
  const names = new Set([
    'toggle',
    'browser-avatar',
    'count-chip',
    'status-tile',
    'pager',
    'header',
    'notice',
    'section',
    'disclosure',
    'field',
    'browser-tabs',
    'browser-chips',
    'choice',
    'list',
    'table',
    'browser-command',
  ]);
  const examples = template.components
    .filter((component) => names.has(component.tag))
    .flatMap((component) => component.examples.map((example) => example.markup));
  expect(examples.length).toBeGreaterThan(30);
  const frame = await mount(page, `<meta name="tmt-ds" content="${pin}">${examples.join('\n')}`);
  await expect(frame.getByRole('button', { name: 'Needs you: 5' })).toHaveAttribute(
    'data-tone',
    'attention',
  );
  await expect(frame.getByRole('button', { name: 'Comments: 2' }).last()).toBeDisabled();
  const toggle = frame.getByRole('button', { name: 'Grid view' }).first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.getByRole('heading', { name: 'Cannot continue' })).toBeVisible();
  await expect(frame.getByRole('table', { name: 'Pages' }).first()).toBeVisible();
});

test('component catalog examples retain interactive dialogs and disabled input', async ({
  page,
}) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-dialog label="Open confirmation" heading="Confirm action">Review the change.</tmt-ui-dialog>
     <tmt-ui-rich-input label="Message" shape="multi" placeholder="Read only" disabled></tmt-ui-rich-input>
     <tmt-ui-button busy busy-label="Sending"></tmt-ui-button>`,
  );
  await expect(frame.getByRole('button', { name: 'Sending' })).toHaveAttribute('aria-busy', 'true');
  await expect(frame.locator('tmt-ui-rich-input [contenteditable]')).toHaveAttribute(
    'contenteditable',
    'false',
  );
  await frame.getByRole('button', { name: 'Open confirmation' }).click();
  await expect(frame.getByRole('dialog')).toContainText('Confirm action');
});

for (const theme of ['light', 'dark'] as const) {
  test(`a pinned GUI page uses palette B in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const frame = await mount(
      page,
      `<meta name="tmt-ds" content="${pin}"><tmt-ui-button>Save</tmt-ui-button>`,
    );
    await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
    const roles = await frame.locator('html').evaluate((node, theme) => {
      const style = getComputedStyle(node);
      return {
        sheet: style.getPropertyValue('--tmt-ui-surface-sheet').trim(),
        expected: style
          .getPropertyValue(theme === 'dark' ? '--tmt-ui-ref-ink-900' : '--tmt-ui-ref-paper-50')
          .trim(),
      };
    }, theme);
    expect(roles.sheet).toBe(roles.expected);
  });
}

test('a Card header action stays interactive inside its slot', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-card heading="Release plan"><tmt-ui-button slot="action" variant="outline">Open</tmt-ui-button>Discuss the release.</tmt-ui-card>`,
  );
  await expect(frame.getByText('Release plan', { exact: true })).toBeVisible();
  const action = frame.getByRole('button', { name: 'Open' });
  await expect(action).toBeVisible();
  await action.click();
});

test('tabs with trailing actions keep selection and the action interactive', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-tabs items="All,Needs you,Done" value="All"><tmt-ui-button slot="actions" variant="outline">Save</tmt-ui-button></tmt-ui-tabs>`,
  );
  await frame.getByRole('tab', { name: 'Needs you' }).click();
  await expect(frame.getByRole('tab', { name: 'Needs you' })).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
  await frame.getByRole('button', { name: 'Save' }).click();
});

test('Browser overlay and meter examples use their real parts', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-dialog-drawer-panel label="Page details" kind="drawer">Details about the page.</tmt-ui-dialog-drawer-panel>
     <tmt-ui-card-meter heading="Allowance" value="100"></tmt-ui-card-meter>`,
  );
  await expect(frame.getByRole('meter', { name: 'Allowance' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await frame.getByRole('button', { name: 'Open Page details' }).click();
  await expect(frame.getByText('Details about the page.')).toBeVisible();
  await frame.getByRole('button', { name: /Close Page details/ }).click();
  await expect(frame.getByText('Details about the page.')).toBeHidden();
});

test('foundations read live token values and run the motion controls', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <div class="tmt-design-docs"><tmt-ui-foundation page="colour"></tmt-ui-foundation>
     <tmt-ui-foundation page="type"></tmt-ui-foundation>
     <tmt-ui-foundation page="spacing"></tmt-ui-foundation>
     <tmt-ui-foundation page="radius"></tmt-ui-foundation>
     <tmt-ui-foundation page="motion"></tmt-ui-foundation>
     <tmt-ui-foundation page="elevation"></tmt-ui-foundation>
     <tmt-ui-foundation page="brand"></tmt-ui-foundation></div>`,
  );
  for (const name of ['Colour', 'Type', 'Spacing', 'Radius', 'Motion', 'Elevation', 'Brand'])
    await expect(frame.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(frame.locator('.docs-swatch .docs-value').first()).toHaveText(/^#[0-9a-f]{6}/);
  await expect(frame.locator('.docs-scale-value').first()).not.toBeEmpty();
  const toggle = frame.getByRole('button', { name: 'Simulate reduced motion' });
  await toggle.click();
  await expect(frame.getByRole('button', { name: 'Reduced motion: on' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(frame.locator('svg.tmt-brand-mark').first()).toBeVisible();
});

test('pattern pages render shared scenes and a scoped dialog', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 1000 });
  const slugs = [
    'list-row',
    'empty-state',
    'tabs-row',
    'add-dialog',
    'work-band',
    'sending-rows',
    'blocks-document',
  ];
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><div class="tmt-design-docs">${slugs
      .map((slug) => `<tmt-ui-pattern page="${slug}"></tmt-ui-pattern>`)
      .join('')}</div>`,
  );
  for (const title of [
    'List row',
    'Empty state',
    'Tabs row with actions',
    'Add or attach dialog',
    'Work band',
    'Sending, failed and unsent',
    'Blocks as one document',
  ])
    await expect(frame.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const stages = frame.locator('tmt-ui-pattern[page="tabs-row"] figure.pattern-viewport');
  await expect(stages).toHaveCount(4);
  await frame.locator('html').evaluate((node) => node.setAttribute('data-theme', 'dark'));
  await expect(
    stages.filter({ hasText: '390 · dark' }).locator('[data-tmt-ui]').first(),
  ).toHaveAttribute('data-tmt-theme', 'dark');
  const foreground = (theme: string) =>
    stages
      .filter({ hasText: `390 · ${theme}` })
      .locator('[data-tmt-ui]')
      .first()
      .evaluate((node) =>
        getComputedStyle(node).getPropertyValue('--tmt-foundation-foreground').trim(),
      );
  await expect.poll(() => foreground('dark')).not.toBe(await foreground('light'));
  await frame
    .locator('tmt-ui-pattern[page="add-dialog"] figure[data-width="390"][data-theme="dark"]')
    .getByRole('button', { name: 'Add a sub-page' })
    .click();
  await expect(frame.getByRole('dialog')).toContainText('Add a sub-page to');
  await page.keyboard.press('Escape');
  const band = frame
    .locator('tmt-ui-pattern[page="work-band"] figure[data-width="390"][data-theme="dark"]')
    .first();
  await band.locator('.pattern-band-bar').first().click();
  await band.getByRole('button', { name: 'Add a sub-page' }).first().click();
  await expect(band.getByText('New sub-page 4').first()).toBeVisible();
  const messages = frame
    .locator('tmt-ui-pattern[page="sending-rows"] figure[data-width="390"][data-theme="dark"]')
    .first();
  await messages.getByRole('button', { name: 'Retry' }).click();
  await expect(messages.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await messages.getByRole('button', { name: 'Edit' }).click();
  await expect(messages.getByRole('textbox', { name: 'Edit draft' })).toBeVisible();
});

test('a pinned page keeps the editorial ramp unless it asked for the runtime (#5917)', async ({
  page,
}) => {
  const sizes = async (extra: string) => {
    const frame = await mount(
      page,
      `<meta name="tmt-ds" content="${pin}">${extra}<h1>Mockup</h1><p>Body text.</p><tmt-ui-button>Save</tmt-ui-button>`,
    );
    await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
    const size = (selector: string) =>
      frame
        .locator(selector)
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    return { h1: await size('h1'), p: await size('p') };
  };
  const plain = await sizes('');
  expect(plain.h1).toBeGreaterThan(plain.p * 1.4);
  // A page that opted into the runtime keeps its reset: its h1 is body text.
  const tailwind = await sizes('<meta name="tmt-colab-runtime" content="react tailwind">');
  expect(tailwind.h1).toBe(tailwind.p);
});

test('a top-level component stands on the column with the text', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><h1>Mockup</h1><p>Body text.</p>
     <tmt-ui-card heading="Timer"><tmt-ui-button variant="outline">Stop</tmt-ui-button></tmt-ui-card>`,
    bundle,
    'column',
  );
  await expect(frame.getByRole('button', { name: 'Stop' })).toBeVisible();
  const left = (selector: string) =>
    frame
      .locator(selector)
      .first()
      .evaluate((node) => node.getBoundingClientRect().left);
  const text = await left('p');
  expect(text).toBeGreaterThan(0);
  expect(await left('tmt-ui-card > *')).toBe(text);
});

test('an attribute change re-renders the component', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-button id="b">Review</tmt-ui-button>
     <script>addEventListener('load', () => document.getElementById('b').setAttribute('variant', 'ghost'));</script>`,
  );
  await expect(frame.getByRole('button', { name: 'Review' })).toHaveAttribute(
    'data-variant',
    'ghost',
  );
});

test('runtime 4 renders Browser parts and keeps native disclosure interactive', async ({
  page,
}) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-browser-avatar name="Alex Kim" kind="agent"></tmt-ui-browser-avatar>
     <label><tmt-ui-browser-checkbox></tmt-ui-browser-checkbox> Select</label>
     <tmt-ui-toggle label="Grid view"></tmt-ui-toggle>
     <tmt-ui-section heading="Details"><tmt-ui-disclosure summary="More">Hello</tmt-ui-disclosure></tmt-ui-section>`,
  );
  await expect(frame.getByRole('img', { name: 'Alex Kim' })).toBeVisible();
  const checkbox = frame.getByRole('checkbox', { name: 'Select' });
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  const toggle = frame.getByRole('button', { name: 'Grid view' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.getByRole('heading', { name: 'Details' })).toBeVisible();
  const details = frame.locator('details');
  await expect(details).not.toHaveAttribute('open');
  await frame.getByText('More', { exact: true }).click();
  await expect(details).toHaveAttribute('open', '');
  await expect(frame.getByText('Hello', { exact: true })).toBeVisible();
});

test('the design-system scope tag creates one stage portal for nested components', async ({
  page,
}) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-ds-scope><tmt-ui-button>Inside</tmt-ui-button></tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('tmt-ui-ds-scope [data-tmt-ds-scope]');
  await expect(scope.getByRole('button', { name: 'Inside' })).toBeVisible();
  await expect(scope.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
});

test('real UI checkbox and switch respond to user activation', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-checkbox label="Include"></tmt-ui-checkbox>
    <tmt-ui-switch label="Enabled"></tmt-ui-switch>
    <tmt-ui-tabs items="One,Two"></tmt-ui-tabs>`,
  );
  const checkbox = frame.getByRole('checkbox', { name: 'Include' });
  const toggle = frame.getByRole('switch', { name: 'Enabled' });
  await checkbox.click();
  await toggle.click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await frame.getByRole('tab', { name: 'Two' }).click();
  await expect(frame.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
});

test('runtime 4 menu and dialog open inside a design stage', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope>
      <tmt-ui-dropdown-menu label="Options" items="First,Second"></tmt-ui-dropdown-menu>
      <tmt-ui-dialog label="Open dialog" heading="Example">Dialog content</tmt-ui-dialog>
    </tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await scope.getByRole('button', { name: 'Options' }).click();
  await expect(scope.getByRole('menuitem', { name: 'First' })).toBeVisible();
  await scope.getByRole('menuitem', { name: 'First' }).click();
  await scope.getByRole('button', { name: 'Open dialog' }).click();
  await expect(scope.getByRole('dialog', { name: 'Example' })).toBeVisible();
});

test('Browser menu and pager tags respond to user input', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-menu label="Actions" items="Open,Archive"></tmt-ui-menu>
    <tmt-ui-pager label="Pages" count="3"></tmt-ui-pager>
    <tmt-ui-field label="Name"></tmt-ui-field>
    <tmt-ui-browser-tabs label="Views" items="All,Active"></tmt-ui-browser-tabs>`,
  );
  await frame.getByRole('button', { name: 'Actions' }).click();
  await expect(frame.getByRole('menuitem', { name: 'Open' })).toBeVisible();
  await frame.getByRole('menuitem', { name: 'Open' }).click();
  await frame.getByRole('button', { name: 'Next' }).click();
  await expect(frame.getByRole('status', { name: 'Pages 2 of 3' })).toBeVisible();
  await frame.getByRole('textbox', { name: 'Name' }).fill('Alex');
  await frame.getByRole('tab', { name: 'Active' }).click();
  await expect(frame.getByRole('tab', { name: 'Active' })).toHaveAttribute('aria-selected', 'true');
});

test('Select and Tooltip tags open their real scoped layers', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope>
      <tmt-ui-select label="State" items="Ready,Draft"></tmt-ui-select>
      <tmt-ui-tooltip label="Help">More information</tmt-ui-tooltip>
    </tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await scope.getByRole('combobox', { name: 'State' }).click();
  await scope.getByRole('option', { name: 'Ready' }).click();
  await expect(scope.getByRole('combobox', { name: 'State' })).toContainText('Ready');
  await scope.getByRole('button', { name: 'Help' }).focus();
  await expect(scope.getByRole('tooltip')).toContainText('More information');
});

test('Command and Floating tags remain interactive in a stage', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope>
      <tmt-ui-command label="Search" items="Open,Close"></tmt-ui-command>
      <tmt-ui-floating label="Chat">Message body</tmt-ui-floating>
    </tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await scope.getByRole('combobox', { name: 'Search' }).fill('Open');
  await expect(scope.getByRole('option', { name: 'Open' })).toBeVisible();
  await scope.getByRole('button', { name: 'Chat' }).click();
  await expect(scope.getByRole('dialog', { name: 'Chat' })).toContainText('Message body');
});

test('Chips tag selects and removes an option', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope><tmt-ui-chips label="People" items="Alex,Sam"></tmt-ui-chips></tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await scope.getByRole('combobox', { name: 'People' }).fill('Alex');
  await scope.getByRole('option', { name: 'Alex' }).click();
  await expect(scope.getByRole('button', { name: 'Remove Alex' })).toBeVisible();
  await scope.getByRole('button', { name: 'Remove Alex' }).click();
  await expect(scope.getByRole('button', { name: 'Remove Alex' })).toHaveCount(0);
});

test('data table and page list tags render their supplied rows', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-data-table label="People" columns="Name,State" rows="Alex,Ready"></tmt-ui-data-table>
    <tmt-ui-page-list rows="Home,Ready"></tmt-ui-page-list>`,
  );
  await expect(frame.getByRole('grid', { name: 'People' })).toContainText('Alex');
  await expect(frame.getByRole('grid', { name: 'Pages' })).toContainText('Home');
});

test('Rich input tag edits text in the frame', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-rich-input label="Message" shape="multi"></tmt-ui-rich-input>`,
  );
  const input = frame.getByRole('textbox', { name: 'Message' });
  await input.fill('Hello from the page');
  await expect(input).toContainText('Hello from the page');
});

// #6085: the parent sends a page the base plus the chunks its verified components need.
test('a one-button page loads only the base and the UI chunk, each once', async ({ page }) => {
  const fetched = await servePageRuntime(page);
  const frame = await render(
    page,
    `<meta name="tmt-ds" content="${pin}"><tmt-ui-button>Save</tmt-ui-button>`,
  );
  await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
  expect([...fetched].sort()).toEqual(['base', 'colab-runtime.css', 'ui']);
  // The frame ran each chunk in one script of its own, then sealed the runtime.
  const scripts = await frame
    .locator('script')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.textContent ?? '').filter((text) => text.includes('__colabDefine')),
    );
  expect(scripts).toHaveLength(2);
  expect(new Set(scripts).size).toBe(2);
  expect(
    await frame
      .locator('body')
      .evaluate(() => [
        typeof (window as unknown as Record<string, unknown>).__colabRuntimeChunk,
        typeof (window as unknown as Record<string, unknown>).__colabRequire,
      ]),
  ).toEqual(['undefined', 'undefined']);
});

test('a chunk that fails to load marks only its own components unavailable', async ({ page }) => {
  const fetched = await servePageRuntime(page, { fail: 'rich-input' });
  const frame = await render(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-button>Save</tmt-ui-button>
     <tmt-ui-rich-input label="Message" shape="multi"></tmt-ui-rich-input>`,
  );
  expect(fetched).toContain('rich-input');
  await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(frame.locator('[data-tmt-part-unavailable]')).toHaveText('Part unavailable');
  await expect(frame.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
});

test('Browser overlay and chips tags work inside a stage', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope>
      <tmt-ui-dialog-drawer-panel label="Details" kind="dialog">Body</tmt-ui-dialog-drawer-panel>
      <tmt-ui-browser-chips label="People" items="Alex,Sam"></tmt-ui-browser-chips>
    </tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await scope.getByRole('button', { name: 'Open Details' }).click();
  await expect(scope.getByRole('dialog', { name: 'Details' })).toBeVisible();
  await scope.getByRole('button', { name: 'Close Details' }).click();
  await scope.getByRole('button', { name: 'Add', exact: true }).click();
  await scope.getByRole('option', { name: 'Alex' }).click();
  await expect(scope.getByRole('button', { name: 'Remove Alex' })).toBeVisible();
});

test('Browser notifications tag shows and dismisses an event', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope><tmt-ui-notifications label="Notify" message="A reply arrived"></tmt-ui-notifications></tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await scope.getByRole('button', { name: 'Notify' }).click();
  await expect(scope.getByText('A reply arrived', { exact: true })).toBeVisible();
  await scope.getByRole('button', { name: 'Dismiss Chat reply' }).click();
  await expect(scope.getByText('A reply arrived', { exact: true })).toHaveCount(0);
});

test('Browser shell tag mounts its real rail in a stage', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-ds-scope width="1000px"><tmt-ui-shell items="Colab,Design">Shell content</tmt-ui-shell></tmt-ui-ds-scope>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await expect(scope.getByRole('link', { name: 'Colab' })).toBeVisible();
  await expect(scope.getByText('Shell content')).toBeVisible();
});

test('older block tags render real parts and preserve authored text', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-block-document>
      <tmt-ui-block label="Heading" kind="heading"><tmt-ui-heading-block>Project</tmt-ui-heading-block></tmt-ui-block>
      <tmt-ui-todo>Ship the change</tmt-ui-todo>
      <tmt-ui-code-block>echo hello</tmt-ui-code-block>
    </tmt-ui-block-document>`,
  );
  await expect(frame.getByRole('heading', { name: 'Project' })).toBeVisible();
  const todo = frame.getByRole('checkbox', { name: 'To-do' });
  await todo.check();
  await expect(todo).toBeChecked();
  await expect(frame.locator('[data-slot="code-block"] code')).toHaveText('echo hello');
});

test('Browser chart and editorial tags render and release the chart observer', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <script>
      const OriginalObserver = ResizeObserver;
      window.ResizeObserver = class extends OriginalObserver {
        observe(node) { this.chart = node.classList.contains('tmt-ui-chart'); return super.observe(node); }
        disconnect() { if (this.chart) document.body.dataset.chartDisconnected = 'yes'; return super.disconnect(); }
      };
    </script>
    <tmt-ui-card-meter heading="Allowance" value="72"></tmt-ui-card-meter>
    <tmt-ui-editorial><h2>Notes</h2><p>Long-form text</p></tmt-ui-editorial>
    <tmt-ui-chart label="Activity" values="3,7,5"></tmt-ui-chart>`,
  );
  await expect(frame.getByRole('meter', { name: 'Allowance' })).toHaveAttribute(
    'aria-valuenow',
    '72',
  );
  await expect(frame.getByRole('heading', { name: 'Notes' })).toBeVisible();
  const chart = frame.locator('tmt-ui-chart');
  await expect(chart.getByRole('img', { name: /Activity/ })).toBeVisible();
  await chart.evaluate((node) => {
    node.remove();
    queueMicrotask(() => node.ownerDocument.body.append(node));
  });
  await expect(frame.locator('body')).toHaveAttribute('data-chart-disconnected', 'yes');
  await expect(frame.locator('tmt-ui-chart').getByRole('img', { name: /Activity/ })).toBeVisible();
});

test('a bundle that does not match the pin draws a notice instead', async ({ page }) => {
  const forged = { ...bundle, tokensCss: '' };
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><tmt-ui-button>Save</tmt-ui-button>`,
    forged,
  );
  await expect(frame.getByRole('alert')).toContainText('does not match its pin');
  await expect(frame.getByRole('button')).toHaveCount(0);
});

test('a page that names the system without a lock draws its draft (#5967)', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="tmt-gui"><tmt-ui-button>Save</tmt-ui-button>`,
  );
  await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('a CSS-only draft refresh keeps the frame and falls back when component code changes', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (initial) => {
    const { mountRenderer } = await import('/src/renderer.ts' as string);
    const host = document.createElement('div');
    host.id = 'probe';
    document.body.prepend(host);
    const state = {
      bundle: initial,
      handle: undefined as Awaited<ReturnType<typeof mountRenderer>> | undefined,
    };
    Object.assign(window, { draftProbe: state });
    state.handle = await mountRenderer(
      host,
      '<meta name="tmt-ds" content="tmt-gui"><p class="refresh-test">Hello</p>',
      {
        signal: new AbortController().signal,
        onState: (value: string) => {
          host.dataset.state = value;
        },
        designSystem: {
          release: async () => undefined,
          draft: async () => state.bundle,
          watch: () => () => {},
        },
      },
    );
  }, bundle);
  await expect(page.locator('#probe')).toHaveAttribute('data-state', 'ready');
  const iframe = page.locator('#probe iframe');
  const before = await iframe.getAttribute('data-render-id');
  const content = iframe.contentFrame().locator('.refresh-test');
  await content.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.setAttribute('data-test-retained', 'yes');
  });
  const result = await page.evaluate(async () => {
    const state = (window as any).draftProbe;
    state.bundle = {
      ...state.bundle,
      tokensCss: `${state.bundle.tokensCss}\n.refresh-test{color:rgb(1,2,3)}`,
    };
    return state.handle.refreshDesign(
      '<meta name="tmt-ds" content="tmt-gui"><p class="refresh-test">Hello</p>',
    );
  });
  expect(result).toBe('applied');
  await expect(content).toHaveCSS('color', 'rgb(1, 2, 3)');
  await expect(content).toHaveAttribute('data-test-retained', 'yes');
  expect(await content.evaluate(() => window.getSelection()?.toString())).toBe('Hello');
  await expect(iframe).toHaveAttribute('data-render-id', before!);
  const raced = await page.evaluate(async () => {
    const state = (window as any).draftProbe;
    const source = '<meta name="tmt-ds" content="tmt-gui"><p class="refresh-test">Hello</p>';
    state.bundle = { ...state.bundle, tokensCss: '.refresh-test{color:rgb(4,5,6)}' };
    const first = state.handle.refreshDesign(source);
    state.bundle = { ...state.bundle, tokensCss: '.refresh-test{color:rgb(7,8,9)}' };
    const second = state.handle.refreshDesign(source);
    return Promise.all([first, second]);
  });
  expect(raced).toEqual(['superseded', 'applied']);
  await expect(content).toHaveCSS('color', 'rgb(7, 8, 9)');
  for (const order of ['source-first', 'style-first'] as const) {
    const result = await page.evaluate(async (which) => {
      const state = (window as any).draftProbe;
      const source = `<meta name="tmt-ds" content="tmt-gui"><p class="refresh-test">${which}</p>`;
      state.bundle = { ...state.bundle, tokensCss: '.refresh-test{color:rgb(10,11,12)}' };
      const update = () => state.handle.update(source);
      const refresh = () => state.handle.refreshDesign(source);
      return which === 'source-first'
        ? Promise.all([update(), refresh()])
        : Promise.all([refresh(), update()]);
    }, order);
    // Pinned pages require a remount for a source change; a style refresh must not hide it.
    expect(result).toEqual(
      order === 'source-first' ? ['remount', 'applied'] : ['applied', 'remount'],
    );
    await expect(content).toHaveText('Hello');
    await expect(content).toHaveCSS('color', 'rgb(10, 11, 12)');
    await expect(iframe).toHaveAttribute('data-render-id', before!);
  }
  expect(
    await page.evaluate(async () => {
      const state = (window as any).draftProbe;
      state.bundle = {
        ...state.bundle,
        components: state.bundle.components.map((component: any, index: number) =>
          index ? component : { ...component, code: `${component.code}\n// changed` },
        ),
      };
      return state.handle.refreshDesign(
        '<meta name="tmt-ds" content="tmt-gui"><p class="refresh-test">Hello</p>',
      );
    }),
  ).toBe('remount');
});

test('a slow draft refresh keeps the last compiled frame instead of replacing it with a notice', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (initial) => {
    const { mountRenderer } = await import('/src/renderer.ts' as string);
    const host = document.createElement('div');
    host.id = 'slow-draft-probe';
    document.body.prepend(host);
    const state = { slow: false, handle: undefined as any };
    Object.assign(window, { slowDraftProbe: state });
    state.handle = await mountRenderer(
      host,
      '<meta name="tmt-ds" content="tmt-gui"><tmt-ui-button>Save</tmt-ui-button>',
      {
        signal: new AbortController().signal,
        onState: (value: string) => {
          host.dataset.state = value;
        },
        designSystem: {
          release: async () => undefined,
          draft: async () => (state.slow ? new Promise(() => {}) : initial),
          watch: () => () => {},
        },
      },
    );
  }, bundle);
  await expect(page.locator('#slow-draft-probe')).toHaveAttribute('data-state', 'ready');
  const iframe = page.locator('#slow-draft-probe iframe');
  const before = await iframe.getAttribute('data-render-id');
  await expect(iframe.contentFrame().getByRole('button', { name: 'Save' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const state = (window as any).slowDraftProbe;
    state.slow = true;
    return state.handle.refreshDesign(
      '<meta name="tmt-ds" content="tmt-gui"><tmt-ui-button>Save</tmt-ui-button>',
    );
  });
  expect(result).toBe('applied');
  await expect(iframe).toHaveAttribute('data-render-id', before!);
  await expect(iframe.contentFrame().getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(iframe.contentFrame().locator('[data-tmt-ds-notice]')).toHaveCount(0);
});

test('source and design updates both settle in either order on an updatable page', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const { mountRenderer } = await import('/src/renderer.ts' as string);
    const host = document.createElement('div');
    host.id = 'concurrent-probe';
    document.body.prepend(host);
    const handle = await mountRenderer(host, '<tmt-ui-button>Go</tmt-ui-button><p>Initial</p>', {
      signal: new AbortController().signal,
      onState: (state: string) => {
        host.dataset.state = state;
      },
    });
    Object.assign(window, { concurrentProbe: handle });
  });
  await expect(page.locator('#concurrent-probe')).toHaveAttribute('data-state', 'ready');
  for (const order of ['source-first', 'style-first'] as const) {
    const result = await page.evaluate(async (which) => {
      const handle = (window as any).concurrentProbe;
      const source = `<tmt-ui-button>Go</tmt-ui-button><p>${which}</p>`;
      const update = () => handle.update(source);
      const refresh = () => handle.refreshDesign(source);
      return which === 'source-first'
        ? Promise.all([update(), refresh()])
        : Promise.all([refresh(), update()]);
    }, order);
    expect(result).toEqual(['applied', 'applied']);
    await expect(page.frameLocator('#concurrent-probe iframe').locator('p')).toHaveText(order);
  }
});

test('an edit to an unpinned page keeps its frame only while its findings stay the same (#5966)', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const { mountRenderer } = await import('/src/renderer.ts' as string);
    const host = document.createElement('div');
    host.id = 'unpinned-probe';
    document.body.prepend(host);
    const handle = await mountRenderer(host, '<tmt-ui-button>Go</tmt-ui-button><p>First</p>', {
      signal: new AbortController().signal,
      onState: (state: string) => {
        host.dataset.state = state;
      },
    });
    Object.assign(window, { unpinnedProbe: handle });
  });
  await expect(page.locator('#unpinned-probe')).toHaveAttribute('data-state', 'ready');
  const frame = page.frameLocator('#unpinned-probe iframe');
  const findings = frame.getByRole('status', { name: 'Design system check' });
  await expect(findings.getByRole('listitem')).toHaveText([
    '<tmt-ui-button> needs the page to pin a design system (<meta name="tmt-ds">).',
  ]);
  const update = (source: string) =>
    page.evaluate((source) => (window as any).unpinnedProbe.update(source), source);
  // The same findings: the text changes in place.
  expect(await update('<tmt-ui-button>Go</tmt-ui-button><p>Second</p>')).toBe('applied');
  await expect(frame.locator('p')).toHaveText('Second');
  // A new tag changes the findings the frame was built with, so the page needs a fresh frame.
  expect(
    await update('<tmt-ui-button>Go</tmt-ui-button><tmt-ui-card>Card</tmt-ui-card><p>Third</p>'),
  ).toBe('remount');
});

test('an unreadable release and a malformed pin both say so', async ({ page }) => {
  let frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><tmt-ui-button>Save</tmt-ui-button>`,
    null,
  );
  await expect(frame.getByRole('alert')).toContainText('release this TMT does not have');
  frame = await mount(
    page,
    `<meta name="tmt-ds" content="tmt-gui@1"><tmt-ui-button>Save</tmt-ui-button>`,
  );
  await expect(frame.getByRole('alert')).toContainText('release this TMT does not have');
});

test('a bad pin never stands in for a real release, and a stuck read ends in a notice', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  // One document, as in the app: the outcome of one pin must not answer for another.
  const states = await page.evaluate(
    async ({ bundle, pin, wrong }) => {
      const { mountRenderer } = await import('/src/renderer.ts' as string);
      const mountOne = async (id: string, content: string, served: () => Promise<unknown>) => {
        const host = document.createElement('div');
        host.id = id;
        document.body.append(host);
        const started = performance.now();
        await mountRenderer(
          host,
          `<meta name="tmt-ds" content="${content}"><tmt-ui-button>Go</tmt-ui-button>`,
          {
            signal: new AbortController().signal,
            onState: (state: string) => (host.dataset.state = state),
            designSystem: {
              release: served,
              draft: served,
              watch: () => () => {},
            },
          },
        );
        return performance.now() - started;
      };
      await mountOne('wrong', wrong, async () => bundle);
      await mountOne('right', pin, async () => bundle);
      const waited = await mountOne(
        'stuck',
        pin.replace('0.1.0', '0.1.1'),
        () => new Promise(() => {}),
      );
      return { waited };
    },
    { bundle, pin, wrong: pin.replace('0.1.0', '9.9.9') },
  );
  await expect(page.frameLocator('#wrong iframe').locator('body')).toContainText(
    'pins a design system release this TMT does not have',
  );
  await expect(
    page.frameLocator('#right iframe').getByRole('button', { name: 'Go' }),
  ).toBeVisible();
  const stuck = page.frameLocator('#stuck iframe').locator('body');
  await expect(stuck).toContainText('could not be read in time');
  expect(states.waited).toBeLessThan(8000);
});

test('the page check shows its findings on the page', async ({ page }) => {
  let frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-button tone="red">Save</tmt-ui-button><tmt-ui-carousel>Card</tmt-ui-carousel><acme-button>Other</acme-button>`,
  );
  const findings = frame.getByRole('status', { name: 'Design system check' });
  await expect(findings).toContainText('<tmt-ui-button> has an invalid tone attribute.');
  await expect(findings).toContainText(
    '<tmt-ui-carousel> is not a component of the pinned design system.',
  );
  await expect(findings).toContainText('<acme-button> is not from the pinned design system.');
  // The valid parts still draw.
  await expect(frame.getByRole('button', { name: 'Save' })).toBeVisible();
  frame = await mount(page, '<tmt-ui-button>Save</tmt-ui-button>');
  await expect(frame.getByRole('status', { name: 'Design system check' })).toContainText(
    'needs the page to pin a design system',
  );
  frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><div data-tmt-ds-scope><tmt-ui-button>Fine</tmt-ui-button></div>`,
  );
  await expect(frame.getByRole('button', { name: 'Fine' })).toBeVisible();
  await expect(frame.getByRole('status', { name: 'Design system check' })).toHaveCount(0);
});

for (const [mode, reference] of [
  ['locked release', pin],
  ['live draft', 'tmt-gui'],
] as const) {
  test(`a ${mode} renders components in page flow and in a stage`, async ({ page }) => {
    const frame = await mount(
      page,
      `<meta name="tmt-ds" content="${reference}">
     <button id="outside">Outside</button>
     <div data-tmt-ds-scope style="width:320px;height:180px"><tmt-ui-button>Inside</tmt-ui-button></div>
     <tmt-ui-button>Unscoped</tmt-ui-button>`,
    );
    const scope = frame.locator('[data-tmt-ds-scope]');
    await expect(scope.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
    await expect(scope.getByRole('button', { name: 'Inside' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Unscoped' })).toBeVisible();
    await expect(frame.locator('[data-tmt-ds-findings]')).toHaveCount(0);
    await frame.locator('#outside').click();
    await expect(frame.locator('#outside')).toBeFocused();
  });
}

test('menu tags place separators before the next item and preserve malformed markers', async ({
  page,
}) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-menu label="Actions" trigger="icon" items="Manage page,-,Archive…,About this page,-"></tmt-ui-menu>`,
  );
  const trigger = frame.getByRole('button', { name: 'Actions' });
  await expect(trigger.locator('svg')).toBeVisible();
  await trigger.click();
  const archive = frame.getByRole('menuitem', { name: 'Archive…' });
  await expect(archive).toHaveAttribute('data-separated', 'true');
  await expect(frame.getByRole('menuitem', { name: 'About this page' })).not.toHaveAttribute(
    'data-separated',
  );
  await expect(frame.getByRole('menuitem', { name: '-', exact: true })).toBeVisible();
});

test('command page entries show an icon and context; malformed entries stay plain', async ({
  page,
}) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-command label="Search pages" items="page:Weekly retro:Product / Planning,page:Weekly retro:Operations / Planning,page::Missing title,Plain item"></tmt-ui-command>`,
  );
  const options = frame.getByRole('option');
  await expect(options).toHaveCount(4);
  await expect(options.nth(0)).toContainText('Weekly retro');
  await expect(options.nth(0)).toContainText('Product / Planning');
  await expect(options.nth(1)).toContainText('Operations / Planning');
  await expect(options.nth(0).locator('tmt-icon[name="file-text"]')).toBeVisible();
  await expect(options.nth(2)).toHaveText('page::Missing title');
  await expect(options.nth(3)).toHaveText('Plain item');
  await frame.getByRole('combobox', { name: 'Search pages' }).fill('Product');
  await expect(frame.getByRole('option')).toHaveCount(1);
  await expect(frame.getByRole('option').first()).toContainText('Product / Planning');
});

test('command query starts populated and filters page results', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-command label="Find a page" query="retro" items="page:Weekly retro:Product / Planning,page:Roadmap:Product / Planning"></tmt-ui-command>`,
  );
  await expect(frame.getByRole('combobox', { name: 'Find a page' })).toHaveValue('retro');
  await expect(frame.getByRole('option')).toHaveCount(1);
  await expect(frame.getByRole('option').first()).toContainText('Weekly retro');
});

test('page search keeps its create action first and page rows square', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
    <tmt-ui-command label="Find a page" query="retro" items="page:Retro archive:Product / Archive,create:Create a page called retro,page:Weekly retro:Product / Planning"></tmt-ui-command>`,
  );
  const options = frame.getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(options.first()).toHaveText('Create a page called retro');
  await expect(options.nth(1)).toHaveCSS('border-radius', '0px');
  await frame.getByRole('combobox', { name: 'Find a page' }).fill('weekly');
  await expect(options).toHaveCount(2);
  await expect(options.first()).toHaveText('Create a page called retro');
  await expect(options.nth(1)).toContainText('Weekly retro');
});

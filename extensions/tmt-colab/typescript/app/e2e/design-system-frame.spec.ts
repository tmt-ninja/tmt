import { readFileSync, readdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// #5821 / epic #5866: a page that pins a design system release gets its components as custom
// elements in the frame. The bundle here is the repo template's, handed to mountRenderer through
// its designSystem source, as the app hands the attachment it reads.
const dist = new URL('../../../../../design/systems/tmt-gui/dist/', import.meta.url);
const file = readdirSync(dist)[0]!;
const bundle = JSON.parse(readFileSync(new URL(file, dist), 'utf8')) as { hash: string };
const pin = `tmt-gui@0.1.0#${bundle.hash}`;

// The dev server has no built page runtime; serve the one the app build writes.
const built = new URL('../dist/assets/', import.meta.url);
async function mount(page: Page, source: string, served: unknown = bundle) {
  for (const name of ['colab-runtime.js', 'colab-runtime.css'])
    await page.route(`**/assets/${name}`, (route) =>
      route.fulfill({
        contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css',
        body: readFileSync(new URL(name, built), 'utf8'),
      }),
    );
  await page.goto('/');
  await page.evaluate(
    async ({ source, served }) => {
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
        designSystem: async () => served,
      });
    },
    { source, served },
  );
  await expect(page.locator('#probe')).toHaveAttribute('data-state', 'ready');
  return page.frameLocator('#probe iframe');
}

test('a pinned page draws its components with their props, slots and tokens', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-button>Save</tmt-ui-button>
     <tmt-ui-button variant="outline" size="sm"><tmt-icon slot="icon" name="plus"></tmt-icon>New page</tmt-ui-button>
     <tmt-ui-button disabled>Send</tmt-ui-button>`,
  );
  const save = frame.getByRole('button', { name: 'Save' });
  await expect(save).toHaveClass(/tmt-ui-button-primary/);
  expect((await save.boundingBox())!.height).toBe(36);
  const create = frame.getByRole('button', { name: 'New page' });
  await expect(create).toHaveClass(/tmt-ui-button-outline tmt-ui-button-sm/);
  expect((await create.boundingBox())!.height).toBe(32);
  // The icon slot lands inside the button, before the label.
  await expect(create.locator('tmt-icon svg')).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(frame.locator('[data-tmt-ds-notice]')).toHaveCount(0);
});

test('an attribute change re-renders the component', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <tmt-ui-button id="b">Review</tmt-ui-button>
     <script>addEventListener('load', () => document.getElementById('b').setAttribute('variant', 'ghost'));</script>`,
  );
  await expect(frame.getByRole('button', { name: 'Review' })).toHaveClass(/tmt-ui-button-ghost/);
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

test('an unreadable release and a malformed pin both say so', async ({ page }) => {
  let frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}"><tmt-ui-button>Save</tmt-ui-button>`,
    null,
  );
  await expect(frame.getByRole('alert')).toContainText('release this TMT does not have');
  frame = await mount(page, `<meta name="tmt-ds" content="tmt-gui"><tmt-ui-button>Save</tmt-ui-button>`);
  await expect(frame.getByRole('alert')).toContainText('release this TMT does not have');
});

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
    `<meta name="tmt-ds" content="${pin}"><tmt-ui-button>Fine</tmt-ui-button>`,
  );
  await expect(frame.getByRole('button', { name: 'Fine' })).toBeVisible();
  await expect(frame.getByRole('status', { name: 'Design system check' })).toHaveCount(0);
});

test('a pinned page scopes published components and warns on unscoped tags', async ({ page }) => {
  const frame = await mount(
    page,
    `<meta name="tmt-ds" content="${pin}">
     <button id="outside">Outside</button>
     <div data-tmt-ds-scope style="width:320px;height:180px"><tmt-ui-button>Inside</tmt-ui-button></div>
     <tmt-ui-button>Unscoped</tmt-ui-button>`,
  );
  const scope = frame.locator('[data-tmt-ds-scope]');
  await expect(scope.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
  await expect(scope.getByRole('button', { name: 'Inside' })).toBeVisible();
  await expect(frame.locator('[data-tmt-ds-findings]')).toContainText(
    'needs a parent with data-tmt-ds-scope',
  );
  await frame.locator('#outside').click();
  await expect(frame.locator('#outside')).toBeFocused();
});

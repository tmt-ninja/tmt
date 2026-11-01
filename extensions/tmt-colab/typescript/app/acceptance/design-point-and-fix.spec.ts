// Point-and-fix on a design-system page (#5866): a person comments on an example with @agent, the
// agent patches that example through the CLI, and the open Design page re-renders it live; Chat
// works on the same page.
import { expect, test } from '@playwright/test';
import { pairBrowser, startDoor } from './harness/browser.js';
import {
  annotationInput,
  composeChat,
  createPage,
  freePort,
  run,
  sendChat,
} from './harness/ask.js';
import { withWorld } from './harness/with-world.js';

test('an @agent comment on a design-system example becomes a live patch of that example', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('sample-1');
    const browser = await pairBrowser(world, 'sample-lead', { talk: true });
    // A serve without `page.new` makes a new system's root under an existing page and detaches it.
    createPage(world, 'sample-lead notes', '<h1>Notes</h1>');
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${door.origin}/design/`);
    await page.getByRole('button', { name: 'New design system', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New design system', exact: true });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Brio');
    await dialog.getByRole('textbox', { name: 'Tag prefix', exact: true }).fill('brio');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 120_000 });
    const frame = page.locator('.design-workspace iframe').first().contentFrame();
    await frame.getByRole('link', { name: /brio-button/ }).click();
    await expect(page).toHaveURL(/\/design\/systems\/[0-9a-f-]+\/[0-9a-f-]+$/);
    const pageId = page.url().split('/').pop()!;
    const example = frame.locator('[data-ds-example="button:secondary"]');
    const draft = example.getByRole('button', { name: 'Draft', exact: true });
    await expect(draft).not.toHaveClass(/brio-button-outline|tmt-ui-button-outline/);

    // Selection mode, then a click anywhere in the example quotes the whole example.
    await frame.locator('h1').click();
    await page.keyboard.press('c');
    await draft.click();
    const popover = page.getByRole('dialog', { name: 'Annotate selection' });
    await expect(popover).toContainText('button:secondary');
    const input = await annotationInput(popover, agent.name);
    await input.fill(`@${agent.name} Make this the outline variant.`);
    await input.press('Enter');
    await expect.poll(() => agent.received().length).toBe(1);
    const asked = String(agent.received()[0]!.message);
    expect(asked).toContain('button:secondary');
    expect(asked).toContain('Make this the outline variant.');

    // The agent finds the example by its root and patches its live markup and snippet together.
    const read = JSON.parse(
      run(world, world.binaries.colab, [
        'page',
        'read',
        pageId,
        '--grep',
        'data-ds-example="button:secondary"',
        '--context',
        '6',
        '--json',
      ]),
    ) as unknown;
    const strings = (value: unknown): string[] =>
      typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : [];
    expect(strings(read).join('\n')).toContain('variant="secondary">Draft</brio-button>');
    run(world, world.binaries.colab, [
      'page',
      'patch',
      pageId,
      '--find',
      '<brio-button variant="secondary">Draft</brio-button>',
      '--replace',
      '<brio-button variant="outline">Draft</brio-button>',
      '--find',
      '&lt;brio-button variant=&quot;secondary&quot;&gt;Draft',
      '--replace',
      '&lt;brio-button variant=&quot;outline&quot;&gt;Draft',
      '--json',
    ]);
    await expect(draft).toHaveClass(/outline/);
    await expect(example.locator('pre')).toContainText(
      '<brio-button variant="outline">Draft</brio-button>',
    );

    // Chat with @agent on the same Design page.
    await page.keyboard.press('Escape');
    const composed = await composeChat(page, agent, 'Which examples use the outline variant?');
    await sendChat(page, composed);
    expect(composed.delivered()).toContain('Which examples use the outline variant?');
  });
});

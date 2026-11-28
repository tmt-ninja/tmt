import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { pairBrowser, restartColab, startDoor } from './harness/browser.js';
import { recordBlocksResults } from './harness/blocks-results.js';
import { captureResponsive } from './harness/captures.js';
import { freePort, openChat, pairedMachine, revokeMachine, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import { until } from './harness/process.js';
import { text } from '../src/strings.js';
import { commentsClose } from '../test/comments-region.js';
import { capturePath } from '../e2e/captures.js';
import { backToPageList, showAllPages } from '../test/home-list.js';

test.afterEach(disposeActiveWorlds);

/** The platform's key to the end of a block's text, past every line: a click puts the caret where
 * it lands (#6742), so a case that types at the end goes there first. */
const textEnd = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';

async function selectBlockByFocus(block: Locator) {
  await block.focus();
  await expect(block).toBeFocused();
  await expect(block).toHaveAttribute('data-selected', '');
}

test('the mounted page bar uses the shell padding and the collapsed outline shows progress', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'shell-polish-owner');
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const outline = cli(['page', 'create', '--title', 'Shell polish', '--no-open']);
    const plain = cli(['page', 'create', '--title', 'Plain page', '--no-open']);
    const insert = (type: string, label: string, props = {}) =>
      cli([
        'block',
        'insert',
        outline.pageId,
        '--type',
        type,
        '--text',
        label,
        '--props',
        JSON.stringify(props),
      ]);
    insert('heading', 'Partial', { level: 2 });
    insert('todo', 'First of three', { checked: true });
    insert('todo', 'Second of three');
    insert('todo', 'Third of three');
    insert('heading', 'Complete', { level: 2 });
    insert('todo', 'Complete task', { checked: true });
    insert('heading', 'Plain heading', { level: 2 });
    insert('heading', 'Two thirds', { level: 2 });
    insert('todo', 'First approved', { checked: true });
    insert('todo', 'Second approved', { checked: true });
    insert('todo', 'One left');
    const waiting = insert('heading', 'Waiting section', { level: 2 }).blockIds[0];
    insert('todo', 'Follow up');
    insert('question', 'Approve the release?', {
      kind: 'single',
      state: 'waiting',
      choices: ['Approve', 'Revisit'],
      other: false,
    });
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const bar = page.locator('.tmt-ui-topbar');
    const stage = page.locator('.structured-page-stage');
    const rail = page.locator('.tmt-ui-shell > .tmt-ui-rail');
    const openPage = (path: string) => page.goto(new URL(path, door.origin).href);

    for (const created of [plain, outline]) {
      await openPage(created.path);
      await expect(stage).toBeVisible();
      await expect
        .poll(() =>
          bar.evaluate((node) => {
            const start = node
              .querySelector('button.colab-work-number')!
              .getBoundingClientRect().left;
            return (
              start -
              node.getBoundingClientRect().left -
              Number.parseFloat(getComputedStyle(node).paddingInlineStart)
            );
          }),
        )
        .toBe(0);
      // The separate heading below the bar stays aligned with the page's block text.
      await expect
        .poll(() =>
          stage.evaluate((node) => {
            const bodyTitle = document.querySelector('.page-mobile-title h1')!;
            return bodyTitle.getBoundingClientRect().left - node.getBoundingClientRect().left;
          }),
        )
        .toBe(56);
    }

    await rail.getByRole('button', { name: 'Collapse side menu', exact: true }).press('Enter');
    await expect(rail.getByRole('button', { name: 'Expand side menu', exact: true })).toBeFocused();
    const strip = page.locator('.page-outline-strip');
    const rings = strip.locator('.page-outline-ring');
    await expect(rings).toHaveCount(5);
    await expect(rings.nth(0)).toHaveAttribute('data-current', '');
    await expect(rings.nth(0).locator('.page-outline-ring-progress')).toHaveAttribute(
      'stroke-dasharray',
      `${1 / 3} 1`,
    );
    await expect(rings.nth(1)).toHaveAttribute('data-state', 'done');
    await expect(rings.nth(1).locator('.page-outline-ring-symbol')).toBeVisible();
    await expect(rings.nth(2)).toHaveAttribute('data-state', 'plain');
    await expect(rings.nth(2).locator('.page-outline-ring-dot')).toBeVisible();
    await expect(rings.nth(3).locator('.page-outline-ring-progress')).toHaveAttribute(
      'stroke-dasharray',
      `${2 / 3} 1`,
    );
    await expect(rings.nth(3).locator('.page-outline-ring-progress')).toHaveCSS(
      'stroke-width',
      '2.5px',
    );
    await expect(rings.nth(3).locator('svg')).toHaveCSS('width', '20px');
    await expect(rings.nth(4)).toHaveAttribute('data-state', 'needs-you');
    await expect(rings.nth(4).locator('svg')).toBeVisible();
    await expect(rings.nth(4).locator('.page-outline-ring-symbol')).toHaveCount(1);
    await strip.hover();
    const list = page.locator('.page-outline-float');
    await expect(list.getByRole('button', { name: /Complete/ })).toBeVisible();
    await page.mouse.move(600, 500);
    await expect(list).toBeHidden();
    await strip.focus();
    await expect(list).toBeVisible();
    await list.getByRole('button', { name: /Waiting section/ }).press('Enter');
    await expect(rings.nth(4)).toHaveAttribute('data-current', '');
    await expect(stage.locator(`[data-block-id="${waiting}"]`)).toBeFocused();
    await expect(list).toBeHidden();

    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(bar.getByRole('button', { name: 'Expand side menu' })).toBeVisible();
    await expect(rail).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bar.getByRole('button', { name: 'Open navigation' })).toBeVisible();
    await expect(rings).toHaveCount(0);
  });
});

test('a phone block image viewer fits the viewport and its controls can be clicked', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'phone-image-owner');
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = cli(['page', 'create', '--title', 'Phone image', '--no-open']);
    cli([
      'block',
      'insert',
      created.pageId,
      '--type',
      'paragraph',
      '--text',
      'The sketch follows.',
    ]);
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL(created.path, door.origin).href);
    await expect(page.getByText('The sketch follows.')).toBeVisible();
    const png = path.join(world.root, 'sketch.png');
    fs.writeFileSync(
      png,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEJMOAQBACsjQf5o4qoqgAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const { attachment } = cli(['attachment', 'attach', created.pageId, png]);
    cli([
      'block',
      'insert',
      created.pageId,
      '--type',
      'image',
      '--props',
      JSON.stringify({
        layout: 'single',
        images: [{ src: `colab-attachment:${attachment.attachmentId}`, alt: 'Release sketch' }],
      }),
    ]);
    await expect(page.getByRole('img', { name: 'Release sketch' })).toBeVisible();
    const opener = page.getByRole('button', { name: 'Image 1: open viewer' });
    for (const method of ['pointer', 'keyboard']) {
      if (method === 'pointer') await opener.click();
      else await opener.press('Enter');
      const viewer = page.getByRole('dialog', { name: 'Release sketch' });
      await expect(viewer).toBeInViewport({ ratio: 0.99 });
      await viewer.getByRole('button', { name: 'Zoom in' }).click();
      await page.keyboard.press('Escape');
      await expect(viewer).toBeHidden();
      await expect(opener).toBeFocused();
    }

    const block = opener.locator('xpath=ancestor::*[@data-block-id][1]');
    const viewer = page.getByRole('dialog', { name: 'Release sketch' });
    await page.keyboard.press('Tab');
    await selectBlockByFocus(block);
    await opener.press('Space');
    await expect(viewer).toBeVisible();
    const zoom = viewer.getByRole('button', { name: 'Zoom in' });
    await zoom.press('Space');
    await expect(viewer.getByText('125%')).toBeVisible();
    await zoom.press('Enter');
    await expect.soft(viewer.getByText('150%')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();

    await selectBlockByFocus(block);
    await opener.press('Enter');
    await expect(viewer).toBeVisible();
  });
});

test('the Work crumb returns to the last active tab and defaults to Home', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'work-crumb-owner');
    const created = JSON.parse(
      run(world, world.binaries.colab, [
        'page',
        'create',
        '--title',
        'Work crumb page',
        '--no-open',
        '--json',
      ]),
    ) as { pageId: string; path: string };
    run(world, world.binaries.colab, ['project', 'add', created.pageId, 'Launch', '--json']);
    const pageUrl = new URL(created.path, door.origin).href;
    const homeUrl = new URL('/colab/work', door.origin).href;
    const listUrl = new URL('/colab/work/list', door.origin).href;
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(pageUrl);
    const shell = page.locator('.tmt-ui-shell[data-rail]');
    await page.getByRole('button', { name: 'Collapse side menu', exact: true }).click();
    await expect(shell).toHaveAttribute('data-rail', 'collapsed');
    const key = 'tmt-colab-work-tab';
    await page.evaluate((name) => localStorage.removeItem(name), key);
    await page.reload();

    const preference = () => page.evaluate((name) => localStorage.getItem(name), key);
    const crumb = page.getByRole('link', { name: 'Work', exact: true });
    const project = page.locator('.colab-scope-crumb', { hasText: /^Launch$/ });
    const tabs = page.getByRole('tablist', { name: 'Work', exact: true });
    const tab = (name: string) => tabs.getByRole('tab', { name, exact: true });
    const active = async (name: 'Home' | 'List') => {
      await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
      await expect.poll(preference).toBe(name.toLowerCase());
    };
    await expect(crumb).toHaveAttribute('href', '/colab/work');
    expect(await preference()).toBeNull();
    await crumb.click();
    await active('Home');
    await captureResponsive(page, 'work-crumb-first-target');

    await tab('List').click();
    await active('List');
    await page.goto(pageUrl);
    await page.reload();
    await expect(crumb).toHaveAttribute('href', '/colab/work/list');
    await crumb.click();
    await active('List');

    await tab('Home').click();
    await active('Home');
    await page.goto(pageUrl);
    await expect(project).toHaveAttribute('href', '/colab/work?project=Launch');
    await project.click();
    await active('Home');
    await expect(page).toHaveURL(/\/colab\/work\?project=Launch/);

    await page.goto(listUrl);
    await active('List');
    await page.goto(pageUrl);
    await expect(crumb).toHaveAttribute('href', '/colab/work/list');
    await page.goto(homeUrl);
    await active('Home');
    await page.goto(pageUrl);
    await expect(crumb).toHaveAttribute('href', '/colab/work');

    // Simulate storage that refuses this preference without disturbing device pairing.
    await page.goto(listUrl);
    await active('List');
    await page.addInitScript((key) => {
      const read = Storage.prototype.getItem;
      const write = Storage.prototype.setItem;
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
        return read.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Storage blocked', 'SecurityError');
        write.call(this, name, value);
      };
    }, key);
    await page.goto(pageUrl);
    await expect(crumb).toHaveAttribute('href', '/colab/work');
    await crumb.click();
    await expect(tab('Home')).toHaveAttribute('aria-selected', 'true');
  });
});

test('the outline follows the live side menu on the same mounted block page', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'live-outline-owner');
    const cli = (args: string[], input?: string) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json'], input));
    const created = cli(['page', 'create', '--title', 'Live outline', '--no-open']);
    cli(
      ['block', 'batch', created.pageId, '--file', '-'],
      JSON.stringify(
        ['Overview', 'Details', 'Closeout'].map((title) => ({
          op: 'insert',
          id: crypto.randomUUID(),
          type: 'heading',
          text: title,
          props: { level: 2 },
        })),
      ),
    );
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(new URL(created.path, door.origin).href);
    await page.mouse.move(720, 450);
    const shell = page.locator('.tmt-ui-shell[data-rail]');
    const outline = page.getByRole('navigation', { name: 'Page outline' });
    const strip = outline.and(page.locator('[data-strip]'));
    const collapse = page.getByRole('button', { name: 'Collapse side menu', exact: true });
    await expect(outline).toBeVisible();
    const shortcut = await collapse.getAttribute('aria-keyshortcuts');
    expect(shortcut).toMatch(/^(Meta|Control)\+Backslash$/);
    await collapse.click();
    await expect(shell).toHaveAttribute('data-rail', 'collapsed');
    await expect(strip).toBeVisible();
    await page.getByRole('button', { name: 'Expand side menu', exact: true }).click();
    await expect(shell).toHaveAttribute('data-rail', 'expanded');
    await expect(strip).toHaveCount(0);
    await page.keyboard.press(shortcut!);
    await expect(strip).toBeVisible();
    await page.keyboard.press(shortcut!);
    await expect(strip).toHaveCount(0);
    await expect(outline).toBeVisible();
  });
});

test('Enter opens table column actions and renames the column after escaping a cell edit', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'table-menu-owner');
    const cli = (args: string[], input?: string) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json'], input));
    const created = cli(['page', 'create', '--title', 'Table menu', '--no-open']);
    const table = crypto.randomUUID();
    const row = crypto.randomUUID();
    cli(
      ['block', 'batch', created.pageId, '--file', '-'],
      JSON.stringify([
        {
          op: 'insert',
          id: table,
          type: 'table',
          props: { columns: [{ id: 'state', name: 'State' }] },
        },
        { op: 'table', id: table, action: 'add-row', row, cells: { state: 'Open' } },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, door.origin).href);
    const block = page.locator(`[data-block-id="${table}"]`);
    await block.getByText('Open', { exact: true }).click();
    const editor = page.locator('[contenteditable="true"]');
    await editor.press(textEnd);
    await editor.pressSequentially(' now');
    await editor.press('Escape');
    await expect(block).toHaveAttribute('data-selected', '');
    await expect(block).toContainText('Open now');
    const actions = block.getByRole('button', { name: 'Column actions: State' });
    await actions.focus();
    await page.keyboard.press('Enter');
    const rename = page.getByRole('menuitem', { name: 'Rename', exact: true });
    await expect(rename).toBeFocused();
    await page.keyboard.press('Enter');
    const name = block.getByRole('textbox', { name: 'Column name' });
    await expect(name).toBeFocused();
    await page.keyboard.type('Status');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => {
        const listed = cli(['block', 'ls', created.pageId]).blocks;
        return {
          title: listed.find((item: { id: string }) => item.id === table)?.props.columns[0].name,
          content: listed.find((item: { id: string }) => item.id === row)?.cells.state.s,
        };
      })
      .toEqual({ title: 'Status', content: 'Open now' });
  });
});

test('keyboard activation stays on selected mockup controls', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'mockup-keyboard-owner');
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = cli(['page', 'create', '--title', 'Preview controls', '--no-open']);
    const {
      blockIds: [id],
    } = cli([
      'block',
      'insert',
      created.pageId,
      '--type',
      'mockup',
      '--props',
      JSON.stringify({ markup: '<p>Release sketch</p>', preset: '390' }),
    ]);
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, door.origin).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await selectBlockByFocus(block);
    // The width and theme sit behind one Mockup settings control (#6749): a key opens it, as a
    // click does, and the block stays selected.
    const settings = block.getByRole('button', { name: 'Mockup settings', exact: true });
    await settings.press('Enter');
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    const dark = block.getByRole('button', { name: 'Dark', exact: true });
    await dark.press('Space');
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    const wide = block.getByRole('button', { name: '1440', exact: true });
    await wide.press('Enter');
    await expect(wide).toHaveAttribute('aria-pressed', 'true');
    await expect(block).toHaveAttribute('data-selected', '');
  });
});

test('an empty mockup width field cannot delete its selected block', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'mockup-width-owner');
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = cli(['page', 'create', '--title', 'Custom preview width', '--no-open']);
    const markup = '<p>Release sketch</p>';
    const {
      blockIds: [id],
    } = cli([
      'block',
      'insert',
      created.pageId,
      '--type',
      'mockup',
      '--props',
      JSON.stringify({ markup, preset: 'custom', width: 500 }),
    ]);
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, door.origin).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await selectBlockByFocus(block);
    // The width sits behind Mockup settings (#6749), opened by key as in the case above.
    const settings = block.getByRole('button', { name: 'Mockup settings', exact: true });
    await settings.press('Enter');
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    const width = block.getByRole('spinbutton', { name: 'Stage width' });
    await width.focus();
    // The controlled width immediately clamps on change. Put its real input into the empty
    // native state to exercise key ownership independently of the width validation.
    for (const key of ['Backspace', 'Delete']) {
      await width.evaluate((node: HTMLInputElement) => {
        node.value = '';
      });
      await expect(width).toHaveValue('');
      await page.keyboard.press(key);
      // The controlled input may restore its width, but focus and the block must survive.
      await expect(width).toBeFocused();
      await expect(block).toHaveAttribute('data-selected', '');
    }
    expect(cli(['block', 'get', created.pageId, id]).block).toMatchObject({
      type: 'mockup',
      props: { markup, preset: 'custom', width: 500 },
    });
  });
});

test('keyboard activation of a selected block mention opens its destination', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'mention-keyboard-owner');
    const cli = (args: string[], input?: string) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json'], input));
    const source = cli(['page', 'create', '--title', 'Mention source', '--no-open']);
    const destination = cli(['page', 'create', '--title', 'Mention destination', '--no-open']);
    const {
      blockIds: [target],
    } = cli([
      'block',
      'insert',
      destination.pageId,
      '--type',
      'paragraph',
      '--text',
      'Release notes',
    ]);
    const id = crypto.randomUUID();
    const label = 'Read release notes';
    cli(
      ['block', 'batch', source.pageId, '--file', '-'],
      JSON.stringify([
        { op: 'insert', id, type: 'paragraph', text: label },
        {
          op: 'text',
          id,
          format: {
            from: 0,
            to: label.length,
            mark: 'block',
            value: `${destination.pageId}/${target}`,
          },
        },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(source.path, door.origin).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await selectBlockByFocus(block);
    const link = block.getByRole('link', { name: label });
    const sourceUrl = page.url();
    await link.press('Space');
    await expect(link).toBeFocused();
    await expect(page).toHaveURL(sourceUrl);
    await link.press('Enter');
    await expect(page.locator(`[data-block-id="${target}"]`)).toBeInViewport();
  });
});

test('keyboard activation of a selected to-do preserves checkbox behavior', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'todo-keyboard-owner');
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = cli(['page', 'create', '--title', 'Keyboard checklist', '--no-open']);
    const {
      blockIds: [id],
    } = cli(['block', 'insert', created.pageId, '--type', 'todo', '--text', 'Tag the release']);
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, door.origin).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await selectBlockByFocus(block);
    const checkbox = block.getByRole('checkbox', { name: 'Tag the release' });
    await checkbox.press('Space');
    await expect(checkbox).toBeChecked();
    await checkbox.press('Enter');
    await expect(checkbox).toBeFocused();
    await expect(checkbox).toBeChecked();
    await expect(block.locator('[contenteditable="true"]')).toHaveCount(0);
    await checkbox.press('Space');
    await expect(checkbox).not.toBeChecked();
  });
});

test('keyboard entry and line breaks still work in a selected code block', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'code-keyboard-owner');
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = cli(['page', 'create', '--title', 'Keyboard code', '--no-open']);
    const {
      blockIds: [id],
    } = cli(['block', 'insert', created.pageId, '--type', 'code', '--text', 'one']);
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, door.origin).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await selectBlockByFocus(block);
    await page.keyboard.press('Enter');
    const editor = block.locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();
    await editor.press(textEnd);
    await editor.press('Enter');
    await page.keyboard.type('two words');
    await editor.press('Escape');
    await expect
      .poll(() => cli(['block', 'get', created.pageId, id]).block.text?.s)
      .toBe('one\ntwo words');
  });
});

test('open --block scrolls the loopback door to the exact heading and to-do', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'block-link-reader');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId } = JSON.parse(
      run(world, colab, ['page', 'create', '--title', 'Block links', '--no-open', '--json']),
    ) as { pageId: string };
    const insert = (kind: string, label: string) =>
      (
        JSON.parse(
          run(world, colab, ['block', 'insert', pageId, '--type', kind, '--text', label, '--json']),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    const spacer = 'This paragraph keeps the next block below the fold. '.repeat(100);
    insert('paragraph', spacer);
    const heading = insert('heading', 'Release');
    insert('paragraph', spacer);
    const todo = insert('todo', 'Ship the release');
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 390, height: 850 });
    const target = (id: string) => page.locator(`[data-block-id="${id}"]`);
    const plain = JSON.parse(run(world, colab, ['open', pageId, '--json'])) as { link: string };
    await page.goto(plain.link);
    await expect(target(heading)).toBeAttached();
    await expect(target(todo)).toBeAttached();
    await expect(target(heading)).not.toBeInViewport();
    await expect(target(todo)).not.toBeInViewport();
    for (const [block, other] of [
      [heading, todo],
      [todo, heading],
    ] as const) {
      const { link, opened } = JSON.parse(
        run(world, colab, ['open', pageId, '--block', block, '--json']),
      ) as { link: string; opened: boolean };
      expect(opened).toBe(false);
      expect(new URL(link).origin).toBe(new URL(door.address).origin);
      await page.goto(link);
      await expect(target(block)).toBeInViewport();
      await expect(target(other)).not.toBeInViewport();
    }
  });
});

// Only the built app leaves Mermaid's other diagrams, layouts and KaTeX out and groups the five
// kinds into one chunk (#6746): the component specs run Mermaid whole, so this case reads the app
// the binary serves.
test('the served app draws the five kinds from its slimmed Mermaid and refuses the rest', async () => {
  await withWorld(async (world) => {
    await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'diagram-reader');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId } = JSON.parse(
      run(world, colab, ['page', 'create', '--title', 'Diagrams', '--no-open', '--json']),
    ) as { pageId: string };
    const insert = (title: string, source: string) =>
      (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            pageId,
            '--type',
            'diagram',
            '--props',
            JSON.stringify({ title }),
            '--text',
            source,
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    const across = insert('Across', 'flowchart LR\n  A[Build] --> B{Green?}\n  B -->|yes| C[Ship]');
    const down = insert('Down', 'graph TD\n  A[Plan] --> B[Review]');
    const sequence = insert('Sequence', 'sequenceDiagram\n  Agent->>Colab: write');
    const state = insert('State', 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Published');
    const gantt = insert('Gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  Design :a1, 2026-12-01, 3d');
    const classes = insert('Classes', 'classDiagram\n  Animal <|-- Duck');
    const pie = insert('Pie', 'pie\n  "A": 1');
    const math = insert('Math', 'flowchart LR\n  A["$$x^2$$"] --> B[Done]');
    const page = await browser.context.newPage();
    const { link } = JSON.parse(run(world, colab, ['open', pageId, '--json'])) as { link: string };
    await page.goto(link);
    const drawing = (id: string) =>
      page.locator(`[data-block-id="${id}"] .structured-diagram-drawing svg`);
    await expect(drawing(across)).toContainText('Ship', { timeout: 30_000 });
    await expect(drawing(down)).toContainText('Review');
    // The four other kinds draw from the one lazy diagram chunk the build keeps.
    await expect(drawing(sequence)).toContainText('Colab', { timeout: 30_000 });
    await expect(drawing(state)).toContainText('Published');
    await expect(drawing(gantt)).toContainText('Design');
    await expect(drawing(classes)).toContainText('Duck');
    // Labels are SVG text, so a math label shows as typed and never needs the KaTeX the build leaves
    // out; another diagram type is refused before Mermaid is asked.
    await expect(drawing(math)).toContainText('$$x^2$$');
    await expect(page.locator(`[data-block-id="${pie}"]`)).toContainText(text.diagram.kind);
    await expect(drawing(pie)).toHaveCount(0);
  });
});

test('a replacement owner pairing offers the old device’s kept typing without sending it', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const original = await pairBrowser(world, 'draft-original');
    const oldId = pairedMachine(world, original.name).clientId;
    const colab = world.binaries.colab;
    world.linkExtensions();
    const create = JSON.parse(
      run(world, colab, ['page', 'create', '--title', 'Re-pair draft', '--no-open', '--json']),
    ) as { pageId: string; path: string };
    run(world, colab, ['share', 'mode', create.pageId, 'link', '--yes', '--json']);
    const { readerPath } = JSON.parse(
      run(world, colab, ['share', 'link', 'add', create.pageId, '--yes', '--json']),
    ) as { readerPath: string };
    const id = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          create.pageId,
          '--type',
          'paragraph',
          '--text',
          'Before',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const savedText = () =>
      (
        JSON.parse(run(world, colab, ['block', 'get', create.pageId, id, '--json'])) as {
          block: { base: string };
        }
      ).block.base;
    const address = new URL(create.path, `${door.address}/`).href;
    const selector = `[data-block-id="${id}"]`;
    const page = await original.context.newPage();
    await page.goto(address);
    await expect(page.locator('.page-connection .status-label')).toHaveText('Live');
    await restartColab(world, door, async () => {
      await expect(page.locator('.page-attention[data-attention="reconnecting"]')).toBeVisible({
        timeout: 30_000,
      });
      await page.evaluate((id) => {
        window.addEventListener('colab:block-draft-durable', (event) => {
          if ((event as CustomEvent<{ id: string }>).detail.id === id)
            document.documentElement.dataset.testDraftKept = 'true';
        });
      }, id);
      const block = page.locator(selector);
      await block.click();
      await block.locator('[contenteditable="true"]').press(textEnd);
      await page.keyboard.insertText(' kept through pairing');
      await expect(page.locator('html')).toHaveAttribute('data-test-draft-kept', 'true');
      await page.close();
      revokeMachine(world, original.name);
    });
    const fresh = await pairBrowser(world, 'draft-replacement', { reuse: original });
    expect(pairedMachine(world, fresh.name).clientId).not.toBe(oldId);
    const reopened = await fresh.context.newPage();
    await reopened.goto(address);
    const notice = reopened.getByRole('status').filter({ hasText: text.blockEdit.restored });
    await expect(notice).toHaveCount(1, { timeout: 30_000 });
    await expect(reopened.locator(selector)).toHaveAttribute('aria-label', 'paragraph: Before');
    await expect(notice).toContainText('Before kept through pairing');
    expect(savedText()).toBe('Before');
    // The same profile holds the sealed draft. Opening the link reader must not offer it.
    const reader = await fresh.context.newPage();
    await reader.goto(new URL(readerPath, address).href);
    const rendered = reader.frameLocator('main iframe');
    await expect(rendered.getByText('Before', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(rendered.getByText('Before kept through pairing', { exact: true })).toHaveCount(0);
    await expect(
      reader.getByRole('status').filter({ hasText: text.blockEdit.restored }),
    ).toHaveCount(0);
    await reader.close();
    await expect(notice).toHaveCount(1);
    const mutations = await notice.evaluateHandle((shown) => {
      const evidence = { withdrawn: false, offers: 1 };
      new MutationObserver((records) => {
        for (const record of records)
          for (const removed of record.removedNodes)
            if (removed === shown || removed.contains(shown)) evidence.withdrawn = true;
      }).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('colab:block-drafts-offered', (event) => {
        if ((event as CustomEvent<{ count: number }>).detail.count > 0) evidence.offers++;
      });
      return evidence;
    });
    const keep = notice.getByRole('button', { name: text.blockEdit.keepRestored });
    const discard = notice.getByRole('button', { name: text.blockDelete.discard });
    for (let reconnect = 0; reconnect < 2; reconnect++) {
      await restartColab(world, door, async () => {
        await expect(
          reopened.locator('.page-attention[data-attention="reconnecting"]'),
        ).toBeVisible({ timeout: 30_000 });
        await expect(notice).toBeVisible();
        await expect(keep).toBeDisabled();
        await expect(discard).toBeDisabled();
      });
      await expect(reopened.locator('.page-connection .status-label')).toHaveText('Live', {
        timeout: 30_000,
      });
      await expect(keep).toBeEnabled();
      await expect(discard).toBeEnabled();
    }
    expect(await mutations.jsonValue()).toEqual({ withdrawn: false, offers: 1 });
    await mutations.dispose();
    await notice.getByRole('button', { name: 'Keep and continue' }).click();
    await expect.poll(savedText, { timeout: 30_000 }).toBe('Before kept through pairing');
    await reopened.reload();
    await expect(reopened.locator(selector)).toHaveText('Before kept through pairing');
    await expect(notice).toHaveCount(0);
  });
});

// #6005: a structured page made and changed by the CLI draws in the browser from the fold, and the
// person's typing goes out as a block batch that merges with an agent's edit of the same block.
test('a structured page draws CLI blocks and keeps typing and an agent edit of the same block', async () => {
  test.setTimeout(360_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-author');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Structured',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const insert = (type: string, text: string) =>
      (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            created.pageId,
            '--type',
            type,
            '--text',
            text,
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    insert('heading', 'Plan');
    const paragraph = insert('paragraph', 'Ship the stack.');
    const textNow = () =>
      (
        JSON.parse(run(world, colab, ['block', 'get', created.pageId, paragraph, '--json'])) as {
          block: { base: string };
        }
      ).block.base;

    let page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    let block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toHaveText('Ship the stack.');
    // At rest no block holds an editor.
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);

    await block.click();
    const editor = block.locator('[contenteditable="true"]');
    await editor.press(textEnd);
    await editor.pressSequentially(' Today.', { delay: 40 });
    // The person's typing reaches the page as a block batch.
    await expect.poll(textNow, { timeout: 30_000 }).toBe('Ship the stack. Today.');

    // An agent changes the start of the same block while the person types at its end.
    await editor.pressSequentially(' Then', { delay: 40 });
    run(world, colab, [
      'block',
      'text',
      created.pageId,
      paragraph,
      '--find',
      'Ship',
      '--replace',
      'Merge',
      '--json',
    ]);
    await editor.pressSequentially(' rest.', { delay: 40 });
    const merged = 'Merge the stack. Today. Then rest.';
    await expect(editor).toHaveText(merged, { timeout: 30_000 });
    await expect.poll(textNow, { timeout: 30_000 }).toBe(merged);

    // #6741: a phone may background and discard the tab while typing is pending.
    const expected = `${merged} background`;
    const address = new URL(created.path, `${door.address}/`).href;
    await page.setViewportSize({ width: 390, height: 900 });
    const cdp = await browser.context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const other = await browser.context.newPage();
    await page.bringToFront();
    await block.click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await page.evaluate((id) => {
      const state = window as Window & { inputSerial?: number; durableSerial?: number };
      state.inputSerial = 0;
      state.durableSerial = 0;
      document.addEventListener(
        'input',
        (event) => {
          if (event.isTrusted) state.inputSerial!++;
        },
        true,
      );
      window.addEventListener('colab:block-draft-durable', (event) => {
        if ((event as CustomEvent<{ id: string }>).detail.id === id)
          state.durableSerial = state.inputSerial;
      });
    }, paragraph);
    await page.keyboard.type(' background');
    await other.bringToFront();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const state = window as Window & { inputSerial?: number; durableSerial?: number };
            return !!state.inputSerial && state.inputSerial === state.durableSerial;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.close();
    page = await browser.context.newPage();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(address);
    await other.close();
    block = page.locator(`[data-block-id="${paragraph}"]`);
    const notice = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
    await expect
      .poll(
        async () => (await block.textContent())?.includes(expected) || (await notice.isVisible()),
        { timeout: 30_000 },
      )
      .toBe(true);
    if (await notice.isVisible())
      await notice.getByRole('button', { name: 'Keep and continue' }).click();
    await expect(block).toContainText(expected);
    await expect.poll(textNow, { timeout: 30_000 }).toBe(expected);

    // Keep a draft while the serve is down; a concurrent CLI edit must survive its recovery.
    await block.click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await restartColab(world, door, async () => {
      await page.keyboard.type(' unsent');
      await expect(block).toContainText(`${expected} unsent`);
      await backToPageList(page);
      await expect(
        page.getByRole('alert').getByRole('heading', { name: 'Page unavailable', exact: true }),
      ).toBeVisible();
      run(world, colab, [
        'block',
        'text',
        created.pageId,
        paragraph,
        '--find',
        'Merge',
        '--replace',
        'Reviewed',
        '--json',
      ]);
    });
    await page.getByRole('button', { name: 'Try again', exact: true }).click({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /^All, \d+\+?$/ })).toBeVisible({ timeout: 30_000 });
    await showAllPages(page);
    await page.getByRole('link', { name: 'Structured', exact: true }).click();
    const restored = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
    await expect(restored).toBeVisible({ timeout: 30_000 });
    expect(textNow()).toContain('Reviewed');
    expect(textNow()).not.toContain(' unsent');
    const captureDir = process.env.COLAB_6741_CAPTURE_DIR;
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['light', 'dark']) {
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await page.screenshot({ path: path.join(captureDir, `${width}-${theme}-restored.png`) });
        }
      }
    }
    await restored.getByRole('button', { name: 'Keep and continue' }).click();
    await expect
      .poll(textNow, { timeout: 30_000 })
      .toBe(`${expected.replace('Merge', 'Reviewed')} unsent`);
    await page.reload();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' }),
    ).toHaveCount(0);
    await expect(block).toContainText(`${expected.replace('Merge', 'Reviewed')} unsent`);
  });
});

for (const departure of ['reload', 'navigate'] as const) {
  test(`#6741 block typing survives immediate ${departure}`, async () => {
    await withWorld(async (world) => {
      const door = await startDoor(world, await freePort());
      const browser = await pairBrowser(world, `block-recovery-${departure}`);
      const colab = world.binaries.colab;
      const created = JSON.parse(
        run(world, colab, [
          'page',
          'create',
          '--title',
          'Recovery',
          '--structured',
          '--json',
          '--no-open',
        ]),
      ) as { pageId: string; path: string };
      const paragraph = (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            created.pageId,
            '--type',
            'paragraph',
            '--text',
            'Plan',
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
      const page = await browser.context.newPage();
      await page.goto(new URL(created.path, `${door.address}/`).href);
      const block = page.locator(`[data-block-id="${paragraph}"]`);
      await block.click();
      await block.locator('[contenteditable="true"]').press(textEnd);
      await page.evaluate((id) => {
        const state = window as Window & { inputSerial?: number; durableSerial?: number };
        state.inputSerial = 0;
        state.durableSerial = 0;
        document.addEventListener(
          'input',
          (event) => {
            if (event.isTrusted) state.inputSerial!++;
          },
          true,
        );
        window.addEventListener('colab:block-draft-durable', (event) => {
          if ((event as CustomEvent<{ id: string }>).detail.id === id)
            state.durableSerial = state.inputSerial;
        });
      }, paragraph);
      let savedRecord: { key: string; value: unknown } | undefined;
      let guarded = false;
      page.on('dialog', async (dialog) => {
        expect(dialog.type()).toBe('beforeunload');
        guarded = true;
        await dialog.dismiss();
      });
      await page.keyboard.type(' publish Friday');
      if (departure === 'reload') {
        await expect
          .poll(
            () =>
              page.evaluate(() => {
                const state = window as Window & { inputSerial?: number; durableSerial?: number };
                return !!state.inputSerial && state.durableSerial === state.inputSerial;
              }),
            { timeout: 5_000 },
          )
          .toBe(true);
        const beforeReload = (
          JSON.parse(run(world, colab, ['block', 'get', created.pageId, paragraph, '--json'])) as {
            block: { base: string };
          }
        ).block.base;
        expect(beforeReload).toBe('Plan');
        // Capture the real sealed recovery record while the server still has the old text.
        savedRecord = await page.evaluate(async (pageId) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('tmt-colab', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const store = database.transaction('keys').objectStore('keys');
            const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
              const request = store.getAllKeys();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            const key = keys.find(
              (item) =>
                typeof item === 'string' &&
                /^(owner-)?block-drafts:/.test(item) &&
                item.endsWith(`:${pageId}`),
            );
            if (typeof key !== 'string') throw new Error('Missing sealed block draft');
            const value = await new Promise<unknown>((resolve, reject) => {
              const request = database.transaction('keys').objectStore('keys').get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return { key, value };
          } finally {
            database.close();
          }
        }, created.pageId);
        await page.reload();
        expect(guarded).toBe(false);
      } else {
        await backToPageList(page);
        await showAllPages(page);
        await page.getByRole('link', { name: 'Recovery', exact: true }).click();
      }
      const notice = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
      await expect
        .poll(
          async () =>
            (await block.textContent())?.includes('Plan publish Friday') ||
            (await notice.isVisible()),
          { timeout: 30_000 },
        )
        .toBe(true);
      if (await notice.isVisible())
        await notice.getByRole('button', { name: 'Keep and continue' }).click();
      await expect(block).toContainText('Plan publish Friday');
      await expect
        .poll(
          () =>
            (
              JSON.parse(
                run(world, colab, ['block', 'get', created.pageId, paragraph, '--json']),
              ) as { block: { base: string } }
            ).block.base,
          { timeout: 30_000 },
        )
        .toBe('Plan publish Friday');
      if (savedRecord) {
        // Restore the actual encrypted record for a block deleted elsewhere, then fail its clear.
        run(world, colab, ['block', 'delete', created.pageId, paragraph, '--json']);
        await page.evaluate(async ({ key, value }) => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('tmt-colab', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const transaction = database.transaction('keys', 'readwrite');
              transaction.objectStore('keys').put(value, key);
              transaction.oncomplete = () => resolve();
              transaction.onerror = () => reject(transaction.error);
              transaction.onabort = () => reject(transaction.error);
            });
          } finally {
            database.close();
          }
        }, savedRecord);
        await page.reload();
        const deleted = page
          .getByRole('status')
          .filter({ hasText: 'This block was deleted while you were editing it.' });
        await expect(deleted).toBeVisible();
        await page.evaluate((key) => {
          const original = IDBObjectStore.prototype.put;
          (window as Window & { restoreDraftPut?: () => void }).restoreDraftPut = () => {
            IDBObjectStore.prototype.put = original;
          };
          IDBObjectStore.prototype.put = function (value, recordKey) {
            if (recordKey === key) throw new Error('Simulated local storage failure');
            return original.call(this, value, recordKey);
          };
        }, savedRecord.key);
        await deleted.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(
          page.getByRole('status').filter({ hasText: 'Your last change was not applied.' }),
        ).toBeVisible();
        await expect(deleted).toBeVisible();
        await page.evaluate(() => {
          const restore = (window as Window & { restoreDraftPut?: () => void }).restoreDraftPut;
          if (!restore) throw new Error('Missing draft storage restore hook');
          restore();
        });
        await deleted.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(deleted).toHaveCount(0);
      }
    });
  });
}

// #6749: a phone join that lands while the split before it is still being saved. A reload offered
// the split's half ("First half "), and Keep put it back over the joined paragraph. Only the
// page's draft store is held, through its lock, as a slow phone's is.
test('a reload after a landed join offers no stale draft, and still offers one newer than the page', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-join');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Join with Backspace',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const first = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'First half Second half',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const texts = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
          blocks: { depth: number; text?: { s: string } }[];
        }
      ).blocks
        .filter((block) => block.depth === 0 && block.text)
        .map((block) => block.text!.s);
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const address = new URL(created.path, `${door.address}/`).href;
    await page.goto(address);
    const block = page.locator(`[data-block-id="${first}"]`);
    await expect(block).toHaveText('First half Second half', { timeout: 30_000 });
    const notice = page.getByRole('status').filter({ hasText: 'Your unsaved text was restored' });
    // Leaving with a draft on its way asks first; this person leaves.
    page.on('dialog', (dialog) => void dialog.accept());
    await page.evaluate(() => {
      const locks = navigator.locks;
      const request = locks.request.bind(locks);
      const gate = { hold: true, held: [] as (() => void)[], done: 0 };
      (window as Window & { draftGate?: typeof gate }).draftGate = gate;
      Object.defineProperty(locks, 'request', {
        value: (name: string, callback: LockGrantedCallback<unknown>) => {
          if (!name.startsWith('owner-block-drafts:') || !gate.hold) return request(name, callback);
          return new Promise<void>((resolve) => gate.held.push(resolve))
            .then(() => request(name, callback))
            .finally(() => gate.done++);
        },
      });
    });
    await block.click();
    const editor = block.locator('[contenteditable="true"]');
    await editor.press('Home');
    for (let i = 0; i < 'First half '.length; i++) await editor.press('ArrowRight');
    await editor.press('Enter');
    await expect.poll(texts, { timeout: 30_000 }).toEqual(['First half ', 'Second half']);
    const gate = () =>
      page.evaluate(() => {
        const gate = (window as Window & { draftGate?: { held: unknown[]; done: number } })
          .draftGate!;
        return { held: gate.held.length, done: gate.done };
      });
    // The split's saves are queued behind the slow store.
    const split = (await gate()).held;
    expect(split).toBeGreaterThan(0);
    const second = page.locator('[contenteditable="true"]');
    await expect(second).toHaveText('Second half');
    await second.press('Backspace');
    await expect.poll(texts, { timeout: 30_000 }).toEqual(['First half Second half']);
    // The split's saves finish now and the join's still wait: the store holds "First half ".
    await page.evaluate((count) => {
      const gate = (window as Window & { draftGate?: { held: (() => void)[] } }).draftGate!;
      for (const release of gate.held.splice(0, count)) release();
    }, split);
    await expect.poll(async () => (await gate()).done).toBe(split);
    // What the reload offers, once it has read the page's stored drafts.
    await page.addInitScript(() => {
      window.addEventListener('colab:block-drafts-offered', (event) => {
        (window as Window & { offered?: number }).offered = (
          event as CustomEvent<{ count: number }>
        ).detail.count;
      });
    });
    const offered = async () =>
      (
        await page.waitForFunction(
          () => {
            const count = (window as Window & { offered?: number }).offered;
            return count === undefined ? undefined : { count };
          },
          undefined,
          { timeout: 30_000 },
        )
      ).jsonValue();
    await page.reload();
    await expect(block).toHaveText('First half Second half', { timeout: 30_000 });
    expect(await offered()).toEqual({ count: 0 });
    await expect(notice).toHaveCount(0);
    expect(texts()).toEqual(['First half Second half']);

    // A draft newer than the page is still offered: typed while the serve is down, kept over a
    // reload there, and offered once the page is back. The edit starts after the page says it is
    // reconnecting, as a person would meet it (#6795); before, it opened only when the click beat
    // the page to the dropped connection.
    await page.evaluate(() => {
      window.addEventListener('colab:block-draft-durable', () => {
        (window as Window & { durable?: boolean }).durable = true;
      });
    });
    await restartColab(world, door, async () => {
      // At phone width the bar says it in the title's place.
      await expect(page.locator('.colab-topbar-phone-title')).toBeVisible({ timeout: 30_000 });
      await block.click();
      await block.locator('[contenteditable="true"]').press(textEnd);
      await page.keyboard.type(' later');
      await page.waitForFunction(() => (window as Window & { durable?: boolean }).durable);
      await page.reload();
    });
    await page.reload();
    await expect(notice).toBeVisible({ timeout: 30_000 });
    expect(await offered()).toEqual({ count: 1 });
    await notice.getByRole('button', { name: 'Keep and continue' }).click();
    await expect.poll(texts, { timeout: 30_000 }).toEqual(['First half Second half later']);
  });
});

test('a page of blocks keeps typing while Colab is stopped, says so, and sends it once on reconnect (#6795)', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-held');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Offline typing',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const insert = (text: string) =>
      (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            created.pageId,
            '--type',
            'paragraph',
            '--text',
            text,
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    const kept = insert('First half Second half');
    const gone = insert('Other block');
    const texts = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
          blocks: { depth: number; deleted?: boolean; text?: { s: string } }[];
        }
      ).blocks
        .filter((block) => block.depth === 0 && block.text && !block.deleted)
        .map((block) => block.text!.s);
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const first = page.locator(`[data-block-id="${kept}"]`);
    const second = page.locator(`[data-block-id="${gone}"]`);
    await expect(first).toHaveText('First half Second half', { timeout: 30_000 });
    const status = page.locator('.page-attention[data-attention="reconnecting"]');
    const label = page.locator('.page-connection .status-label');
    await expect(label).toHaveText('Live', { timeout: 30_000 });
    await expect(status).toHaveCount(0);
    await page.evaluate(() => {
      window.addEventListener('colab:block-draft-durable', () => {
        const w = window as Window & { durable?: number };
        w.durable = (w.durable ?? 0) + 1;
      });
    });
    const durable = (count: number) =>
      page.waitForFunction(
        (count) => ((window as Window & { durable?: number }).durable ?? 0) >= count,
        count,
      );
    await restartColab(world, door, async () => {
      // The person is told, once to assistive technology, and keeps typing.
      await expect(status).toHaveText('◐Reconnecting… what you type is kept', { timeout: 30_000 });
      await expect(page.locator('.connection-announcement')).toHaveText(
        'Reconnecting… what you type is kept',
      );
      await first.click();
      await first.locator('[contenteditable="true"]').press(textEnd);
      await page.keyboard.type(' later');
      await durable(1);
      await second.click();
      await second.locator('[contenteditable="true"]').press(textEnd);
      await page.keyboard.type(' too');
      await durable(2);
      expect(texts()).toEqual(['First half Second half', 'Other block']);
      // Meanwhile the page changes elsewhere: a word of the first block, and the second is deleted.
      run(world, colab, [
        'block',
        'text',
        created.pageId,
        kept,
        '--find',
        'First',
        '--replace',
        'Primo',
      ]);
      run(world, colab, ['block', 'delete', created.pageId, gone]);
    });
    await expect(label).toHaveText('Live', { timeout: 60_000 });
    await expect(status).toHaveCount(0);
    // The first block's typing lands once, merged with the change made meanwhile.
    await expect.poll(texts, { timeout: 30_000 }).toEqual(['Primo half Second half later']);
    // The second block's typing has no block to land in: the page offers it back in its place, as
    // for any block deleted while it was being edited, never dropping it.
    const offer = page
      .getByRole('status')
      .filter({ hasText: 'This block was deleted while you were editing it.' });
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await expect(second).toContainText('Other block too');
    await offer.getByRole('button', { name: 'Keep as a new block' }).click();
    await expect
      .poll(texts, { timeout: 30_000 })
      .toEqual(['Primo half Second half later', 'Other block too']);
  });
});

test('typing kept while Colab is stopped survives the page being archived meanwhile, and lands once when it is restored (#6795, #6820)', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-held-archived');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Archived meanwhile',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const id = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Before',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const texts = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
          blocks: { depth: number; text?: { s: string } }[];
        }
      ).blocks
        .filter((block) => block.depth === 0 && block.text)
        .map((block) => block.text!.s);
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await expect(block).toHaveText('Before', { timeout: 30_000 });
    await expect(page.locator('.page-connection .status-label')).toHaveText('Live', {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      window.addEventListener('colab:block-draft-durable', () => {
        (window as Window & { durable?: boolean }).durable = true;
      });
    });
    await restartColab(world, door, async () => {
      await expect(page.locator('.page-attention[data-attention="reconnecting"]')).toBeVisible({
        timeout: 30_000,
      });
      await block.click();
      await block.locator('[contenteditable="true"]').press(textEnd);
      await page.keyboard.type(' after');
      await page.waitForFunction(() => (window as Window & { durable?: boolean }).durable);
      run(world, colab, ['archive', created.pageId]);
    });
    // Back, but archived: the text cannot land, and the page says it is kept, not lost. The page
    // draws what it holds, not the text that has not landed (#6820).
    await expect(page.locator('.page-attention[data-attention="archived"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText(`${text.archiveAnnouncement} ${text.archivedDraftsKept}`),
    ).toBeVisible({ timeout: 30_000 });
    await expect(block).toHaveText('Before');
    // Wherever the person has scrolled, the block line says where the text went.
    await expect(page.getByText(text.blockEdit.kept)).toBeVisible();
    expect(texts()).toEqual(['Before']);
    // Restored: the kept text lands once by itself, so nothing is left to choose. The page offers
    // what is still unlanded only after its own sends settle, so it never shows an offer and
    // withdraws it (#6820).
    await page.evaluate(() => {
      const w = window as Window & { offers?: number[] };
      w.offers = [];
      window.addEventListener('colab:block-drafts-offered', (event) =>
        w.offers!.push((event as CustomEvent<{ count: number }>).detail.count),
      );
    });
    run(world, colab, ['unarchive', created.pageId]);
    await expect(page.locator('.page-connection .status-label')).toHaveText('Live', {
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => ((window as Window & { offers?: number[] }).offers ?? []).length > 0,
    );
    await expect.poll(texts, { timeout: 30_000 }).toEqual(['Before after']);
    await expect(page.getByRole('status').filter({ hasText: text.blockEdit.restored })).toHaveCount(
      0,
    );
    await expect(block).toHaveText('Before after');
    // The status region says what is true now.
    await expect(page.locator('.archive-announcement')).toHaveText(text.restoreAnnouncement);
  });
});

test('typing whose block is deleted while the page is archived is offered once it is restored, and stays until chosen (#6820)', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-held-archived-gone');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Archived and deleted meanwhile',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const id = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Before',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const texts = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
          blocks: { depth: number; text?: { s: string } }[];
        }
      ).blocks
        .filter((block) => block.depth === 0 && block.text)
        .map((block) => block.text!.s);
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await expect(block).toHaveText('Before', { timeout: 30_000 });
    await expect(page.locator('.page-connection .status-label')).toHaveText('Live', {
      timeout: 30_000,
    });
    await page.evaluate(() => {
      window.addEventListener('colab:block-draft-durable', () => {
        (window as Window & { durable?: boolean }).durable = true;
      });
    });
    await restartColab(world, door, async () => {
      await expect(page.locator('.page-attention[data-attention="reconnecting"]')).toBeVisible({
        timeout: 30_000,
      });
      await block.click();
      await block.locator('[contenteditable="true"]').press(textEnd);
      await page.keyboard.type(' after');
      await page.waitForFunction(() => (window as Window & { durable?: boolean }).durable);
      run(world, colab, ['block', 'delete', created.pageId, id]);
      run(world, colab, ['archive', created.pageId]);
    });
    await expect(page.locator('.page-attention[data-attention="archived"]')).toBeVisible({
      timeout: 60_000,
    });
    expect(texts()).toEqual([]);
    await page.evaluate(() => {
      const w = window as Window & { offers?: number[] };
      w.offers = [];
      window.addEventListener('colab:block-drafts-offered', (event) =>
        w.offers!.push((event as CustomEvent<{ count: number }>).detail.count),
      );
    });
    run(world, colab, ['unarchive', created.pageId]);
    await expect(page.locator('.page-connection .status-label')).toHaveText('Live', {
      timeout: 60_000,
    });
    // The typing has no block to land in: once the page's own sends settle it is offered in its
    // place, and the offer stays through a later change to the page until the person chooses.
    const offer = page.getByRole('status').filter({ hasText: text.blockDelete.draft });
    await expect(offer).toBeVisible({ timeout: 30_000 });
    // As for any block deleted while it was being edited, the kept text draws in its place.
    await expect(block).toContainText('Before after');
    run(world, colab, [
      'block',
      'insert',
      created.pageId,
      '--type',
      'paragraph',
      '--text',
      'Later',
    ]);
    await expect(page.getByText('Later', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(offer).toBeVisible();
    expect(texts()).toEqual(['Later']);
    await offer.getByRole('button', { name: text.blockDelete.keep }).click();
    await expect
      .poll(texts, { timeout: 30_000 })
      .toEqual(expect.arrayContaining(['Later', 'Before after']));
    expect(texts()).toHaveLength(2);
    await expect(offer).toHaveCount(0);
  });
});

test('#6741 warns before leaving while a draft write is pending', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'block-draft-guard');
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Guard',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const paragraph = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Plan',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await block.click();
    await block.locator('[contenteditable="true"]').press(textEnd);
    await page.evaluate(() => {
      const locks = navigator.locks;
      const request = locks.request.bind(locks);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      (window as Window & { releaseDraftWrite?: () => void }).releaseDraftWrite = release;
      Object.defineProperty(locks, 'request', {
        value: (name: string, callback: LockGrantedCallback<unknown>) =>
          name.startsWith('block-drafts:')
            ? held.then(() => request(name, callback))
            : request(name, callback),
      });
    });
    let warned = false;
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      warned = true;
      await dialog.dismiss();
    });
    await page.keyboard.type(' Friday');
    const diagnostic = async (stage: string) => {
      const dom = await page.evaluate((id) => {
        const block = document.querySelector(`[data-block-id="${id}"]`);
        const editor = block?.querySelector('[contenteditable="true"]');
        const active = document.activeElement;
        return {
          url: location.href,
          block: block?.textContent,
          editor: editor?.textContent,
          active: active?.outerHTML.slice(0, 300),
        };
      }, paragraph);
      const server = (
        JSON.parse(run(world, colab, ['block', 'get', created.pageId, paragraph, '--json'])) as {
          block: { base: string };
        }
      ).block.base;
      console.log(`#6741 case B ${stage} ${JSON.stringify({ dom, server, navigations })}`);
    };
    await diagnostic('before-dismissal');
    try {
      await page.reload({ timeout: 10_000 });
    } catch (error) {
      if (!warned) throw error;
    }
    expect(warned).toBe(true);
    await diagnostic('after-dismissal');
    await expect(block).toContainText('Plan Friday');
    await page.evaluate(() =>
      (window as Window & { releaseDraftWrite?: () => void }).releaseDraftWrite?.(),
    );
    await expect
      .poll(
        () =>
          (
            JSON.parse(
              run(world, colab, ['block', 'get', created.pageId, paragraph, '--json']),
            ) as { block: { base: string } }
          ).block.base,
        { timeout: 30_000 },
      )
      .toBe('Plan Friday');
  });
});

// #6449: the comment remains anchored after a real page reload. #6611: text selected in a block
// offers Annotate as on an HTML page, without Selection mode; a block without text is still
// annotated whole from Selection mode.
test('a comment on a structured block survives reopening', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'block-comment');
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(
        world,
        colab,
        [
          'page',
          'create',
          '--title',
          'Review notes',
          '--html',
          '--reason',
          'Exercise the HTML source path',
          '--layout',
          'column',
          '--file',
          '-',
          '--json',
          '--no-open',
        ],
        '<p>Legacy review page.</p>',
      ),
    ) as { pageId: string; path: string };
    run(world, colab, ['page', 'convert', created.pageId, '--yes', '--json']);
    const paragraph = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Review this release before launch.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const duplicate = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'Review this release before launch.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const mockup = crypto.randomUUID();
    run(
      world,
      colab,
      ['block', 'batch', created.pageId, '--file', '-', '--json'],
      JSON.stringify([
        {
          op: 'insert',
          id: mockup,
          type: 'mockup',
          parent: 'root',
          after: duplicate,
          props: { markup: '<p>Mockup</p>' },
        },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toContainText('Review this release before launch.');
    // A person selects with the pointer (#6636): a drag across words of a block at rest selects
    // that text, not the block, and offers Annotate quoting exactly the dragged words.
    const dragAcross = async (phrase: string) => {
      const words = await block.evaluate((node, phrase) => {
        const text = [...node.querySelectorAll('*')]
          .flatMap((element) => [...element.childNodes])
          .find(
            (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes(phrase),
          )!;
        const range = document.createRange();
        const start = text.textContent!.indexOf(phrase);
        range.setStart(text, start);
        range.setEnd(text, start + phrase.length);
        const rects = range.getClientRects();
        const first = rects[0]!;
        const last = rects[rects.length - 1]!;
        return {
          x1: first.left + 1,
          y1: first.top + first.height / 2,
          x2: last.right - 1,
          y2: last.top + last.height / 2,
        };
      }, phrase);
      await page.mouse.move(words.x1, words.y1);
      await page.mouse.down();
      await page.mouse.move(words.x2, words.y2, { steps: 12 });
      await page.mouse.up();
    };
    await dragAcross('this release');
    await expect(block).not.toHaveAttribute('data-selected');
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    const dragged = page.locator('.annotation-popover');
    await expect(dragged.getByText('Annotate the selection', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        [...(CSS.highlights.get('colab-annotating') ?? [])].map((range) => range.toString()),
      ),
    ).toEqual(['this release']);
    await page.keyboard.press('Escape');
    await expect(dragged).toHaveCount(0);
    // The control leaves with its window instead of staying where the selection was (#6636).
    await expect(page.getByRole('button', { name: 'Annotate', exact: true })).toHaveCount(0);
    // The keyboard path selects the same way.
    await block.getByText('Review this release before launch.').click();
    await page.keyboard.press(textEnd);
    for (const _ of 'launch.') await page.keyboard.press('Shift+ArrowLeft');
    await page.getByRole('button', { name: 'Annotate', exact: true }).click();
    const annotation = page.locator('.annotation-popover');
    // Titled and marked as an HTML page's selection: the quoted text stays marked while it is open.
    await expect(annotation.getByText('Annotate the selection', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => {
        const marked = [...(CSS.highlights.get('colab-annotating') ?? [])];
        return marked.map((range) => range.toString());
      }),
    ).toEqual(['launch.']);
    const message = 'Please check this block.';
    const composer = annotation.getByRole('combobox', { name: 'Message' });
    await composer.fill(message);
    await annotation.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    // The sent text can still be a saved draft until retention resolves. Assert that it
    // appears in the conversation itself and that it leaves the composer before reload.
    const sent = annotation.locator('[data-testid="comment-echo"], [data-testid="comment-entry"]');
    await expect(sent.getByText(message, { exact: true })).toBeVisible();
    await expect(composer).toHaveText('');
    // Wait for the admitted thread before navigating away.
    await expect(block.getByRole('button', { name: 'Open comment 1' })).toBeAttached();
    await expect(
      page
        .locator(`[data-block-id="${duplicate}"]`)
        .getByRole('button', { name: 'Open comment 1' }),
    ).toHaveCount(0);
    await page.reload();
    await block.getByRole('button', { name: 'Open comment 1' }).click();
    await expect(
      page.getByTestId('comments-panel').getByTestId('comment-entry').getByText(message, {
        exact: true,
      }),
    ).toBeVisible();
    await commentsClose(page, 'discussion').click();
    await page.getByRole('button', { name: 'Selection mode', exact: true }).click();
    // In Selection mode the same drag quotes the dragged text at a phone width too (#6636).
    await page.setViewportSize({ width: 390, height: 844 });
    await dragAcross('release before');
    const narrow = page.locator('.annotation-popover');
    await expect(narrow.getByText('Annotate the selection', { exact: true })).toBeVisible();
    await expect(narrow.locator('.annotation-quote')).toHaveText('release before');
    await page.keyboard.press('Escape');
    await expect(narrow).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    // Escape also left Selection mode; the mockup below is annotated in it.
    const mode = page.getByRole('button', { name: 'Selection mode', exact: true });
    if ((await mode.getAttribute('aria-pressed')) !== 'true') await mode.click();
    const preview = page.locator(`[data-block-id="${mockup}"]`);
    await preview.locator('.tmt-block-mockup-viewport').click();
    const mockupComment = page.locator('.annotation-popover');
    await expect(mockupComment.getByText('Annotate the block', { exact: true })).toBeVisible();
    await mockupComment.getByRole('combobox', { name: 'Message' }).fill('Review this mockup.');
    await mockupComment.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
    await expect(preview.getByRole('button', { name: 'Open comment 2' })).toBeAttached();
    await page.reload();
    // The preview keeps to the text column, so its marker sits at the column's edge, where the
    // comments card the reload restores covers it: close the card first, as for comment 1.
    await commentsClose(page, 'discussion').click();
    await preview.getByRole('button', { name: 'Open comment 2' }).click();
    await expect(page.getByText('Review this mockup.', { exact: true })).toBeVisible();
    const threads = JSON.parse(run(world, colab, ['threads', created.pageId, '--json']))
      .threads as {
      id: string;
      anchor: { block?: string; quote?: { exact: string } } | null;
    }[];
    expect(threads.map((thread) => thread.anchor?.block).sort()).toEqual(
      [paragraph, mockup].sort(),
    );
    // The selection's text is the quote; the editor kept its text.
    expect(threads.find((thread) => thread.anchor?.block === paragraph)?.anchor?.quote?.exact).toBe(
      'launch.',
    );
    await expect(block).toContainText('Review this release before launch.');
    const target = threads.find((thread) => thread.anchor?.block === mockup)!;
    run(world, colab, ['page', 'convert', created.pageId, '--revert', '--yes', '--json']);
    await page.reload();
    await expect(page.locator('iframe')).toBeVisible();
    await page.getByRole('button', { name: /^Comments/ }).click();
    await expect(page.getByText('Review this mockup.', { exact: true })).toBeVisible();
    const after = JSON.parse(run(world, colab, ['threads', created.pageId, '--json'])) as {
      threads: { id: string; anchor: { block?: string } | null; resolved: boolean }[];
    };
    expect(after.threads.find((thread) => thread.id === target.id)?.anchor?.block).toBe(mockup);
    run(world, colab, ['threads', 'resolve', created.pageId, target.id, '--json']);
    const resolved = JSON.parse(run(world, colab, ['threads', created.pageId, '--json'])) as {
      threads: { id: string; resolved: boolean }[];
    };
    expect(resolved.threads.find((thread) => thread.id === target.id)?.resolved).toBe(true);
    run(world, colab, ['threads', 'reopen', created.pageId, target.id, '--json']);
    const reopened = JSON.parse(run(world, colab, ['threads', created.pageId, '--json'])) as {
      threads: { id: string; resolved: boolean }[];
    };
    expect(reopened.threads.find((thread) => thread.id === target.id)?.resolved).toBe(false);
  });
});

for (const width of [1440, 1280]) {
  for (const collapsed of [false, true]) {
    test(`the Comment gutter accepts a real pointer crossing at ${width} with the rail ${collapsed ? 'collapsed' : 'expanded'}`, async () => {
      await withWorld(async (world) => {
        const door = await startDoor(world, await freePort());
        const cli = (args: string[], input?: string) =>
          JSON.parse(run(world, world.binaries.colab, [...args, '--json'], input));
        const created = cli([
          'page',
          'create',
          '--title',
          'Comment pointer crossing',
          '--structured',
          '--no-open',
        ]);
        const id = crypto.randomUUID();
        const sentence = 'Review the release checklist.';
        cli(
          ['block', 'batch', created.pageId, '--file', '-'],
          JSON.stringify([
            {
              op: 'insert',
              type: 'heading',
              id: crypto.randomUUID(),
              text: 'First heading',
              props: { level: 2 },
            },
            { op: 'insert', type: 'todo', id, text: sentence },
            {
              op: 'insert',
              type: 'todo',
              id: crypto.randomUUID(),
              text: 'Update the release notes.',
            },
          ]),
        );
        const owner = await pairBrowser(world, 'comment-pointer-owner');
        const page = await owner.context.newPage();
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        if (collapsed)
          await page.addInitScript(() => localStorage.setItem('tmt-shell-rail', 'collapsed'));
        await page.goto(new URL(created.path, door.origin).href);
        await expect(page.locator('.tmt-ui-shell[data-rail]')).toHaveAttribute(
          'data-rail',
          collapsed ? 'collapsed' : 'expanded',
        );
        const block = page.locator(`[data-block-id="${id}"]`);
        const label = block.locator('.tmt-block-todo-text');
        await expect(label).toContainText(sentence);
        const origin = await label.evaluate((node, sentence) => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          for (let run = walker.nextNode(); run; run = walker.nextNode()) {
            if (run.textContent?.trim() !== sentence) continue;
            const range = document.createRange();
            range.selectNodeContents(run);
            const first = range.getClientRects()[0]!;
            return { x: first.x + Math.min(10, first.width / 2), y: first.y + first.height / 2 };
          }
          throw new Error('To-do text has no rendered run');
        }, sentence);
        await page.mouse.move(origin.x, origin.y);
        const action = block.getByRole('button', { name: 'Comment on block', exact: true });
        const slot = block.locator('.structured-comment-action');
        await expect(slot).toHaveCSS('opacity', '1');
        const target = (await action.boundingBox())!;
        const row = (await block.boundingBox())!;
        const gap = target.x - row.x - row.width;
        expect.soft(gap, 'Comment button clears the highlighted row').toBeGreaterThanOrEqual(0);
        expect.soft(gap, 'Comment button stays beside the highlighted row').toBeLessThanOrEqual(16);
        if (process.env.COLAB_CAPTURE_DIR)
          await page.screenshot({
            path: capturePath(`6952-todo-${width}-${collapsed ? 'collapsed' : 'expanded'}.png`),
          });
        const destination = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
        // Sample the last 55 px at pixel resolution so a narrow dead gap cannot be skipped.
        const approach = destination.x - 55;
        const approachY =
          origin.y +
          (destination.y - origin.y) * ((approach - origin.x) / (destination.x - origin.x));
        await page.mouse.move(approach, approachY, { steps: 20 });
        await page.mouse.move(destination.x, destination.y, { steps: 55 });
        await page.mouse.down();
        await page.mouse.up();
        await expect(
          page.locator('.annotation-popover').getByText('Annotate the block', { exact: true }),
        ).toBeVisible();
      });
    });
  }
}

test('whole-block comments open from the gutter and grip without selecting text', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'whole-block-comment');
    world.linkExtensions();
    const cli = (args: string[], input?: string) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json'], input));
    const created = cli([
      'page',
      'create',
      '--title',
      'Release review',
      '--structured',
      '--no-open',
    ]);
    const paragraph = crypto.randomUUID();
    const card = crypto.randomUUID();
    const table = crypto.randomUUID();
    const row = crypto.randomUUID();
    cli(
      ['block', 'batch', created.pageId, '--file', '-'],
      JSON.stringify([
        { op: 'insert', id: paragraph, type: 'paragraph', text: 'Review the release checklist.' },
        { op: 'insert', id: card, type: 'card', props: { title: 'Release details' } },
        {
          op: 'insert',
          id: table,
          parent: card,
          type: 'table',
          props: { columns: [{ id: 'status', name: 'Status' }] },
        },
        { op: 'table', id: table, action: 'add-row', row, cells: { status: 'Ready' } },
      ]),
    );
    const page = await browser.context.newPage();
    // The full-width image needs a clear gutter beside the 1280 px stage.
    await page.addInitScript(() => localStorage.setItem('tmt-shell-rail', 'collapsed'));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(new URL(created.path, door.origin).href);
    await expect(page.getByText('Review the release checklist.')).toBeVisible();
    const png = path.join(world.root, 'sketch.png');
    fs.writeFileSync(
      png,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEJMOAQBACsjQf5o4qoqgAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const { attachment } = cli(['attachment', 'attach', created.pageId, png]);
    const image = cli([
      'block',
      'insert',
      created.pageId,
      '--type',
      'image',
      '--props',
      JSON.stringify({
        layout: 'single',
        images: [{ src: `colab-attachment:${attachment.attachmentId}`, alt: 'Release sketch' }],
      }),
    ]).blockIds[0] as string;
    await expect(page.getByRole('img', { name: 'Release sketch' })).toBeVisible();

    const block = (id: string) => page.locator(`[data-block-id="${id}"]`);
    const action = (id: string) =>
      block(id).getByRole('button', { name: 'Comment on block', exact: true });
    const handle = (id: string) =>
      block(id).getByRole('button', { name: 'Block actions', exact: true });
    const menu = page.getByRole('menu', { name: 'Block actions' });
    const comment = menu.getByRole('menuitem', { name: 'Comment', exact: true });
    const composer = page.locator('.annotation-popover');
    const shot = async (name: string) => {
      if (process.env.COLAB_CAPTURE_DIR)
        await page.screenshot({ path: capturePath(name), animations: 'disabled' });
    };
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.mouse.move(0, 0);
      await shot(`6917-resting-1440-${colorScheme}.png`);
      for (const [kind, id] of [
        ['paragraph', paragraph],
        ['table', table],
        ['image', image],
      ] as const) {
        const before = await block(id).boundingBox();
        await block(id).hover();
        const button = action(id);
        await expect(button).toBeInViewport();
        await expect(button.locator('xpath=../..')).toHaveCSS('opacity', '1');
        if (kind === 'paragraph') {
          const paragraphText = 'Review the release checklist.';
          await expect(button).toHaveAccessibleDescription(text.blockActions.commentHelp);
          await expect(block(id)).toHaveText(paragraphText);
          const quote = await block(id).evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.toString();
          });
          expect(quote).toBe(paragraphText);
        }
        const [body, control] = await Promise.all([block(id).boundingBox(), button.boundingBox()]);
        expect(body?.width).toBe(before?.width);
        expect(control!.x - body!.x - body!.width).toBeCloseTo(10, 0);
        await shot(`6917-${kind}-1440-${colorScheme}.png`);
        if (kind === 'paragraph' && colorScheme === 'light') {
          await button.hover();
          const tooltip = page.locator('.tmt-ui-icon-action-tooltip:popover-open');
          await expect(tooltip).toHaveText(text.blockActions.commentHelp);
          expect(
            await tooltip.evaluate((node) => node.closest('[data-block-id], [contenteditable]')),
          ).toBeNull();
        }
      }
    }
    // The full-width block takes the pointer beyond the document edge on its way to the button.
    await block(image).hover();
    const [imageBox, imageAction] = await Promise.all([
      block(image).boundingBox(),
      action(image).boundingBox(),
    ]);
    const crossingY = imageAction!.y + imageAction!.height / 2;
    const crossingX = imageAction!.x + imageAction!.width / 2;
    await page.mouse.move(imageBox!.x + imageBox!.width - 20, crossingY);
    await page.mouse.move(crossingX, crossingY, { steps: 42 });
    await page.mouse.down();
    await page.mouse.up();
    await expect(composer.getByText('Annotate the block', { exact: true })).toBeVisible();
    await composer.getByRole('button', { name: text.threadCollapse, exact: true }).click();
    await expect(composer).toHaveCount(0);
    async function send(body: string, id: string, ordinal: number) {
      await expect(composer.getByText('Annotate the block', { exact: true })).toBeVisible();
      await composer.getByRole('combobox', { name: 'Message' }).fill(body);
      await composer.getByRole('button', { name: /^Send(?: · to .+)?$/, exact: true }).click();
      await expect(
        block(id).getByRole('button', { name: `Open comment ${ordinal}` }),
      ).toBeAttached();
      await page.keyboard.press('Escape');
      await expect(composer).toHaveCount(0);
    }

    await block(paragraph).hover();
    await handle(paragraph).click();
    await comment.click();
    await send('Paragraph review', paragraph, 1);

    await selectBlockByFocus(block(table));
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('Home');
    await expect(menu).toHaveAttribute('aria-activedescendant', 'block-action-comment');
    await page.keyboard.press('Enter');
    await send('Table review', table, 2);

    // The otherwise visually hidden desktop button is keyboard reachable and opens the same path.
    await page.mouse.move(0, 0);
    await selectBlockByFocus(block(image));
    await page.keyboard.press('Tab');
    await expect(action(image)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(composer.getByText('Annotate the block', { exact: true })).toBeVisible();
    await composer.getByRole('button', { name: text.threadCollapse, exact: true }).click();
    await expect(composer).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(action(image)).toHaveCount(0);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await selectBlockByFocus(block(image));
      await handle(image).click();
      await expect(comment).toBeVisible();
      await shot(`6917-menu-390-${colorScheme}.png`);
      await comment.click();
      await expect(composer.getByText('Annotate the block', { exact: true })).toBeVisible();
      await shot(`6917-composer-390-${colorScheme}.png`);
      if (colorScheme === 'dark') await send('Image review', image, 3);
      else {
        await composer.getByRole('button', { name: text.threadCollapse, exact: true }).click();
        await expect(composer).toHaveCount(0);
      }
    }

    const threads = cli(['threads', created.pageId]).threads as {
      anchor: { block: string; quote?: { exact: string } };
    }[];
    expect(threads.map(({ anchor }) => [anchor.block, anchor.quote?.exact])).toEqual(
      expect.arrayContaining([
        [paragraph, 'Review the release checklist.'],
        [table, undefined],
        [image, undefined],
      ]),
    );
    expect(threads).toHaveLength(3);
    await page.reload();
    for (const [id, ordinal] of [
      [paragraph, 1],
      [table, 2],
      [image, 3],
    ] as const) {
      await expect(
        block(id).getByRole('button', { name: `Open comment ${ordinal}` }),
      ).toBeAttached();
    }
  });
});

// #6611: an agent's edit never moves a person's typing out of the Chat composer, even with a
// block selected on the page before they moved there.
test('an agent edit keeps focus in Chat and never moves it into the page', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'chat-focus', { talk: true });
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Focus',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const id = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'First block.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await block.getByText('First block.').click();
    await page.keyboard.press('Escape');
    await expect(block).toBeFocused();
    await openChat(page);
    const input = page.getByTestId('chat-panel').getByRole('combobox', { name: 'Message' });
    await input.click();
    await page.keyboard.type('hello ');
    run(world, colab, [
      'block',
      'text',
      created.pageId,
      id,
      '--find',
      'First',
      '--replace',
      'Second',
      '--json',
    ]);
    await expect(block).toContainText('Second block.');
    await expect(input).toBeFocused();
    await page.keyboard.type('there');
    await expect.poll(() => input.innerText()).toBe('hello there');
    await expect(page.locator('[data-block-id]')).toHaveText(['Second block.']);
    // Focus the person left on the empty page is not taken by the selected block either: a key
    // after the agent's next edit changes nothing on the page.
    await page.getByRole('button', { name: 'Close Chat', exact: true }).click();
    await block.getByText('Second block.').click();
    await page.keyboard.press('Escape');
    await expect(block).toBeFocused();
    const empty = (await page.locator('.structured-page-stage').boundingBox())!;
    await page.mouse.click(empty.x + empty.width / 2, empty.y + empty.height + 120);
    await expect(block).not.toBeFocused();
    run(world, colab, [
      'block',
      'text',
      created.pageId,
      id,
      '--find',
      'Second',
      '--replace',
      'Third',
      '--json',
    ]);
    await expect(block).toContainText('Third block.');
    await expect(block).not.toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.type('x');
    await expect(page.locator('[data-block-id]')).toHaveText(['Third block.']);
  });
});

// #6005's done condition: a person writes and rearranges a page in the browser, and edits its
// table, while an agent edits the same page through the CLI; both land, and the page the CLI reads
// back is the page the browser draws.
test('a person writes, rearranges and edits a table while an agent edits the same page', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-together');
    const colab = world.binaries.colab;
    world.linkExtensions();
    // Block and row IDs are UUIDs, as the serve requires.
    const id = Object.fromEntries(
      ['plan', 'first', 'second', 'work', 'w1', 'w2', 'w3', 'note'].map((key) => [
        key,
        crypto.randomUUID(),
      ]),
    ) as Record<'plan' | 'first' | 'second' | 'work' | 'w1' | 'w2' | 'w3' | 'note', string>;
    const { pageId, path } = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Together',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const batch = (ops: unknown[]) =>
      run(world, colab, ['block', 'batch', pageId, '--file', '-', '--json'], JSON.stringify(ops));
    batch([
      {
        op: 'insert',
        id: id.plan,
        type: 'heading',
        parent: 'root',
        text: 'Plan',
        props: { level: 2 },
      },
      {
        op: 'insert',
        id: id.first,
        type: 'paragraph',
        parent: 'root',
        after: id.plan,
        text: 'First step.',
      },
      {
        op: 'insert',
        id: id.second,
        type: 'paragraph',
        parent: 'root',
        after: id.first,
        text: 'Second step.',
      },
      {
        op: 'insert',
        id: id.work,
        type: 'table',
        parent: 'root',
        after: id.second,
        props: {
          label: 'Work',
          columns: [
            { id: 'task', name: 'Task' },
            { id: 'state', name: 'State' },
          ],
        },
      },
      { op: 'table', id: id.work, action: 'add-row', row: id.w1, cells: { task: 'Model' } },
      { op: 'table', id: id.work, action: 'add-row', row: id.w2, cells: { task: 'Menus' } },
    ]);
    type Listed = {
      id: string;
      type: string;
      depth: number;
      text?: { s: string };
      cells?: Record<string, { s: string }>;
      props?: { columns?: { id: string; name: string }[] };
    };
    const listed = () =>
      (JSON.parse(run(world, colab, ['block', 'ls', pageId, '--json'])) as { blocks: Listed[] })
        .blocks;
    const texts = () =>
      listed()
        .filter((block) => block.depth === 0 && block.text)
        .map((block) => block.text!.s);
    const table = () => {
      const blocks = listed();
      return {
        columns: blocks.find((block) => block.id === id.work)!.props!.columns!.map((c) => c.name),
        rows: blocks
          .filter((block) => block.type === 'row')
          .map((row) =>
            Object.fromEntries(Object.entries(row.cells ?? {}).map(([key, cell]) => [key, cell.s])),
          ),
      };
    };

    const page = await browser.context.newPage();
    recordBlocksResults(page);
    await page.goto(new URL(path, `${door.address}/`).href);
    const second = page.locator(`[data-block-id="${id.second}"]`);
    await expect(second).toHaveText('Second step.');

    // The person writes at the end of a block and starts a new one with Enter.
    await second.click();
    const editor = page.locator('[contenteditable="true"]');
    await editor.press(textEnd);
    await editor.pressSequentially(' Now.', { delay: 40 });
    // Meanwhile the agent adds a note under the heading and fills a cell.
    batch([
      {
        op: 'insert',
        id: id.note,
        type: 'paragraph',
        parent: 'root',
        after: id.plan,
        text: 'Agent note.',
      },
      { op: 'table', id: id.work, action: 'set-cell', row: id.w1, column: 'state', text: 'done' },
    ]);
    await editor.press('Enter');
    await editor.pressSequentially('Third step.', { delay: 40 });
    await expect
      .poll(texts, { timeout: 30_000 })
      .toEqual(['Plan', 'Agent note.', 'First step.', 'Second step. Now.', 'Third step.']);

    // The person rearranges: Esc selects the block, and ⌥⇧↑ moves it above the first step.
    await editor.press('Escape');
    await page.locator(`[data-block-id="${id.second}"]`).click();
    await page.keyboard.press('Escape');
    await expect(second).toHaveAttribute('data-selected', '');
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect
      .poll(texts, { timeout: 30_000 })
      .toEqual(['Plan', 'Agent note.', 'Second step. Now.', 'First step.', 'Third step.']);

    // The table: the person fills a cell and adds a column while the agent adds a row.
    const work = page.locator(`[data-block-id="${id.work}"]`);
    await expect(work.locator('tbody tr').first()).toContainText('done');
    await work.locator('tbody tr').nth(1).locator('td').first().click();
    await editor.pressSequentially('open', { delay: 40 });
    batch([{ op: 'table', id: id.work, action: 'add-row', row: id.w3, cells: { task: 'Review' } }]);
    await editor.press('Escape');
    await work.getByRole('button', { name: 'Column actions: State' }).click();
    await page.getByRole('menuitem', { name: 'Add a column after' }).click();
    const name = work.getByRole('textbox', { name: 'Column name' });
    await name.fill('Owner');
    await name.press('Enter');
    await expect.poll(table, { timeout: 30_000 }).toEqual({
      columns: ['Task', 'State', 'Owner'],
      rows: [
        { task: 'Model', state: 'done' },
        { task: 'Menus', state: 'open' },
        { task: 'Review' },
      ],
    });

    // The browser draws the page the CLI reads back.
    const drawn = page.locator('[data-block-id]');
    await expect(drawn).toHaveText([
      'Plan',
      'Agent note.',
      'Second step. Now.',
      'First step.',
      'Third step.',
      /Task.*State.*Owner.*Model.*done.*Menus.*open.*Review/,
    ]);
    // A batch of the person's that the page could not get through (#6220) shows its notice.
    await expect(page.getByRole('status').filter({ hasText: 'not saved' })).toHaveCount(0);

    // A long cell typed at full speed, then Esc and a reload at once: the page holds it all, and
    // nothing typed on the way is offered back, neither part of this cell nor the keys the Enter
    // above moved to the new block (#6795).
    const long = ` ${'abcdefgh'.repeat(18)}`;
    // The row's first column is its header cell: Owner is the second data cell.
    await work.locator('tbody tr').first().locator('td').nth(1).click();
    await editor.press(textEnd);
    await page.keyboard.type(long);
    await editor.press('Escape');
    await page.addInitScript(() => {
      window.addEventListener('colab:block-drafts-offered', () => {
        (window as Window & { offered?: boolean }).offered = true;
      });
    });
    await page.reload();
    await expect(work.locator('tbody tr').first()).toContainText(long.trim(), { timeout: 30_000 });
    await page.waitForFunction(() => (window as Window & { offered?: boolean }).offered);
    await expect(page.getByText(text.blockEdit.restored)).toHaveCount(0);
    await expect
      .poll(() => Object.values(table().rows[0]!).some((cell) => cell.trim() === long.trim()))
      .toBe(true);
  });
});

// #6005 image step: an agent attaches a file and inserts an image naming it; the browser draws it
// through the page's authorized read; a delete keeps the file, so undo draws it again.
test('an attached image draws on a page of blocks and comes back on undo', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-image');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Images',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    run(world, colab, [
      'block',
      'insert',
      pageId,
      '--type',
      'paragraph',
      '--text',
      'The sketch follows.',
      '--json',
    ]);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-image-'));
    // The serve reaches the page's object channel once a browser has opened it.
    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    await expect(page.getByText('The sketch follows.')).toBeVisible({ timeout: 30_000 });
    try {
      // A 2x2 PNG.
      const file = path.join(out, 'sketch.png');
      fs.writeFileSync(
        file,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEJMOAQBACsjQf5o4qoqgAAAABJRU5ErkJggg==',
          'base64',
        ),
      );
      const attached = JSON.parse(
        run(world, colab, ['attachment', 'attach', pageId, file, '--json']),
      ) as { attachment: { attachmentId: string } };
      const reference = `colab-attachment:${attached.attachment.attachmentId}`;
      const image = (
        JSON.parse(
          run(world, colab, [
            'block',
            'insert',
            pageId,
            '--type',
            'image',
            '--props',
            JSON.stringify({ images: [{ src: reference, alt: 'Sketch' }], layout: 'single' }),
            '--json',
          ]),
        ) as { blockIds: string[] }
      ).blockIds[0]!;

      const block = page.locator(`[data-block-id="${image}"]`);
      const drawn = block.getByRole('img', { name: 'Sketch' });
      await expect(drawn).toBeVisible({ timeout: 30_000 });
      await expect(drawn).toHaveAttribute('src', /^data:image\/png;base64,/);
      // An agent's insert draws the block without selecting it.
      expect(await block.getAttribute('aria-label')).toBe('image');
      await expect
        .poll(() => drawn.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(2);

      // Delete from the block menu, then Undo: the file stayed on the page, so it draws again.
      await block.hover();
      await page.getByRole('button', { name: 'Block actions' }).click();
      await page
        .getByRole('menu', { name: 'Block actions' })
        .getByRole('menuitem', { name: /Delete/ })
        .click();
      await expect(block).toHaveCount(0);
      const listed = () =>
        (
          JSON.parse(run(world, colab, ['block', 'ls', pageId, '--all', '--json'])) as {
            blocks: { id: string; deleted?: unknown }[];
          }
        ).blocks.find((entry) => entry.id === image);
      await expect.poll(() => listed()?.deleted !== undefined, { timeout: 30_000 }).toBe(true);
      // The deleted block still keeps the file: the serve reads it out, verified.
      const kept = JSON.parse(
        run(world, colab, [
          'attachment',
          'read',
          pageId,
          attached.attachment.attachmentId,
          '--output',
          out,
          '--json',
        ]),
      ) as { path: string };
      expect(fs.readFileSync(kept.path)).toEqual(fs.readFileSync(file));
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(drawn).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => listed()?.deleted, { timeout: 30_000 }).toBeUndefined();
      await page.close();
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

// #6202: a person drops an image and pastes a text file onto a page of blocks; each uploads, and
// one batch inserts its block and lists the file, so the CLI reads both back byte for byte. A
// delete in the browser keeps the file listed, so Undo draws the card again.
test('a dropped image and a pasted file upload, list and come back on undo', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-files');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(world, colab, [
        'page',
        'create',
        '--title',
        'Files',
        '--structured',
        '--json',
        '--no-open',
      ]),
    ) as { pageId: string; path: string };
    const anchor = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          pageId,
          '--type',
          'paragraph',
          '--text',
          'Files follow.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-files-'));
    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    await expect(page.getByText('Files follow.')).toBeVisible({ timeout: 30_000 });
    try {
      // A 2x2 PNG, and a text file whose name claims an image: its bytes decide it is a file card.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwnwEJMOAQBACsjQf5o4qoqgAAAABJRU5ErkJggg==',
        'base64',
      );
      const notes = Buffer.from('Ship the stack.\n');
      const add = (how: 'drop' | 'paste', name: string, bytes: Buffer, type: string) =>
        page.evaluate(
          ({ how, name, data, type, anchor }) => {
            const transfer = new DataTransfer();
            const raw = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
            transfer.items.add(new File([raw], name, { type }));
            const block = document.querySelector(`[data-block-id="${anchor}"]`)!;
            const target =
              how === 'paste' ? (block.querySelector('[contenteditable="true"]') ?? block) : block;
            target.dispatchEvent(
              how === 'paste'
                ? new ClipboardEvent('paste', {
                    clipboardData: transfer,
                    bubbles: true,
                    cancelable: true,
                  })
                : new DragEvent('drop', {
                    dataTransfer: transfer,
                    bubbles: true,
                    cancelable: true,
                  }),
            );
          },
          { how, name, data: bytes.toString('base64'), type, anchor },
        );
      type Listed = {
        id: string;
        type: string;
        props: Record<string, unknown>;
        deleted?: unknown;
      };
      const listed = () =>
        (
          JSON.parse(run(world, colab, ['block', 'ls', pageId, '--all', '--json'])) as {
            blocks: Listed[];
          }
        ).blocks;
      const reference = (block: Listed) =>
        String(
          (block.props.images as { src: string }[] | undefined)?.[0]?.src ??
            (block.props.files as { href: string }[])[0]!.href,
        ).slice('colab-attachment:'.length);
      const readBack = (block: Listed) =>
        fs.readFileSync(
          (
            JSON.parse(
              run(world, colab, [
                'attachment',
                'read',
                pageId,
                reference(block),
                '--output',
                out,
                '--json',
              ]),
            ) as { path: string }
          ).path,
        );

      await add('drop', 'sketch.png', png, 'image/png');
      const image = page.locator('[data-block-id]').getByRole('img', { name: 'sketch.png' });
      try {
        await expect(image).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        // #6274: say which stage the drop stopped at (ignored, tile drawn, upload failed, batch
        // not listed), bounded to one line, then fail as before.
        const view = await page.evaluate((anchor) => {
          const block = document.querySelector(`[data-block-id="${anchor}"]`);
          return {
            anchorFound: !!block,
            anchorReadonly: !!block?.hasAttribute('data-readonly'),
            tiles: document.querySelectorAll('.tmt-block-image-placeholder').length,
            failedTiles: document.querySelectorAll('.tmt-block-image-failed').length,
            images: document.querySelectorAll('[data-block-id] img').length,
            status: document.querySelector('.tmt-block-toast-place')?.textContent?.slice(0, 160),
          };
        }, anchor);
        const blocks = listed().map((block) => ({
          type: block.type,
          images: (block.props.images as unknown[] | undefined)?.length ?? 0,
          files: (block.props.files as unknown[] | undefined)?.length ?? 0,
          deleted: !!block.deleted,
        }));
        console.log(`#6274 drop diagnostics ${JSON.stringify({ view, blocks }).slice(0, 2000)}`);
        throw error;
      }
      await expect.poll(() => image.evaluate((n) => (n as HTMLImageElement).naturalWidth)).toBe(2);
      await page.getByText('Files follow.').click();
      await add('paste', 'notes.png', notes, 'image/png');
      const card = page.locator('.tmt-block-file');
      await expect(card).toContainText('notes.png', { timeout: 30_000 });
      await expect(card.locator('.tmt-block-file-size')).toHaveText('16 B');

      // The serve holds both blocks, each naming a file the page lists, with the same bytes.
      await expect
        .poll(() => listed().filter((block) => block.type === 'image').length, { timeout: 30_000 })
        .toBe(2);
      const blocks = listed();
      const files = blocks.filter((block) => block.type === 'image');
      const drawnImage = files.find((block) => Array.isArray(block.props.images))!;
      const fileCard = files.find((block) => block.props.variant === 'file')!;
      expect(readBack(drawnImage)).toEqual(png);
      expect(readBack(fileCard)).toEqual(notes);
      // Its bytes, not its name, made it a text file card.
      expect((fileCard.props.files as { type: string }[])[0]!.type).toBe('text/plain');
      // The paste went after the focused paragraph; the drop after the paragraph it landed on.
      expect(blocks.filter((block) => !block.deleted).map((block) => block.id)).toEqual([
        anchor,
        fileCard.id,
        drawnImage.id,
      ]);

      // Download asks the page's confirmation bar, then saves the file through the authorized read.
      await card.getByRole('button', { name: 'Download notes.png' }).click();
      const bar = page.getByRole('dialog', { name: 'Download attachment' });
      await expect(bar).toContainText('notes.png');
      const pending = page.waitForEvent('download');
      await bar.getByRole('button', { name: 'Download' }).click();
      const saved = await pending;
      expect(saved.suggestedFilename()).toBe('notes.png');
      expect(fs.readFileSync((await saved.path())!)).toEqual(notes);

      // Delete the card from the block menu, then Undo: the file stayed listed, so it draws again.
      const cardBlock = page.locator(`[data-block-id="${fileCard.id}"]`);
      await cardBlock.hover();
      await cardBlock.getByRole('button', { name: 'Block actions' }).click();
      await page
        .getByRole('menu', { name: 'Block actions' })
        .getByRole('menuitem', { name: /Delete/ })
        .click();
      await expect(cardBlock).toHaveCount(0);
      const state = () => listed().find((block) => block.id === fileCard.id)?.deleted;
      await expect.poll(() => state() !== undefined, { timeout: 30_000 }).toBe(true);
      expect(readBack(fileCard)).toEqual(notes);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(card).toContainText('notes.png', { timeout: 30_000 });
      await expect.poll(state, { timeout: 30_000 }).toBeUndefined();
      await page.close();
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

// #6208: the @ picker opens another of the owner's pages and marks its block with the page; the serve
// admits the `<pageId>/<blockId>` value. Activating it reaches the offscreen block through the
// normal owner shell (#6749), and history keeps each entry's actual scroll position.
test('@ marks a block on another page and opens it in the viewport', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'structured-at-pages');
    const colab = world.binaries.colab;
    world.linkExtensions();
    const create = (title: string) =>
      JSON.parse(
        run(world, colab, [
          'page',
          'create',
          '--title',
          title,
          '--structured',
          '--json',
          '--no-open',
        ]),
      ) as { pageId: string; path: string };
    const insert = (pageId: string, type: string, text: string) =>
      (
        JSON.parse(
          run(world, colab, ['block', 'insert', pageId, '--type', type, '--text', text, '--json']),
        ) as { blockIds: string[] }
      ).blockIds[0]!;
    const spacer = 'The following content stays below the fold. '.repeat(200);
    const other = create('Release checklist');
    insert(other.pageId, 'heading', 'Overview');
    insert(other.pageId, 'paragraph', spacer);
    insert(other.pageId, 'heading', 'Release steps');
    const tag = insert(other.pageId, 'todo', 'Tag the release');
    insert(other.pageId, 'paragraph', spacer);
    insert(other.pageId, 'heading', 'Follow-up');
    const here = create('Plan');
    insert(here.pageId, 'paragraph', spacer);
    const paragraph = insert(here.pageId, 'paragraph', 'See');
    const page = await browser.context.newPage();
    await page.goto(new URL(here.path, `${door.address}/`).href);
    await expect(page.getByText('See', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByText('See', { exact: true }).click();
    const editor = page.locator(`[data-block-id="${paragraph}"] [contenteditable="true"]`);
    await editor.press(textEnd);
    await editor.pressSequentially(' @rel', { delay: 20 });
    const menu = page.getByRole('listbox', { name: '@ mention' });
    await menu.getByRole('option', { name: 'Release checklist' }).click({ timeout: 30_000 });
    await menu.getByRole('option', { name: 'To-do: Tag the release' }).click({
      timeout: 30_000,
    });
    await expect(menu).toHaveCount(0);
    // The serve holds the mark with the other page's ID, and the HTML export names that page.
    const value = `${other.pageId}/${tag}`;
    await expect
      .poll(
        () =>
          (
            JSON.parse(run(world, colab, ['block', 'get', here.pageId, paragraph, '--json'])) as {
              block: { text?: { marks?: { mark: string; value?: string }[] } };
            }
          ).block.text?.marks?.find((mark) => mark.mark === 'block')?.value,
        { timeout: 30_000 },
      )
      .toBe(value);
    const hereUrl = new URL(here.path, door.origin).href;
    const otherUrl = new URL(other.path, door.origin).href;
    const target = page.locator(`[data-block-id="${tag}"]`);
    const mention = page.locator(`[data-block-id="${paragraph}"]`).getByRole('link');
    const direct = JSON.parse(
      run(world, colab, ['open', other.pageId, '--block', tag, '--json']),
    ) as { link: string };
    const scroll = () => page.evaluate(() => window.scrollY);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(otherUrl);
      await expect(target).toContainText('Tag the release');
      await expect(target).not.toBeInViewport();
      await page.goto(direct.link);
      await expect(target).toBeInViewport();
      await page.goto(hereUrl);
      await expect(mention).toContainText('Tag the release');
      // The router records the document's scroll event before it snapshots a history entry.
      const sourceScroll = await mention.evaluate(async (link) => {
        const before = window.scrollY;
        await new Promise<void>((resolve) => {
          const onScroll = () => resolve();
          document.addEventListener('scroll', onScroll, { once: true });
          link.scrollIntoView({ block: 'center', behavior: 'instant' });
          if (window.scrollY === before) {
            document.removeEventListener('scroll', onScroll);
            resolve();
          }
        });
        return window.scrollY;
      });
      const sourceUrl = page.url();
      expect(sourceScroll).toBeGreaterThan(0);
      if (width === 1440) await mention.click();
      else {
        await mention.focus();
        await expect(mention).toBeFocused();
        await page.keyboard.press('Enter');
      }
      const destination = new URL(`/colab/pages/${other.pageId}`, door.origin);
      destination.searchParams.set('anchor', `block-${tag}`);
      await expect(page).toHaveURL(destination.href);
      await expect(target).toContainText('Tag the release');
      await expect(target, `mention destination at ${width}px`).toBeInViewport();
      const outline = page.getByRole('navigation', { name: 'Page outline' });
      if (width === 390)
        await expect(outline.locator('.page-outline-toggle')).toContainText('Release steps');
      else
        await expect(outline.getByRole('button', { name: /Release steps/ })).toHaveAttribute(
          'aria-current',
          'location',
        );

      const landing = await scroll();
      const destinationScroll = await page.evaluate(async () => {
        const scrolled = new Promise<void>((resolve) =>
          document.addEventListener('scroll', () => resolve(), { once: true }),
        );
        window.scrollBy({ top: 160, behavior: 'instant' });
        await scrolled;
        return window.scrollY;
      });
      expect(destinationScroll).toBeGreaterThan(landing);
      await page.goBack();
      await expect(page).toHaveURL(sourceUrl);
      await expect.poll(scroll).toBe(sourceScroll);
      await page.goForward();
      await expect(page).toHaveURL(destination.href);
      await expect.poll(scroll).toBe(destinationScroll);
    }
    await page.close();
  });
});

// #6194: a person writes a question in the browser on a page an agent made; the serve registers
// it, and the person's answer reaches that agent, the page's creator.
test('a question written in the browser is registered and its answer reaches the page creator', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('answer-agent', { gated: true });
    const browser = await pairBrowser(world, 'structured-question', { talk: true });
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Questions', '--structured', '--json', '--no-open'],
        '',
        agent.pane,
      ),
    ) as { pageId: string; path: string };
    const intro = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          pageId,
          '--type',
          'paragraph',
          '--text',
          'Before the question.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;

    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    await page.locator(`[data-block-id="${intro}"]`).click();
    const editor = page.locator('[contenteditable="true"]');
    await editor.press(textEnd);
    await editor.press('Enter');
    await editor.press('/');
    await editor.pressSequentially('q', { delay: 20 });
    await editor.press('Enter');
    const edit = page.getByRole('group', { name: 'Edit question' });
    // The line names the creator, as words or, for the owner device, on the recipient picker.
    await expect(edit).toContainText('Answers go to');
    await expect(edit).toContainText('answer-agent');
    await edit.getByLabel('Question').fill('Which heading should we use?');
    await edit.getByLabel('Question').press('Enter');
    await page.keyboard.type('Keep it');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Change it');
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit).toHaveCount(0);

    // The serve registered the block with the page's question registry.
    const listed = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', pageId, '--json'])) as {
          blocks: {
            id: string;
            type: string;
            text?: { s: string };
            props: Record<string, unknown>;
          }[];
        }
      ).blocks.find((block) => block.type === 'question');
    // This tab's batches commit one after another (insert, title, each choices edit).
    await expect
      .poll(() => listed()?.props.choices, { timeout: 30_000 })
      .toEqual(['Keep it', 'Change it']);
    const question = listed()!;
    expect(question.text?.s).toBe('Which heading should we use?');
    const registry = JSON.parse(run(world, colab, ['question', 'ls', pageId, '--json'])) as {
      questions: { id: string; state: string }[];
    };
    expect(registry.questions.map((entry) => entry.id)).toEqual([question.id]);

    // The answer goes to the page's creator, the agent.
    const card = page
      .locator(`[data-block-id="${question.id}"]`)
      .getByRole('group', { name: 'Which heading should we use?' });
    await card.getByLabel('Keep it', { exact: true }).check();
    await card.getByRole('button', { name: 'Send' }).click();
    await until(() => agent.received().length === 1, 'the answer reached the agent');
    const answer = agent.received()[0];
    expect(answer.identityId).toBe(agent.id);
    expect(answer.message).toContain('Answer to “Which heading should we use?”: Keep it');
    const threads = JSON.parse(run(world, colab, ['threads', pageId, '--json'])).threads as {
      comments: { questionId?: string }[];
    }[];
    expect(threads.flatMap((thread) => thread.comments.map((c) => c.questionId))).toContain(
      question.id,
    );
    await page.close();
  });
});

test('short question answer keys cannot change the blocks on the page', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('short-answer-agent');
    const browser = await pairBrowser(world, 'short-answer-owner', { talk: true });
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Answer keys', '--no-open', '--json'],
        '',
        agent.pane,
      ),
    );
    const title = 'What should we bring?';
    const id = crypto.randomUUID();
    const next = crypto.randomUUID();
    run(
      world,
      colab,
      ['block', 'batch', created.pageId, '--file', '-', '--json'],
      JSON.stringify([
        { op: 'insert', type: 'question', id, text: title, props: { kind: 'short' } },
        { op: 'insert', type: 'paragraph', id: next, after: id, text: 'Next passage' },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, door.origin).href);
    const block = page.locator(`[data-block-id="${id}"]`);
    await selectBlockByFocus(block);
    await page.keyboard.press('Enter');
    const field = block.getByRole('textbox', { name: 'Your answer' });
    await expect(field).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect(field).toBeFocused();
    await page.keyboard.type('Slides');
    await field.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 0));
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await expect(field).toHaveValue('lides');
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect(field).toBeFocused();
    await expect(block.getByRole('group', { name: title })).toBeVisible();
    const originalBlocks = [
      { id, type: 'question', text: { s: title } },
      { id: next, type: 'paragraph', text: { s: 'Next passage' } },
    ];
    const listed = () =>
      JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])).blocks;
    expect(listed()).toMatchObject(originalBlocks);
    await field.fill('Slides');
    await expect(block.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await page.keyboard.press('Enter');
    await until(() => agent.received().length === 1, 'the answer reached the agent', 30_000);
    expect(agent.received()[0]!.message).toContain(`Answer to “${title}”: Slides`);
    await page.reload();
    await expect(block.getByRole('button', { name: /Slides/ })).toBeVisible();
    // An Ask can add its own to-do, after the two original blocks.
    expect(listed().slice(0, 2)).toMatchObject(originalBlocks);
  });
});

test('built-in Other reaches the agent and survives every question read', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('other-answer-agent');
    const browser = await pairBrowser(world, 'other-answer-owner', { talk: true });
    world.linkExtensions();
    const colab = world.binaries.colab;
    const { pageId, path: pagePath } = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Other answers', '--no-open', '--json'],
        '',
        agent.pane,
      ),
    );
    const cli = (args: string[], input?: string) =>
      JSON.parse(run(world, colab, [...args, '--json'], input));
    const single = crypto.randomUUID();
    const multiple = crypto.randomUUID();
    cli(
      ['block', 'batch', pageId, '--file', '-'],
      JSON.stringify([
        {
          op: 'insert',
          id: single,
          type: 'question',
          text: 'Which format?',
          props: { kind: 'single', choices: ['PDF', 'Other'] },
        },
        {
          op: 'insert',
          id: multiple,
          after: single,
          type: 'question',
          text: 'Which days?',
          props: { kind: 'multiple', choices: ['Monday', 'Friday'], other: false },
        },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, door.origin).href);
    const first = page.locator(`[data-block-id="${single}"]`);
    const second = page.locator(`[data-block-id="${multiple}"]`);
    const answer = async (block: Locator, value: string) => {
      await block.getByLabel('Other…', { exact: true }).check();
      await block.getByLabel('Other: your answer').fill(value);
      await block.getByRole('button', { name: 'Send', exact: true }).click();
    };
    await expect(first.getByLabel('Other', { exact: true })).toHaveCount(0);
    await expect(first.getByLabel('Other…', { exact: true })).toHaveCount(1);
    expect(cli(['block', 'get', pageId, single]).block.props.choices).toEqual(['PDF', 'Other']);
    await answer(first, 'Plain text');
    await until(() => agent.received().length === 1, 'the single Other answer', 30_000);
    expect(agent.received()[0]!.message).toContain('Answer to “Which format?”: Other: Plain text');
    await second.getByLabel('Friday', { exact: true }).check();
    await answer(second, 'Sunday afternoon');
    await until(() => agent.received().length === 2, 'the multiple Other answer', 30_000);
    const selection = 'Friday; Other: Sunday afternoon';
    expect(agent.received()[1]!.message).toContain(`Answer to “Which days?”: ${selection}`);

    const question = (id: string) =>
      cli(['question', 'ls', pageId]).questions.find((item: { id: string }) => item.id === id);
    await expect
      .poll(() => question(single))
      .toMatchObject({ state: 'answered', answer: 'Other: Plain text' });
    await expect
      .poll(() => question(multiple))
      .toMatchObject({ state: 'answered', answer: selection });
    type AnswerComment = { questionId: string; body: string };
    const comment = (threads: { comments: AnswerComment[] }[], id: string) =>
      threads.flatMap(({ comments }) => comments).find(({ questionId }) => questionId === id);
    const threads = cli(['threads', pageId]).threads;
    const recorded = comment(threads, multiple);
    expect(recorded?.body).toContain(`Answer to “Which days?”: ${selection}`);
    const { directory } = cli(['export', pageId, '--dir', world.root]);
    const exported = JSON.parse(
      fs.readFileSync(path.join(directory, 'conversations.json'), 'utf8'),
    );
    for (const id of [single, multiple])
      expect(comment(exported.threads, id)?.body).toBe(comment(threads, id)?.body);
    expect(fs.readFileSync(path.join(directory, 'conversations.md'), 'utf8')).toContain(selection);

    await page.reload();
    await expect(first.getByRole('button', { name: /Other: Plain text/ })).toBeVisible();
    await second.getByRole('button', { name: /Sunday afternoon/ }).click();
    await expect(second.getByLabel('Friday', { exact: true })).toBeChecked();
    await expect(second.getByLabel('Other…', { exact: true })).toBeChecked();
    await expect(second.getByLabel('Other: your answer')).toHaveValue('Sunday afternoon');
    await expect(second.getByRole('button', { name: 'Edit question' })).toHaveCount(0);
    cli(
      ['block', 'batch', pageId, '--file', '-'],
      JSON.stringify([{ op: 'text', id: multiple, base: 'Which days?', set: 'Which afternoon?' }]),
    );
    await expect
      .poll(() => question(multiple))
      .toMatchObject({
        state: 'open',
        earlierAnswer: { answer: selection },
      });
    await expect(second.getByText(text.questionEarlierVersion(selection))).toBeVisible();
    expect(comment(cli(['threads', pageId]).threads, multiple)?.body).toBe(recorded?.body);
  });
});

// #6749: changing an answer starts from the answer given, after a reload too, so adding a choice
// or editing a short answer keeps the rest. The change reaches the agent, and the page's verified
// record ends with the whole answer.
test('a changed answer keeps what was given: a choice added after a reload, a short answer edited', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    // The agent replies at once, so each answer reaches it in turn.
    const agent = await world.startAgent('answer-agent');
    const browser = await pairBrowser(world, 'structured-change', { talk: true });
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Changes', '--structured', '--json', '--no-open'],
        '',
        agent.pane,
      ),
    ) as { pageId: string; path: string };
    const days = crypto.randomUUID();
    const note = crypto.randomUUID();
    run(
      world,
      colab,
      ['block', 'batch', pageId, '--file', '-', '--json'],
      JSON.stringify([
        {
          op: 'insert',
          id: days,
          type: 'question',
          props: { kind: 'multiple', choices: ['Monday', 'Friday', 'Sunday'], other: false },
          text: 'Which days work?',
        },
        {
          op: 'insert',
          id: note,
          type: 'question',
          props: { kind: 'short' },
          text: 'Anything to bring?',
        },
      ]),
    );
    // The page's verified record: the last answer comment on each question's thread.
    const recorded = (question: string) =>
      (
        JSON.parse(run(world, colab, ['threads', pageId, '--json'])) as {
          threads: { comments: { questionId?: string; body?: string; deleted?: boolean }[] }[];
        }
      ).threads
        .flatMap((thread) => thread.comments)
        .filter((comment) => comment.questionId === question && !comment.deleted)
        .at(-1)?.body;
    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    const card = (id: string, title: string) =>
      page.locator(`[data-block-id="${id}"]`).getByRole('group', { name: title });
    const strip = (id: string) =>
      page.locator(`[data-block-id="${id}"] .tmt-block-question-answered`);

    const choices = card(days, 'Which days work?');
    await expect(choices).toBeVisible({ timeout: 30_000 });
    const question = page.locator(`[data-block-id="${days}"]`);
    await selectBlockByFocus(question);
    await page.keyboard.press('Enter');
    const monday = choices.getByLabel('Monday', { exact: true });
    await expect(monday).toBeFocused();
    await page.keyboard.press('Space');
    await expect(monday).toBeChecked();
    await choices.getByLabel('Friday', { exact: true }).press('Space');
    await choices.getByRole('button', { name: 'Send' }).press('Enter');
    await until(() => agent.received().length === 1, 'the first answer reached the agent');
    const words = card(note, 'Anything to bring?');
    await words.getByLabel('Your answer').fill('The release notes');
    await words.getByRole('button', { name: 'Send' }).click();
    await until(() => agent.received().length === 2, 'the short answer reached the agent');
    await expect.poll(() => recorded(days), { timeout: 30_000 }).toContain('Monday; Friday');
    await expect.poll(() => recorded(note), { timeout: 30_000 }).toContain('The release notes');

    // A reload draws both from the record; the change form opens with the answer given.
    await page.reload();
    await expect(strip(days)).toContainText('Monday; Friday', { timeout: 30_000 });
    await strip(days).click();
    await expect(choices.getByLabel('Monday', { exact: true })).toBeChecked();
    await expect(choices.getByLabel('Friday', { exact: true })).toBeChecked();
    await expect(choices.getByLabel('Sunday', { exact: true })).not.toBeChecked();
    await choices.getByLabel('Sunday', { exact: true }).check();
    await choices.getByRole('button', { name: 'Send' }).click();
    await until(() => agent.received().length === 3, 'the changed answer reached the agent');
    expect(agent.received()[2].message).toContain(
      'Answer to “Which days work?”: Monday; Friday; Sunday',
    );
    await expect
      .poll(() => recorded(days), { timeout: 30_000 })
      .toContain('Monday; Friday; Sunday');
    await expect(choices.getByText('Could not confirm this answer')).toHaveCount(0);

    await strip(note).click();
    const text = words.getByLabel('Your answer');
    await expect(text).toHaveValue('The release notes');
    await text.press('End');
    await text.pressSequentially(' and the slides');
    await words.getByRole('button', { name: 'Send' }).click();
    await until(() => agent.received().length === 4, 'the edited short answer reached the agent');
    expect(agent.received()[3].message).toContain('The release notes and the slides');
    await expect
      .poll(() => recorded(note), { timeout: 30_000 })
      .toContain('The release notes and the slides');
    await page.close();
  });
});

// #6197: the person who owns the page picks, on the block question editor's recipient line, which
// agent receives the answers. The serve resolves the agent from the real identity store; the answer
// reaches that agent and not the page's creator, and choosing the creator again takes it back.
test('the agent picked in the question editor receives the answer, and the creator again after a clear', async () => {
  test.setTimeout(300_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const creator = await world.startAgent('question-creator', { gated: true });
    const chosen = await world.startAgent('question-chosen', { gated: true });
    const browser = await pairBrowser(world, 'structured-recipient', { talk: true });
    const colab = world.binaries.colab;
    world.linkExtensions();
    const { pageId, path: pagePath } = JSON.parse(
      run(
        world,
        colab,
        ['page', 'create', '--title', 'Recipients', '--structured', '--json', '--no-open'],
        '',
        creator.pane,
      ),
    ) as { pageId: string; path: string };
    const question = crypto.randomUUID();
    run(
      world,
      colab,
      ['block', 'batch', pageId, '--file', '-', '--json'],
      JSON.stringify([
        {
          op: 'insert',
          id: question,
          type: 'question',
          props: { kind: 'single', choices: ['Keep it', 'Change it'], other: false },
          text: 'Which heading should we use?',
        },
      ]),
    );
    const recipient = () =>
      (
        JSON.parse(run(world, colab, ['question', 'ls', pageId, '--json'])) as {
          questions: { id: string; agent?: { id: string; name: string } }[];
        }
      ).questions.find((entry) => entry.id === question)?.agent;
    // Registered with no agent of its own: the page's creator receives the answers.
    expect(recipient()).toBeUndefined();

    const page = await browser.context.newPage();
    await page.goto(new URL(pagePath, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${question}"]`);
    await expect(block).toBeVisible({ timeout: 30_000 });
    await expect(block.getByRole('button', { name: 'Edit question' })).toHaveCount(0);
    await selectBlockByFocus(block);
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Block actions' });
    await expect
      .poll(() => menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.id)))
      .toEqual([
        'block-action-comment',
        'block-action-move-up',
        'block-action-move-down',
        'block-action-duplicate',
        'block-action-edit-question',
        'block-action-delete',
      ]);
    await page.keyboard.press('Home');
    await expect(menu).toHaveAttribute('aria-activedescendant', 'block-action-comment');
    await page.keyboard.press('Enter');
    const composer = page.locator('.annotation-popover');
    await expect(composer.getByText('Annotate the block', { exact: true })).toBeVisible();
    await composer.getByRole('button', { name: text.threadCollapse, exact: true }).click();
    await expect(composer).toHaveCount(0);

    await selectBlockByFocus(block);
    await page.keyboard.press('Shift+F10');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    await expect(menu).toHaveAttribute('aria-activedescendant', 'block-action-edit-question');
    await page.keyboard.press('Enter');
    const edit = page.getByRole('group', { name: 'Edit question' });
    await expect(edit).toContainText('Answers go to');
    const pick = edit.locator('.question-recipient-trigger');
    // Registered with no agent of its own, the question follows the page's creator.
    await expect(pick).toHaveText(`The page creator (${creator.name})`);
    await expect(pick).toBeEnabled({ timeout: 30_000 });
    await pick.click();
    const options = page.getByRole('listbox').getByRole('option');
    // The page's creator first, then the directory's agents (Remote's order).
    await expect(options.first()).toHaveText(`The page creator (${creator.name})`);
    await expect(options).toHaveCount(3);
    expect(await options.allTextContents()).toEqual(
      expect.arrayContaining([creator.name, chosen.name]),
    );
    await options.filter({ hasText: chosen.name }).click();
    // The serve resolved the identity and registered it; the editor stays open and says who.
    await expect.poll(() => recipient()?.id, { timeout: 30_000 }).toBe(chosen.id);
    expect(recipient()?.name).toBe(chosen.name);
    await expect(pick).toHaveText(chosen.name);
    await expect(edit).toBeVisible();
    await edit.getByRole('button', { name: 'Done' }).click();
    await expect(edit).toHaveCount(0);

    // The answer goes to the chosen agent, not the creator.
    const card = block.getByRole('group', { name: 'Which heading should we use?' });
    await card.getByLabel('Keep it', { exact: true }).check();
    await card.getByRole('button', { name: 'Send' }).click();
    await until(() => chosen.received().length === 1, 'the answer reached the chosen agent');
    expect(chosen.received()[0].identityId).toBe(chosen.id);
    expect(chosen.received()[0].message).toContain(
      'Answer to “Which heading should we use?”: Keep it',
    );
    expect(creator.received()).toHaveLength(0);

    // Choosing the page creator clears the question's own agent: the registry follows the creator.
    // An answered question is one line; pressing it opens the card again, with its Edit.
    await block.getByRole('button', { name: /Which heading should we use\?/ }).click();
    await expect(block.getByRole('button', { name: 'Edit question' })).toHaveCount(0);
    await block.hover();
    await block.getByRole('button', { name: 'Block actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit question', exact: true }).click();
    await expect(pick).toHaveText(chosen.name);
    await pick.click();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: `The page creator (${creator.name})`, exact: true })
      .click();
    await expect.poll(() => recipient(), { timeout: 30_000 }).toBeUndefined();
    await expect(pick).toHaveText(`The page creator (${creator.name})`);
    await page.close();
  });
});

// #6474 (spec 隨口交辦): a comment that asks an agent on a page of blocks becomes a to-do on that
// page once Remote accepts the send; the request names the block to check, the thread shows the
// to-do's progress, and checking the to-do through the CLI is what makes it done.
test('a comment that asks an agent becomes a to-do the agent checks', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const agent = await world.startAgent('todo-agent');
    const browser = await pairBrowser(world, 'todo-asker', { talk: true });
    world.linkExtensions();
    const colab = world.binaries.colab;
    const created = JSON.parse(
      run(
        world,
        colab,
        [
          'page',
          'create',
          '--title',
          'Toolbar',
          '--html',
          '--reason',
          'Exercise the HTML source path',
          '--layout',
          'column',
          '--file',
          '-',
          '--json',
          '--no-open',
        ],
        '<p>Draft.</p>',
      ),
    ) as { pageId: string; path: string };
    run(world, colab, ['page', 'convert', created.pageId, '--yes', '--json']);
    const paragraph = (
      JSON.parse(
        run(world, colab, [
          'block',
          'insert',
          created.pageId,
          '--type',
          'paragraph',
          '--text',
          'The mockup sits against the switcher.',
          '--json',
        ]),
      ) as { blockIds: string[] }
    ).blockIds[0]!;
    // A later section with its own to-do: the Ask's to-do belongs beside the asked block (#6636).
    for (const [type, text] of [
      ['heading', 'Build'],
      ['todo', 'Write the data layer'],
    ])
      run(world, colab, ['block', 'insert', created.pageId, '--type', type!, '--text', text!]);
    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toContainText('The mockup sits against the switcher.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await block.hover();
    await block.getByRole('button', { name: 'Comment on block', exact: true }).click();
    const annotation = page.locator('.annotation-popover');
    const input = annotation.getByRole('combobox', { name: 'Message' });
    await input.fill('@');
    await page
      .getByRole('option', { name: /todo-agent/ })
      .first()
      .click();
    await input.pressSequentially(' add a gap above the switcher');
    await input.press('Enter');
    await until(() => agent.received().length === 1, 'one delivery to the agent');
    const message = String(agent.received()[0]!.message);
    expect(message).toContain(`Block ${paragraph}: The mockup sits against the switcher.`);
    const check = /tmt colab block props ([0-9a-f-]{36}) ([0-9a-f-]{36}) --set checked=true/.exec(
      message,
    );
    expect(check?.[1]).toBe(created.pageId);
    const todoId = check![2]!;
    expect(message).toContain('To-do: add a gap above the switcher\n');
    // The to-do appears on the page after the accepted send, with the agent and the thread.
    const listed = () =>
      (
        JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
          blocks: { id: string; type: string; props?: Record<string, unknown>; text?: string }[];
        }
      ).blocks.find((entry) => entry.id === todoId);
    await until(() => listed() !== undefined, 'the to-do block on the page', 60_000);
    expect(listed()).toMatchObject({
      type: 'todo',
      props: { assignee: 'todo-agent', checked: false },
    });
    const order = (
      JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
        blocks: { id: string }[];
      }
    ).blocks.map((entry) => entry.id);
    expect(order.indexOf(todoId)).toBe(order.indexOf(paragraph) + 1);
    const line = page.locator('.ask-todo-line');
    if (!(await line.isVisible()))
      await block.getByRole('button', { name: 'Open comment 1' }).click();
    await expect(line).toContainText('Added as a to-do · todo-agent');
    // The agent checks it the way the request says; the thread then says done.
    run(world, colab, [
      'block',
      'props',
      created.pageId,
      todoId,
      '--set',
      'checked=true',
      '--json',
    ]);
    await expect(line).toContainText('Done', { timeout: 60_000 });
    // One to-do, however often the page reads the accepted Ask.
    await page.reload();
    await expect(page.locator(`[data-block-id="${todoId}"]`)).toBeVisible();
    const todos = (
      JSON.parse(run(world, colab, ['block', 'ls', created.pageId, '--json'])) as {
        blocks: { type: string; deleted?: boolean }[];
      }
    ).blocks.filter((entry) => entry.type === 'todo' && !entry.deleted);
    expect(todos).toHaveLength(2);
    expect(agent.received()).toHaveLength(1);
  });
});

async function tabTo(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
) {
  await target.waitFor({ state: 'visible' });
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

for (const task of ['heading actions', 'annotation'] as const)
  test(`keyboard-only structured page: ${task}`, async () => {
    await withWorld(async (world) => {
      const door = await startDoor(world, await freePort());
      const browser = await pairBrowser(world, 'block-keyboard');
      world.linkExtensions();
      const cli = (args: string[]) =>
        JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
      const created = cli(['page', 'create', '--title', 'Keyboard review', '--no-open']);
      for (const title of ['Overview', 'Details', 'Decisions'])
        cli(['block', 'insert', created.pageId, '--type', 'heading', '--text', title]);
      const paragraph = cli([
        'block',
        'insert',
        created.pageId,
        '--type',
        'paragraph',
        '--text',
        'Review the checklist.',
      ]).blockIds[0];
      const todo = cli([
        'block',
        'insert',
        created.pageId,
        '--type',
        'todo',
        '--text',
        'Send the summary',
      ]).blockIds[0];
      const page = await browser.context.newPage();
      await page.goto(new URL(created.path, door.address).href);
      const nav = page.getByRole('navigation', { name: 'Page outline' });
      if (task === 'heading actions') {
        const toggle = nav.locator('.page-outline-toggle');
        await tabTo(page, toggle);
        if ((await toggle.getAttribute('aria-expanded')) === 'false')
          await page.keyboard.press('Enter');
        await tabTo(page, nav.getByRole('button', { name: 'Details', exact: true }));
        await page.keyboard.press('Enter');
        const heading = page
          .locator('[data-block-id]')
          .filter({ has: page.getByRole('heading', { name: 'Details', exact: true }) });
        await expect(heading).toBeFocused();
        await page.keyboard.press('Shift+F10');
        await expect(page.getByRole('menuitem', { name: 'Mark as done' })).toBeVisible();
        await page.keyboard.press('End');
        const menu = page.getByRole('menu', { name: 'Block actions' });
        for (
          let i = 0;
          i < 20 && !(await menu.getAttribute('aria-activedescendant'))?.endsWith('progress-done');
          i++
        )
          await page.keyboard.press('ArrowUp');
        await expect(menu).toHaveAttribute('aria-activedescendant', /progress-done$/);
        await page.keyboard.press('Enter');
        const id = await heading.getAttribute('data-block-id');
        await expect
          .poll(() => cli(['block', 'get', created.pageId, id!]).block.props.progress)
          .toBe('done');
        // Sections follow the page's own blocks at once (#6687), here and in another tab of the
        // owner: the heading marked done by hand says Done, never 0 of something.
        const other = await browser.context.newPage();
        await other.goto(new URL(created.path, door.address).href);
        const row = (view: typeof page, name: string) =>
          view
            .getByRole('navigation', { name: 'Page outline' })
            .getByRole('button', { name: new RegExp(`^${name}`) });
        for (const view of [page, other]) {
          await expect(row(view, 'Details').locator('.page-outline-section-count')).toHaveText(
            /^Done/,
          );
          await expect(row(view, 'Details').locator('.page-outline-mark')).toHaveAttribute(
            'data-shape',
            'dot',
          );
          await expect(view.locator('.page-outline-progress')).toContainText('1/2 done');
        }
        await page.getByRole('checkbox', { name: 'Send the summary' }).check();
        for (const view of [page, other]) {
          await expect(row(view, 'Decisions').locator('.page-outline-section-count')).toHaveText(
            /^1\/1/,
          );
          await expect(view.locator('.page-outline-progress')).toContainText('2/2 done');
          await expect(
            view.locator('.structured-section-heading').filter({ hasText: 'Decisions' }),
          ).toContainText('1/1');
        }
      } else {
        // A heading selected from the outline first: Selection mode does not draw it (#6675).
        const outlineToggle = nav.locator('.page-outline-toggle');
        await tabTo(page, outlineToggle);
        if ((await outlineToggle.getAttribute('aria-expanded')) === 'false')
          await page.keyboard.press('Enter');
        await tabTo(page, nav.getByRole('button', { name: 'Details', exact: true }));
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-selected]')).toHaveCount(1);
        const select = page.getByRole('button', { name: 'Selection mode', exact: true });
        await tabTo(page, select);
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-selected]')).toHaveCount(0);
        // Back from the button: the last block, then block by block, a to-do one stop (#6675).
        await expect(select).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator(`[data-block-id="${todo}"]`)).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        const block = page.locator(`[data-block-id="${paragraph}"]`);
        await expect(block).toBeFocused();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await expect(select).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(block).toBeFocused();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Annotate selection' });
        await expect(dialog.getByText('Annotate the block', { exact: true })).toBeVisible();
        await expect(dialog.locator('.annotation-quote')).toContainText('Review the checklist.');
        await page.keyboard.press('Escape');
        await expect(block).toBeFocused();
        // Selection mode stays on after the window closes (#6725): a second Escape leaves it.
        await page.keyboard.press('Escape');
        await expect(select).toHaveAttribute('aria-pressed', 'false');
        await expect(block).toBeFocused();
        await page.keyboard.press('Enter');
        // The editor opens on the block before the caret keys reach it.
        await expect(block.locator('[contenteditable="true"]')).toBeFocused();
        await page.keyboard.press('End');
        for (const _ of 'checklist.') await page.keyboard.press('Shift+ArrowLeft');
        // The page reads the selection on its selectionchange task: let the last one run before
        // Tab leaves the editor, as a person's next key would (it fails 3 in 5 on main without).
        await expect
          .poll(() =>
            page.evaluate(
              () => new Promise((done) => setTimeout(() => done(getSelection()?.toString()), 0)),
            ),
          )
          .toBe('checklist.');
        const annotate = page.getByRole('button', { name: 'Annotate', exact: true });
        await expect(annotate).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(annotate).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog.locator('.annotation-quote')).toHaveText('checklist.');
      }
    });
  });

test('remote deletion preserves typing until the person keeps or discards the draft', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const { page } = await pairBrowser(world, 'concurrent-editor');
    const cli = (...args: string[]) => run(world, world.binaries.colab, [...args, '--json']);
    const created = JSON.parse(
      cli('page', 'create', '--title', 'Release checklist', '--structured', '--no-open'),
    );
    const insert = (text: string): string =>
      JSON.parse(cli('block', 'insert', created.pageId, '--type', 'paragraph', '--text', text))
        .blockIds[0];
    const first = insert('Review launch notes');
    const second = insert('Review rollback plan');
    await page.goto(new URL(created.path, door.address).href);
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'This block was deleted while you were editing it.' });
    for (const [id, action] of [
      [first, 'Keep as a new block'],
      [second, 'Discard'],
    ] as const) {
      const block = page.locator(`[data-block-id="${id}"]`);
      await block.click();
      const editor = block.locator('[contenteditable=true]');
      await editor.press(textEnd);
      await page.keyboard.type(' today');
      cli('block', 'delete', created.pageId, id);
      await expect(notice).toBeVisible();
      await expect(editor).toBeFocused();
      await page.keyboard.type(' before noon');
      await expect(editor).toContainText(' today before noon');
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(notice).toHaveCount(0);
      await expect(block).toHaveCount(0);
      if (action === 'Keep as a new block') {
        const kept = page
          .locator('[contenteditable=true]')
          .filter({ hasText: 'Review launch notes today before noon' });
        await expect(kept).toBeFocused();
        await page.keyboard.type('.');
        const newId = await kept.evaluate((el) =>
          el.closest('[data-block-id]')!.getAttribute('data-block-id')!,
        );
        await expect
          .poll(() => JSON.parse(cli('block', 'get', created.pageId, newId)).block.base)
          .toBe('Review launch notes today before noon.');
      } else {
        await expect(page.locator('body')).not.toBeFocused();
        await page.reload();
        await expect(
          page.getByText('Review launch notes today before noon.', { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('Review rollback plan today before noon')).toHaveCount(0);
      }
    }
    // An editor that holds nothing unsent is no draft (#6725): the block leaves with the toast.
    const opened = insert('Review the press note');
    const block = page.locator(`[data-block-id="${opened}"]`);
    await block.click();
    await expect(block.locator('[contenteditable=true]')).toBeFocused();
    cli('block', 'delete', created.pageId, opened);
    await expect(
      page.getByRole('status').filter({ hasText: 'The block was deleted.' }),
    ).toBeVisible();
    await expect(block).toHaveCount(0);
    await expect(notice).toHaveCount(0);
  });
});

// #6735: once the serve has combined a page's updates into a checkpoint, the page revision a tab
// computes never equals the serve's, and every batch waited 20 s for it in turn. Past that point a
// to-do check, among an agent's inserts and the person's typing, lands at once.
test('past a combine every batch lands at once', async () => {
  test.setTimeout(240_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const { page } = await pairBrowser(world, 'combine-author');
    const colab = world.binaries.colab;
    const cli = (...args: string[]) => JSON.parse(run(world, colab, [...args, '--json']));
    const created = cli('page', 'create', '--title', 'Combined', '--structured', '--no-open') as {
      pageId: string;
      path: string;
    };
    const insert = (type: string, text: string) =>
      (
        cli('block', 'insert', created.pageId, '--type', type, '--text', text) as {
          blockIds: string[];
        }
      ).blockIds[0]!;
    const todo = insert('todo', 'Check me');
    const typed = insert('paragraph', 'Notes');
    // Close to the serve's combine point (50 updates on its writer stream) before the page opens.
    for (let n = 0; n < 44; n++) insert('paragraph', `Agent line ${n}`);
    await page.goto(new URL(created.path, door.address).href);
    const checked = () =>
      !!(cli('block', 'get', created.pageId, todo) as { block: { props?: { checked?: boolean } } })
        .block.props?.checked;
    for (let round = 0; round < 8; round++) {
      const block = page.locator(`[data-block-id="${typed}"]`);
      await block.click();
      await block.locator('[contenteditable=true]').press(textEnd);
      await page.keyboard.type(` w${round}`);
      await page.keyboard.press('Escape');
      insert('paragraph', `Agent round ${round}`);
      const was = checked();
      await page.locator(`[data-block-id="${todo}"]`).getByRole('checkbox').click();
      // Well under the 20 s the revision wait took, and with no saving line drawn.
      await expect.poll(checked, { timeout: 5_000 }).toBe(!was);
      await expect(page.getByRole('status').filter({ hasText: 'Saving your change' })).toHaveCount(
        0,
      );
    }
  });
});

test('typing at a block or cell byte limit keeps the last allowed key after reload', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const browser = await pairBrowser(world, 'limited-author');
    world.linkExtensions();
    const cli = (args: string[], input?: string) => run(world, world.binaries.colab, args, input);
    const { pageId, path } = JSON.parse(
      cli(['page', 'create', '--title', 'Full fields', '--no-open', '--json']),
    );
    const paragraph = crypto.randomUUID(),
      table = crypto.randomUUID(),
      row = crypto.randomUUID();
    const almostFull = (bytes: number) =>
      '界'.repeat(Math.floor((bytes - 1) / 3)) + 'a'.repeat((bytes - 1) % 3);
    const longId = crypto.randomUUID();
    const longText = almostFull(40950) + ' last word';
    const blockText = almostFull(32626),
      cellText = almostFull(4096);
    cli(
      ['block', 'batch', pageId, '--file', '-', '--json'],
      JSON.stringify([
        { op: 'insert', type: 'paragraph', parent: 'root', id: paragraph, text: blockText },
        {
          op: 'insert',
          type: 'paragraph',
          parent: 'root',
          id: longId,
          after: paragraph,
          text: longText,
        },
        {
          op: 'insert',
          type: 'table',
          parent: 'root',
          id: table,
          after: paragraph,
          props: { columns: [{ id: 'task', name: 'Task' }] },
        },
        { op: 'table', action: 'add-row', id: table, row, cells: { task: cellText } },
      ]),
    );
    const page = await browser.context.newPage();
    await page.goto(new URL(path, door.address).href);
    for (const [target, initial, notice] of [
      [
        page.locator(`[data-block-id="${paragraph}"]`),
        blockText,
        'This edit is too large to save. Try removing a large selection, or use the block menu to delete the block or change its type. To edit its text from the CLI, use tmt colab block text.',
      ],
      [
        page.locator(`[data-cell-row="${row}"]`),
        cellText,
        'This cell is full. Move part of the text to another cell.',
      ],
    ] as const) {
      await target.click();
      const editor = page.locator('[contenteditable="true"]');
      await editor.press(textEnd);
      await editor.pressSequentially('XY');
      await expect(page.getByText(notice, { exact: true })).toBeVisible();
      await expect(editor).toHaveText(initial + 'X');
      await expect
        .poll(() => editor.evaluate((el) => el.ownerDocument.getSelection()?.anchorOffset))
        .toBe(initial.length + 1);
      await expect
        .poll(
          () => {
            const blocks = JSON.parse(cli(['block', 'ls', pageId, '--json'])).blocks as {
              id: string;
              text?: { s: string };
              cells?: Record<string, { s: string }>;
            }[];
            return initial === blockText
              ? blocks.find((b) => b.id === paragraph)?.text?.s
              : blocks.find((b) => b.id === row)?.cells?.task?.s;
          },
          { timeout: 30000 },
        )
        .toBe(initial + 'X');
      await page.reload();
      await expect(target).toHaveText(initial + 'X');
    }
    const long = page.locator(`[data-block-id="${longId}"]`);
    await long.click();
    const field = long.locator('[contenteditable="true"]');
    await field.press(textEnd);
    await field.pressSequentially('Z');
    await expect(
      page.getByText(
        'This edit is too large to save. Try removing a large selection, or use the block menu to delete the block or change its type. To edit its text from the CLI, use tmt colab block text.',
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await expect(field).toHaveText(longText);
    // The notice is keyed by its occurrence. The same node must remain through this burst.
    const notice = await page.getByText(/This edit is too large to save/).elementHandle();
    await field.press('Backspace');
    await expect(field).toHaveText(longText);
    await field.press(process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace');
    await expect(field).toHaveText(longText);
    await field.press(textEnd);
    await field.press('Shift+ArrowLeft');
    await expect.poll(() => field.evaluate(() => getSelection()?.toString())).toBe('d');
    // Invoke the browser's Cut editing command (the same command as the menu).
    const cut = await field.evaluate((el) => {
      let selected: string | undefined;
      el.addEventListener(
        'cut',
        () => {
          selected = el.ownerDocument.getSelection()?.toString();
        },
        { capture: true, once: true },
      );
      el.ownerDocument.execCommand('cut');
      return selected;
    });
    expect(cut).toBe('d');
    await expect(field).toHaveText(longText);
    expect(await notice!.evaluate((el) => el.isConnected)).toBe(true);
    await page.reload();
    await expect(long).toHaveText(longText);
    expect(JSON.parse(cli(['block', 'get', pageId, longId, '--json'])).block.text.s).toBe(longText);
    await long.click();
    await field.press(textEnd);
    await field.press('ArrowLeft');
    await field.press('Enter');
    await expect(field).toBeFocused();
    await expect(field).toHaveText(longText);
    await field.press('Escape');
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Turn into' }).click();
    await page.getByRole('menuitem', { name: 'Heading 2' }).click();
    await expect(long.getByRole('heading')).toHaveText(longText);
    await page.reload();
    await expect(long).toHaveText(longText);
    await long.click();
    await field.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await field.press('Backspace');
    await expect
      .poll(() => JSON.parse(cli(['block', 'get', pageId, longId, '--json'])).block.text.s)
      .toBe('');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect
      .poll(() =>
        JSON.parse(cli(['block', 'ls', pageId, '--json'])).blocks.some(
          (block: { id: string }) => block.id === longId,
        ),
      )
      .toBe(false);
  });
});

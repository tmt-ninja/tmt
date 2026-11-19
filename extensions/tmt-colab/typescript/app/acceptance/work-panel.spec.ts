import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { pairBrowser, startDoor, openReaderLink } from './harness/browser.js';
import { createPage, openPage, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

/** Match the settled shared token, not an in-between light/dark transition frame. */
async function panelTheme(page: Page, chip: Locator, theme: string) {
  await page.mouse.move(0, 0);
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
  const background = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--tmt-ui-surface-command)';
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect(chip).toHaveCSS('background-color', background);
}

/** The page's details open from the bar's status chip (#6652): a popover, or a sheet on a phone. */
async function openDetails(page: Page) {
  await page.locator('.tmt-ui-topbar:visible .page-bar-status').click();
  const details = page.locator('.page-status-details:visible');
  await expect(details).toBeVisible();
  return details;
}
const field = (details: Locator, name: string) =>
  details
    .locator('.page-status-fields dt')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator('xpath=following-sibling::dd[1]');
/** The work band (parent and sub-pages) inside the opened details. */
const bandIn = (details: Locator) => details.getByRole('region', { name: 'Work on this page' });

test.afterEach(disposeActiveWorlds);

test('an open linked PR supplies the owner page status', async () => {
  await withWorld(async (world) => {
    const result = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            state: 'OPEN',
            mergeCommit: null,
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
          },
        },
      },
    });
    writeFileSync(join(world.root, 'wrap', 'gh'), `#!/bin/sh\nprintf '%s\\n' '${result}'\n`, {
      mode: 0o700,
    });
    const created = createPage(
      world,
      'Linked work',
      '<p><a href="https://github.com/example/project/pull/42">Review</a></p>',
    );
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'work-facts-owner');
    const page = await openPage(door, browser, created);
    const status = page.getByRole('button', { name: 'Waiting for CI, show status details' });
    await expect(status).toBeVisible();
    await status.click();
    await expect(page.getByText(/PR #42.*CI pending/)).toBeVisible();
    const shown = JSON.parse(run(world, world.binaries.colab, ['show', created.pageId, '--json']));
    expect(shown.page.computedStatus.state).toBe('waiting-ci');
    const listed = JSON.parse(run(world, world.binaries.colab, ['ls', '--json']));
    expect(
      listed.pages.find((entry: { pageId: string }) => entry.pageId === created.pageId)
        .computedStatus.state,
    ).toBe('waiting-ci');
  });
});

test('an owner can ignore and restore a title-bound PR', async () => {
  await withWorld(async (world) => {
    world.linkExtensions();
    const cli = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = cli([
      'page',
      'create',
      '--title',
      'Release review',
      '--project',
      'Atlas',
      '--no-open',
    ]);
    cli(['project', 'set', 'Atlas', '--repo', 'example/project']);
    const rows = JSON.stringify([
      { number: 42, title: 'Ship [atlas-1]' },
      { number: 43, title: 'ATLAS-10 is separate' },
    ]);
    const facts = JSON.stringify({
      data: {
        repository: { pullRequest: { state: 'OPEN', mergeCommit: null, commits: { nodes: [] } } },
      },
    });
    writeFileSync(
      join(world.root, 'wrap', 'gh'),
      `#!/bin/sh
case "$1" in
 pr) printf '%s\n' '${rows}' ;;
 api) printf '%s\n' '${facts}' ;;
 *) exit 1 ;;
esac
`,
      { mode: 0o700 },
    );
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'title-match-owner');
    const page = await openPage(door, browser, created);
    await page.getByRole('button', { name: 'Waiting for CI, show status details' }).click();
    await expect(page.locator('.work-pull-details').filter({ hasText: 'PR #42' })).toContainText(
      'Matched by title: ATLAS-1',
    );
    await expect(page.getByText(/PR #43/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Ignore', exact: true }).click();
    await expect(page.locator('.work-pull-details').filter({ hasText: 'PR #42' })).toContainText(
      'Ignored',
    );
    // The bar's chip follows at once, with the details still open (#6652).
    await expect(
      page.getByRole('button', { name: 'Discussing, show status details' }),
    ).toContainText('Discussing');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Waiting for CI, show status details' }),
    ).toContainText('Waiting for CI');
    await expect(page.locator('.work-pull-details').filter({ hasText: 'PR #42' })).toContainText(
      'Matched by title: ATLAS-1',
    );
    await expect(page.getByRole('button', { name: 'Ignore', exact: true })).toBeVisible();
  });
});

test('a released HTML page with no to-dos is done', async () => {
  await withWorld(async (world) => {
    const merged = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            state: 'MERGED',
            mergeCommit: { oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
          },
        },
      },
    });
    writeFileSync(
      join(world.root, 'wrap', 'gh'),
      `#!/bin/sh
case "$4" in
  graphql) printf '%s\n' '${merged}' ;;
  *releases*) printf '%s\n' '["v1.0.0"]' ;;
  *compare*) printf '%s\n' '{"status":"behind"}' ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o700 },
    );
    const created = createPage(
      world,
      'Released HTML',
      '<p><a href="https://github.com/example/project/pull/42">Review</a></p>',
    );
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'released-html-owner');
    const page = await openPage(door, browser, created);
    await expect(page.getByRole('button', { name: 'Done, show status details' })).toBeVisible();
    await expect(field(await openDetails(page), 'Last activity')).toBeVisible();
    const shown = JSON.parse(run(world, world.binaries.colab, ['show', created.pageId, '--json']));
    expect(shown.page.computedStatus.state).toBe('done');
  });
});

test('new empty parent and sub-page show discussing with page activity', async () => {
  await withWorld(async (world) => {
    world.linkExtensions();
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const parent = colab([
      'page',
      'create',
      '--structured',
      '--title',
      'Empty parent',
      '--no-open',
    ]);
    colab(['subpage', 'create', parent.pageId, '--title', 'Empty child']);
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'empty-work-owner');
    const page = await openPage(door, browser, parent);
    await expect(
      page.getByRole('button', { name: 'Discussing, show status details' }),
    ).toBeVisible();
    const details = await openDetails(page);
    await expect(field(details, 'Last activity')).toBeVisible();
    await details.getByRole('button', { name: '1 sub-page' }).click();
    await page.getByRole('link', { name: 'Empty child' }).click();
    await expect(page.getByRole('heading', { name: /Empty child/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Discussing, show status details' }),
    ).toBeVisible();
  });
});

test('CLI work fields and to-do numbers appear on the owner page', async () => {
  await withWorld(async (world) => {
    world.linkExtensions();
    await world.startAgent('release-coordination-agent');
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const created = colab([
      'page',
      'create',
      '--title',
      'Release readiness and cross-team delivery plan',
      '--project',
      'Colab',
      '--no-open',
    ]);
    colab([
      'page',
      'set',
      created.pageId,
      '--owner',
      'release-coordination-agent',
      '--priority',
      'high',
      '--next',
      'Review the result',
    ]);
    colab(['block', 'insert', created.pageId, '--type', 'todo', '--text', 'Ship the fix']);
    colab(['block', 'insert', created.pageId, '--type', 'todo', '--text', 'Review the change']);
    colab(['block', 'insert', created.pageId, '--type', 'todo', '--text', 'Publish the release']);
    const parent = colab(['page', 'create', '--title', 'Release coordination', '--no-open']);
    colab(['subpage', 'attach', parent.pageId, created.pageId]);
    for (const title of ['Investigate', 'Implement', 'Verify'])
      colab(['subpage', 'create', created.pageId, '--title', title]);
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'work-fields-owner');
    const page = await openPage(door, browser, created);
    // The page's heading and its top bar both carry the number (#6611).
    await expect(page.getByRole('heading').locator('.colab-work-number')).toHaveText('COLAB-1');
    await expect(page.getByRole('banner').locator('.colab-work-number:visible')).toHaveText(
      'COLAB-1',
    );
    // The fields are read in the bar's status details (#6652); the projects are the bar's labels.
    await expect(
      page.getByRole('button', { name: 'Projects: Colab. Edit projects' }),
    ).toBeVisible();
    const fields = await openDetails(page);
    await expect(field(fields, 'Priority')).toHaveText('↑ High');
    await expect(field(fields, 'Owner')).toHaveText(/release-coordination-agent$/);
    await expect(field(fields, 'Next')).toHaveText('Review the result');
    await expect(fields.getByRole('button', { name: '3 sub-pages' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fields).toHaveCount(0);
    await expect(page.getByText('COLAB-2', { exact: true })).toBeVisible();
    await expect(page.locator('[data-block-id]').filter({ hasText: 'Ship the fix' })).toBeVisible();
    const prior = new Set<string>(
      colab(['block', 'ls', created.pageId]).blocks.map((block: { id: string }) => block.id),
    );
    let earlyCliLookup = false;
    await page.route('**/api/work-numbers', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { pageId: string; numbers: Record<string, string> };
      const requested = route.request().postDataJSON() as { blocks: string[] };
      if (!earlyCliLookup && requested.blocks.some((id) => !prior.has(id))) {
        earlyCliLookup = true;
        body.numbers = Object.fromEntries(
          Object.entries(body.numbers).filter(([id]) => prior.has(id)),
        );
      }
      await route.fulfill({ response, json: body });
    });
    colab(['block', 'insert', created.pageId, '--type', 'todo', '--text', 'Verify live numbering']);
    await expect(page.getByRole('checkbox', { name: 'Verify live numbering' })).toBeVisible();
    await expect(page.getByText('COLAB-5', { exact: true })).toBeVisible();
    expect(earlyCliLookup).toBe(true);
    await page.unroute('**/api/work-numbers');
    // Model the owner's first lookup arriving before its new to-do number is allocated.
    const known = new Set<string>(
      colab(['block', 'ls', created.pageId]).blocks.map((block: { id: string }) => block.id),
    );
    let earlyLookup = false;
    await page.route('**/api/work-numbers', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { pageId: string; numbers: Record<string, string> };
      const requested = route.request().postDataJSON() as { blocks: string[] };
      if (!earlyLookup && requested.blocks.some((id) => !known.has(id))) {
        earlyLookup = true;
        body.numbers = Object.fromEntries(
          Object.entries(body.numbers).filter(([id]) => known.has(id)),
        );
      }
      await route.fulfill({ response, json: body });
    });
    await page.locator('[data-block-id]').filter({ hasText: 'Publish the release' }).hover();
    await page.getByRole('button', { name: 'Insert block' }).click();
    await page
      .getByRole('listbox', { name: 'Insert a block' })
      .getByRole('option', { name: /To-do/ })
      .click();
    await expect(page.getByText('COLAB-6', { exact: true })).toBeVisible();
    expect(earlyLookup).toBe(true);
    const todo = page.getByRole('checkbox', { name: 'Ship the fix' });
    await todo.check();
    await expect(todo).toBeChecked();
    const persisted = (name: string) => {
      const listing = colab(['block', 'ls', created.pageId]);
      return listing.blocks.find((block: { text?: { s?: string } }) => block.text?.s === name)
        ?.props?.checked;
    };
    await expect.poll(() => persisted('Ship the fix')).toBe(true);
    await page.getByRole('checkbox', { name: 'Review the change' }).check();
    await expect.poll(() => persisted('Review the change')).toBe(true);
    await expect(page.getByText('COLAB-2', { exact: true })).toBeVisible();
    const captures = process.env.COLAB_WORK_FIELDS_CAPTURE_DIR;
    if (captures) {
      mkdirSync(captures, { recursive: true });
      for (const width of [1440, 1100, 800, 390])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 900 });
          await page.reload();
          await expect(page.getByRole('checkbox', { name: 'Ship the fix' })).toBeChecked();
          await expect(page.getByRole('checkbox', { name: 'Review the change' })).toBeChecked();
          if (width <= 900) await expect(page.locator('.page-mobile-title')).toBeVisible();
          await expect(
            (await openDetails(page)).getByRole('button', {
              name: 'Parent · Release coordination',
            }),
          ).toBeVisible();
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await page.screenshot({
            path: `${captures}/filled-high-${width}-${theme}.png`,
            animations: 'disabled',
          });
        }
    }
    colab(['page', 'set', created.pageId, '--clear-owner', '--priority', 'low']);
    await page.reload();
    const cleared = await openDetails(page);
    await expect(field(cleared, 'Priority')).toHaveText('Low');
    await expect(field(cleared, 'Owner')).toHaveCount(0);
    await page.keyboard.press('Escape');
    if (captures) {
      for (const width of [1440, 1100, 800, 390])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 900 });
          await page.reload();
          await expect(page.getByRole('checkbox', { name: 'Ship the fix' })).toBeChecked();
          await expect(page.getByRole('checkbox', { name: 'Review the change' })).toBeChecked();
          if (width <= 900) await expect(page.locator('.page-mobile-title')).toBeVisible();
          await expect(
            (await openDetails(page)).getByRole('button', {
              name: 'Parent · Release coordination',
            }),
          ).toBeVisible();
          await page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await page.screenshot({
            path: `${captures}/filled-low-${width}-${theme}.png`,
            animations: 'disabled',
          });
        }
    }
    colab([
      'page',
      'set',
      created.pageId,
      '--owner',
      'release-coordination-agent',
      '--priority',
      'high',
    ]);
    colab(['share', 'mode', created.pageId, 'link', '--yes']);
    const link = colab(['share', 'link', 'add', created.pageId, '--yes']);
    const reader = await openReaderLink(world, door, link.readerPath, 'work-fields-reader');
    // A reader's bar mark opens the owner's own fields (#6679).
    await reader.page.getByRole('banner').locator('.page-bar-status').click();
    const details = reader.page.locator('.page-status-details:visible');
    await expect(details.locator('.page-status-fields')).toContainText('↑ High');
    await expect(details.locator('.page-status-fields')).toContainText(
      'release-coordination-agent',
    );
    await expect(reader.page.locator('.colab-work-number:visible')).toHaveCount(0);
  });
});

test('manual state persists, an empty page offers Add to the owner only, and share readers have no owner controls', async () => {
  await withWorld(async (world) => {
    const created = createPage(world, 'Status panel', '<h1>Status panel source</h1>');
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    const before = colab(['show', created.pageId]);
    expect(before.page.state).toBe('todo');
    expect(before.page.progress).toEqual({ done: 0, inProgress: 0, todo: 0, unknown: 0, total: 0 });
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'status-owner');
    const page = await openPage(door, browser, created);
    // An empty page keeps its state in the bar and offers Add in the page menu (#6652).
    const status = page.locator('.tmt-ui-topbar:visible .page-bar-status');
    await expect(status).toBeVisible();
    const details = await openDetails(page);
    await expect(details.locator('.work-toggle')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await expect(status).toBeFocused();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Add a sub-page' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Manual page state…' }).click();
    const stateDrawer = page.getByRole('dialog', { name: 'Page state' });
    await stateDrawer.getByRole('button', { name: /^Page state:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Done', exact: true }).click();
    await expect.poll(() => colab(['show', created.pageId]).page.state).toBe('done');
    await stateDrawer.getByRole('button', { name: 'Close Page state' }).click();
    const after = colab(['show', created.pageId]);
    expect(after.page.state).toBe('done');
    expect(after.page.progress).toEqual(before.page.progress);
    await page.reload();
    await expect(status).toBeVisible();
    await expect((await openDetails(page)).locator('.work-toggle')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const captures = process.env.COLAB_STATUS_CAPTURE_DIR;
    if (captures) {
      mkdirSync(captures, { recursive: true });
      for (const width of [390, 1440])
        for (const theme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 900 });
          await panelTheme(page, status, theme);
          await page.screenshot({
            path: `${captures}/status-owner-empty-${width}-${theme}.png`,
          });
        }
    }
    colab(['share', 'mode', created.pageId, 'link', '--yes']);
    const link = colab(['share', 'link', 'add', created.pageId, '--yes']);
    const reader = await openReaderLink(world, door, link.readerPath, 'status-reader');
    // The reader names the manual state as the page state (#6679); it offers no control over it.
    const mark = reader.page.getByRole('banner').locator('.page-bar-status');
    await expect(mark).toHaveAccessibleName('Page state: Done, show details');
    await mark.click();
    const shared = reader.page.locator('.page-status-details:visible');
    await expect(shared.locator('.page-status-headline')).toHaveText(/^Page state\s*Done$/);
    await expect(shared.locator('.work-toggle')).toHaveCount(0);
    await expect(shared.getByRole('button', { name: /Page state/ })).toHaveCount(0);
    await expect(shared.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
    expect(
      reader.requests.filter((request) => /summary-details|api\/space/.test(request.url)),
    ).toEqual([]);
    if (captures)
      for (const width of [390, 1440])
        for (const theme of ['light', 'dark']) {
          await reader.page.setViewportSize({ width, height: 900 });
          await reader.page.evaluate((value) => {
            document.documentElement.dataset.theme = value;
          }, theme);
          await reader.page.screenshot({
            path: `${captures}/status-reader-null-${width}-${theme}.png`,
          });
        }
  });
});

test('opening a page with sub-pages reads details once and lists the child', async () => {
  await withWorld(async (world) => {
    const parent = createPage(world, 'Status parent', '<h1>Status parent source</h1>');
    const child = createPage(world, 'Status child', '<h1>Status child source</h1>');
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    colab(['subpage', 'attach', parent.pageId, child.pageId]);
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'progress-open');
    let reads = 0;
    browser.context.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith(`/api/pages/${parent.pageId}/summary-details`))
        reads++;
    });
    const page = await openPage(door, browser, parent);
    const band = bandIn(await openDetails(page));
    await expect(band.locator('.work-toggle')).toHaveAccessibleName('1 sub-page');
    await band.locator('.work-toggle').click();
    await expect(band.getByRole('link', { name: 'Status child', exact: true })).toBeVisible();
    expect(reads).toBe(1);
  });
});

test('sub-pages attach, get created and detach at any depth through the owner admission', async () => {
  await withWorld(async (world) => {
    const top = createPage(world, 'Attach top', '<h1>Top</h1>');
    const middle = createPage(world, 'Attach middle', '<h1>Middle</h1>');
    const grand = createPage(world, 'Grand page', '<h1>Grand</h1>');
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json']));
    colab(['subpage', 'attach', top.pageId, middle.pageId]);
    const door = await startDoor(world);
    const browser = await pairBrowser(world, 'attach-owner');
    // The middle page already has a parent and still takes a child of its own (#5820).
    const page = await openPage(door, browser, middle);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add a sub-page' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a sub-page to “Attach middle”' });
    await dialog.getByRole('combobox').fill('Attach');
    await expect(dialog.getByRole('option', { name: /Attach top/ })).toHaveCount(0);
    await expect(dialog.getByText('No page matches.')).toBeVisible();
    await dialog.getByRole('combobox').fill('Grand');
    await dialog.getByRole('option', { name: /Grand page/ }).click();
    await expect(dialog).toHaveCount(0);
    const listed = () => colab(['subpage', 'ls', middle.pageId]).children as string[];
    expect(listed()).toEqual([grand.pageId]);
    let band = bandIn(await openDetails(page));
    await band.locator('.work-toggle').click();
    await expect(band.getByRole('link', { name: 'Grand page', exact: true })).toBeVisible();
    // Create makes the page with the typed name and attaches it.
    await band.locator('.work-add-row').getByRole('button', { name: 'Add', exact: true }).click();
    await dialog.getByRole('combobox').fill('Made here');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    const [, made] = listed();
    expect(made).toBeDefined();
    expect(colab(['show', made]).page.title).toBe('Made here');
    // Add replaced the details; open them again for the list.
    band = bandIn(await openDetails(page));
    await band.locator('.work-toggle').click();
    // Detach removes the link only: the page stays.
    await band.getByRole('link', { name: 'Grand page', exact: true }).hover();
    await band.getByRole('button', { name: 'More for Grand page' }).click();
    await page.getByRole('menuitem', { name: 'Detach' }).click();
    await expect(band.getByRole('link', { name: 'Grand page', exact: true })).toHaveCount(0);
    expect(listed()).toEqual([made]);
    expect(colab(['show', grand.pageId]).page.title).toBe('Grand page');
  });
});

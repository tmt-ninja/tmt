import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { pairBrowser, startDoor } from './harness/browser.js';
import { freePort, run } from './harness/ask.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import { until } from './harness/process.js';

test.afterEach(disposeActiveWorlds);

// #6005: a structured page made and changed by the CLI draws in the browser from the fold, and the
// person's typing goes out as a block batch that merges with an agent's edit of the same block.
test('a structured page draws CLI blocks and keeps typing and an agent edit of the same block', async () => {
  test.setTimeout(180_000);
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

    const page = await browser.context.newPage();
    await page.goto(new URL(created.path, `${door.address}/`).href);
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    const block = page.locator(`[data-block-id="${paragraph}"]`);
    await expect(block).toHaveText('Ship the stack.');
    // At rest no block holds an editor.
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);

    await block.click();
    const editor = block.locator('[contenteditable="true"]');
    await editor.press('End');
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
    await page.goto(new URL(path, `${door.address}/`).href);
    const second = page.locator(`[data-block-id="${id.second}"]`);
    await expect(second).toHaveText('Second step.');

    // The person writes at the end of a block and starts a new one with Enter.
    await second.click();
    const editor = page.locator('[contenteditable="true"]');
    await editor.press('End');
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
    await editor.press('End');
    await editor.press('Enter');
    await editor.press('/');
    await editor.pressSequentially('q', { delay: 20 });
    await editor.press('Enter');
    const edit = page.getByRole('group', { name: 'Edit question' });
    await expect(edit).toContainText('Answers go to answer-agent');
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

import { expect, test, type Page } from '@playwright/test';

const fixture = '/test/page-workflow-browser.tsx';
const invoke = (page: Page, name: string, argument?: string) =>
  page.evaluate(async ({ path, name, argument }) => (await import(path))[name](argument), {
    path: fixture,
    name,
    argument,
  });
async function setup(page: Page, fault: 'none' | 'refused' | 'unknown') {
  await page.goto('/');
  await invoke(page, 'mountWorkflow', fault);
  await expect(page.locator('[data-workflow-ready]')).toBeAttached();
}

test('workflow attaches through the two owner writes', async ({ page }) => {
  await setup(page, 'none');
  expect(await invoke(page, 'move')).toBeUndefined();
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({
      parent: 'new-parent',
      calls: ['old-parent:subpage.detach', 'new-parent:subpage.attach'],
      busy: false,
    });
});

test('workflow exposes a confirmed detached result and retries it', async ({ page }) => {
  await setup(page, 'refused');
  await invoke(page, 'move');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({
      parent: undefined,
      failure: { target: 'new-parent', title: 'Target' },
      busy: false,
    });
  await invoke(page, 'retry');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({
      parent: 'new-parent',
      failure: undefined,
      calls: [
        'old-parent:subpage.detach',
        'new-parent:subpage.attach',
        'new-parent:subpage.attach',
      ],
    });
});

test('workflow does not claim an unknown attach as a confirmed failure', async ({ page }) => {
  await setup(page, 'unknown');
  expect(await invoke(page, 'move')).toContain('could not be confirmed');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({ parent: undefined, failure: undefined, busy: false });
});

test('workflow refuses retry when the target is no longer in the owner list', async ({ page }) => {
  await setup(page, 'refused');
  await invoke(page, 'move');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({ failure: { target: 'new-parent' }, busy: false });
  await invoke(page, 'removeTarget');
  await invoke(page, 'retry');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({
      parent: undefined,
      failure: undefined,
      uncertain: true,
      calls: ['old-parent:subpage.detach', 'new-parent:subpage.attach'],
    });
});

test('workflow ignores a second press before React rerenders', async ({ page }) => {
  await setup(page, 'none');
  expect(await invoke(page, 'doubleMove')).toContain('could not be confirmed');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({
      parent: 'new-parent',
      busy: false,
      calls: ['old-parent:subpage.detach', 'new-parent:subpage.attach'],
    });
});

test('a rejected lifecycle operation clears busy and permits another attempt', async ({ page }) => {
  await setup(page, 'none');
  await invoke(page, 'openArchive');
  await expect.poll(() => invoke(page, 'state')).toMatchObject({ operation: 'page.archive' });
  await invoke(page, 'archive');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({
      operationBusy: false,
      operation: undefined,
      operationNotice: { failed: true, text: expect.stringContaining('result is unknown') },
      lifecycleReads: 1,
    });
  await invoke(page, 'openArchive');
  await expect.poll(() => invoke(page, 'state')).toMatchObject({ operation: 'page.archive' });
  await invoke(page, 'archive');
  await expect
    .poll(() => invoke(page, 'state'))
    .toMatchObject({ operationBusy: false, lifecycleReads: 2 });
});

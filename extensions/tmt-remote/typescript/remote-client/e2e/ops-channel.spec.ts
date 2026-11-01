import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

const origin = 'https://ops-channels.test';
let directory = '',
  harness = '',
  html = '',
  css = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ops-channels-'));
  await build({
    root: new URL('..', import.meta.url).pathname,
    logLevel: 'silent',
    build: {
      outDir: directory,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: new URL('./ops-channel-harness.ts', import.meta.url).pathname,
        formats: ['es'],
        fileName: () => 'harness.js',
      },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  harness = await readFile(join(directory, 'harness.js'), 'utf8');
  const assets = new URL('../../../rust/tmt-remote/assets/', import.meta.url);
  html = (await readFile(new URL('ops.html', assets), 'utf8'))
    .replace(
      '<div class="tmt-ui-shell-content">',
      '<div class="tmt-ui-shell-content"><div class="tmt-ui-shell-bar"></div>',
    )
    .replace('/sdk/shell.js', '/harness.js');
  css =
    (await readFile(
      new URL('../../../../../design/browser-ui/generated/static.css', import.meta.url),
      'utf8',
    )) + (await readFile(new URL('pages.css', assets), 'utf8'));
});
test.afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function open(page: Page, width = 1440, theme = 'light') {
  await page.clock.install();
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript((theme) => localStorage.setItem('tmt-ui-theme', theme), theme);
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType:
        path === '/harness.js'
          ? 'text/javascript'
          : path === '/sdk/pages.css'
            ? 'text/css'
            : 'text/html',
      body: path === '/harness.js' ? harness : path === '/sdk/pages.css' ? css : html,
    });
  });
  await page.goto(`${origin}/ops/#channel/sample`);
  await expect(page.getByRole('tab', { name: 'Members', exact: true })).toBeVisible();
}
async function refresh(page: Page) {
  await page.clock.runFor(5001);
}
async function shot(page: Page, name: string) {
  const root =
    process.env.TMT_OPS_CHANNEL_CAPTURE_DIR ?? join('test-results', 'ops-channel-captures');
  await mkdir(root, { recursive: true });
  const history = page.getByRole('region', { name: 'Talk history' });
  if (await history.isVisible()) await expect(history).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, name + '.png'), fullPage: true });
}
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'])
    test(`local channel and UUID DM are read-only at ${width} ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await open(page, width, theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / #sample');
      await expect(page.locator('.ops-channel-context .tmt-ui-list-state')).toHaveText([
        'Working',
        'Idle',
        'Offline',
      ]);
      await expect(page.locator('.ops-channel-context [data-tone]')).toHaveCount(0);
      await expect(page.locator('.ops-channel-summary')).toHaveText('Members 3 · Timers 1');
      await expect(page.locator('details.ops-channel-context')).toHaveCount(0);
      await expect(page.locator('.tmt-ui-topbar-title-chips .tmt-ui-chip-label')).toHaveText([
        'Idle alert 15 min',
        'Timers 1',
        'Read only',
      ]);
      await expect(page.locator('.tmt-ui-topbar-title-current')).toBeVisible();
      if (width === 390) await expect(page.locator('.tmt-ui-topbar-title-chips')).toBeHidden();
      else await expect(page.locator('.tmt-ui-topbar-title-chips')).toBeVisible();
      const member = page.locator('.ops-channel-context .tmt-ui-list-title > a').first();
      await expect(member).toHaveCSS('text-decoration-line', 'none');
      await shot(page, `channel-${width}-${theme}`);
      await page.getByRole('tab', { name: 'Members', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Squad timers', exact: true })).toBeFocused();
      await expect(page.getByRole('tabpanel', { name: 'Squad timers', exact: true })).toContainText(
        'Sample hourly review',
      );
      await shot(page, `timers-${width}-${theme}`);
      if (width === 390)
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      const dm = page.locator('.tmt-ui-rail').getByRole('link', { name: 'sample-1', exact: true });
      await dm.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / sample-1');
      await expect(page.getByRole('tab', { name: 'About', exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', {
          name: 'Talk history',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Copy tmt ops ui', exact: true }),
      ).toBeVisible();
      for (const label of ['Send', 'New timer', 'Edit idle reminder'])
        await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
      await expect(page.locator('.ops-channel-compose')).toContainText(
        'not available in the browser yet',
      );
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.tmt-ui-rail a[href*="#dm/"] .tmt-ui-shell-count')).toHaveCount(0);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await shot(page, `dm-${width}-${theme}`);
      if (width === 390)
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      const rail = page.locator('.tmt-ui-rail');
      const hide = rail.getByRole('button', { name: 'Hide #sample', exact: true });
      await expect(hide).toHaveAttribute('aria-expanded', 'true');
      if (width === 390) await shot(page, `rail-${width}-${theme}`);
      await hide.click();
      await expect(rail.getByRole('link', { name: '#sample', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(rail.getByRole('link', { name: 'sample-1', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / sample-1');
      await page.evaluate(() => {
        window.channelBoard.agents[0]!.task = 'A refreshed sample';
      });
      await refresh(page);
      await expect(rail.getByRole('button', { name: 'Show #sample', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await rail.getByRole('link', { name: '#sample', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(rail.getByRole('link', { name: 'sample-1', exact: true })).toBeVisible();
      await expect(rail.getByRole('link', { name: 'sample-1', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(rail.locator('[aria-current="page"]')).toHaveCount(1);
      expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
      expect(requests.some((url) => /requests|dispatch|subscribe/.test(url))).toBe(false);
      expect(errors).toEqual([]);
    });

test('UUID selection survives rename, refuses a namesake after removal, and preserves the selected panel', async ({
  page,
}) => {
  await open(page);
  const memberLink = page
    .locator('.ops-channel-context')
    .getByRole('link', { name: 'sample-1', exact: true });
  await memberLink.focus();
  await page.evaluate(() => {
    window.channelBoard.agents[0]!.task = 'A changed observation';
  });
  await refresh(page);
  await expect(memberLink).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Squad timers', exact: true }).click();
  await page.getByRole('tab', { name: 'Squad timers', exact: true }).focus();
  await page.evaluate(() => {
    window.channelBoard.agents = window.channelBoard.agents.map((agent) =>
      agent.name === 'sample-1' ? { ...agent, name: 'renamed-member' } : agent,
    );
  });
  await refresh(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / renamed-member');
  await expect(page.getByRole('tab', { name: 'Squad timers', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Squad timers', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.evaluate(() => {
    window.channelBoard.truncated = true;
    window.channelBoard.agents = window.channelBoard.agents.filter(
      (agent) => agent.name !== 'renamed-member',
    );
  });
  await refresh(page);
  await expect(page.locator('[data-ops-channel-missing]')).toContainText('partial board');
  await expect(page.locator('[data-ops-channel-missing]')).not.toContainText('no longer');
  await page.evaluate(() => {
    window.channelBoard.truncated = false;
  });
  await page.evaluate(() => {
    window.channelBoard.agents = window.channelBoard.agents
      .filter((agent) => agent.name !== 'renamed-member')
      .map((agent) => (agent.name === 'sample-2' ? { ...agent, name: 'sample-1' } : agent));
  });
  await refresh(page);
  await expect(page.locator('[data-ops-channel-missing]')).toContainText('no longer listed');
  await expect(page.locator('.ops-channel-context')).toBeHidden();
  await expect(page.locator('.ops-channel-context')).not.toContainText('renamed-member');
  await expect(page.locator('.tmt-ui-rail a[href*="#dm/"][aria-current="page"]')).toHaveCount(0);
});

test('null and truncated timer reads stay unknown, and a stopped route fences late reads', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('heading', { level: 1 }).focus();
  await page.evaluate(() => {
    window.channelBoard.schedules = null;
  });
  await refresh(page);
  await expect(page.locator('.ops-channel-summary')).toContainText('Timers unavailable');
  await expect(page.locator('.tmt-ui-topbar-title-chips')).toContainText('Timers unavailable');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.getByRole('tab', { name: 'Squad timers', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Squad timers', exact: true })).toContainText(
    'Squad timers are unavailable',
  );
  await page.evaluate(() => {
    window.channelBoard.schedules = [];
    window.channelBoard.truncated = true;
  });
  await refresh(page);
  await expect(page.locator('.ops-channel-summary')).toContainText('Members (partial)');
  await expect(page.getByRole('tabpanel', { name: 'Squad timers', exact: true })).toContainText(
    'partial read',
  );
  await page.evaluate(() => {
    window.channelHold = true;
    window.channelBoard.squads = [];
    window.channelBoard.agents = [];
  });
  await refresh(page);
  const before = await page.locator('#ops-section').textContent();
  const reads = await page.evaluate(() => {
    window.channelStop();
    window.channelRelease();
    return window.channelReads;
  });
  await page.clock.runFor(60000);
  expect(await page.locator('#ops-section').textContent()).toBe(before);
  expect(await page.evaluate(() => window.channelReads)).toBe(reads);
});

async function openHistory(page: Page, width = 1440, theme = 'light') {
  await page.addInitScript(() => {
    window.dmEnabled = true;
  });
  await open(page, width, theme);
  await page
    .locator('.ops-channel-context')
    .getByRole('link', { name: 'sample-1', exact: true })
    .click();
  await expect(page.getByRole('list', { name: 'Conversation previews' })).toContainText(
    'release checklist',
  );
}
async function positions(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.includes('tmt.dm.seen.v1'))
      .map((key) => ({ key, position: localStorage.getItem(key) })),
  );
}
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'])
    test(`DM history keeps bounded previews and explicit paging at ${width} ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await openHistory(page, width, theme);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / sample-1');
      await expect(page.getByText('Unread changes: Unknown', { exact: true })).toBeVisible();
      await expect.poll(async () => (await positions(page))[0]?.position).toBe('position_1');
      await refresh(page);
      await expect(page.getByText('Unread changes: 0', { exact: true })).toBeVisible();
      await expect(page.getByRole('list', { name: 'Conversation previews' })).toContainText(
        'Answered by reply',
      );
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      for (const label of ['Send', 'New timer', 'Edit idle reminder'])
        await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
      await shot(page, `history-newest-${width}-${theme}`);
      await page.getByRole('button', { name: 'Older', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Conversation previews' })).toContainText(
        'An earlier review request.',
      );
      await expect(page.getByRole('list', { name: 'Conversation previews' })).toContainText(
        'Reply expired',
      );
      await expect(page.getByRole('button', { name: 'No older page', exact: true })).toBeDisabled();
      expect((await positions(page))[0]?.position).toBe('position_1');
      const before = await page.evaluate(() => window.dmCalls.at(-1)!.input.before);
      expect(before).toEqual({
        preparedAtMs: 1720000000000,
        requestId: 'req_cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });
      await shot(page, `history-older-${width}-${theme}`);
      await page.evaluate(() => {
        window.dmNewest.changePosition = 'fresh_position';
        window.dmChanges = 'unknown';
        const key = Object.keys(localStorage).find((key) => key.includes('tmt.dm.seen.v1'))!;
        localStorage.setItem(key, 'foreign_position');
      });
      await page.getByRole('button', { name: 'Newest page', exact: true }).click();
      await expect(page.getByText('Unread changes: Unknown', { exact: true })).toBeVisible();
      await expect.poll(async () => (await positions(page))[0]?.position).toBe('fresh_position');
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await shot(page, `history-unknown-${width}-${theme}`);
      expect(
        await page.evaluate(() =>
          window.dmCalls.every((call) =>
            Object.keys(call.input).every((key) => ['limit', 'before', 'since'].includes(key)),
          ),
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });

test('DM history leaves a late older final unread in the background, then opening marks the conversation', async ({
  page,
}) => {
  await openHistory(page);
  await refresh(page);
  await page.evaluate(() => {
    location.hash = '#channel/sample';
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / #sample');
  await page.evaluate(() => {
    window.dmNewest.changePosition = 'late_final';
    window.dmChanges = { count: 1, more: false };
  });
  await refresh(page);
  const dm = page.locator('.tmt-ui-rail a[href*="#dm/00000000-0000-4000-8000-000000000002/"]');
  await expect(dm).toHaveAttribute('data-emphasis', 'unread');
  await expect(dm).toContainText('1');
  expect((await positions(page))[0]?.position).toBe('position_1');
  await page.evaluate(() => {
    window.dmChanges = { count: 50, more: true };
    window.dmNewest.changePosition = 'more_changes';
  });
  await refresh(page);
  await expect(dm).toContainText('50+');
  expect((await positions(page))[0]?.position).toBe('position_1');
  await page
    .locator('.ops-channel-context')
    .getByRole('link', { name: 'sample-1', exact: true })
    .click();
  await expect.poll(async () => (await positions(page))[0]?.position).toBe('more_changes');
  await refresh(page);
  await expect(page.getByText('Unread changes: 0', { exact: true })).toBeVisible();
  await expect(dm).not.toHaveAttribute('data-emphasis');
});

test('DM history fences hidden-document and disposed-route replies without persisting previews', async ({
  page,
}) => {
  await openHistory(page);
  await refresh(page);
  await page.evaluate(() => {
    window.dmHold = true;
    window.dmNewest.changePosition = 'while_hidden';
  });
  const count = await page.evaluate(() => window.dmCalls.length);
  await refresh(page);
  await expect.poll(() => page.evaluate(() => window.dmCalls.length)).toBeGreaterThan(count);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dmRelease();
  });
  await expect(page.getByRole('region', { name: 'Talk history' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  expect((await positions(page))[0]?.position).toBe('position_1');
  const hidden = await page.evaluate(() => window.dmCalls.length);
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.dmCalls.length)).toBe(hidden);
  await page.evaluate(() => {
    window.dmHold = false;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await positions(page))[0]?.position).toBe('while_hidden');
  await page.evaluate(() => {
    window.dmHold = true;
    window.dmNewest.changePosition = 'after_dispose';
  });
  await refresh(page);
  const before = await page.getByRole('region', { name: 'Talk history' }).textContent();
  const reads = await page.evaluate(() => {
    window.channelStop();
    window.dmRelease();
    return window.dmCalls.length;
  });
  await page.clock.runFor(60000);
  expect(await page.evaluate(() => window.dmCalls.length)).toBe(reads);
  expect(await page.getByRole('region', { name: 'Talk history' }).textContent()).toBe(before);
  expect((await positions(page))[0]?.position).toBe('while_hidden');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(
    'release checklist',
  );
});

test('DM history isolates a changed viewer and renders untrusted previews as text', async ({
  page,
}) => {
  await openHistory(page);
  await refresh(page);
  await page.evaluate(() => {
    const viewer = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    window.dmNewest.viewerId = viewer;
    window.dmNewest.changePosition = 'new_viewer';
    window.dmChanges = 'unknown';
    window.dmNewest.items[0]!.sender.identityId = viewer;
    window.dmNewest.items[0]!.preview =
      '<img src=x onerror="window.unexpected=true">' + 'x'.repeat(100);
  });
  await refresh(page);
  await expect(page.getByText('Unread changes: Unknown', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Conversation previews' })).toContainText(
    '<img src=x',
  );
  await expect(
    page.getByRole('list', { name: 'Conversation previews' }).locator('img'),
  ).toHaveCount(0);
  const stored = await positions(page);
  expect(stored).toHaveLength(2);
  expect(
    stored.find((row) => row.key.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))?.position,
  ).toBe('position_1');
  expect(
    stored.find((row) => row.key.includes('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))?.position,
  ).toBe('new_viewer');
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 1440);
});

// Valid bounded names/previews must fit; no per-name clipping or CSS test override.
test('DM history long names and stable previews stay readable at 390', async ({ page }) => {
  await openHistory(page, 390);
  await refresh(page);
  const text = await page
    .getByRole('list', { name: 'Conversation previews' })
    .locator('.tmt-ui-list-description')
    .first()
    .textContent();
  await page.evaluate(() => {
    const node = document.querySelector(
      '[aria-label="Conversation previews"] .tmt-ui-list-description',
    )!;
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await refresh(page);
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(text);
  await page.evaluate(() => {
    window.channelBoard.agents = window.channelBoard.agents.map((agent) =>
      agent.id === '00000000-0000-4000-8000-000000000002'
        ? { ...agent, name: 'x'.repeat(64) }
        : agent,
    );
  });
  await refresh(page);
  await refresh(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('x'.repeat(64));
  const overflow = await page.locator('#ops-section').evaluate((root) =>
    [...root.querySelectorAll('*')].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width && rect.right > innerWidth + 1
        ? [{ tag: node.localName, className: node.className, right: rect.right }]
        : [];
    }),
  );
  expect(overflow).toEqual([]);
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 390);
});

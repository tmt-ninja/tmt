import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildOpsHarness, serveOpsHarness, type OpsHarness } from './ops-harness-page.js';

const origin = 'https://ops-channels.test';
let built: OpsHarness | undefined;
test.beforeAll(async () => {
  built = await buildOpsHarness();
});
test.afterAll(async () => {
  await built?.dispose();
});
async function open(page: Page, width = 1440, theme = 'light') {
  await serveOpsHarness(page, built!, origin, width, theme);
  await page.goto(`${origin}/ops/#channel/sample`);
  await expect(page.locator('.ops-channel-name')).toHaveText('#sample');
}
/** Phones open a channel with its details folded away. */
async function details(page: Page) {
  const show = page.getByRole('button', { name: 'Show details', exact: true });
  if (await show.isVisible()) await show.click();
}
const memberLink = (page: Page, name: string) =>
  page.locator('.ops-member-list').getByRole('link', { name, exact: true });
const conversation = (page: Page) => page.getByRole('list', { name: 'Conversation' });
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
      await page.evaluate(() => {
        window.channelBoard.squads = [
          ...window.channelBoard.squads,
          { name: 'core', room: null },
          { name: 'remote', room: null },
        ];
        window.channelBoard.agents = [
          ...window.channelBoard.agents,
          {
            id: '00000000-0000-4000-8000-000000000004',
            name: 'core-lead',
            squad: 'core',
            role: 'lead',
            tokens1d: null,
            checklistCount: null,
            state: 'unknown',
            waitingOnYou: 0,
          },
          {
            id: '00000000-0000-4000-8000-000000000005',
            name: 'remote-lead',
            squad: 'remote',
            role: 'lead',
            tokens1d: null,
            checklistCount: null,
            state: 'working',
            activity: { state: 'working' },
            waitingOnYou: 0,
          },
        ];
      });
      await refresh(page);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / #sample');
      // One Timers count: in the summary row, not again as a chip.
      await expect(page.locator('.ops-channel-chips')).toHaveText('Idle alert 15m');
      // The member count lives once, in the summary bar.
      await expect(page.locator('.ops-channel-line')).toHaveText('Lead sample-lead · This machine');
      await expect(page.locator('.ops-channel-compose')).toBeHidden();
      await expect(page.locator('.ops-channel-empty')).toContainText(
        'No channel room on this machine yet',
      );
      await expect(page.getByRole('link', { name: 'Talk to sample-lead' })).toHaveAttribute(
        'href',
        '/ops/#dm/00000000-0000-4000-8000-000000000001/sample',
      );
      await page.getByRole('link', { name: 'Talk to sample-lead' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / sample-lead');
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / #sample');
      await details(page);
      const usage = page.locator('.ops-member-row').first().locator('.ops-member-usage');
      await expect(usage).toBeEmpty();
      await page.evaluate(() => {
        window.channelBoard.agents[0]!.tokens1d = { tokens: 1200, complete: true };
      });
      await refresh(page);
      await expect(usage).toHaveText('~1.2K 1d');
      await expect(page.locator('.ops-member-row .ops-member-state')).toHaveText([
        'Working',
        'Idle',
        'Offline',
      ]);
      // Only working is coloured: idle is a dot in the text's colour, offline a ring.
      await expect(page.locator('.ops-member-row [data-tone]')).toHaveCount(1);
      await expect(page.locator('.ops-member-row [data-tone]')).toHaveAttribute(
        'data-tone',
        'working',
      );
      await expect(page.locator('.tmt-ui-topbar-title-chips')).toHaveCount(0);
      await expect(page.locator('.tmt-ui-topbar-title-current')).toBeVisible();
      const member = page.locator('.ops-member-name').first();
      await expect(member).toHaveCSS('text-decoration-line', 'none');
      await shot(page, `channel-${width}-${theme}`);
      if (width === 390) {
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await shot(page, `rail-channel-${width}-${theme}`);
        await page.keyboard.press('Escape');
      }
      await page.getByRole('tab', { name: 'Members 3', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Timers 1', exact: true })).toBeFocused();
      await expect(page.getByRole('tabpanel', { name: 'Timers 1', exact: true })).toContainText(
        'Sample hourly reviewEvery hour at :00',
      );
      await shot(page, `timers-${width}-${theme}`);
      if (width === 390)
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      const dm = page
        .locator('.tmt-ui-rail')
        .getByRole('link', { name: /^sample-1(?: unread)? ·/ });
      await dm.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / sample-1');
      await expect(page.locator('.ops-channel-name')).toHaveText('sample-1');
      // A route taken with the keyboard moves focus to the title and shows its ring.
      await expect(page.locator('.ops-channel-name')).toBeFocused();
      await expect(page.locator('.ops-channel-name')).not.toHaveAttribute('data-quiet-focus');
      await expect(page.getByRole('region', { name: 'Talk history' })).toBeVisible();
      await expect(page.locator('.ops-dm [contenteditable="true"]')).toBeVisible();
      await expect(page.locator('.ops-channel > .ops-channel-history > .ops-dm')).toHaveCount(1);
      await expect(page.locator('.tmt-ui-rail [aria-current="page"]')).toHaveCount(1);
      await expect(page.locator('.tmt-ui-rail a[href*="#dm/"] .tmt-ui-shell-count')).toHaveCount(0);
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await shot(page, `dm-${width}-${theme}`);
      if (width === 390)
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      const rail = page.locator('.tmt-ui-rail');
      await expect(rail.getByText('THIS MACHINE', { exact: true })).toBeVisible();
      const squad = rail.getByRole('link', { name: 'sample · Channel · ⏱ 1', exact: true });
      await expect(squad.locator('.tmt-ui-shell-count')).toHaveText(['⏱ 1']);
      // Working and idle are both dots told apart by colour: the state word is in each name.
      await expect(rail.getByRole('link', { name: /^sample-lead · Working/ })).toHaveCount(1);
      await expect(rail.getByRole('link', { name: /^sample-1 · Idle/ })).toHaveCount(1);
      const hide = rail.getByRole('button', { name: 'Hide sample', exact: true });
      await expect(hide).toHaveAttribute('aria-expanded', 'true');
      if (width === 390) await shot(page, `rail-${width}-${theme}`);
      await hide.click();
      await expect(squad).toHaveAttribute('aria-current', 'page');
      await expect(rail.getByRole('link', { name: /^sample-1(?: unread)? ·/ })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / sample-1');
      await page.evaluate(() => {
        window.channelBoard.agents[0]!.task = 'A refreshed sample';
      });
      await refresh(page);
      await expect(rail.getByRole('button', { name: 'Show sample', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await squad.focus();
      await page.keyboard.press('ArrowRight');
      await expect(rail.getByRole('link', { name: /^sample-1(?: unread)? ·/ })).toBeVisible();
      await expect(rail.getByRole('link', { name: /^sample-1(?: unread)? ·/ })).toHaveAttribute(
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
  await details(page);
  const link = memberLink(page, 'sample-1');
  await link.focus();
  await page.evaluate(() => {
    window.channelBoard.agents[0]!.task = 'A changed observation';
    window.channelBoard.agents.find((agent) => agent.name === 'sample-1')!.task = 'Capture pass';
    // The member owns one timer: its DM shows it as a chip that opens the Timers panel.
    window.channelBoard.schedules = [
      ...window.channelBoard.schedules!,
      {
        ...window.channelBoard.schedules![0]!,
        id: 'timer2',
        owner: 'sample-1',
        what: 'Member check',
      },
    ];
  });
  await refresh(page);
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ops-channel-name')).toHaveText('sample-1');
  await expect(page.locator('.ops-channel-line')).toContainText('Task: Capture pass');
  await expect(page.locator('.ops-channel-panel')).toBeHidden();
  await page.locator('.ops-channel-timer-chip').click();
  const timers = page.getByRole('tab', { name: /^Timers/ });
  await expect(timers).toHaveAttribute('aria-selected', 'true');
  await timers.click();
  await timers.focus();
  await page.evaluate(() => {
    window.channelBoard.agents = window.channelBoard.agents.map((agent) =>
      agent.name === 'sample-1' ? { ...agent, name: 'renamed-member' } : agent,
    );
    window.channelBoard.schedules = window.channelBoard.schedules!.map((job) =>
      job.owner === 'sample-1' ? { ...job, owner: 'renamed-member' } : job,
    );
  });
  await refresh(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ops / renamed-member');
  await expect(timers).toBeFocused();
  await expect(timers).toHaveAttribute('aria-selected', 'true');
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
  await expect(page.locator('.ops-channel-panel')).toBeHidden();
  await expect(page.locator('.ops-channel-panel')).not.toContainText('renamed-member');
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
  await expect(page.locator('.ops-channel-chips')).not.toContainText('Timers');
  await expect(page.locator('.ops-channel-summary')).toContainText('Timers unavailable');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await details(page);
  await page.getByRole('tab', { name: 'Timers', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Timers', exact: true })).toContainText(
    'Timers are unavailable',
  );
  await page.evaluate(() => {
    window.channelBoard.schedules = [];
    window.channelBoard.truncated = true;
  });
  await refresh(page);
  await expect(page.locator('.ops-channel-summary')).toContainText('Members (partial)');
  await expect(page.getByRole('tabpanel', { name: 'Timers 0', exact: true })).toContainText(
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
  await details(page);
  await memberLink(page, 'sample-1').click();
  await expect(conversation(page)).toContainText('release checklist');
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
      await expect.poll(async () => (await positions(page))[0]?.position).toBe('position_1');
      await refresh(page);
      await expect(conversation(page)).toContainText('The checks passed.');
      await expect(page.locator('html')).toHaveJSProperty('scrollWidth', width);
      await shot(page, `history-newest-${width}-${theme}`);
      await page.getByRole('button', { name: 'Show older messages', exact: true }).click();
      await expect(conversation(page)).toContainText('An earlier review request.');
      await expect(conversation(page)).toContainText('The reply has expired');
      await expect(page.getByRole('button', { name: 'Show older messages' })).toBeHidden();
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
      await refresh(page);
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
  await details(page);
  await memberLink(page, 'sample-1').click();
  await expect.poll(async () => (await positions(page))[0]?.position).toBe('more_changes');
  await refresh(page);
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
      '<img src=x onerror="window.unexpected=true"> see https://example.test/a?b=1). Run `tmt ls` ' +
      'not javascript:alert(1) ' +
      'x'.repeat(40);
  });
  await refresh(page);
  await expect(conversation(page)).toContainText('<img src=x');
  await expect(conversation(page).locator('img')).toHaveCount(0);
  // Only an http(s) address is a link, built as a node: a new tab, no opener, the address in full.
  const link = conversation(page).locator('.ops-dm-message-text a');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('https://example.test/a?b=1');
  await expect(link).toHaveAttribute('href', 'https://example.test/a?b=1');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('title', 'https://example.test/a?b=1');
  await expect(conversation(page).locator('.ops-dm-message-text code')).toHaveText('tmt ls');
  // A reply cut to its preview ends in an ellipsis until its full text is read from its result.
  const reply = conversation(page)
    .locator('.ops-dm-message')
    .nth(1)
    .locator('.ops-dm-message-text');
  await page.evaluate(() => {
    const item = window.dmNewest.items[0]!;
    if (item.final.status === 'retained') item.final.bodyBytes = 4000;
  });
  await refresh(page);
  await expect(reply).toHaveText(/…$/);
  await expect(reply).toHaveAttribute('title', 'Preview shortened · the full reply is 4,000 bytes');
  await page.evaluate(() => {
    const requestId = window.dmNewest.items[0]!.requestId;
    window.roomResults[requestId] = {
      state: 'replied',
      requestId,
      message: 'The checks passed. The whole reply, past its preview, ends here.',
    };
  });
  await page.evaluate(() => (location.hash = '#channel/sample'));
  await details(page);
  await memberLink(page, 'sample-1').click();
  await expect(reply).toHaveText(
    'The checks passed. The whole reply, past its preview, ends here.',
  );
  await expect(reply).not.toHaveAttribute('title');
  // A message Core holds says why, in Core's words, and when it goes at the latest.
  const latest = await page.evaluate(() => {
    const at = 1720000600000;
    const item = window.dmNewest.items[0]!;
    item.delivery = 'queued';
    item.final = { status: 'not_submitted' };
    item.responsePreview = null;
    item.messageState = {
      state: 'batched',
      reason: { code: 'batched', text: 'batched every 30 min' },
      latestMs: at,
      remainingMs: null,
      canSendNow: true,
    };
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  });
  await refresh(page);
  await expect(conversation(page).locator('.ops-dm-message-state').first()).toContainText(
    `Batched every 30 min · delivers by ${latest}`,
  );
  // Send now asks once, and is not offered again until the result has been read.
  const sendNow = conversation(page).getByRole('button', { name: 'Send now' });
  await sendNow.click();
  await expect(sendNow).toBeHidden();
  expect(await page.evaluate(() => window.sendNowCalls)).toEqual([
    await page.evaluate(() => window.dmNewest.items[0]!.requestId),
  ]);
  await page.evaluate(() => {
    window.dmNewest.items[0]!.messageState = {
      state: 'delivered',
      reason: { code: 'delivered', text: 'delivered' },
      latestMs: null,
      remainingMs: null,
      canSendNow: false,
    };
  });
  await refresh(page);
  await expect(conversation(page).locator('.ops-dm-message-state').first()).toHaveText('Delivered');
  await expect(sendNow).toBeHidden();
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
  const text = await conversation(page).locator('.ops-dm-message-text').first().textContent();
  await page.evaluate(() => {
    const node = document.querySelector('[aria-label="Conversation"] .ops-dm-message-text')!;
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

test('DM send freezes its operation, only observes an unknown outcome and links the Talk setting', async ({
  page,
}) => {
  await openHistory(page);
  const box = page.locator('.ops-dm [contenteditable="true"]');
  const note = page.locator('#ops-dm-send-note');
  await box.click();
  await page.keyboard.type('Take the 390 capture next.');
  await page.evaluate(() => {
    window.dmSendState = { state: 'refused', operationId: '', reason: 'ROOM_ROSTER_CHANGED' };
  });
  await page.keyboard.press('Enter');
  await expect(note).toContainText(
    'Not sent: the squad changed. Check the recipients and send again.',
  );
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.dmSends.length)).toBe(2);
  const sends = await page.evaluate(() => window.dmSends);
  // Remote replays a refused id without asking Core, so the retry is a new operation.
  expect(sends[1]).toEqual({ ...sends[0], operationId: sends[1]!.operationId });
  expect(sends[1]!.operationId).not.toBe(sends[0]!.operationId);
  expect(sends[0]).toMatchObject({
    agentId: '00000000-0000-4000-8000-000000000002',
    message: 'Take the 390 capture next.',
  });
  // Cancelled on the machine is settled too: its retry is another new operation.
  await page.evaluate(() => {
    window.dmSendState = { state: 'cancelled', operationId: '' };
  });
  await page.keyboard.press('Enter');
  await expect(note).toContainText('Not sent: it was cancelled on the machine.');
  await expect.poll(() => page.evaluate(() => window.dmSends.length)).toBe(3);
  const afterCancel = await page.evaluate(() => window.dmSends.map((send) => send.operationId));
  expect(new Set(afterCancel).size).toBe(3);
  await page.evaluate(() => {
    window.dmSendState = { state: 'uncertain', operationId: '' };
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('.ops-dm-exchange[data-pending="uncertain"]')).toContainText(
    'nothing is sent again',
  );
  await expect(note).toContainText('never sent twice');
  await refresh(page);
  await refresh(page);
  expect(await page.evaluate(() => window.dmSends.length)).toBe(4);
  expect(await page.evaluate(() => window.dmObserved)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    window.dmSendState = {
      state: 'refused',
      operationId: '',
      reason: 'Talk is off for this browser.',
      scope: 'talk',
      settingsUrl: '/remote/settings#talk',
    };
  });
  await refresh(page);
  await expect(note.getByRole('link', { name: 'Turn on Talk in Remote settings' })).toHaveAttribute(
    'href',
    '/remote/settings#talk',
  );
  await expect(page.locator('.ops-dm').getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(await page.evaluate(() => window.dmSends.length)).toBe(4);
});

test('channel posts to the lead or each mention with the board room, and shows replies under the post', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.channelBoard.squads[0]!.room = {
      roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
      revision: 7,
    };
    const at = 1720000000000;
    window.roomPage.items = [
      {
        requestId: 'req_00000011-cccc-4ccc-8ccc-cccccccccccc',
        recipientId: '00000000-0000-4000-8000-000000000001',
        roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
        sender: { kind: 'verified', identityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        kind: 'request',
        origin: 'person',
        preparedAtMs: at,
        delivery: 'sent',
        final: {
          status: 'retained',
          submittedAtMs: at + 60000,
          expiresAtMs: at + 1e9,
          bodyBytes: 9,
        },
        // Remote's device line (colab-v1) moves to the header; the bubble keeps the words.
        preview: '[remote: Work laptop]\nAsk @sample-2 <b>about</b> the plan',
      },
      {
        requestId: 'req_00000012-cccc-4ccc-8ccc-cccccccccccc',
        recipientId: '00000000-0000-4000-8000-000000000001',
        roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
        sender: { kind: 'verified', identityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        kind: 'request',
        origin: 'person',
        preparedAtMs: at + 120000,
        delivery: 'sent',
        final: { status: 'not_submitted' },
        preview: '[remote: This laptop]\nAnd the 390 pass.',
      },
      {
        requestId: 'req_00000013-cccc-4ccc-8ccc-cccccccccccc',
        recipientId: '00000000-0000-4000-8000-000000000001',
        roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
        sender: { kind: 'verified', identityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        kind: 'announcement',
        origin: 'automation',
        preparedAtMs: at + 180000,
        delivery: 'sent',
        final: { status: 'not_required' },
        preview: '▚ ⏱ sample c1 · every 30m · added',
      },
    ];
    window.roomResults = {
      'req_00000011-cccc-4ccc-8ccc-cccccccccccc': {
        state: 'replied',
        requestId: 'req_00000011-cccc-4ccc-8ccc-cccccccccccc',
        message: 'On it.',
      },
    };
  });
  await refresh(page);
  const stream = page.getByRole('list', { name: 'Channel messages' });
  // Another device is named; this browser's own device only in the tooltip.
  const first = stream.locator('.ops-dm-message').first();
  await expect(first.locator('.ops-dm-message-device')).toBeVisible();
  await expect(first.locator('.ops-dm-message-device')).toHaveText('· from Work laptop');
  await expect(first.locator('.ops-dm-message-who')).toHaveAttribute(
    'title',
    'Sent from Work laptop',
  );
  // This browser's own device: no device words, the tooltip keeps it.
  const own = stream.locator('.ops-dm-message').nth(1);
  await expect(own.locator('.ops-dm-message-device')).toBeHidden();
  await expect(own.locator('.ops-dm-message-who')).toHaveAttribute(
    'title',
    'Sent from This laptop',
  );
  // An announcement is one quiet line, not a message with a reply.
  // One icon: TMT's terminal mark (▚) does not lead the web line.
  await expect(stream.locator('.ops-dm-notice-text')).toHaveText('⏱ sample c1 · every 30m · added');
  await expect(stream.locator('.ops-dm-message')).toHaveCount(2);
  await expect(stream).not.toContainText('No reply needed');
  await expect(stream.locator('.ops-dm-message-text').first()).toHaveText(
    'Ask @sample-2 <b>about</b> the plan',
  );
  await expect(stream.locator('.ops-dm-mention')).toHaveText('@sample-2');
  await expect(stream.locator('b')).toHaveCount(0);
  const summary = stream.getByRole('button', { name: /1 reply/ });
  // The thread line names who replied and how many; Answered only before any reply text.
  await expect(summary.locator('.ops-thread-faces > *')).toHaveText(['SL']);
  await expect(summary).not.toContainText('Answered');
  await expect(stream).not.toContainText('On it.');
  await summary.click();
  const thread = page.getByRole('complementary', { name: 'Thread' });
  await expect(thread).toContainText('sample-lead→ You');
  await expect(thread).toContainText('On it.');
  await expect(thread.getByRole('heading')).toHaveText('Ask @sample-2 <b>about</b> the plan');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  // Leaving the channel closes its thread; coming back shows the channel.
  await page.evaluate(() => (location.hash = '#dm/00000000-0000-4000-8000-000000000002/sample'));
  await expect(page.locator('.ops-channel-name')).toHaveText('sample-1');
  await page.evaluate(() => (location.hash = '#channel/sample'));
  await expect(page.locator('.ops-channel-name')).toHaveText('#sample');
  await expect(thread).toBeHidden();
  await summary.click();
  await expect(thread).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(thread).toBeHidden();
  await expect(summary).toBeFocused();
  const box = page.locator('.ops-channel-compose [contenteditable="true"]');
  await box.click();
  await page.keyboard.type('Plan the week.');
  await page.keyboard.press('Enter');
  await box.click();
  await page.keyboard.type('@sample-1 and @sample-2, take the captures.');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.roomSends.length)).toBe(2);
  const [lead, mentioned] = await page.evaluate(() => window.roomSends);
  expect(lead).toMatchObject({
    message: 'Plan the week.',
    room: { roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001', revision: 7 },
    recipientIds: ['00000000-0000-4000-8000-000000000001'],
  });
  expect(mentioned!.recipientIds).toEqual([
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
  ]);
  expect(mentioned!.operationId).not.toBe(lead!.operationId);
  await expect(box).toHaveText('');
  // A post Core holds for two members: Send now asks for each one's request once, and a refusal
  // shows Core's sentence.
  await page.evaluate(() => {
    const at = 1720000300000;
    const held = (requestId: string, recipientId: string) => ({
      requestId,
      recipientId,
      roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
      sender: { kind: 'verified', identityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      kind: 'request',
      origin: 'person',
      preparedAtMs: at,
      delivery: 'queued',
      messageState: {
        state: 'batched',
        reason: { code: 'batched', text: 'batched every 30 min' },
        latestMs: null,
        remainingMs: null,
        canSendNow: true,
      },
      final: { status: 'not_submitted' },
      preview: '@sample-1 @sample-2 the held post',
    });
    (window.roomPage.items as unknown[]).push(
      held('req_00000014-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-4000-8000-000000000002'),
      held('req_00000015-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-4000-8000-000000000003'),
    );
    window.sendNowAnswer = {
      state: 'refused',
      reason: 'SEND_NOW_NOT_ALLOWED',
      reasonText: 'this message is no longer held',
    };
  });
  await refresh(page);
  const heldPost = stream.locator('.ops-dm-exchange', { hasText: 'the held post' });
  await heldPost.getByRole('button', { name: 'Send now' }).click();
  await expect(heldPost.locator('.ops-dm-send-now-note')).toHaveText(
    'This message is no longer held',
  );
  await expect(heldPost.getByRole('button', { name: 'Send now' })).toBeHidden();
  expect(await page.evaluate(() => window.sendNowCalls)).toEqual([
    'req_00000014-cccc-4ccc-8ccc-cccccccccccc',
    'req_00000015-cccc-4ccc-8ccc-cccccccccccc',
  ]);
});

test('a busy channel lands at the latest, groups a run, offers the latest when scrolled up, and keeps it above the keyboard', async ({
  page,
}) => {
  await open(page, 390);
  await page.setViewportSize({ width: 390, height: 844 });
  const post = (n: number, at: number, recipient: string) => ({
    requestId: `req_${String(n).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`,
    recipientId: recipient,
    roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
    sender: { kind: 'verified', identityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    kind: 'request',
    origin: 'person',
    preparedAtMs: at,
    delivery: 'sent',
    final: { status: 'not_submitted' },
    preview: `Post ${n}`,
  });
  await page.evaluate(
    ({ items }) => {
      window.channelBoard.squads[0]!.room = {
        roomId: 'dddddddd-dddd-4ddd-8ddd-000000000001',
        revision: 7,
      };
      window.roomPage.items = items as never;
    },
    {
      // Hourly posts, then a run of three to the lead within five minutes.
      items: [
        ...Array.from({ length: 30 }, (_, n) =>
          post(100 + n, 1720000000000 + n * 3_600_000, '00000000-0000-4000-8000-000000000002'),
        ),
        ...[0, 1, 2].map((n) =>
          post(200 + n, 1720200000000 + n * 60_000, '00000000-0000-4000-8000-000000000001'),
        ),
      ].map((item) =>
        // The last two of the run reach Core's 160-character preview.
        /Post 20[12]/.test(item.preview)
          ? { ...item, preview: `${item.preview} `.padEnd(160, 'x') }
          : item,
      ),
    },
  );
  // Post 202's result carries its whole text; Core no longer keeps Post 201's words.
  await page.evaluate(() => {
    const id = (n: number) => `req_${String(n).padStart(8, '0')}-cccc-4ccc-8ccc-cccccccccccc`;
    window.roomResults[id(201)] = { state: 'pending', requestId: id(201), requestMessage: null };
    window.roomResults[id(202)] = {
      state: 'pending',
      requestId: id(202),
      requestMessage: `Post 202 ${'x'.repeat(151)} and the rest of the post, past its preview.`,
    };
  });
  await refresh(page);
  const stream = page.getByRole('list', { name: 'Channel messages' });
  const gap = () =>
    stream.evaluate((list) => list.scrollHeight - list.scrollTop - list.clientHeight);
  await expect(stream.locator('.ops-dm-message')).toHaveCount(33);
  await expect.poll(gap).toBeLessThan(2);
  // The run reads as one turn: one face and header, the rest continue it.
  const run = stream.locator('.ops-dm-message').filter({ hasText: /Post 20[012]/ });
  await expect(run.nth(0)).not.toHaveAttribute('data-continued');
  await expect(run.nth(1)).toHaveAttribute('data-continued', '');
  await expect(run.nth(2)).toHaveAttribute('data-continued', '');
  await expect(stream.locator('.ops-dm-message').nth(1)).not.toHaveAttribute('data-continued');
  // Only the current day's line is held at the top: the earlier day's line leaves with its block.
  await stream.evaluate((list) => (list.scrollTop = list.scrollHeight / 2));
  const held = await stream.evaluate((list) => {
    const top = list.getBoundingClientRect().top;
    return [...list.querySelectorAll('.ops-dm-day')].filter((line) => {
      const rect = line.getBoundingClientRect();
      return rect.bottom > top && rect.top < top + rect.height;
    }).length;
  });
  expect(held).toBe(1);
  // A post cut at Core's preview shows its whole text from its result; one whose words Core no
  // longer keeps ends in an ellipsis and says so.
  const whole = stream.locator('.ops-dm-message-text').filter({ hasText: 'Post 202' });
  await expect(whole).toHaveText(/and the rest of the post, past its preview\.$/);
  await expect(whole).not.toHaveAttribute('title');
  const capped = stream.locator('.ops-dm-message-text').filter({ hasText: 'Post 201' });
  await expect(capped).toHaveText(/…$/);
  await expect(capped).toHaveAttribute(
    'title',
    'Preview shortened · the full message is longer than 160 characters',
  );
  // Scrolled up, a new post keeps the reader's place and says it arrived.
  await stream.evaluate((list) => (list.scrollTop = 0));
  const latest = page.getByRole('button', { name: /new message|Jump to latest/ });
  await expect(latest).toHaveText('Jump to latest ↓');
  await page.evaluate(({ next }) => (window.roomPage.items as unknown[]).push(next), {
    next: post(300, 1720300000000, '00000000-0000-4000-8000-000000000001'),
  });
  await refresh(page);
  await expect(latest).toHaveText('1 new message ↓');
  expect(await stream.evaluate((list) => list.scrollTop)).toBe(0);
  await latest.click();
  await expect.poll(gap).toBeLessThan(2);
  await expect(latest).toBeHidden();
  // Typing on a phone: the header folds to its title and the stream stays at the latest.
  await page
    .locator('.ops-composer-host [contenteditable], .ops-composer-host [role="combobox"]')
    .first()
    .click();
  await expect(page.locator('.ops-channel-line')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 508 });
  await expect.poll(gap).toBeLessThan(2);
  await expect(page.locator('.ops-composer-host')).toBeInViewport();
});

test('a phone DM leads back to its channel, the rail marks drafts quietly, and a chosen route focuses its title', async ({
  page,
}) => {
  await openHistory(page, 390);
  const rail = page.locator('.tmt-ui-rail');
  // The DM leads back to its channel; with no timers it shows no Timers bar.
  const back = page.getByRole('link', { name: 'Back to #sample', exact: true });
  await expect(back).toBeVisible();
  await expect(page.locator('.ops-channel-panel')).toBeHidden();
  await expect(page.locator('.ops-channel-squad-link')).toHaveText('#sample');
  // Unsent words mark the DM in the rail as a draft, never as unread.
  await page.locator('.ops-dm [contenteditable="true"]').click();
  await page.keyboard.type('Half a thought');
  await back.click();
  await expect(page.locator('.ops-channel-name')).toHaveText('#sample');
  await expect(page.locator('.ops-channel-name')).toBeFocused();
  // A route taken with the pointer moves focus quietly, with no ring.
  await expect(page.locator('.ops-channel-name')).toHaveAttribute('data-quiet-focus', '');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const dm = rail.getByRole('link', { name: /^sample-1/ });
  await expect(dm).toContainText('✎ Draft');
  await expect(dm).not.toHaveAttribute('data-emphasis');
  await dm.click();
  await expect(page.locator('.ops-channel-name')).toHaveText('sample-1');
  await expect(page.locator('.ops-channel-name')).toBeFocused();
  await expect(page.locator('.ops-dm [contenteditable="true"]')).toHaveText('Half a thought');
  // Clearing the words clears the mark.
  await page.locator('.ops-dm [contenteditable="true"]').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(rail.getByRole('link', { name: /^sample-1/ })).not.toContainText('Draft');
});

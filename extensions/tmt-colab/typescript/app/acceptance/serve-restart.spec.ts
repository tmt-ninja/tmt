import { localTime } from '../src/expiry.js';
import { pageAction } from '../test/page-actions.js';
import { text } from '../src/strings.js';
import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { READMIT_DELAYS_MS } from '../src/readmit.js';
import { pairBrowser, restartColab, startDoor, startRemoteOnly } from './harness/browser.js';
import {
  patchArgs,
  revokeMachine,
  composeChat,
  createPage,
  freePort,
  openChat,
  openPage,
  run,
  sendChat,
} from './harness/ask.js';
import { distinct, openSource, save } from './harness/page-source.js';
import { until } from './harness/process.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';
import type { AcceptanceWorld } from './harness/world.js';

test.afterEach(disposeActiveWorlds);

test('confirmed history recovery keeps a dirty source draft on the old connection', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const device = await pairBrowser(world, 'history-recovery-owner');
    const colab = world.binaries.colab;
    const created = createPage(world, 'History recovery', distinct(48_000, 'old source'));
    const original = '<p>Keep the current page.</p>';
    run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json']), original);
    const file = path.join(world.workspace, 'recovery-note.txt');
    const note = 'This attachment outlives the history cut.';
    fs.writeFileSync(file, note);
    const attached = JSON.parse(
      run(world, colab, ['attachment', 'attach', created.pageId, file, '--json']),
    ).attachment;
    const page = await openPage(door, device, created);
    const draft = '<p>Keep the current page. Unsent edit.</p>';
    const editor = await openSource(page);
    await expect(editor).toHaveValue(original);
    await editor.fill(draft);

    await restartColab(world, door, async () => {
      await expect(page.locator('.status')).toContainText('Reconnecting…', { timeout: 60_000 });
      const report = JSON.parse(
        run(world, colab, [
          'page',
          'reclaim',
          created.pageId,
          '--discard-content-history',
          '--yes',
          '--json',
        ]),
      );
      expect(report.freedGzipBytes).toBeGreaterThan(0);
    });
    await expect(page.locator('.status.live .status-label')).toHaveText('Live', {
      timeout: 60_000,
    });
    await expect(editor).toHaveValue(draft);
    await expect(page.frameLocator('iframe').getByText('Keep the current page.')).toBeVisible();
    await save(page);
    const read = () =>
      JSON.parse(run(world, colab, ['page', 'read', created.pageId, '--json'])).source;
    await expect.poll(read).toBe(draft);
    await page.reload();
    await expect(
      page.frameLocator('iframe').getByText('Keep the current page. Unsent edit.'),
    ).toBeVisible();
    const attachmentText = () => {
      let restored: { path: string };
      try {
        restored = JSON.parse(
          run(world, colab, [
            'attachment',
            'read',
            created.pageId,
            attached.attachmentId,
            '--output',
            world.workspace,
            '--json',
          ]),
        );
      } catch (error) {
        // The document can be live before Remote has reactivated the attachment channel.
        if (
          error instanceof Error &&
          error.message.includes(
            '"code":"COLAB_UNAVAILABLE","message":"Colab attachments are unavailable until a Colab page is opened in the browser or Remote restarts."',
          )
        )
          return undefined;
        throw error;
      }
      return fs.readFileSync(restored.path, 'utf8');
    };
    await expect.poll(attachmentText, { timeout: 30_000 }).toBe(note);
  });
});

async function verifyRecoveryAudit(page: Page, recoveredAt: number) {
  const audit = text.historyReclaimedAt(localTime(recoveredAt));
  const notice = page.locator('.page-history-recovery-notice');
  await expect(notice.getByText(audit, { exact: true })).toBeVisible();
  await notice.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.page-mobile-title h1')).toBeVisible();
  await expect(notice).toHaveCount(0);
  await (await pageAction(page, text.aboutPage)).click();
  await expect(page.getByText(audit, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Close ${text.aboutPage}`, exact: true }).click();
}

test('capacity recovery shows the owner its dated audit and the page remains editable', async () => {
  test.setTimeout(300_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const colab = world.binaries.colab;
    const created = createPage(world, 'Capacity recovery audit', '<p>First source.</p>');
    let source = '';
    let recoveredAt: number | undefined;
    // Pair only after recovery: a page already admitted to another device is ineligible.
    for (let revision = 0; revision < 20 && recoveredAt === undefined; revision++) {
      const payload = createHash('shake256', { outputLength: 337_500 })
        .update(String(revision))
        .digest('base64');
      source = `<p>Capacity fixture revision ${revision}</p><pre>${payload}</pre>`;
      const receipt = JSON.parse(
        run(world, colab, patchArgs(world, created.pageId, ['--file', '-', '--json']), source),
      );
      recoveredAt = receipt.historyReclaimedAtMs;
    }
    expect(recoveredAt).toBeGreaterThan(0);
    const device = await pairBrowser(world, 'capacity-audit-owner');
    const page = await openPage(door, device, created);
    await verifyRecoveryAudit(page, recoveredAt!);
    const editor = await openSource(page);
    await expect(editor).toHaveValue(source);
    const next = `${source}<p>The next browser save works.</p>`;
    await editor.fill(next);
    await save(page);
    const read = () =>
      JSON.parse(run(world, colab, ['page', 'read', created.pageId, '--json'])).source;
    await expect.poll(read).toBe(next);
  });
});

test('block capacity recovery preserves the document and the next browser edit', async () => {
  test.setTimeout(300_000);
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const cli = (args: string[], input?: string) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json'], input));
    const created = cli(['page', 'create', '--title', 'Block recovery audit', '--no-open']);
    const pageId: string = created.pageId;
    const marked = randomUUID();
    const editable = randomUUID();
    const table = randomUUID();
    const row = randomUUID();
    const ids: string[] = Array.from({ length: 8 }, () => randomUUID());
    const churn = (revision: number) =>
      ids.map((_, index) =>
        createHash('shake256', { outputLength: 19_500 })
          .update(`block:${revision}:${index}`)
          .digest('base64'),
      );
    const batch = (ops: unknown[]) =>
      cli(['block', 'batch', pageId, '--file', '-'], JSON.stringify(ops));
    const blocks = () => cli(['block', 'ls', pageId, '--all']).blocks;
    let current = churn(0);
    batch([
      { op: 'insert', id: editable, type: 'paragraph', text: 'Before browser edit' },
      { op: 'insert', id: marked, type: 'paragraph', text: 'Keep the bold mark' },
      { op: 'text', id: marked, format: { from: 0, to: 4, mark: 'bold', value: true } },
      {
        op: 'insert',
        id: table,
        type: 'table',
        props: { columns: [{ id: 'state', name: 'State' }] },
      },
      { op: 'table', id: table, action: 'add-row', row, cells: { state: 'Keep this cell' } },
      ...ids.map((id, index) => ({ op: 'insert', id, type: 'paragraph', text: current[index] })),
    ]);
    let recoveredAt: number | undefined;
    for (let revision = 1; revision <= 38 && recoveredAt === undefined; revision++) {
      const next = churn(revision);
      const before = blocks();
      const receipt = batch(
        ids.map((id, index) => ({ op: 'text', id, base: current[index], set: next[index] })),
      );
      expect(receipt.droppedHunks).toEqual([]);
      current = next;
      if (receipt.historyReclaimedAtMs !== undefined) {
        recoveredAt = receipt.historyReclaimedAtMs;
        const expected = before.map((block: { id: string; text?: { s: string } }) => {
          const index = ids.indexOf(block.id);
          return index < 0 ? block : { ...block, text: { ...block.text, s: next[index] } };
        });
        expect(blocks()).toEqual(expected);
      }
    }
    expect(recoveredAt).toBeGreaterThan(0);
    const device = await pairBrowser(world, 'block-capacity-audit-owner');
    const page = await openPage(door, device, created);
    await verifyRecoveryAudit(page, recoveredAt!);
    await expect(page.locator(`[data-block-id="${marked}"]`)).toHaveText('Keep the bold mark');
    await expect(page.getByText('Keep this cell', { exact: true })).toBeVisible();
    const block = page.locator(`[data-block-id="${editable}"]`);
    await block.click();
    const editor = block.locator('[contenteditable="true"]');
    await editor.fill('After browser edit');
    await editor.press('Tab');
    await expect
      .poll(() => cli(['block', 'get', pageId, editable]).block.base)
      .toBe('After browser edit');
  });
});

// #2929: the serve restarts onto a newer installed release (upgrade-safe serve, #2865) while a
// paired owner has a page open. Remote keeps running, so while the replacement is down its mount
// answers with a bare status; that is the extension restarting, not a verdict on the device.
// The replacement is held down until the page has waited longer than the finite readmission,
// which is what ended the page before.
const BEYOND_READMISSION_MS = READMIT_DELAYS_MS.reduce((total, delay) => total + delay, 0) + 10_000;

interface Upgrade {
  address: string;
  /** Install the newer release; its start is held until `release()`. */
  install(): void;
  release(): void;
  /** The replacement answers `mounted`. */
  replaced(): Promise<void>;
}

async function attachedUpgrade(world: AcceptanceWorld): Promise<Upgrade> {
  world.linkExtensions();
  await startRemoteOnly(world);
  const lib = path.join(world.root, 'lib/tmt-colab');
  const old = path.join(lib, 'releases/old');
  const next = path.join(lib, 'releases/next');
  fs.mkdirSync(old, { recursive: true });
  fs.mkdirSync(next);
  fs.copyFileSync(world.binaries.colab, path.join(old, 'tmt-colab'));
  fs.chmodSync(path.join(old, 'tmt-colab'), 0o755);
  fs.writeFileSync(path.join(old, 'receipt.json'), JSON.stringify({ version: 'running-fixture' }));
  fs.symlinkSync('releases/old', path.join(lib, 'current'));
  const colab = world.spawn('installed-colab', path.join(old, 'tmt-colab'), [
    'serve',
    '--json',
    '--no-open',
  ]);
  const first = await colab.event((value) => value.state === 'mounted');
  expect(first.door).toBe('attached');
  await world.recordColabServe();
  const gate = path.join(world.root, 'replacement-may-start');
  const mounted = () =>
    colab.lines.filter((line) => {
      try {
        return (JSON.parse(line) as Record<string, unknown>).state === 'mounted';
      } catch {
        return false;
      }
    }).length;
  return {
    address: String(first.url).replace(/\/x\/colab\/$/, ''),
    install() {
      const prepared = JSON.parse(
        run(world, world.binaries.colab, ['serve', '--upgrade-check', '--json', '--no-open']),
      ) as Record<string, unknown>;
      prepared.version = '9.9.9-upgrade-proof';
      const word = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
      const program = `#!/bin/sh
if [ "$2" = '--upgrade-check' ]; then printf '%s\\n' ${word(JSON.stringify(prepared))}; exit 0; fi
while [ ! -e ${word(gate)} ]; do sleep 0.2; done
exec ${word(world.binaries.colab)} "$@"
`;
      fs.writeFileSync(path.join(next, 'tmt-colab'), program, { mode: 0o755 });
      fs.writeFileSync(
        path.join(next, 'receipt.json'),
        JSON.stringify({
          version: prepared.version,
          file_sha256: { 'tmt-colab': createHash('sha256').update(program).digest('hex') },
        }),
      );
      fs.unlinkSync(path.join(lib, 'current'));
      fs.symlinkSync('releases/next', path.join(lib, 'current'));
    },
    release() {
      fs.writeFileSync(gate, '');
    },
    replaced: () => until(() => mounted() >= 2, 'the replacement Colab readiness', 120_000),
  };
}

const status = (page: Page) => page.locator('.status');

test('an open owner page waits out a serve upgrade that outlasts the readmission, then reads, saves and sends once', async () => {
  test.setTimeout(300_000);
  await withWorld(async (world) => {
    const upgrade = await attachedUpgrade(world);
    const agent = await world.startAgent('restart-agent');
    const device = await pairBrowser(world, 'restart-owner', { talk: true });
    const created = createPage(world, 'Serve upgrade', '<h1 id="h">Before</h1>', agent.pane);
    const page = await openPage({ address: upgrade.address }, device, created);
    await expect(page.locator('.status.live .status-label')).toHaveText('Live');
    await openChat(page);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });

    upgrade.install();
    // The replacement stays down: the page says so quietly and keeps waiting past the old limit.
    await expect(status(page)).toContainText('Reconnecting…', { timeout: 60_000 });
    await page.waitForTimeout(BEYOND_READMISSION_MS);
    await expect(status(page)).toContainText('Reconnecting…');
    await expect(page.getByRole('heading', { name: 'Preview stopped', exact: true })).toHaveCount(
      0,
    );

    upgrade.release();
    await upgrade.replaced();
    await expect(page.locator('.status.live .status-label')).toHaveText('Live', {
      timeout: 120_000,
    });

    // It reads: a CLI write after the upgrade reaches the open tab.
    run(
      world,
      world.binaries.colab,
      patchArgs(world, created.pageId, ['--file', '-', '--json']),
      '<h1 id="h">After</h1>',
    );
    await expect(page.frameLocator('iframe').locator('#h')).toHaveText('After', {
      timeout: 60_000,
    });

    // It saves: the browser's edit lands once.
    const box = await openSource(page);
    await expect(box).toHaveValue('<h1 id="h">After</h1>');
    await box.fill('<h1 id="h">Edited</h1>');
    await save(page);
    const read = () =>
      (
        JSON.parse(
          run(world, world.binaries.colab, ['page', 'read', created.pageId, '--json']),
        ) as {
          source: string;
        }
      ).source;
    await expect.poll(read, { timeout: 60_000 }).toBe('<h1 id="h">Edited</h1>');

    // It talks: the composer reaches the agent with the exact text, once.
    const composed = await composeChat(page, agent, 'Back after the upgrade?');
    await sendChat(page, composed);
    await expect
      .poll(
        () => {
          try {
            return composed.delivered();
          } catch {
            return '';
          }
        },
        { timeout: 60_000 },
      )
      .toContain('Back after the upgrade?');
    expect(agent.received()).toHaveLength(1);
    expect(world.coreCalls().filter((call) => call.operation === 'dispatch.create')).toHaveLength(
      1,
    );
    expect(navigations).toEqual([]);
  });
});

// The wait is only for a device Remote still vouches for: every retry opens a fresh Remote Session
// first, so a grant revoked while the serve is down still ends the page with the access card.
test('a device revoked while the serve is being upgraded still ends with the access card', async () => {
  test.setTimeout(300_000);
  await withWorld(async (world) => {
    const upgrade = await attachedUpgrade(world);
    const device = await pairBrowser(world, 'restart-revoked');
    const created = createPage(world, 'Revoked in upgrade', '<h1 id="h">Revoked</h1>');
    const page = await openPage({ address: upgrade.address }, device, created);
    await expect(page.locator('.status.live .status-label')).toHaveText('Live');

    upgrade.install();
    await expect(status(page)).toContainText('Reconnecting…', { timeout: 60_000 });
    revokeMachine(world, 'restart-revoked');

    const card = page.locator('.tmt-ui-notice');
    await expect(card).toContainText(text.failurePairingRemoved, { timeout: 90_000 });
    await expect(card).toContainText('Pair again');
    upgrade.release();
  });
});

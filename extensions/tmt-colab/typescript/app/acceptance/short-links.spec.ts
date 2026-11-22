import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { backToPageList, showAllPages } from '../test/home-list.js';
import { createPage, freePort, openPage, run, selectInRenderer } from './harness/ask.js';
import {
  openReaderLink,
  pairBrowser,
  restartColab,
  restartRemote,
  startDoor,
} from './harness/browser.js';
import { disposeActiveWorlds, withWorld } from './harness/with-world.js';

test.afterEach(disposeActiveWorlds);
test('real Colab keeps public short entries across admission, reload and history', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const created = createPage(
      world,
      'Short routing proof',
      '<h1 id="proof">Short route content</h1>',
    );
    const shown = JSON.parse(
      run(world, world.binaries.colab, ['show', created.pageId, '--json']),
    ) as { link: string; shortLink: string; path: string; spaceId: string };
    const canonical = new URL(`/colab/pages/${created.pageId}`, door.origin).href;
    expect(shown.link).toBe(shown.shortLink);
    expect(new URL(shown.link).pathname).toBe(created.path);
    expect(new URL(shown.link).hash).toBe('');
    const device = await pairBrowser(world, 'short-owner', { talk: true });
    const page = await openPage(door, device, created);
    const proof = () => page.frameLocator('iframe').locator('#proof');
    await expect(proof()).toHaveText('Short route content');
    expect(page.url()).toBe(canonical);
    await page.reload();
    await expect(proof()).toHaveText('Short route content');
    expect(page.url()).toBe(canonical);
    await selectInRenderer(page, '#proof');
    await page.getByTestId('selection-ask').click();
    const compose = page.getByRole('dialog', { name: 'Annotate selection' });
    await compose
      .getByRole('combobox', { name: 'Message', exact: true })
      .fill('Short thread proof');
    await compose.getByRole('button', { name: 'Send', exact: true }).click();
    const thread = compose.getByTestId('comment-thread');
    await expect(thread.locator('.comment-body')).toHaveText('Short thread proof');
    const threadId = await thread.getAttribute('data-thread-id');
    expect(threadId).not.toBeNull();
    const threadUrl = `${canonical}#t=${threadId}`;
    await page.goto(threadUrl);
    await expect(page.getByTestId('comment-thread').locator('.comment-body')).toHaveText(
      'Short thread proof',
    );
    expect(page.url()).toBe(threadUrl);
    await page.goto(shown.link);
    await expect(proof()).toHaveText('Short route content');
    await backToPageList(page);
    await showAllPages(page);
    await expect(
      page.locator(`[data-page-id="${created.pageId}"]`).getByRole('link'),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/colab/');
    await page.goBack();
    await expect(proof()).toHaveText('Short route content');
    expect(page.url()).toBe(canonical);
    await page.goForward();
    await expect(
      page.locator(`[data-page-id="${created.pageId}"]`).getByRole('link'),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/colab/');
    await page.goto(
      `${door.mounts}colab/#space=${shown.spaceId}&path=%2Fpages%2F${created.pageId}`,
    );
    await expect(proof()).toHaveText('Short route content');
    expect(page.url()).toBe(canonical);
    await page.reload();
    await expect(proof()).toHaveText('Short route content');
    expect(page.url()).toBe(canonical);
    for (const route of ['/colab', '/colab/']) {
      await page.goto(new URL(route, door.origin).href);
      // Choosing a tab rewrites the address to `/colab/`, so check it once the list is up and
      // before asking for All.
      await expect(page.getByRole('tab', { name: /^All, \d+\+?$/ })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(route);
      await showAllPages(page);
      await expect(
        page.locator(`[data-page-id="${created.pageId}"]`).getByRole('link'),
      ).toBeVisible();
    }
    // A fresh public response supplies the current private mount after either process restarts.
    for (const restart of [restartColab, restartRemote]) {
      await restart(world, door);
      await page.goto(shown.link);
      await expect(proof()).toHaveText('Short route content');
      expect(page.url()).toBe(canonical);
      await page.reload();
      await expect(proof()).toHaveText('Short route content');
      expect(page.url()).toBe(canonical);
    }
    const colab = (args: string[]) =>
      JSON.parse(run(world, world.binaries.colab, [...args, '--json'])) as Record<string, unknown>;
    colab(['share', 'mode', created.pageId, 'link', '--yes']);
    const added = colab(['share', 'link', 'add', created.pageId, '--yes']);
    const readerPath = added.readerPath as string;
    const capability = new URL(readerPath, door.origin);
    expect(capability.pathname).toBe(`/read/${added.linkId}`);
    expect(added.readerUrl).toBe(capability.href);
    const reader = await openReaderLink(world, door, readerPath, 'short-reader');
    await expect(reader.page.frameLocator('iframe').locator('#proof')).toHaveText(
      'Short route content',
    );
    expect(reader.page.url()).toBe(`${door.origin}${capability.pathname}`);
    expect(
      reader.requests.every(
        (request) => !request.url.includes('#') && !request.url.includes('seed='),
      ),
    ).toBe(true);
    expect((await fetch(`${door.mounts}colab/index.html`)).status).toBe(403);
    colab(['share', 'link', 'remove', created.pageId, String(added.linkId), '--yes']);
    await expect(
      reader.page.getByRole('heading', { name: 'Access ended', level: 2 }),
    ).toBeVisible();
    const requestCount = reader.requests.length;
    await reader.page.goto(shown.link);
    await expect(
      reader.page.getByRole('link', { name: 'Pair this browser', exact: true }),
    ).toBeVisible();
    await expect(
      reader.page.getByRole('link', { name: 'Pair this browser', exact: true }),
    ).toHaveAttribute('href', '/remote/');
    expect(reader.page.url()).toBe(shown.link);
    await expect(reader.page.locator('iframe')).toHaveCount(0);
    expect(
      reader.requests.slice(requestCount).some((request) => request.url.includes('/api/pages')),
    ).toBe(false);
    expect(world.coreCalls().filter((call) => call.operation === 'dispatch.create')).toHaveLength(
      0,
    );
  });
});

async function captureRecovery(page: Page, route: string) {
  const directory = process.env.COLAB_RESTART_RECOVERY_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({ path: path.join(directory, `${route}-${width}-${theme}.png`) });
    }
  }
}

test('an open Colab tab recovers its page and home list after Colab restarts', async () => {
  await withWorld(async (world) => {
    const door = await startDoor(world, await freePort());
    const created = createPage(world, 'Restart recovery', '<h1 id="proof">Recovered page</h1>');
    const browser = await pairBrowser(world, 'restart-owner');
    const page = await openPage(door, browser, created);
    const proof = page.frameLocator('iframe').locator('#proof');
    await expect(proof).toHaveText('Recovered page');
    const pageUrl = page.url();
    await backToPageList(page);
    await showAllPages(page);
    const homeUrl = page.url();

    const home = await openPage(door, browser, created);
    await expect(home.frameLocator('iframe').locator('#proof')).toHaveText('Recovered page');
    const row = home.locator(`[data-page-id="${created.pageId}"]`).getByRole('link');
    const waitForOutage = async (tab: Page, route: 'page' | 'home') => {
      const unavailable = tab.getByRole(route === 'page' ? 'status' : 'alert').filter({
        hasText: 'Colab registration unavailable (404)',
      });
      await expect(unavailable).toBeVisible();
      const retry = route === 'page' ? 'Retry' : 'Try again';
      await expect(unavailable.getByRole('button', { name: retry, exact: true })).toBeVisible();
      await expect(unavailable.getByText('Trying again…', { exact: true })).toBeVisible();
      await captureRecovery(tab, route);
    };

    await restartColab(world, door, async () => {
      await page.bringToFront();
      await page.goBack();
      await waitForOutage(page, 'page');
      await expect(page).toHaveURL(pageUrl);

      await home.bringToFront();
      await backToPageList(home);
      await waitForOutage(home, 'home');
      await expect(home).toHaveURL(homeUrl);
      await page.bringToFront();
    });
    await expect(proof).toHaveText('Recovered page', { timeout: 8_000 });
    await expect(page).toHaveURL(pageUrl);
    await home.bringToFront();
    await expect(row).toBeVisible({ timeout: 8_000 });
    await expect(home).toHaveURL(homeUrl);
  });
});

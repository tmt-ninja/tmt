import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
);

for (const width of [1440, 390]) {
  test(`page-view renders the admitted live list in the frame at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.evaluate(async (release) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      document.body.prepend(host);
      await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-page-view label="Live pages"></tmt-ui-page-view>`,
        {
          signal: new AbortController().signal,
          onState: (state: string) => {
            host.dataset.state = state;
          },
          designSystem: {
            release: async () => release,
            draft: async () => release,
            watch: () => () => {},
          },
          pageView: (publish: (rows: unknown[]) => void) => {
            (window as unknown as { updatePageView(rows: unknown[]): void }).updatePageView =
              publish;
            publish([
              {
                id: 'one',
                name: 'Admitted page',
                projects: ['spec'],
                stage: 'Open',
                updated: 'Today',
                author: 'Ben',
                access: 'Team',
              },
            ]);
            return () => {};
          },
        },
      );
      const frame = host.querySelector('iframe');
      if (frame) frame.style.width = '100%';
    }, bundle);
    const frame = page.frameLocator('iframe[title="Page content"]');
    await expect(frame.getByRole('grid', { name: 'Pages' })).toContainText('Admitted page');
    expect(
      await frame
        .locator('.tmt-data-table-row[data-table-row]')
        .first()
        .evaluate((row) => getComputedStyle(row).display),
    ).toBe(width === 390 ? 'flex' : 'grid');
    await expect(frame.getByRole('button', { name: /Open/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await frame.getByRole('button', { name: /Open/ }).click();
    await expect(frame.getByText('Admitted page')).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { updatePageView(rows: unknown[]): void }).updatePageView([
        {
          id: 'two',
          name: 'Refreshed page',
          projects: [],
          stage: 'Done',
          updated: 'Now',
          author: 'Ben',
          access: 'Team',
        },
      ]),
    );
    await expect(frame.getByText('Refreshed page')).toBeVisible();
  });
  test(`work bundle shows only its admitted page metadata at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.evaluate(async (release) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      document.body.prepend(host);
      await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-work-bundle page="allowed" work="Review it"></tmt-ui-work-bundle><tmt-ui-work-bundle page="missing"></tmt-ui-work-bundle>`,
        {
          signal: new AbortController().signal,
          onState: () => {},
          designSystem: {
            release: async () => release,
            draft: async () => release,
            watch: () => () => {},
          },
          workBundle: {
            subscribe: (id: string, _signal: AbortSignal, publish: (value: unknown) => void) => {
              publish(
                id === 'allowed'
                  ? {
                      title: 'Admitted work page',
                      href: '/pages/allowed',
                      summary: 'Safe summary',
                      projects: ['spec'],
                    }
                  : undefined,
              );
              return () => {};
            },
          },
        },
      );
      const frame = host.querySelector('iframe');
      if (frame) frame.style.width = '100%';
    }, bundle);
    const frame = page.frameLocator('iframe[title="Page content"]');
    await expect(frame.getByRole('link', { name: 'Admitted work page' })).toBeVisible();
    await expect(frame.getByText('Safe summary')).toBeVisible();
    await expect(frame.getByText('Review it')).toBeVisible();
    await expect(frame.getByText('Page not found')).toBeVisible();
  });
  test(`mockup block creates a scoped stage without another frame at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.evaluate(async (release) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      document.body.prepend(host);
      await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-mockup-block><tmt-ui-button>Stage button</tmt-ui-button></tmt-ui-mockup-block>`,
        {
          signal: new AbortController().signal,
          onState: () => {},
          designSystem: {
            release: async () => release,
            draft: async () => release,
            watch: () => () => {},
          },
        },
      );
      const frame = host.querySelector('iframe');
      if (frame) frame.style.width = '100%';
    }, bundle);
    const frame = page.frameLocator('iframe[title="Page content"]');
    const stage = frame.locator('[data-tmt-ds-scope]');
    await expect(stage).toHaveCount(1);
    await expect(stage.locator(':scope > [data-tmt-ui-portal]')).toHaveCount(1);
    await expect(stage.getByRole('button', { name: 'Stage button' })).toBeVisible();
    await expect(frame.locator('iframe')).toHaveCount(0);
    await frame.getByRole('button', { name: '1440' }).click();
    await expect(frame.getByRole('button', { name: '1440' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
}

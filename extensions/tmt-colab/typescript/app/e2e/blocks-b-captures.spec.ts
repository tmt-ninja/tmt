import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
);
const captureDir = process.env.BLOCK_CAPTURE_DIR;
if (captureDir) mkdirSync(captureDir, { recursive: true });

for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const) {
    test(`part B filled blocks at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await servePageRuntime(page);
      await page.goto('/');
      await page.evaluate(async (release) => {
        const path = '/src/renderer.ts';
        const { mountRenderer } = await import(path);
        const host = document.createElement('div');
        host.style.width = '100%';
        document.body.replaceChildren(host);
        const image =
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d3d3d3"/><rect x="24" y="24" width="272" height="28" fill="#888"/><rect x="24" y="70" width="160" height="80" fill="#aaa"/></svg>',
          );
        const source = `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}">
        <tmt-ui-question-block label="Which screen should we build first?" agent="gui-lead" choices='["Insert menu","Block handle"]'></tmt-ui-question-block>
        <tmt-ui-image-block images='[{"src":"${image}","alt":"Screen","caption":"390 light","tag":"Review"}]'></tmt-ui-image-block>
        <tmt-ui-mockup-block height="200"><tmt-ui-button>Approve</tmt-ui-button></tmt-ui-mockup-block>
        <tmt-ui-work-bundle page="allowed" work="Review the shared component."></tmt-ui-work-bundle>
        <tmt-ui-page-view label="Spec pages"></tmt-ui-page-view>`;
        await mountRenderer(host, source, {
          signal: new AbortController().signal,
          onState: () => {},
          designSystem: {
            release: async () => release,
            draft: async () => release,
            watch: () => () => {},
          },
          pageView: (publish: (rows: unknown[]) => void) => {
            publish([
              {
                id: 'one',
                name: 'Structured pages',
                projects: ['spec'],
                stage: 'Awaiting decision',
                updated: 'Today',
                author: 'gui-lead',
                access: 'Team',
                subpages: { done: 2, total: 4 },
              },
              {
                id: 'two',
                name: 'Night execution plan',
                projects: ['night'],
                stage: 'In progress',
                updated: 'Yesterday',
                author: 'night-lead',
                access: 'Team',
              },
            ]);
            return () => {};
          },
          workBundle: {
            subscribe: (_id: string, _signal: AbortSignal, publish: (value: unknown) => void) => {
              publish({
                title: 'Shared page components',
                href: '/pages/allowed',
                summary: 'Implement the approved component family.',
                projects: ['gui'],
                stage: 'In progress',
                owner: 'night-lead',
                needsYou: true,
                updated: '20 minutes ago',
              });
              return () => {};
            },
          },
        });
        const frame = host.querySelector('iframe');
        if (frame) frame.style.width = '100%';
      }, bundle);
      const frame = page.frameLocator('iframe[title="Page content"]');
      for (const [name, selector] of [
        ['question', 'tmt-ui-question-block'],
        ['image', 'tmt-ui-image-block'],
        ['mockup', 'tmt-ui-mockup-block'],
        ['work', 'tmt-ui-work-bundle'],
        ['page-view', 'tmt-ui-page-view'],
      ]) {
        const target = frame.locator(selector);
        await expect(target).toBeVisible();
        if (captureDir)
          await target.screenshot({ path: join(captureDir, `${name}-${width}-${theme}.png`) });
      }
      await expect(frame.getByText('Structured pages')).toBeVisible();
      await expect(frame.getByText('Shared page components')).toBeVisible();
      await frame.getByLabel('Other…').check();
      await frame.getByLabel('Other: your answer').fill('Show the list first');
      if (captureDir)
        await frame
          .locator('tmt-ui-question-block')
          .screenshot({ path: join(captureDir, `question-other-${width}-${theme}.png`) });
      await frame.getByRole('button', { name: 'Open Screen' }).click();
      const viewer = frame.getByRole('dialog', { name: 'Image viewer' });
      await expect(viewer).toBeVisible();
      if (captureDir)
        await viewer.screenshot({ path: join(captureDir, `image-viewer-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await frame.getByText('Columns 5/5').click();
      if (captureDir)
        await frame
          .locator('tmt-ui-page-view')
          .screenshot({ path: join(captureDir, `page-view-columns-${width}-${theme}.png`) });
    });
  }

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
        const renderer = await mountRenderer(host, source, {
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
        (
          window as unknown as { captureRenderer: { images(input: unknown): void } }
        ).captureRenderer = renderer;
        const frame = host.querySelector('iframe');
        if (frame) frame.style.width = '100%';
      }, bundle);
      const frame = page.frameLocator('iframe[title="Page content"]');
      for (const [name, selector] of [
        ['question', 'tmt-ui-question-block'],
        ['image', 'tmt-ui-image-block'],
        ['mockup', 'tmt-ui-mockup-block'],
        ['work', 'tmt-ui-work-bundle'],
        ['page-view', '[data-parent-page-view]'],
      ]) {
        // The page view is drawn by the trusted parent over the frame's reserved slot.
        const target = name === 'page-view' ? page.locator(selector) : frame.locator(selector);
        await expect(target).toBeVisible();
        if (captureDir) {
          const capture = await target.screenshot({
            path: join(captureDir, `${name}-${width}-${theme}.png`),
          });
          if (name === 'question') {
            await page.evaluate(
              ({ base64, length }) => {
                const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
                (
                  window as unknown as { captureRenderer: { images(input: unknown): void } }
                ).captureRenderer.images({
                  descriptors: [
                    {
                      attachmentId: '11111111-1111-4111-8111-111111111111',
                      filename: 'question.png',
                      mediaType: 'image/png',
                      plaintextBytes: String(length),
                    },
                  ],
                  binding: { scope: () => 'capture', open: async () => bytes },
                });
              },
              { base64: capture.toString('base64'), length: capture.length },
            );
            await frame.locator('tmt-ui-image-block').evaluate((node) => {
              node.setAttribute(
                'images',
                JSON.stringify([
                  {
                    src: 'colab-attachment:11111111',
                    alt: 'Screen',
                    filename: 'question.png',
                    caption: 'Question preview',
                    tag: 'Review',
                  },
                ]),
              );
            });
            await expect(
              frame.getByRole('button', { name: 'Image 1: open viewer' }).locator('img'),
            ).toHaveAttribute('src', /^data:image\/png;base64,/);
          }
        }
      }
      const pageView = page.locator('[data-parent-page-view]');
      await expect(pageView.getByText('Structured pages')).toBeVisible();
      await expect(frame.getByText('Shared page components')).toBeVisible();
      await frame.getByLabel('Other…').check();
      await frame.getByLabel('Other: your answer').fill('Show the list first');
      if (captureDir)
        await frame
          .locator('tmt-ui-question-block')
          .screenshot({ path: join(captureDir, `question-other-${width}-${theme}.png`) });
      await frame.getByRole('button', { name: 'Image 1: open viewer' }).click();
      const viewer = frame.getByRole('dialog');
      await expect(viewer).toBeVisible();
      if (captureDir)
        await viewer.screenshot({ path: join(captureDir, `image-viewer-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await pageView.getByText('Columns 5/5').click();
      if (captureDir)
        await pageView.screenshot({
          path: join(captureDir, `page-view-columns-${width}-${theme}.png`),
        });
    });
  }

// #6176: the carousel's control row is the part's own, drawn by the shared block stylesheet, so a
// page shows the controls the docs show: laid out in a row with a gap, never native buttons run
// together.
const swatch = (fill: string, label: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${fill}"/><text x="24" y="96" font-size="28" font-family="sans-serif" fill="#222">${label}</text></svg>`,
  );
const carousel = ['#d3d3d3', '#c9d6ea', '#d9ead3', '#f4e1c1', '#e8d0e8', '#cfe8e8'].map(
  (fill, index) => ({
    src: swatch(fill, `Screen ${index + 1}`),
    alt: `Screen ${index + 1}`,
    caption: `Screen ${index + 1} of 6`,
  }),
);
for (const width of [1440, 390])
  for (const theme of ['light', 'dark'] as const) {
    test(`the image block carousel controls are styled at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.emulateMedia({ colorScheme: theme });
      await servePageRuntime(page);
      await page.goto('/');
      await page.evaluate(
        async ({ release, images }) => {
          const path = '/src/renderer.ts';
          const { mountRenderer } = await import(path);
          const host = document.createElement('div');
          host.style.width = '100%';
          document.body.replaceChildren(host);
          await mountRenderer(
            host,
            `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}">
            <tmt-ui-image-block images='${JSON.stringify(images)}'></tmt-ui-image-block>`,
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
        },
        { release: bundle, images: carousel },
      );
      const frame = page.frameLocator('iframe[title="Page content"]');
      const block = frame.locator('tmt-ui-image-block');
      const controls = block.locator('.tmt-block-image-controls');
      await expect(controls).toBeVisible();
      await expect(controls).toHaveCSS('display', 'flex');
      await expect(controls).toHaveCSS('align-items', 'center');
      await expect(controls).not.toHaveCSS('column-gap', /^(normal|0px)$/);
      await expect(controls.getByText('1 / 6')).toBeVisible();
      // The arrows go on a phone, where the images scroll by touch; the count stays.
      if (width === 1440) {
        await controls.getByRole('button', { name: 'Next image' }).click();
        await expect(controls.getByText('2 / 6')).toBeVisible();
      }
      if (captureDir)
        await block.screenshot({ path: join(captureDir, `image-carousel-${width}-${theme}.png`) });
    });
  }

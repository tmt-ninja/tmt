import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
);

test('mockup stages accept the page pin and explain mismatched systems and locks', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (release) => {
    const path = '/src/renderer.ts';
    const { mountRenderer } = await import(path);
    const host = document.createElement('div');
    document.body.prepend(host);
    await mountRenderer(
      host,
      `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}">
       <tmt-ui-mockup-block id="implicit"><tmt-ui-button>Inherited</tmt-ui-button></tmt-ui-mockup-block>
       <tmt-ui-mockup-block id="matching" system="tmt-gui" lock="0.1.0"><tmt-ui-button>Matching</tmt-ui-button></tmt-ui-mockup-block>
       <tmt-ui-mockup-block id="matching-hash" lock="0.1.0#${release.hash}"><tmt-ui-button>Matching hash</tmt-ui-button></tmt-ui-mockup-block>
       <tmt-ui-mockup-block id="wrong-system" system="other"><tmt-ui-button>Wrong system</tmt-ui-button></tmt-ui-mockup-block>
       <tmt-ui-mockup-block id="wrong-lock" lock="follow"><tmt-ui-button>Wrong lock</tmt-ui-button></tmt-ui-mockup-block>
       <tmt-ui-mockup-block id="wrong-hash" lock="0.1.0#sha256-wrong"><tmt-ui-button>Wrong hash</tmt-ui-button></tmt-ui-mockup-block>`,
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
  }, bundle);
  const frame = page.frameLocator('iframe[title="Page content"]');
  await expect(frame.locator('#implicit').getByRole('button', { name: 'Inherited' })).toBeVisible();
  await expect(frame.locator('#matching').getByRole('button', { name: 'Matching' })).toBeVisible();
  await expect(
    frame.locator('#matching-hash').getByRole('button', { name: 'Matching hash' }),
  ).toBeVisible();
  for (const id of ['wrong-system', 'wrong-lock', 'wrong-hash']) {
    const block = frame.locator(`#${id}`);
    await expect(block.getByRole('status')).toContainText('tmt-gui@0.1.0');
    await expect(block.locator('[data-tmt-ds-scope]')).toHaveCount(0);
  }
  await frame
    .locator('#wrong-system')
    .evaluate((element) => element.setAttribute('system', 'tmt-gui'));
  await expect(
    frame.locator('#wrong-system').getByRole('button', { name: 'Wrong system' }),
  ).toBeVisible();
});

test('verified custom-prefix components receive only their declared data', async ({ page }) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (original) => {
    const path = '/src/renderer.ts';
    const { mountRenderer } = await import(path);
    const release = {
      ...original,
      system: 'acme',
      prefix: 'acme',
      components: original.components.map((part: { tag: string }) => ({
        ...part,
        tag: part.tag.replace(/^tmt-ui-/, 'acme-'),
      })),
    };
    const host = document.createElement('div');
    document.body.prepend(host);
    (window as unknown as { admittedPages: string[] }).admittedPages = [];
    await mountRenderer(
      host,
      '<meta name="tmt-ds" content="acme"><acme-page-view></acme-page-view><acme-work-bundle page="project-1"></acme-work-bundle><acme-button page="not-admitted">Test</acme-button><acme-mockup-block id="draft" lock="follow"><acme-button>Draft stage</acme-button></acme-mockup-block><acme-mockup-block id="locked" lock="0.1.0"><acme-button>Locked stage</acme-button></acme-mockup-block>',
      {
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
              name: 'Custom list',
              projects: [],
              stage: 'Open',
              updated: 'Today',
              author: 'Ben',
              access: 'Team',
            },
          ]);
          return () => {};
        },
        workBundle: {
          subscribe: (page: string, _signal: AbortSignal, publish: (row: unknown) => void) => {
            (window as unknown as { admittedPages: string[] }).admittedPages.push(page);
            publish({
              id: 'project-1',
              title: 'Custom work',
              href: '/pages/project-1',
              projects: [],
            });
            return () => {};
          },
        },
      },
    );
  }, bundle);
  const frame = page.frameLocator('iframe[title="Page content"]');
  await expect(frame.getByText('Custom list')).toBeVisible();
  await expect(frame.getByText('Custom work')).toBeVisible();
  await expect(frame.locator('#draft').getByRole('button', { name: 'Draft stage' })).toBeVisible();
  await expect(frame.locator('#locked').getByRole('status')).toContainText(
    'acme@0.1.0 (following draft)',
  );
  await expect(frame.locator('#locked').locator('[data-tmt-ds-scope]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { admittedPages: string[] }).admittedPages),
  ).toEqual(['project-1']);
});

test('attachment download requires parent confirmation and current admission', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/e2e/attachment-download-fixture.tsx';
    const { mountDownloadFixture } = await import(path);
    mountDownloadFixture();
  });
  await page.getByRole('button', { name: 'Unknown' }).click();
  await expect(page.getByRole('dialog', { name: 'Download attachment' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Download attachment' });
  await expect(dialog).toContainText('example.png');
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => (window as unknown as { reads: number }).reads)).toBe(0);
  await page.getByRole('button', { name: 'Request', exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { failDownload: boolean }).failDownload = true;
  });
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { failDownload: boolean }).failDownload = false;
  });
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { reads: number }).reads))
    .toBe(2);
  await expect(dialog).toHaveCount(0);
});

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
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-page-view label="Live pages" filters='[{"field":"project","value":"spec"}]'></tmt-ui-page-view>`,
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
                subpages: { done: 2, total: 5 },
              },
              {
                id: 'other',
                name: 'Other project',
                projects: ['other'],
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
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('tmt-page-view-data', { detail: [{ id: 'fake', name: 'Forged data' }] }),
      );
    });
    expect(await frame.locator('body').evaluate(() => '__colabBlockData' in window)).toBe(false);
    await expect(frame.getByText('Forged data')).toHaveCount(0);
    if (width === 1440)
      await expect(frame.getByRole('meter', { name: 'Sub-page progress' })).toHaveAttribute(
        'aria-valuenow',
        '2',
      );
    await expect(frame.getByText('Other project')).toHaveCount(0);
    await frame.getByRole('button', { name: 'Remove project: spec filter' }).click();
    await expect(frame.getByText('Other project')).toBeVisible();
    await frame.getByText('Columns 5/5').click();
    await frame.getByRole('menuitemcheckbox', { name: 'Updated' }).uncheck();
    await frame.getByText('Columns 4/5').press('Escape');
    await expect(frame.getByText('Columns 4/5')).toBeFocused();
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
      const result = await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-work-bundle page="allowed" work="Review it" editable></tmt-ui-work-bundle><tmt-ui-work-bundle page="missing"></tmt-ui-work-bundle><tmt-ui-work-bundle page="bad.id"></tmt-ui-work-bundle>`,
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
              const state = window as unknown as { workIds: string[]; stops: number };
              (state.workIds ??= []).push(id);
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
              return () => {
                state.stops = (state.stops || 0) + 1;
              };
            },
          },
        },
      );
      (window as unknown as { stopWorkFrame(): void }).stopWorkFrame = () => result.destroy();
      const frame = host.querySelector('iframe');
      if (frame) frame.style.width = '100%';
    }, bundle);
    const frame = page.frameLocator('iframe[title="Page content"]');
    await expect(frame.getByRole('link', { name: 'Admitted work page' })).toBeVisible();
    await expect(frame.getByText('Safe summary')).toBeVisible();
    const work = frame.getByRole('textbox', { name: 'Work' });
    await expect(work).toHaveValue('Review it');
    await work.evaluate((node) =>
      node.addEventListener('tmt-work-change', (event) => {
        node.setAttribute('data-work-event', (event as CustomEvent).detail.value);
      }),
    );
    await work.fill('Updated work');
    await expect(work).toHaveAttribute('data-work-event', 'Updated work');
    await expect(frame.getByText('Page not found')).toHaveCount(2);
    expect(await page.evaluate(() => (window as unknown as { workIds: string[] }).workIds)).toEqual(
      ['allowed', 'missing'],
    );
    await page.evaluate(() => (window as unknown as { stopWorkFrame(): void }).stopWorkFrame());
    expect(await page.evaluate(() => (window as unknown as { stops: number }).stops)).toBe(2);
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
  test(`question block offers Other and emits the answer at ${width}`, async ({ page }) => {
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
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-question-block label="Which screen?" agent="gui" choices='["List","Menu"]'></tmt-ui-question-block>`,
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
    }, bundle);
    const frame = page.frameLocator('iframe[title="Page content"]');
    await frame.getByLabel('Other…').check();
    await frame.getByLabel('Other: your answer').fill('Something else');
    const form = frame.locator('form');
    await form.evaluate((node) =>
      node.addEventListener('tmt-question-answer', (event) => {
        node.setAttribute('data-answer', JSON.stringify((event as CustomEvent).detail));
      }),
    );
    await frame.getByRole('button', { name: 'Send' }).click();
    await expect(form).toHaveAttribute('data-answer', /Something else/);
    const question = frame.locator('tmt-ui-question-block');
    await question.evaluate((node) => {
      node.setAttribute('answer', 'Something else');
      node.setAttribute('state', 'answered');
    });
    const answered = question.getByRole('button', { name: /Which screen\? Something else/ });
    await expect(answered).toHaveAttribute('aria-expanded', 'false');
    await expect(answered).toHaveCSS('height', '32px');
    await answered.click();
    await expect(question.getByRole('button', { name: 'Send' })).toBeVisible();
  });
  test(`image viewer stays inside its scope and restores focus at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.evaluate(async (release) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      document.body.prepend(host);
      const images = JSON.stringify([
        {
          src: 'colab-attachment:11111111',
          alt: 'First',
        },
        {
          src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
          alt: 'Second',
        },
      ]);
      await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-mockup-block><tmt-ui-image-block images='${images}'></tmt-ui-image-block><button id="inside">Inside</button></tmt-ui-mockup-block><button id="outside">Outside</button>`,
        {
          signal: new AbortController().signal,
          onState: () => {},
          images: {
            descriptors: [
              {
                attachmentId: '11111111-1111-4111-8111-111111111111',
                mediaType: 'image/png',
                plaintextBytes: '68',
              },
            ],
            binding: {
              scope: () => 'admitted',
              open: async () =>
                Uint8Array.from(
                  atob(
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
                  ),
                  (c) => c.charCodeAt(0),
                ),
            },
          },
          onAttachmentDownload: (id: string) => {
            ((window as unknown as { downloadIds: string[] }).downloadIds ??= []).push(id);
          },
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
    const open = frame.getByRole('button', { name: 'Open First' });
    await expect(open.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await open.click();
    const dialog = frame.getByRole('dialog', { name: 'Image viewer' });
    await expect(dialog).toBeVisible();
    await expect(frame.locator('#inside')).toHaveJSProperty('inert', true);
    await expect(dialog).not.toHaveJSProperty('open', true);
    await expect(dialog.getByAltText('First')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const renderId = await page
      .locator('iframe[title="Page content"]')
      .getAttribute('data-render-id');
    await frame.locator('body').evaluate(
      (_, id) =>
        parent.postMessage(
          {
            type: 'colab.render.attachment-download',
            renderId: id,
            reference: 'colab-attachment:99999999',
          },
          '*',
        ),
      renderId,
    );
    await dialog.getByRole('link', { name: 'Download' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { downloadIds?: string[] }).downloadIds),
      )
      .toEqual(['11111111-1111-4111-8111-111111111111']);
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(dialog.getByAltText('Second')).toBeVisible();
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    await expect(dialog.getByText('125%')).toBeVisible();
    await frame.getByRole('button', { name: 'Outside' }).click();
    await expect(dialog).toBeVisible();
    await dialog.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(frame.locator('#inside')).toHaveJSProperty('inert', false);
    await expect(open).toBeFocused();
    await frame.getByRole('button', { name: 'Outside' }).click();
    const block = frame.locator('tmt-ui-image-block');
    await block.evaluate((node) =>
      node.setAttribute(
        'images',
        JSON.stringify([
          {
            src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
            alt: 'First',
          },
        ]),
      ),
    );
    await expect(open.locator('img')).toHaveAttribute('src', /^data:image\/gif;base64,/);
    await frame.locator('body').evaluate((body) => {
      const image = document.createElement('img');
      image.id = 'another-attachment';
      image.src = 'colab-attachment:11111111';
      body.append(image);
    });
    await expect(frame.locator('#another-attachment')).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/,
    );
    await expect(open.locator('img')).toHaveAttribute('src', /^data:image\/gif;base64,/);
    await block.evaluate((node) =>
      node.setAttribute(
        'images',
        JSON.stringify([{ src: 'colab-attachment:11111111', alt: 'First' }]),
      ),
    );
    await expect(open.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  });
}

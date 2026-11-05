import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';
import { DOWNLOAD_COOLDOWN_MS } from '../src/download-cooldown.js';

const bundle = JSON.parse(
  readFileSync(
    new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
    'utf8',
  ),
);

test('work-bundle data is withheld, admitted, then revoked as writer proof changes', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (release) => {
    const rendererPath = '/src/renderer.ts';
    const gatePath = '/src/work-bundle-source.ts';
    const { mountRenderer } = await import(rendererPath);
    const { gateWorkBundleSource } = await import(gatePath);
    const host = document.createElement('div');
    document.body.prepend(host);
    let allowed = false;
    let current: { destroy(): void } | undefined;
    let subscriptions = 0;
    const source = {
      subscribe(_id: string, _signal: AbortSignal, publish: (value: unknown) => void) {
        subscriptions++;
        publish({ title: 'Owner secret', href: '/pages/allowed' });
        return () => {};
      },
    };
    const state = window as unknown as {
      setWriterProof(value: boolean): Promise<void>;
      workSubscriptions(): number;
    };
    state.workSubscriptions = () => subscriptions;
    state.setWriterProof = async (value) => {
      allowed = value;
      current?.destroy();
      current = await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-work-bundle page="allowed"></tmt-ui-work-bundle><tmt-ui-page-view></tmt-ui-page-view>`,
        {
          signal: new AbortController().signal,
          onState: () => {},
          designSystem: {
            release: async () => release,
            draft: async () => release,
            watch: () => () => {},
          },
          workBundle: gateWorkBundleSource(source, () => allowed),
          pageView: (publish: (rows: unknown[]) => void) => {
            publish([
              {
                id: 'other',
                name: 'Other page secret',
                href: '/pages/other',
                projects: [],
                stage: '',
                updated: '',
                author: '',
                access: '',
              },
            ]);
            return () => {};
          },
        },
      );
    };
    await state.setWriterProof(false);
  }, bundle);
  const frame = page.frameLocator('iframe[title="Page content"]');
  await expect(frame.getByText('Owner secret')).toHaveCount(0);
  await expect(
    page.locator('[data-parent-page-view]').getByText('Other page secret'),
  ).toBeVisible();
  await expect(frame.getByText('Other page secret')).toHaveCount(0);
  expect(await frame.locator('body').evaluate(() => '__colabBlockData' in window)).toBe(false);
  await page.evaluate(() =>
    (window as unknown as { setWriterProof(v: boolean): Promise<void> }).setWriterProof(true),
  );
  await expect(frame.getByText('Owner secret')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { setWriterProof(v: boolean): Promise<void> }).setWriterProof(false),
  );
  await expect(frame.getByText('Owner secret')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { workSubscriptions(): number }).workSubscriptions(),
    ),
  ).toBe(1);
});

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
  await expect(page.locator('[data-parent-page-view]').getByText('Custom list')).toBeVisible();
  await expect(frame.getByText('Custom list')).toHaveCount(0);
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
  // Time is the page's own fake clock: the cool-down is stepped through, never waited out.
  await page.clock.install();
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
  // #6094: after a Cancel the page cannot reopen the bar at once; asking again does not extend
  // the cool-down, and after it the bar opens again.
  const request = page.getByRole('button', { name: 'Request', exact: true });
  await request.click();
  await expect(dialog).toHaveCount(0);
  await page.clock.fastForward(DOWNLOAD_COOLDOWN_MS - 500);
  await request.click();
  await expect(dialog).toHaveCount(0);
  await page.clock.fastForward(500);
  await request.click();
  await expect(dialog).toContainText('example.png');
  // Escape is a Cancel too; a new render clears the cool-down.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await request.click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'New render' }).click();
  await request.click();
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
  // A finished download is no Cancel: the next request opens the bar at once.
  await request.click();
  await expect(dialog).toContainText('example.png');
});

test('trusted page-view preserves authored presentation and selection', async ({ page }) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (release) => {
    const path = '/src/renderer.ts';
    const { mountRenderer } = await import(path);
    const host = document.createElement('div');
    document.body.prepend(host);
    await mountRenderer(
      host,
      `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-page-view label="Custom pages" group-by="none" columns='["title","owner"]' density="comfortable" selected="one" selectable></tmt-ui-page-view>`,
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
              name: 'Admitted page',
              projects: [],
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
  }, bundle);
  const parent = page.locator('[data-parent-page-view]');
  await expect(parent.getByText('Admitted page')).toBeVisible();
  await expect(parent.getByLabel('Group by')).toHaveValue('none');
  await expect(parent.getByText('Columns 2/5')).toBeVisible();
  await expect(parent.locator('[data-density]')).toHaveAttribute('data-density', 'comfortable');
  await expect(parent.getByRole('checkbox', { name: /select admitted page/i })).toBeChecked();
  await expect(
    page.frameLocator('iframe[title="Page content"]').getByText('Admitted page'),
  ).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`page-view renders the admitted live list in the trusted parent at ${width}`, async ({
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
    const parent = page.locator('[data-parent-page-view]');
    await expect(parent.getByRole('grid', { name: 'Pages' })).toContainText('Admitted page');
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('tmt-page-view-data', { detail: [{ id: 'fake', name: 'Forged data' }] }),
      );
    });
    expect(await frame.locator('body').evaluate(() => '__colabBlockData' in window)).toBe(false);
    await expect(frame.getByText('Forged data')).toHaveCount(0);
    await expect(frame.getByText('Admitted page')).toHaveCount(0);
    if (width === 1440)
      await expect(parent.getByRole('meter', { name: 'Sub-page progress' })).toHaveAttribute(
        'aria-valuenow',
        '2',
      );
    await expect(parent.getByText('Other project')).toHaveCount(0);
    await parent.getByRole('button', { name: 'Remove project: spec filter' }).click();
    await expect(parent.getByText('Other project')).toBeVisible();
    await parent.getByText('Columns 5/5').click();
    if (width === 390) {
      await parent.getByRole('checkbox', { name: 'Updated' }).uncheck();
      await parent.getByRole('button', { name: 'Close', exact: true }).click();
    } else {
      await parent.getByRole('menuitemcheckbox', { name: 'Updated' }).uncheck();
      await parent.getByText('Columns 4/5').press('Escape');
    }
    await expect(parent.getByText('Columns 4/5')).toBeFocused();
    expect(
      await parent
        .locator('.tmt-data-table-row[data-table-row]')
        .first()
        .evaluate((row) => getComputedStyle(row).display),
    ).toBe(width === 390 ? 'flex' : 'grid');
    await expect(parent.getByRole('button', { name: /Open/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await parent.getByRole('button', { name: /Open/ }).click();
    await expect(parent.getByText('Admitted page')).toHaveCount(0);
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
    await expect(parent.getByText('Refreshed page')).toBeVisible();
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

// Page views and work bundles are read from the source when the frame mounts. Only a design-system
// page has them, and the frame applies no in-place update to such a page (it owns its DOM), so an
// edit that adds, removes or re-targets one always remounts and binds afresh.
test('an update to a page with page views or work bundles remounts', async ({ page }) => {
  await servePageRuntime(page);
  await page.goto('/');
  const results = await page.evaluate(async (release) => {
    const path = '/src/renderer.ts';
    const { mountRenderer } = await import(path);
    const pin = `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}">`;
    const mount = async (source: string) => {
      const host = document.createElement('div');
      document.body.prepend(host);
      let ready = () => {};
      const shown = new Promise<void>((resolve) => (ready = resolve));
      const mounted = await mountRenderer(host, source, {
        signal: new AbortController().signal,
        onState: (state: string) => {
          if (state === 'ready') ready();
        },
        designSystem: {
          release: async () => release,
          draft: async () => release,
          watch: () => () => {},
        },
        pageView: () => () => {},
        workBundle: { subscribe: () => () => {} },
      });
      await shown;
      return mounted;
    };
    const bound = await mount(
      `${pin}<tmt-ui-page-view label="First"></tmt-ui-page-view><tmt-ui-work-bundle page="one"></tmt-ui-work-bundle>`,
    );
    const plain = await mount('<p>Plain</p>');
    return [
      await bound.update(
        `${pin}<tmt-ui-page-view label="Second"></tmt-ui-page-view><tmt-ui-work-bundle page="two"></tmt-ui-work-bundle>`,
      ),
      await bound.update(`${pin}<p>No bindings</p>`),
      await plain.update('<p>Edited</p>'),
      await plain.update(`${pin}<tmt-ui-work-bundle page="one"></tmt-ui-work-bundle>`),
    ];
  }, bundle);
  expect(results).toEqual(['remount', 'remount', 'applied', 'remount']);
});

// A live page list on a page another writer touched would be a guessing oracle on the owner's pages
// (its rows, and the height they give the frame's slot). Such a page gets no rows and a height that
// does not depend on the owner's data; a page that stops qualifying loses its rows.
test('a page view on a page not written only by its owner gets no rows and a fixed height', async ({
  page,
}) => {
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (release) => {
    const { mountRenderer } = await import('/src/renderer.ts' as string);
    const { gatePageViewSource } = await import('/src/page-view-source.ts' as string);
    const row = (index: number) => ({
      id: `p${index}`,
      name: `Owner page ${index}`,
      href: `/pages/p${index}`,
      projects: ['Secret'],
      stage: 'Open',
      updated: '',
      author: 'Ben',
      access: '',
    });
    const state = window as unknown as {
      mountList(rows: number, allowed: boolean): Promise<void>;
      revoke(): void;
    };
    let current: { destroy(): void } | undefined;
    let allowed = false;
    let push: ((rows: unknown[]) => void) | undefined;
    state.revoke = () => {
      allowed = false;
      push?.([row(99)]);
    };
    state.mountList = async (count, admitted) => {
      current?.destroy();
      document.querySelector('#list-host')?.remove();
      allowed = admitted;
      const host = document.createElement('div');
      host.id = 'list-host';
      document.body.prepend(host);
      current = await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-page-view filters='[{"field":"project","value":"Secret"}]'></tmt-ui-page-view>`,
        {
          signal: new AbortController().signal,
          onState: () => {},
          designSystem: {
            release: async () => release,
            draft: async () => release,
            watch: () => () => {},
          },
          pageView: gatePageViewSource(
            (publish: (rows: unknown[]) => void) => {
              push = publish;
              publish(Array.from({ length: count }, (_, index) => row(index)));
              return () => {};
            },
            () => allowed,
          ),
        },
      );
    };
  }, bundle);
  const list = page.locator('[data-parent-page-view]');
  const frameHeight = () =>
    page
      .frameLocator('iframe[title="Page content"]')
      .locator('tmt-ui-page-view')
      .evaluate((node) => node.getBoundingClientRect().height);
  const mountList = (rows: number, allowed: boolean) =>
    page.evaluate(
      ([count, admitted]) =>
        (
          window as unknown as { mountList(rows: number, allowed: boolean): Promise<void> }
        ).mountList(count, admitted),
      [rows, allowed] as [number, boolean],
    );
  const heights: number[] = [];
  for (const rows of [0, 1, 30]) {
    await mountList(rows, false);
    await expect(list.getByText('Page list unavailable')).toBeVisible();
    await expect(list.getByText(/Owner page/)).toHaveCount(0);
    await expect.poll(frameHeight).toBeGreaterThan(1);
    heights.push(await frameHeight());
  }
  expect(new Set(heights).size).toBe(1);
  // Admitted, the owner's rows show; once revoked, the next publish leaves the fixed state.
  await mountList(3, true);
  await expect(list.getByText('Owner page 2')).toBeVisible();
  await page.evaluate(() => (window as unknown as { revoke(): void }).revoke());
  await expect(list.getByText(/Owner page/)).toHaveCount(0);
  await expect(list.getByText('Page list unavailable')).toBeVisible();
  await expect.poll(frameHeight).toBe(heights[0]);
});

// #5981: a data: image the frame hands over is saved only on the reader's confirmation, under its
// cleaned name, one request at a time, with the same cool-down after Cancel.
test('a page image download asks once, saves the checked bytes and cools down after Cancel', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/e2e/attachment-download-fixture.tsx';
    const { mountDownloadFixture } = await import(path);
    mountDownloadFixture();
  });
  const dialog = page.getByRole('dialog', { name: 'Download image' });
  await page.getByRole('button', { name: 'Image first' }).click();
  await expect(dialog).toContainText('first.png');
  // A second request while the bar asks is ignored. It arrives as a message, not a pointer press
  // outside the bar (which would dismiss it), so the fixture's control is activated directly.
  await page
    .getByRole('button', { name: 'Image second' })
    .evaluate((node) => (node as HTMLElement).click());
  await expect(dialog).toContainText('first.png');
  await expect(dialog).not.toContainText('second.png');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Image second' }).click();
  await expect(dialog).toHaveCount(0);
  await page.clock.fastForward(DOWNLOAD_COOLDOWN_MS);
  await page.getByRole('button', { name: 'Image second' }).click();
  await expect(dialog).toContainText('second.png');
  const saved = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe('second.png');
  const { readFile } = await import('node:fs/promises');
  expect([...(await readFile((await download.path())!))]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3,
  ]);
  await expect(dialog).toHaveCount(0);
});

test('the frame hands over a data: image download link, and the parent admits only checked images', async ({
  page,
}) => {
  await page.goto('/');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANAQID';
  const fake = 'data:image/png;base64,/9j/4AAQAQIDBAUG';
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
  await page.evaluate(
    async ({ png, fake, svg }) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      host.id = 'probe';
      document.body.prepend(host);
      const asked: unknown[] = [];
      (window as unknown as { asked: unknown[] }).asked = asked;
      await mountRenderer(
        host,
        `<p><a id="png" download="chart.png" href="${png}">PNG</a>
         <a id="fake" download="fake.png" href="${fake}">Fake</a>
         <a id="svg" download="logo.svg" href="${svg}">SVG</a>
         <a id="plain" href="${png}">Not a download</a></p>`,
        {
          signal: new AbortController().signal,
          onState: (state: string) => {
            host.dataset.state = state;
          },
          onImageDownload: (image: { filename: string; mediaType: string; length: number }) =>
            asked.push({
              filename: image.filename,
              mediaType: image.mediaType,
              length: image.length,
            }),
        },
      );
    },
    { png, fake, svg },
  );
  await expect(page.locator('#probe')).toHaveAttribute('data-state', 'ready');
  const frame = page.frameLocator('#probe iframe');
  for (const id of ['fake', 'svg', 'plain', 'png']) await frame.locator(`#${id}`).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { asked: unknown[] }).asked))
    .toEqual([{ filename: 'chart.png', mediaType: 'image/png', length: 15 }]);
});

// A window-high size inside a page frame reads the frame's own viewport, which is the page, so it
// grew a window-scrolled frame. A stage bounds a sheet menu by the stage; at page level the
// visible band bounds the sheet menu and the shell (#5981).
const sheetMenu =
  '<tmt-ui-block-menu label="Insert block" items="Paragraph, Heading, Table, To-do, Question, Code, Quote, Divider, Image, Mockup, Callout, Toggle, List, Numbers, Board, Calendar, Embed, File, Link, Columns" placement="sheet"></tmt-ui-block-menu>';
const windowHigh = [
  {
    where: 'a sheet block menu in a stage',
    html: `<tmt-ui-mockup-block preset="390" height="420">${sheetMenu}</tmt-ui-mockup-block>`,
    part: '.tmt-block-menu[data-placement="sheet"]',
    // The menu is longer than this bound, so its height is the bound.
    fits: (height: number) => height <= 0.6 * 420 + 1,
  },
  {
    where: 'a page-level sheet block menu',
    html: sheetMenu,
    part: '.tmt-block-menu[data-placement="sheet"]',
    fits: (height: number) => height <= 0.6 * 844 + 1,
  },
  {
    where: 'a page-level shell',
    html: '<tmt-ui-shell items="Colab,Design">Content</tmt-ui-shell>',
    part: '.tmt-ui-shell',
    fits: (height: number) => height <= 844,
  },
];
for (const { where, html, part, fits } of windowHigh) {
  test(`${where} keeps a long page in window scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.evaluate(
      async ({ release, html }) => {
        const path = '/src/renderer.ts';
        const { mountRenderer } = await import(path);
        const host = document.createElement('div');
        document.body.prepend(host);
        await mountRenderer(
          host,
          `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}">${html}<div style="height:3000px">Long page</div>`,
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
      },
      { release: bundle, html },
    );
    const frame = page.locator('iframe[title="Page content"]');
    const shown = page.frameLocator('iframe[title="Page content"]').locator(part);
    await expect(shown).toBeVisible();
    // Once the frame is as tall as the page, the part fits its bound. Sized against the frame's
    // own viewport it outgrows the bound with the frame, or the renderer gives up on window
    // scroll and caps the frame.
    await expect
      .poll(async () => ({
        mode: await frame.getAttribute('data-scroll-mode'),
        tall: ((await frame.boundingBox())?.height ?? 0) > 3000,
        fits: fits((await shown.boundingBox())?.height ?? Infinity),
      }))
      .toEqual({ mode: 'window', tall: true, fits: true });
  });
}

// #5981: a mockup stage hugs its content (`height` is a minimum), sits centred when narrower than
// the block, and shows a phone sheet whole; its toolbar is two segmented groups that wrap whole.
const stages = `
  <tmt-ui-mockup-block id="hug" preset="390"><div id="hug-content" style="height:150px">Short</div></tmt-ui-mockup-block>
  <tmt-ui-mockup-block id="min" preset="390" height="300"><div style="height:150px">Short</div></tmt-ui-mockup-block>
  <tmt-ui-mockup-block id="sheet" preset="390"><tmt-ui-block-menu label="Insert block" items="Paragraph, Heading, Table" placement="sheet"></tmt-ui-block-menu></tmt-ui-mockup-block>`;
for (const width of [390, 1440])
  test(`mockup stages hug their content, centre and keep a segmented toolbar at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await servePageRuntime(page);
    await page.goto('/');
    await page.addStyleTag({ content: 'iframe[title="Page content"]{width:100%!important}' });
    await page.evaluate(
      async ({ release, html }) => {
        const path = '/src/renderer.ts';
        const { mountRenderer } = await import(path);
        const host = document.createElement('div');
        document.body.prepend(host);
        await mountRenderer(
          host,
          `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}">${html}`,
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
      },
      { release: bundle, html: stages },
    );
    const content = page.frameLocator('iframe[title="Page content"]');
    const stage = (id: string) => content.locator(`#${id} [data-tmt-ds-scope]`);
    const height = async (id: string) => Math.round((await stage(id).boundingBox())?.height ?? 0);
    await expect(stage('hug').getByText('Short')).toBeVisible();
    // The stage is its content's height, and follows it; a minimum holds a shorter content.
    await expect.poll(() => height('hug')).toBe(150);
    await expect.poll(() => height('min')).toBe(300);
    await content.locator('#hug-content').evaluate((node) => (node.style.height = '220px'));
    await expect.poll(() => height('hug')).toBe(220);
    // A phone sheet sizes itself from the stage; with no minimum the stage is the sheet's own
    // height over its 60% share, so every row shows and nothing scrolls.
    const sheet = content.locator('#sheet .tmt-block-menu[data-placement="sheet"]');
    const fit = await sheet.evaluate((node: HTMLElement) => ({
      client: node.clientHeight,
      scroll: node.scrollHeight,
      border: node.offsetHeight - node.clientHeight,
    }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.client);
    expect(
      Math.abs((await height('sheet')) - Math.ceil((fit.scroll + fit.border) / 0.6)),
    ).toBeLessThanOrEqual(1);
    await expect(sheet.getByRole('option')).toHaveCount(3);
    const bounds = await stage('sheet').boundingBox();
    for (const option of await sheet.getByRole('option').all()) {
      const row = await option.boundingBox();
      expect(
        row && bounds && row.y >= bounds.y && row.y + row.height <= bounds.y + bounds.height + 0.5,
      ).toBe(true);
    }
    // A 390 stage sits in the middle of a wider block.
    const box = await content.locator('#hug .tmt-block-mockup-viewport').boundingBox();
    const inner = await stage('hug').boundingBox();
    if (box && inner && box.width > 391)
      expect(
        Math.abs(inner.x - box.x - (box.x + box.width - inner.x - inner.width)),
      ).toBeLessThanOrEqual(1);
    else expect(inner?.x).toBe(box?.x);
    // Each group keeps its segments on one row inside the block; the chosen one is filled.
    const block = await content.locator('#hug').boundingBox();
    for (const name of ['Stage width', 'Theme']) {
      const group = content.locator('#hug').getByRole('group', { name });
      const tops = await group
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
        );
      expect(new Set(tops).size).toBe(1);
      const edge = await group.boundingBox();
      expect((edge?.x ?? 0) + (edge?.width ?? Infinity)).toBeLessThanOrEqual(
        (block?.x ?? 0) + (block?.width ?? 0) + 0.5,
      );
    }
    const toolbar = content.locator('#hug').getByRole('toolbar', { name: 'Mockup settings' });
    expect(await toolbar.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const chosen = toolbar.getByRole('button', { name: '390' });
    const other = toolbar.getByRole('button', { name: '1440' });
    await expect(chosen).toHaveAttribute('aria-pressed', 'true');
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    await expect(toolbar.getByRole('button', { name: 'Viewer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const fill = (button: typeof chosen) =>
      button.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await fill(chosen)).not.toBe(await fill(other));
    // Hugging never reads as viewport coupling.
    await expect(page.locator('iframe[title="Page content"]')).toHaveAttribute(
      'data-scroll-mode',
      'window',
    );
  });

// #5981: the block-menu tag draws the one insert catalog, as the design-system docs' phone sheet does.
test('the block-menu tag draws catalog rows with icon, description, shortcut and group', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(async (release) => {
    const path = '/src/renderer.ts';
    const { mountRenderer } = await import(path);
    const host = document.createElement('div');
    document.body.prepend(host);
    await mountRenderer(
      host,
      `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-block-menu label="Insert block" placement="sheet" items="Paragraph, Table, Code, Callout" active="Table"></tmt-ui-block-menu><tmt-ui-block-menu label="Block actions" kind="actions" items="Duplicate, Delete"></tmt-ui-block-menu>`,
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
  const insert = frame.getByRole('listbox', { name: 'Insert block' });
  await expect(insert).toHaveAttribute('data-placement', 'sheet');
  await expect(insert.getByRole('group')).toHaveText([/^Basic/, /^Structure/]);
  const table = insert.getByRole('option', { name: /Table/ });
  await expect(table).toHaveAttribute('aria-selected', 'true');
  await expect(table.locator('.tmt-block-menu-icon svg')).toBeVisible();
  await expect(table.locator('.tmt-block-menu-description')).toHaveText('Columns and rows');
  await expect(table.locator('kbd')).toHaveText('/table');
  await expect(insert.getByRole('option', { name: /Code/ }).locator('kbd')).toHaveText('```');
  const plain = insert.getByRole('option', { name: 'Callout' });
  await expect(plain.locator('.tmt-block-menu-icon, kbd, .tmt-block-menu-description')).toHaveCount(
    0,
  );
  const actions = frame.getByRole('menu', { name: 'Block actions' });
  await expect(actions.getByRole('menuitem', { name: /Duplicate/ }).locator('kbd')).toHaveText(
    '⌘D',
  );
  await expect(actions.getByRole('menuitem', { name: /Delete/ })).toHaveAttribute(
    'data-danger',
    '',
  );
  await expect(actions.locator('[data-slot="block-menu-separator"]')).toHaveCount(1);
});

/** A page that uses the runtime and the design system, mounted full width as in the app. */
async function mountRuntimePage(page: Page, body: string, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await servePageRuntime(page);
  await page.goto('/');
  await page.evaluate(
    async ({ release, body }) => {
      const style = document.createElement('style');
      style.textContent = 'iframe { width: 100% !important; }';
      document.head.append(style);
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      document.body.prepend(host);
      await mountRenderer(
        host,
        `<meta name="tmt-ds" content="tmt-gui@0.1.0#${release.hash}"><tmt-ui-button>Part</tmt-ui-button>${body}`,
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
    },
    { release: bundle, body },
  );
  return page.locator('iframe[title="Page content"]');
}
/** A late part: counted as pending, painted only after `paintAfter` uneven growth steps (never when
 * 0), so the page grows while parts still paint. */
const lateGrowth = (steps: number, paintAfter: number) =>
  `<script>
    // Taller than the window, so every step grows the frame.
    document.body.append(Object.assign(document.createElement('div'), { style: 'height:1000px' }));
    globalThis.__tmtPartsPending = 1;
    let step = 0;
    const timer = setInterval(() => {
      const block = document.createElement('div');
      block.style.height = 300 + ((step * 137) % 400) + 'px';
      block.dataset.step = String(++step);
      document.body.append(block);
      if (step === ${paintAfter}) globalThis.__tmtPartsPending = 0;
      if (step >= ${steps}) clearInterval(timer);
    }, 150);
  </script>`;

// #5981: parts that paint over several frames grow the page in steps; that is not viewport coupling.
for (const width of [390, 1440])
  test(`a runtime page whose parts grow it six times in a second stays in window scroll at ${width}`, async ({
    page,
  }) => {
    const frame = await mountRuntimePage(page, lateGrowth(6, 6), width);
    const content = page.frameLocator('iframe[title="Page content"]');
    await expect(content.locator('[data-step="6"]')).toBeAttached();
    // The sixth step's height reaches the parent and is applied, without a fallback.
    await expect.poll(async () => ((await frame.boundingBox())?.height ?? 0) > 2000).toBe(true);
    await expect(frame).toHaveAttribute('data-scroll-mode', 'window');
    await expect
      .poll(async () => {
        const outer = Math.round((await frame.boundingBox())?.height ?? 0);
        const inner = await content.locator('html').evaluate((node) => node.scrollHeight);
        return Math.abs(outer - inner) <= 1;
      })
      .toBe(true);
    await expect(frame).toHaveAttribute('data-scroll-mode', 'window');
  });

test('a runtime page that never settles is checked for growth after the grace', async ({
  page,
}) => {
  const frame = await mountRuntimePage(page, lateGrowth(60, 0));
  const content = page.frameLocator('iframe[title="Page content"]');
  // Within the grace, its growth does not count.
  await expect(content.locator('[data-step="8"]')).toBeAttached();
  await expect(frame).toHaveAttribute('data-scroll-mode', 'window');
  // After it, the steady growth is checked as before and falls back to a bounded inner scroll.
  await expect(frame).toHaveAttribute('data-scroll-mode', 'frame', { timeout: 10_000 });
  expect(await content.locator('[data-step]').count()).toBeGreaterThan(20);
});

test('a viewport-coupled runtime page still falls back once its parts settle', async ({ page }) => {
  const frame = await mountRuntimePage(
    page,
    '<style>body{margin:0}.grow{height:calc(100vh + 120px)}</style><div class="grow">Coupled</div>',
  );
  await expect(frame).toHaveAttribute('data-scroll-mode', 'frame', { timeout: 10_000 });
});

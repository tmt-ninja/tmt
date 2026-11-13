import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { servePageRuntime } from './page-runtime.js';

test('verified TerminalFrame renders live and in the offline copy, and changed renderer bytes fail closed', async ({
  page,
  browser,
}) => {
  const original = JSON.parse(
    readFileSync(
      new URL('../../../../../design/systems/tmt-gui/generated/bundle.json', import.meta.url),
      'utf8',
    ),
  );
  const { hash: _oldHash, ...body } = original;
  body.components = [
    {
      tag: `${body.prefix}-terminal-preview`,
      props: {},
      slots: [],
      uiParts: ['TerminalFrame'],
      examples: [
        {
          title: 'Terminal preview',
          markup: `<${body.prefix}-terminal-preview></${body.prefix}-terminal-preview>`,
        },
      ],
      css: '',
      code: `return ({React,ui}) => () => React.createElement('div', {id:'stacked-frames'}, ...[0,1].map(() => React.createElement(ui.TerminalFrame, {component:'section-rule',width:40,height:1,title:'Saved · 1d',note:'0.9% of input',note_role:'muted',focused:false})));`,
    },
  ];
  const hash = `sha256-${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  const bundle = { ...body, hash };
  const source = `<meta name="tmt-ds" content="${body.system}@${body.version}#${hash}"><${body.prefix}-terminal-preview></${body.prefix}-terminal-preview>`;
  const fetched = await servePageRuntime(page);
  await page.setViewportSize({ width: 1000, height: 480 });
  await page.goto('/');
  await page.evaluate(
    async ({ source, bundle }) => {
      const path = '/src/renderer.ts';
      const { mountRenderer } = await import(path);
      const host = document.createElement('div');
      host.id = 'terminal-proof';
      document.body.replaceChildren(host);
      const style = document.createElement('style');
      style.textContent = '#terminal-proof iframe { width: 900px; min-height: 150px; }';
      document.head.append(style);
      await mountRenderer(host, source, {
        signal: new AbortController().signal,
        onState: (state: string) => {
          host.dataset.state = state;
        },
        designSystem: {
          release: async () => bundle,
          draft: async () => bundle,
          watch: () => () => {},
        },
      });
    },
    { source, bundle },
  );
  await expect(page.locator('#terminal-proof')).toHaveAttribute('data-state', 'ready');
  const live = page.frameLocator('#terminal-proof iframe');
  await expect(live.locator(`${body.prefix}-terminal-preview`)).toContainText('Saved · 1d');
  expect(fetched.filter((name) => name.endsWith('.wasm'))).toHaveLength(1);
  // Compare the actual live cells with the checked-in native tmt/40 golden, including color.
  const golden = readFileSync(
    new URL(
      '../../../../../rust/crates/tmt-tui/src/components/design_system_ratatui/cell-grids.txt',
      import.meta.url,
    ),
    'utf8',
  );
  const section = golden
    .split('=== tmt 40 ===')[1]!
    .split('[section-note] hits=[]\n')[1]!
    .split('\n')[0]!;
  const [expectedText, runs] = section.split(' | ');
  const actual = await live
    .locator(`${body.prefix}-terminal-preview #stacked-frames > span:first-child > span`)
    .evaluateAll((cells) =>
      cells.map((cell) => ({ text: cell.textContent, color: getComputedStyle(cell).color })),
    );
  expect(actual.map((cell) => cell.text).join('')).toBe(expectedText);
  let covered = 0;
  for (const match of runs!.matchAll(
    /(\d+)\.\.(\d+):(Rgb\(\d+, \d+, \d+\)|Reset)\/Reset\/Reset\/NONE;/g,
  )) {
    const expected = match[3] === 'Reset' ? 'rgb(216, 216, 216)' : match[3]!.replace('Rgb', 'rgb');
    for (let index = Number(match[1]); index <= Number(match[2]); index++) {
      expect(actual[index]!.color).toBe(expected);
      covered++;
    }
  }
  expect(covered).toBe(40);
  const edges = await live.locator('#stacked-frames > span').evaluateAll((frames) =>
    frames.map((frame) => {
      const { top, bottom } = frame.getBoundingClientRect();
      return { top, bottom };
    }),
  );
  expect(edges).toHaveLength(2);
  expect(edges[0]!.bottom).toBeCloseTo(edges[1]!.top, 3);
  const capture = process.env.COLAB_TERMINAL_CAPTURE;
  const liveImage = capture
    ? await page.screenshot({ path: join(capture, 'terminal-live.png') })
    : undefined;

  // The copy is made by the app's own export path, from the same verified bundle (#6157).
  const copy = await page.evaluate(
    async ({ source, bundle }) => {
      const runtime = '/src/export-runtime.ts';
      const standalone = '/src/standalone.ts';
      const { standaloneRequest } = await import(runtime);
      const { deriveStandalone } = await import(standalone);
      const request = await standaloneRequest(
        { source },
        { release: async () => bundle, draft: async () => bundle, watch: () => () => {} },
      );
      return (deriveStandalone(source, request) as { document?: string }).document;
    },
    { source, bundle },
  );
  expect(typeof copy).toBe('string');
  const dir = mkdtempSync(join(tmpdir(), 'terminal-standalone-'));
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1000, height: 480 },
  });
  try {
    // The copy carries the verified renderer, so the terminal draws from disk with no network.
    expect(copy).toContain('<script type="application/octet-stream" data-terminal>AGFzbQ');
    const file = join(dir, 'page.standalone.html');
    writeFileSync(file, copy as string);
    const offline = await context.newPage();
    await offline.goto(pathToFileURL(file).href);
    await expect(offline.locator(`${body.prefix}-terminal-preview`)).toContainText('Saved · 1d');
    await expect(offline.locator('[data-colab-standalone-notice]')).toHaveCount(0);
    expect(await offline.evaluate(() => '__colabTakeTerminalBytes' in window)).toBe(false);
    // Changed renderer bytes fail closed: nothing draws and the page says so.
    const changed = join(dir, 'changed.standalone.html');
    writeFileSync(
      changed,
      (copy as string).replace('data-terminal>AGFzbQ', 'data-terminal>AGFzbR'),
    );
    const refused = await context.newPage();
    await refused.goto(pathToFileURL(changed).href);
    await expect(refused.locator('[data-colab-standalone-notice]')).toContainText(
      'TerminalFrame is unavailable in standalone export.',
    );
    await expect(refused.locator(`${body.prefix}-terminal-preview`)).not.toContainText(
      'Saved · 1d',
    );
    if (capture) {
      const offlineImage = await offline.screenshot({
        path: join(capture, 'terminal-standalone.png'),
      });
      const comparison = await browser.newPage({ viewport: { width: 2000, height: 520 } });
      try {
        await comparison.setContent(
          `<style>body{margin:0;display:flex;gap:8px;font:16px sans-serif}figure{margin:0}img{width:990px}</style><figure><figcaption>Live verified TerminalFrame</figcaption><img src="data:image/png;base64,${liveImage!.toString('base64')}"></figure><figure><figcaption>Offline standalone export (carried renderer)</figcaption><img src="data:image/png;base64,${offlineImage.toString('base64')}"></figure>`,
        );
        await comparison.screenshot({ path: join(capture, 'terminal-live-vs-standalone.png') });
      } finally {
        await comparison.close();
      }
    }
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

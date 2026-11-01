/** The Ops harness page both Ops specs serve: one build of the test-owned harness into the real
 * Ops document and the generated static styles, routed under a test origin. */
import type { Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

export interface OpsHarness {
  harness: string;
  html: string;
  css: string;
  dispose(): Promise<void>;
}

export async function buildOpsHarness(): Promise<OpsHarness> {
  const directory = await mkdtemp(join(tmpdir(), 'ops-harness-'));
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
  const harness = await readFile(join(directory, 'harness.js'), 'utf8');
  const assets = new URL('../../../rust/tmt-remote/assets/', import.meta.url);
  const html = (await readFile(new URL('ops.html', assets), 'utf8'))
    .replace(
      '<div class="tmt-ui-shell-content">',
      '<div class="tmt-ui-shell-content"><div class="tmt-ui-shell-bar"></div>',
    )
    .replace('/sdk/shell.js', '/harness.js');
  const css =
    (await readFile(
      new URL('../../../../../design/browser-ui/generated/static.css', import.meta.url),
      'utf8',
    )) + (await readFile(new URL('pages.css', assets), 'utf8'));
  return { harness, html, css, dispose: () => rm(directory, { recursive: true, force: true }) };
}

/** Serves the harness under `origin` with a fake clock, the viewport and the stored theme. */
export async function serveOpsHarness(
  page: Page,
  built: OpsHarness,
  origin: string,
  width: number,
  theme: string,
): Promise<void> {
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
      body:
        path === '/harness.js' ? built.harness : path === '/sdk/pages.css' ? built.css : built.html,
    });
  });
}

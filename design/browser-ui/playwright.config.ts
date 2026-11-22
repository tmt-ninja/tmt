import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
const port = Number(process.env.BROWSER_UI_TEST_PORT ?? 5184);
if (!Number.isSafeInteger(port) || port < 1 || port > 65534)
  throw new Error('BROWSER_UI_TEST_PORT must be a TCP port.');
const baseURL = `http://127.0.0.1:${port}`;
// The /docs site, one port above the gallery, for e2e/docs-previews.spec.ts.
const docsURL = `http://127.0.0.1:${port + 1}`;
// Each dev server runs through e2e/web-server.mjs, which says why it stopped if it dies mid-run
// and interrupts active tests; the reporter explains why (#6804). Set once by the runner,
// so its workers, which load this file again, keep the same values.
const serverExit = (process.env.TMT_PLAYWRIGHT_SERVER_EXIT ??= path.join(
  os.tmpdir(),
  `browser-ui-web-server-exit-${randomUUID()}.log`,
));
const guardEnv = {
  TMT_PLAYWRIGHT_SERVER_EXIT: serverExit,
  TMT_PLAYWRIGHT_RUNNER_PID: String(process.pid),
};
const devServer = (name: string, config: string, at: number) =>
  `node e2e/web-server.mjs ${name} ./node_modules/.bin/vp dev --config ${config} --port ${at} --strictPort`;
// Real-browser checks of the design gallery's own pages: computed styles and overlay motion. The
// gallery is served by the leaf's dev server; nothing here touches a product or the host tmux.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: { baseURL, trace: 'retain-on-failure' },
  // Playwright's own default reporter, plus the web servers' exit reason.
  reporter: [[process.env.CI ? 'dot' : 'list'], ['./e2e/web-server-reporter.ts']],
  webServer: [
    {
      command: devServer('gallery', 'vite.gallery.config.ts', port),
      env: guardEnv,
      url: baseURL,
      reuseExistingServer: false,
    },
    {
      command: devServer('docs', 'vite.docs.config.ts', port + 1),
      env: guardEnv,
      url: docsURL,
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

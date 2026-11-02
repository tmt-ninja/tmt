import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const port = Number(process.env.TUI_DOCS_TEST_PORT ?? 15835);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid TUI docs test port');
export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60000,
  outputDir: process.env.TUI_DOCS_TEST_RESULTS ?? '/tmp/tmt-tui-docs-results',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', headless: true },
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: `../../typescript/node_modules/.bin/vp dev --config vite.docs.config.ts --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

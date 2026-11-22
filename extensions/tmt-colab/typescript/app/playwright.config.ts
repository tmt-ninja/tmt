import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
const port = Number(process.env.COLAB_APP_TEST_PORT ?? 4179);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error('COLAB_APP_TEST_PORT must be a TCP port.');
const baseURL = `http://127.0.0.1:${port}`;
// Workers can load this config again. Keep the runner's report path across those loads.
const serverExit = (process.env.TMT_PLAYWRIGHT_SERVER_EXIT ??= join(
  tmpdir(),
  `colab-app-web-server-exit-${randomUUID()}.log`,
));
const guard = '../../../../design/browser-ui/e2e';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  timeout: 30000,
  // The app's View Transitions animate for about half a second; tests that are not about motion
  // run without them (a spec that is calls `emulateMedia({ reducedMotion: 'no-preference' })`).
  use: { baseURL, trace: 'retain-on-failure', reducedMotion: 'reduce' },
  reporter: [[process.env.CI ? 'dot' : 'list'], [`${guard}/web-server-reporter.ts`]],
  webServer: {
    command: `node ${guard}/web-server.mjs colab-app ./node_modules/.bin/vp dev --host 127.0.0.1 --port ${port} --strictPort`,
    env: { TMT_PLAYWRIGHT_SERVER_EXIT: serverExit, TMT_PLAYWRIGHT_RUNNER_PID: String(process.pid) },
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

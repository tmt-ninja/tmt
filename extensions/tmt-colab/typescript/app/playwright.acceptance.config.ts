import { defineConfig } from '@playwright/test';
// Real-binary Ask agent acceptance (#1110). It spawns the built tmt, tmt-remote
// and tmt-colab itself, so unlike playwright.config.ts it starts no dev server.
export default defineConfig({
  testDir: './acceptance',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: 'list',
  // Worlds a killed or interrupted worker could not tear down are stopped here (#5892).
  globalSetup: './acceptance/harness/global-setup.ts',
  globalTeardown: './acceptance/harness/global-teardown.ts',
  use: { trace: 'retain-on-failure' },
});

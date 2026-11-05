import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    clearMocks: false,
    pool: 'threads',
    globalSetup: ['test/e2e/harness/lifecycle.ts'],
    include: ['test/e2e/**/*.e2e.test.ts'],
    exclude: ['node_modules', 'dist'],
    fileParallelism: false,
    // Allow setup plus a 10 s capture wait to throw its pane diagnostic first (#5947).
    testTimeout: 60_000,
    hookTimeout: 5_000,
    maxConcurrency: 1,
    sequence: { concurrent: false, shuffle: false },
    reporters: ['default'],
    coverage: { enabled: false },
  },
});

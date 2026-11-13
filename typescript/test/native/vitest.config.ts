import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    clearMocks: false,
    pool: 'threads',
    include: ['test/native/**/*.test.ts'],
    setupFiles: ['test/support/disk-stall.ts'],
    fileParallelism: false,
    testTimeout: 10_000,
    // One rerun, taken only after a CLI disk stall (test/support/disk-stall.ts, #6393).
    retry: { count: 1, condition: /CLI disk stall, inconclusive/ },
    coverage: { enabled: false },
  },
});

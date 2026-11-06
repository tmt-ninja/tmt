import { lintConfig } from './scripts/lint-config.mjs';
import { defineConfig } from 'vite-plus';
import { readToolingGroups } from './scripts/unit-test-consumers.mjs';
import { fileURLToPath } from 'node:url';

const groups = readToolingGroups(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  lint: lintConfig,
  fmt: {
    semi: true,
    singleQuote: true,
    trailingComma: 'es5',
    printWidth: 100,
    tabWidth: 2,
    sortImports: false,
    sortPackageJson: false,
  },
  test: {
    clearMocks: false,
    pool: 'threads',
    projects: Object.entries(groups).map(([name, include]) => ({
      extends: true,
      test: { name, include },
    })),
    exclude: ['test/e2e/**', 'node_modules', 'dist'],
    // Vitest 4 counts real, bounded synchronous subprocess and filesystem work.
    testTimeout: 10_000,
    // Limit simultaneous suites on high-core development machines.
    maxWorkers: 2,
  },
});

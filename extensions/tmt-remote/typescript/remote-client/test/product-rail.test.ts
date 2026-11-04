import { readFileSync } from 'node:fs';
import { expect, it } from 'vite-plus/test';

// Design is a product rail module (#5866, #5873): Colab's Design extra, beside Colab, served by
// Colab's own mount at /colab/design/. The door's shell script ships that one fixed item.
it('ships the Design rail item, routed to Colab, in the product shell', () => {
  const shell = readFileSync(
    new URL('../../../rust/tmt-remote/assets/remote-v1.js', import.meta.url),
    'utf8',
  );
  expect(shell).toMatch(
    /id: "design",\s*label: "Design",\s*icon: "palette",\s*path: "\/colab\/design\/"/,
  );
});

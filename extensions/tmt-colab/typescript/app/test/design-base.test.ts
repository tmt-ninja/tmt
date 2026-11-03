import { expect, it } from 'vite-plus/test';
import { designBase, hostInShell } from '../src/entry.js';

/** #5866/#5873: Design sits at the TMT app's /design/ only when the shell mounted Colab there. */
it('puts Design under /colab/ outside the shell or off a /design/ location', () => {
  expect(designBase('/design/ds/gui')).toBe('/colab/design');
  hostInShell(null);
  for (const path of ['/design', '/design/', '/design/ds/tui', '/design/systems/p1'])
    expect(designBase(path), path).toBe('/design');
  for (const path of ['/colab/design/ds/gui', '/colab/', '/designer', '/'])
    expect(designBase(path), path).toBe('/colab/design');
});

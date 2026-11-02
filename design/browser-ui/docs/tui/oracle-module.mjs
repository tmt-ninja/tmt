/** The TUI docs read the Ops oracle at build time (#5866): under Vite this plugin replaces
 * oracle-source.ts with extract()'s result as a literal, so the browser never loads node:fs and a
 * changed oracle, theme or token file reaches the docs on the next build (and dev reload). Node
 * (unit tests, Playwright specs) runs oracle-source.ts as written, which calls extract() itself. */
import { fileURLToPath } from 'node:url';
import { extract, root, sources } from './generate.mjs';

const target = fileURLToPath(new URL('./oracle-source.ts', import.meta.url));

export function tuiOracle() {
  return {
    name: 'tmt-tui-oracle',
    enforce: 'pre',
    load(id) {
      if (id.split('?')[0] !== target) return;
      for (const path of sources) this.addWatchFile(fileURLToPath(new URL(path, root)));
      return `export default ${JSON.stringify(extract())};`;
    },
  };
}

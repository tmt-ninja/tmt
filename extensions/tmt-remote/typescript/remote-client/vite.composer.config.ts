import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite-plus';
import sdk from './vite.config.js';

/** Styles reach the page through the door's one stylesheet (pages.rs STYLE), never this module. */
const noStyles: Plugin = {
  name: 'ops-composer-no-styles',
  enforce: 'pre',
  load: (id) => (id.endsWith('.css') ? '' : undefined),
};

/** The field surface the box renders in, copied into Remote's own assets as `ops-composer.css`,
 * so the door embeds a file of its own tree and every build context already has it. The asset
 * freshness check covers it like the module. */
const fieldStyles: Plugin = {
  name: 'ops-composer-field-styles',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'ops-composer.css',
      source: readFileSync(
        new URL(
          '../../../../design/browser-ui/src/rich-input-control/control.css',
          import.meta.url,
        ),
        'utf8',
      ),
    });
  },
};

/** The Ops message box (#5704): React, Lexical and the rich-input core in their own module, which
 * the door serves as `/sdk/ops-composer-v1.js` beside `settings-v1.js`. Only an opened Ops channel
 * or DM imports it. Its own build, rather than a second entry in vite.page.config.ts: two entries
 * would split a shared chunk out of settings-v1.js, and React needs its production build. */
export default defineConfig({
  ...sdk,
  plugins: [noStyles, fieldStyles],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    ...sdk.build,
    // Unlike the SDK this module is almost all third-party code (React and Lexical): minified.
    minify: true,
    lib: { entry: 'src/ops-composer.ts', formats: ['es'], fileName: () => 'ops-composer-v1.js' },
    rollupOptions: { output: { codeSplitting: false } },
  },
});

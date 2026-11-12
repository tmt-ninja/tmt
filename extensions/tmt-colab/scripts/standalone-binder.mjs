// The standalone copy's binder (#6157), built by the runtime build beside the chunks it checks:
// `assets/colab-standalone-binder.js`, one classic script from typescript/app/src/standalone-binder.ts
// and the frame's own design-system modules. It carries the SHA-256 of each chunk this build wrote, in
// load order, and the editorial layer the frame gives a page that did not ask for the runtime. The
// runtime pin records its bytes (verify-runtime.mjs), so both exports read the binder as a pinned file.
import { createHash } from 'node:crypto';
import { builtChunks } from './runtime-chunks.mjs';

export const BINDER_FILE = 'assets/colab-standalone-binder.js';

/** The runtime build's plugin: after the chunks are written into the bundle, build and emit the
 * binder with `build`, the app's own Vite+ build (this directory has no packages of its own). */
export function standaloneBinderPlugin({ build }) {
  return {
    name: 'colab-standalone-binder',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const chunks = builtChunks.map(({ name }) => {
        const found = Object.values(bundle).filter(
          (output) =>
            output.type === 'asset' &&
            new RegExp(`^assets/colab-runtime-${name}-[0-9a-f]{16}\\.js$`).test(output.fileName),
        );
        if (found.length !== 1) throw new Error(`The binder needs one built ${name} chunk`);
        return { name, sha256: createHash('sha256').update(found[0].source).digest('hex') };
      });
      const { dsProseStyle } = await (await import('./page-ui.mjs')).buildPageUi();
      const app = new URL('../typescript/app/', import.meta.url);
      const [output] = [].concat(
        await build({
          configFile: false,
          logLevel: 'warn',
          root: app.pathname,
          define: {
            __COLAB_RUNTIME_CHUNKS__: JSON.stringify(chunks),
            __COLAB_DS_PROSE__: JSON.stringify(dsProseStyle),
          },
          build: {
            write: false,
            minify: true,
            lib: {
              entry: new URL('src/standalone-binder.ts', app).pathname,
              formats: ['iife'],
              name: 'colabStandaloneBinder',
              fileName: () => 'binder.js',
            },
          },
        }),
      );
      const built = output.output.find((item) => item.type === 'chunk')?.code;
      if (!built) throw new Error('The binder build wrote no script');
      // The frame's own guards spell `<!--` and `</script` in strings and patterns. Escaped, they
      // mean the same in a string, a template and a pattern, and cannot end the binder's element.
      const code = built.replaceAll('<!--', '\\x3C!--').replace(/<\/(script)/gi, '<\\/$1');
      if (code.includes('<!--') || /<\/script/i.test(code))
        throw new Error('The binder could end its own element or open a comment');
      this.emitFile({ type: 'asset', fileName: BINDER_FILE, source: code });
    },
  };
}

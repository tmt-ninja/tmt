import { lintConfig } from '../../../../typescript/scripts/lint-config.mjs';
import { defineConfig } from 'vite-plus';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { designTokens } from '../../../../design/tokens/tokens-plugin.ts';
import { tuiOracle } from '@tmt/browser-ui/docs-oracle';
import { entryOf, isBuild } from './src/build-stamp.ts';
import { runtimeBuildOptions, runtimeChunksPlugin } from '../../scripts/runtime-chunks.mjs';

/**
 * The app build the Colab module is made beside (#4282): the hashed entry of the `dist/index.html`
 * the build before it wrote. The module carries it as its own build, so nothing read after it
 * loaded can rename it. A module without one would never show the update row, so it is refused.
 */
function moduleBuild(): string {
  const index = new URL('./dist/index.html', import.meta.url);
  const entry = entryOf(readFileSync(index, 'utf8'), new URL('http://app.invalid/'));
  if (!entry || !isBuild(entry))
    throw new Error(
      `${index.pathname} names no hashed app entry; run \`vp build\` before the module.`,
    );
  return entry;
}

/** The mounted module is built after the app. Share its immutable generated data chunks instead
 * of emitting a second copy; both entries are served from the same authenticated assets path. */
function appDataChunk(name: string): string {
  const matches = readdirSync(new URL('./dist/assets/', import.meta.url)).filter((file) =>
    new RegExp(`^${name}-[A-Za-z0-9_-]{8}\\.js$`).test(file),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one app ${name} chunk, found ${matches.length}`);
  return `./${matches[0]}`;
}

const runtimeChunks = runtimeBuildOptions(new URL('./', import.meta.url));
export default defineConfig(({ mode }) => ({
  lint: lintConfig,
  fmt: {
    ignorePatterns: ['terminal-frame-assets/**'],
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    sortImports: false,
    sortPackageJson: false,
  },
  base: './',
  // The decoder worker is the first importer of `yjs` in dev. Pre-bundling it up front keeps
  // Vite from discovering it mid-run and reloading the page under a running test.
  optimizeDeps: { include: ['yjs'] },
  // The page runtime's compiler is a prebuilt browser script, so the lib build appends it as text
  // instead of bundling it (see src/runtime/entry.ts and scripts/verify-runtime.mjs).
  plugins: [
    react(),
    designTokens(),
    {
      name: 'colab-hosted-entry',
      apply: () => mode === 'hosted',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replace('/src/main.tsx', '/src/hosted-index.tsx'),
      },
    },
    {
      name: 'colab-shared-design-data',
      apply: () => mode === 'module',
      enforce: 'pre',
      resolveId(source) {
        const match = source.match(/\/tmt-gui\/generated\/(pages|template|bundle)\.json$/);
        if (match) return { id: appDataChunk(match[1]), external: true };
      },
    },
    // The Design route's docs (@tmt/browser-ui/docs-embed) read the Ops oracle at build time.
    tuiOracle(),
    {
      // The frame has no `process`, so React must be its production build, fixed at build time.
      // Library builds do not take `define` for this, so it is replaced where it is read.
      name: 'colab-runtime-production',
      apply: () => mode === 'runtime',
      enforce: 'pre',
      transform: {
        filter: { code: 'process.env.NODE_ENV' },
        handler: (code) => ({
          code: code.replaceAll('process.env.NODE_ENV', '"production"'),
          map: null,
        }),
      },
    },
    {
      name: 'colab-runtime-assets',
      apply: () => mode === 'runtime',
      async generateBundle() {
        // The theme is Tailwind source for a `<style type="text/tailwindcss">` block, not compiled
        // CSS; scripts/generate-runtime-theme.mjs writes it from the design tokens.
        this.emitFile({
          type: 'asset',
          fileName: 'assets/colab-runtime.css',
          source: readFileSync(new URL('./src/runtime/theme.css', import.meta.url), 'utf8'),
        });
        // The design system a page frame carries (#5057), for the standalone export of a page that uses
        // it: the same CSS and `tmt-icon` script the renderer inlines, built by one module.
        const { pageUiStyle, pageUiScript } = await (
          await import('../../scripts/page-ui.mjs')
        ).buildPageUi();
        this.emitFile({ type: 'asset', fileName: 'assets/colab-page-ui.css', source: pageUiStyle });
        this.emitFile({ type: 'asset', fileName: 'assets/colab-page-ui.js', source: pageUiScript });
      },
    },
    // The runtime's chunks (#6085): the base carries the prebuilt Tailwind browser compiler as text.
    ...(mode === 'runtime'
      ? [
          runtimeChunksPlugin({
            compiler: readFileSync(
              createRequire(import.meta.url).resolve('@tailwindcss/browser'),
              'utf8',
            ),
          }),
        ]
      : []),
    {
      // Shared-part styles travel in the declaring component's bundle CSS, rather than in every
      // runtime page. The library build also emits those imported CSS files; do not ship that copy.
      name: 'colab-runtime-shared-parts-css',
      apply: () => mode === 'runtime',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const kept = ['assets/colab-runtime.css', 'assets/colab-page-ui.css'];
        const copies = Object.keys(bundle).filter(
          (name) => name.endsWith('.css') && !kept.includes(name),
        );
        for (const name of copies) delete bundle[name];
      },
    },
    {
      name: 'colab-renderer-policy',
      configureServer(server) {
        // Use the native policy owner, avoiding a second dev-only policy copy.
        const source = readFileSync(
          new URL('../../rust/tmt-colab/src/browser_policy.rs', import.meta.url),
          'utf8',
        );
        const policy = source.match(/pub const RENDERER_POLICY: &str = "([^"]+)";/)?.[1];
        if (!policy) throw new Error('Missing native renderer policy');
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split('?')[0] ?? '';
          if (
            path === '/assets/recovery.js' ||
            /^\/r\/[a-z0-9]+\/x\/colab\/assets\/recovery\.js$/.test(path)
          ) {
            request.url = '/src/guidance.ts';
          }
          if (
            path === '/renderer.html' ||
            /^\/r\/[a-z0-9]+\/x\/colab\/renderer\.html$/.test(path)
          ) {
            // Mirror the native exact renderer route for mounted protocol fixtures.
            // Vite otherwise serves the app fallback at this prefix.
            request.url = '/renderer.html';
            response.setHeader('Content-Security-Policy', policy);
            response.setHeader('Referrer-Policy', 'no-referrer');
            response.setHeader('X-Content-Type-Options', 'nosniff');
          }
          next();
        });
      },
    },
  ],
  // `reader` is the public read-only entry: one fixed-name script, stylesheet and decoder worker,
  // so the native server can allowlist exactly these files for unpaired browsers.
  define:
    mode === 'module'
      ? {
          'process.env.NODE_ENV': '"production"',
          // The build this module belongs to, read by src/app-build.ts.
          __COLAB_MODULE_BUILD__: JSON.stringify(moduleBuild()),
        }
      : mode === 'reader'
        ? { 'process.env.NODE_ENV': '"production"' }
        : undefined,
  worker:
    mode === 'reader' || mode === 'module'
      ? {
          format: 'es',
          rollupOptions: { output: { entryFileNames: `assets/${mode}-fold.js` } },
        }
      : undefined,
  build:
    mode === 'recovery'
      ? {
          emptyOutDir: false,
          lib: {
            entry: new URL('./src/guidance.ts', import.meta.url).pathname,
            formats: ['es'],
            fileName: () => 'assets/recovery.js',
          },
        }
      : mode === 'module'
        ? {
            // Colab as a route of the one TMT app: a fixed-name module the app imports from the
            // owner's mount (`assets/colab-module.js`), with its own stylesheet. Minified like the
            // app's own bundle (a library build is not by default): it is the route's first wait.
            emptyOutDir: false,
            copyPublicDir: false,
            minify: true,
            lib: {
              entry: new URL('./src/colab-module.tsx', import.meta.url).pathname,
              formats: ['es'],
              fileName: () => 'assets/colab-module.js',
              cssFileName: 'assets/colab-module',
            },
            // Its lazy routes (Design, #5866) split into chunks. They go under assets/ beside it:
            // the native app inventory admits no script at the build's root.
            rollupOptions: {
              output: { chunkFileNames: 'assets/colab-module-[name]-[hash].js' },
            },
          }
        : mode === 'runtime'
          ? {
              emptyOutDir: false,
              copyPublicDir: false,
              lib: {
                entry: runtimeChunks.entry,
                formats: ['cjs'],
                fileName: (_format, name) => `assets/entry-${name}.js`,
              },
              rollupOptions: {
                preserveEntrySignatures: 'allow-extension',
                output: {
                  minify: true,
                  codeSplitting: {
                    includeDependenciesRecursively: false,
                    groups: runtimeChunks.groups,
                  },
                  chunkFileNames: 'assets/[name]-[hash].js',
                },
              },
            }
          : mode === 'reader'
            ? {
                emptyOutDir: false,
                copyPublicDir: false,
                lib: {
                  entry: new URL('./src/reader-main.tsx', import.meta.url).pathname,
                  formats: ['es'],
                  fileName: () => 'assets/reader.js',
                  cssFileName: 'assets/reader',
                },
                // The native allowlist serves the reader one fixed script, so its lazy imports
                // (the Design docs chrome, #6272) stay inside it rather than split into chunks.
                rollupOptions: { output: { codeSplitting: false } },
              }
            : { license: { fileName: 'THIRD-PARTY-NOTICES.txt' } },
}));

import { defineConfig } from 'vite-plus';
import { renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The docs site as one embeddable document (#5866): `assets/design-docs.html` and its hashed
// assets, written into the Colab app build so Colab's Design route can frame it. Everything sits
// in one flat directory because the Colab serve admits only flat `assets/*` files; the docs route
// by hash there (docs/router.ts). DOCS_EMBED_OUT names that directory.
const named = process.env.DOCS_EMBED_OUT;
if (!named) throw new Error('DOCS_EMBED_OUT must name the output directory');
const out = resolve(process.cwd(), named);
export default defineConfig({
  root: fileURLToPath(new URL('./docs/', import.meta.url)),
  base: './',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'design-docs-entry',
      // The HTML is written last, so it is renamed on disk once the bundle is out.
      enforce: 'post',
      writeBundle() {
        renameSync(join(out, 'index.html'), join(out, 'design-docs.html'));
      },
    },
  ],
  build: {
    outDir: out,
    emptyOutDir: false,
    assetsDir: '.',
    rollupOptions: {
      output: {
        entryFileNames: 'design-docs-[hash].js',
        chunkFileNames: 'design-docs-[hash].js',
        assetFileNames: 'design-docs-[hash][extname]',
      },
    },
  },
});

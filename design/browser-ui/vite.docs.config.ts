import { defineConfig } from 'vite-plus';
import { fileURLToPath } from 'node:url';
import { tuiOracle } from './docs/tui/oracle-module.mjs';

// The design-system docs and mockups on the development server (#5821): `vp dev --config
// vite.docs.config.ts`, on one fixed local URL, http://127.0.0.1:5100/. Products host the docs through
// `docs/embed.tsx` (export `./docs-embed`) with the `./docs-oracle` plugin, not through this config.
export default defineConfig({
  root: fileURLToPath(new URL('./docs/', import.meta.url)),
  appType: 'spa',
  plugins: [tuiOracle()],
  server: {
    host: '127.0.0.1',
    port: 5100,
    strictPort: true,
    watch: { usePolling: true, interval: 250 },
    fs: { allow: [fileURLToPath(new URL('../', import.meta.url))] },
  },
});

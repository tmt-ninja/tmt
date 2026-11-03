import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

// The dev server has no built page runtime. Build it once per worker, the way the app builds it,
// so a spec that renders a runtime page never depends on a leftover `dist/`.
let built: { js: string; css: string } | undefined;
function pageRuntime() {
  if (built) return built;
  const output = mkdtempSync(join(tmpdir(), 'tmt-page-runtime-'));
  process.once('exit', () => rmSync(output, { recursive: true, force: true }));
  execFileSync('./node_modules/.bin/vp', ['build', '--mode', 'runtime', '--outDir', output], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'pipe',
  });
  built = {
    js: readFileSync(join(output, 'assets/colab-runtime.js'), 'utf8'),
    css: readFileSync(join(output, 'assets/colab-runtime.css'), 'utf8'),
  };
  return built;
}

/** Serve the built page runtime to the frame's `assets/colab-runtime.{js,css}` requests. */
export async function servePageRuntime(page: Page) {
  const { js, css } = pageRuntime();
  await page.route('**/assets/colab-runtime.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: js }),
  );
  await page.route('**/assets/colab-runtime.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: css }),
  );
}

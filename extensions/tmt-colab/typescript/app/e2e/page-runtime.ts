import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import vector from '../../../contracts/vectors/page-runtime-chunks-v1.json' with { type: 'json' };

// The dev server has no built page runtime. Build it once per worker, the way the app builds it,
// so a spec that renders a runtime page never depends on a leftover `dist/`. The app takes the
// chunks' names and hashes from runtime-pin.json, so a stale pin fails here as it would in the app.
let built: Map<string, string> | undefined;
let terminal: { name: string; bytes: Buffer } | undefined;
/** Every built runtime file (the theme and each chunk, #6085), by its file name under assets/. */
export function pageRuntimeFiles() {
  if (built) return built;
  const output = mkdtempSync(join(tmpdir(), 'tmt-page-runtime-'));
  process.once('exit', () => rmSync(output, { recursive: true, force: true }));
  execFileSync('./node_modules/.bin/vp', ['build', '--mode', 'runtime', '--outDir', output], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'pipe',
  });
  const files = readdirSync(join(output, 'assets'));
  const terminalName = files.find((name) =>
    /^colab-runtime-terminal-[0-9a-f]{16}\.wasm$/.test(name),
  );
  if (terminalName)
    terminal = { name: terminalName, bytes: readFileSync(join(output, 'assets', terminalName)) };
  built = new Map(
    files
      .filter((name) => name.startsWith('colab-runtime') && !name.endsWith('.wasm'))
      .map((name) => [name, readFileSync(join(output, 'assets', name), 'utf8')]),
  );
  return built;
}
/** The built chunk's text by its vector name. */
export function pageRuntimeChunk(name: string) {
  const file = [...pageRuntimeFiles()].find(([file]) =>
    new RegExp(`^colab-runtime-${name}-[0-9a-f]{16}\\.js$`).test(file),
  );
  if (!file) throw new Error(`No built ${name} chunk`);
  return file[1];
}

/**
 * What a standalone copy inlines: every built chunk in vector (load) order, then the seal, as the
 * export assembles it (#6085). `files` maps a file name under assets/ to its text.
 */
export function sealedRuntimeScript(files: ReadonlyMap<string, string> = pageRuntimeFiles()) {
  const texts = vector.chunks
    .filter(
      (chunk) =>
        !('reserved' in chunk && chunk.reserved) && !('kind' in chunk && chunk.kind === 'wasm'),
    )
    .map((chunk) => {
      const found = [...files].filter(([file]) => chunkName(file) === chunk.name);
      if (found.length !== 1) throw new Error(`No single built ${chunk.name} chunk`);
      return found[0]![1];
    });
  return `${texts.join('\n')}\nwindow.__colabRuntimeSeal?.();`;
}

/** The vector name of a chunk file, or the file name itself for the theme. */
const chunkName = (file: string) => /^colab-runtime-(.+)-[0-9a-f]{16}\.js$/.exec(file)?.[1] ?? file;

/**
 * Serve the built page runtime to the frame's `assets/colab-runtime*` requests. Returns the
 * requests in order, by chunk name (the theme by its file name); `fail` answers one chunk with 500.
 */
export async function servePageRuntime(page: Page, { fail }: { fail?: string } = {}) {
  const files = pageRuntimeFiles();
  const fetched: string[] = [];
  await page.route('**/assets/colab-runtime*', (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\//, '');
    fetched.push(chunkName(name));
    const body = name === terminal?.name ? terminal.bytes : files.get(name);
    if (body === undefined) return route.fulfill({ status: 404 });
    if (chunkName(name) === fail) return route.fulfill({ status: 500 });
    return route.fulfill({
      contentType: name.endsWith('.wasm')
        ? 'application/wasm'
        : name.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
      body,
    });
  });
  return fetched;
}

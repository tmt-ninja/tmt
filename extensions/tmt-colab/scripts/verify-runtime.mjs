// Checks the built page runtime against its reviewed pin (#1693), the way the Remote Firebase build
// is pinned: exact bytes and versions, so a changed dependency or build output is a reviewed diff.
// Usage: node verify-runtime.mjs <app dist directory> [--update]
//   --update  rewrites app/runtime-pin.json from the build, for a deliberate dependency change.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A chunk's raw bytes: the bound the frame enforces on each script it is handed at bind (#6085).
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_THEME_BYTES = 16 * 1024;
const app = new URL('../typescript/app/', import.meta.url).pathname;
const [directory, flag] = process.argv.slice(2);
if (!directory) throw new Error('usage: verify-runtime.mjs <dist directory> [--update]');

const read = (path) => readFileSync(path, 'utf8');
const manifest = JSON.parse(read(join(app, 'package.json')));
const installed = (name) => JSON.parse(read(join(app, 'node_modules', name, 'package.json'))).version;
const packages = Object.fromEntries(
  ['react', 'react-dom', 'htm', '@tailwindcss/browser', 'lucide-react'].map((name) => [name, installed(name)]),
);
const { builtChunks, chunkVector, gzipLength } = await import('./runtime-chunks.mjs');
const assets = readdirSync(join(directory, 'assets'));
const themeBytes = readFileSync(join(directory, 'assets/colab-runtime.css'));
const hash = (content) => createHash('sha256').update(content).digest('hex');
// One file per built chunk, in vector order: the parent loads a page's chunks in this order.
const chunks = builtChunks.map(({ name }) => {
  const found = assets.filter((file) => new RegExp(`^colab-runtime-${name}-[0-9a-f]{16}\\.js$`).test(file));
  if (found.length !== 1) throw new Error(`expected one ${name} chunk, found ${found.length}`);
  const bytes = readFileSync(join(directory, 'assets', found[0]));
  return {
    name,
    path: `assets/${found[0]}`,
    sha256: hash(bytes),
    length: bytes.length,
    gzip: gzipLength(bytes),
    bytes,
  };
});
const built = {
  version: 2,
  packages,
  chunks: chunks.map(({ bytes: _bytes, ...chunk }) => chunk),
  theme: { path: 'assets/colab-runtime.css', sha256: hash(themeBytes), length: themeBytes.length },
};

const pinPath = join(app, 'runtime-pin.json');
if (flag === '--update') {
  writeFileSync(pinPath, `${JSON.stringify(built, null, 2)}\n`);
  console.log('runtime-pin.json updated');
  process.exit(0);
}

const failures = [];
const expect = (ok, message) => ok || failures.push(message);
const pin = JSON.parse(read(pinPath));
for (const [name, version] of Object.entries(packages)) {
  const declared = manifest.dependencies[name];
  expect(declared === version, `${name}: package.json says ${declared}, installed ${version}`);
  expect(pin.packages[name] === version, `${name}: pin says ${pin.packages[name]}, installed ${version}`);
}
expect(JSON.stringify(pin.chunks) === JSON.stringify(built.chunks), 'runtime chunks differ from runtime-pin.json');
expect(JSON.stringify(pin.theme) === JSON.stringify(built.theme), 'runtime theme differs from runtime-pin.json');
const stray = assets.filter((file) => /^(colab-runtime[-.].*\.js|entry-.*\.js)$/.test(file) && !chunks.some((chunk) => chunk.path === `assets/${file}`));
expect(stray.length === 0, `unpinned runtime scripts: ${stray.join(', ')}`);
// The budget is gzip -9 of every chunk together; each chunk also has its own vector cap.
const total = chunks.reduce((sum, chunk) => sum + chunk.gzip, 0);
expect(total <= chunkVector.gzipBudget, `runtime is ${total} gzip bytes, over ${chunkVector.gzipBudget}`);
for (const chunk of chunks) {
  const cap = chunkVector.chunks.find((entry) => entry.name === chunk.name).gzipCap;
  expect(chunk.gzip <= cap, `${chunk.name} is ${chunk.gzip} gzip bytes, over its ${cap}`);
  expect(chunk.length <= MAX_CHUNK_BYTES, `${chunk.name} is ${chunk.length} bytes, over ${MAX_CHUNK_BYTES}`);
  const text = chunk.bytes.toString('utf8');
  // The frame injects each chunk as an inline script: it must not close its own tag, must not need
  // `process`, must not load a source map, and must not need eval (the frame has no unsafe-eval).
  expect(!text.toLowerCase().includes('</script'), `${chunk.name}: contains a script end tag`);
  expect(!text.includes('<' + '!--'), `${chunk.name}: contains an HTML comment opener`);
  expect(!text.includes('process.env'), `${chunk.name}: reads process.env`);
  expect(!text.includes('sourceMappingURL'), `${chunk.name}: references a source map`);
  expect(!/\beval\s*\(/.test(text) && !text.includes('new Function('), `${chunk.name}: uses eval or new Function`);
}
// The theme goes into a `<style type="text/tailwindcss">` block: an `@import` there makes the
// browser build skip its own default import of Tailwind, and `</style` would end the block.
const theme = themeBytes.toString('utf8');
expect(themeBytes.length <= MAX_THEME_BYTES, `theme is ${themeBytes.length} bytes, over ${MAX_THEME_BYTES}`);
expect(!theme.includes('@import'), 'theme contains @import');
expect(!theme.toLowerCase().includes('</style'), 'theme contains a style end tag');
expect(!theme.includes('<' + '!--'), 'theme contains an HTML comment opener');
// The design system a standalone export carries (#5057) is first-party generated output, not a pinned
// dependency: it must be exactly what the renderer inlines and fit the same cap.
const { buildPageUi, PAGE_UI_LIMIT } = await import('./page-ui.mjs');
const { pageUiStyle, pageUiScript } = await buildPageUi();
const pageUiCss = read(join(directory, 'assets/colab-page-ui.css'));
const pageUiJs = read(join(directory, 'assets/colab-page-ui.js'));
expect(pageUiCss === pageUiStyle, 'colab-page-ui.css differs from the renderer design system');
expect(pageUiJs === pageUiScript, 'colab-page-ui.js differs from the renderer tmt-icon script');
expect(Buffer.byteLength(pageUiCss) <= PAGE_UI_LIMIT, 'colab-page-ui.css is over its cap');
for (const [name, text, end] of [
  ['colab-page-ui.css', pageUiCss, '</style'],
  ['colab-page-ui.js', pageUiJs, '</script'],
]) {
  expect(!text.toLowerCase().includes(end), `${name} contains an element end tag`);
  expect(!text.includes('<' + '!--'), `${name} contains an HTML comment opener`);
}
const notices = read(join(directory, 'THIRD-PARTY-NOTICES.txt'));
for (const name of Object.keys(packages))
  expect(notices.includes(`\n## ${name} - ${packages[name]} (`), `notices lack ${name} ${packages[name]}`);

if (failures.length) {
  console.error(`Page runtime check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `page runtime ok: ${chunks.map((chunk) => `${chunk.name} ${chunk.length}/${chunk.gzip}`).join(', ')} (raw/gzip); total gzip ${total}; theme ${themeBytes.length} bytes`,
);

// The page runtime's chunks (#6085): which modules each chunk owns, and the build step that turns
// the bundler's CommonJS chunks into the classic scripts the renderer frame runs. The frame has no
// network and no module loader, so each chunk defines its modules into a small registry that the
// base installs, and the parent sends a page the base plus the chunks it needs, in vector order.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const vectorUrl = new URL('../contracts/vectors/page-runtime-chunks-v1.json', import.meta.url);
/** The versioned chunk list the build and the parent share. */
export const chunkVector = JSON.parse(readFileSync(vectorUrl, 'utf8'));
/** The chunks that ship bytes now, in vector (load) order. */
export const builtChunks = chunkVector.chunks.filter((chunk) => !chunk.reserved && chunk.kind !== 'wasm');
/** The only binary chunk is built by the renderer owner, not by the app bundler. */
export const wasmChunk = chunkVector.chunks.find((chunk) => chunk.kind === 'wasm');

/** Which chunk owns a module, by its resolved path. The first match wins; everything else is base.
 * A module that a lower chunk needs belongs to that lower chunk (the build refuses an upward edge). */
const owners = [
  ['docs', /\/browser-ui\/(docs|gallery)\/|\/src\/runtime\/chunks\/docs\.ts$/],
  ['rich-input', /\/lexical|\/@lexical\/|\/browser-ui\/src\/rich-input\/|\/src\/runtime\/chunks\/rich-input\.ts$/],
  ['blocks', /\/browser-ui\/src\/(blocks|data-table)\/|\/src\/runtime\/chunks\/blocks\.ts$/],
  [
    'ui',
    /\/browser-ui\/src\/(ui\/|overlay\.ts$|scoped-modal\.ts$|trusted-activation\.ts$)|radix|floating-ui|cmdk|tailwind-merge|clsx|class-variance-authority|aria-hidden|react-remove-scroll|react-style-singleton|use-callback-ref|use-sidecar|get-nonce|detect-node-es|tslib|\/src\/runtime\/chunks\/ui\.ts$|\/src\/runtime\/terminal-frame\.ts$|\/terminal-frame-assets\/tmt_tui_wasm\.js$/,
  ],
  ['browser', /\/browser-ui\/src\/|\/src\/runtime\/chunks\/browser\.ts$/],
  // React and what `window.tmt` publishes with it (#6077): the base carries no React. The bundler's
  // CommonJS interop runtime goes with it, as React is the first CommonJS the chunks load.
  [
    'react',
    /\/node_modules\/(react|react-dom|scheduler|htm|lucide-react)\/|\/src\/runtime\/(chunks\/react|icons|ds-scope)\.ts$|^\0?rolldown\/runtime\.js$/,
  ],
];
export const chunkOf = (id) => owners.find(([, test]) => test.test(id))?.[0] ?? 'base';

/** A chunk and every chunk it comes after, transitively. */
export function closure(name) {
  const byName = new Map(chunkVector.chunks.map((chunk) => [chunk.name, chunk]));
  const out = new Set();
  const visit = (current) => {
    if (out.has(current)) return;
    out.add(current);
    for (const next of byName.get(current)?.after ?? []) visit(next);
  };
  visit(name);
  return out;
}

/** The bundler options for the runtime build: one entry per chunk, CommonJS chunks grouped by owner. */
export function runtimeBuildOptions(appRoot) {
  return {
    entry: Object.fromEntries(builtChunks.map((chunk) => [chunk.name, new URL(chunk.entry, appRoot).pathname])),
    groups: [...owners.map(([name]) => name), 'base'].map((name, index) => ({
      name,
      test: (id) => chunkOf(id) === name,
      priority: 100 - index,
    })),
  };
}

// Installed by the base script before any module: chunks define modules by file name, and a
// module runs once, on its first require. The base entry's seal removes both globals.
const loader =
  '(()=>{const d=Object.create(null),c=Object.create(null);' +
  'const r=(id)=>{id=id.replace(/^\\.\\//,"");if(c[id])return c[id].exports;const f=d[id];' +
  'if(!f)throw new Error("Missing page runtime module "+id);const m={exports:{}};c[id]=m;f(r,m.exports,m);return m.exports};' +
  'self.__colabDefine=(id,f)=>{if(!(id in d))d[id]=f};self.__colabRequire=r;})();\n';

export const gzipLength = (bytes) => gzipSync(bytes, { level: 9 }).length;
const digest = (text) => createHash('sha256').update(text).digest('hex');

/** The published file name of a chunk: content-hashed, so the hosts can cache it as immutable. */
export const chunkFileName = (name, text) => `assets/colab-runtime-${name}-${digest(text).slice(0, 16)}.js`;

/**
 * Rewrites the CommonJS output into one classic script per chunk. It refuses a module that imports
 * a chunk its own chunk does not come after, and output it cannot place. `compiler` is the Tailwind
 * browser compiler, which the base carries as text after its modules.
 */
export function runtimeChunksPlugin({ compiler }) {
  return {
    name: 'colab-runtime-chunks',
    generateBundle(_options, bundle) {
      const upward = [];
      for (const id of this.getModuleIds()) {
        const owner = chunkOf(id);
        const allowed = closure(owner);
        for (const dep of this.getModuleInfo(id)?.importedIds ?? [])
          if (!allowed.has(chunkOf(dep))) upward.push(`${owner}: ${id} imports ${dep} (${chunkOf(dep)})`);
      }
      if (upward.length) throw new Error(`Page runtime chunks import upward:\n${upward.join('\n')}`);
      const files = new Map(builtChunks.map((chunk) => [chunk.name, []]));
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        const owners = new Set(output.moduleIds.map(chunkOf));
        const name = output.isEntry ? output.name : owners.size ? [...owners][0] : 'base';
        if (owners.size > 1 || !files.has(name))
          throw new Error(`Page runtime output ${fileName} mixes or misses chunks: ${[...owners]}`);
        const id = fileName.replace(/^.*\//, '');
        files.get(name).push(`__colabDefine(${JSON.stringify(id)},function(require,exports,module){${output.code}\n});`);
        if (output.isEntry) files.get(name).entry = id;
        delete bundle[fileName];
      }
      const wasm = readFileSync(new URL('../typescript/app/terminal-frame-assets/tmt_tui_wasm_bg.wasm', import.meta.url));
      this.emitFile({ type: 'asset', fileName: `assets/colab-runtime-terminal-${digest(wasm).slice(0, 16)}.wasm`, source: wasm });
      for (const chunk of builtChunks) {
        const list = files.get(chunk.name);
        if (!list.entry) throw new Error(`Page runtime chunk ${chunk.name} has no entry`);
        const body = `${chunk.name === 'base' ? loader : ''}${list.join('\n')}\n__colabRequire(${JSON.stringify(list.entry)});\n${
          chunk.name === 'base' ? compiler : ''
        }`;
        this.emitFile({ type: 'asset', fileName: chunkFileName(chunk.name, body), source: body });
      }
    },
  };
}

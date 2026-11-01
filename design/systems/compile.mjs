// Compiles a design system's component docs (schema 1) into its release bundle and the product's
// module and types (#5821, Colab baea16b8). `--write` regenerates, `--check` fails on drift.
//
//   node design/systems/compile.mjs --write|--check [system-dir ...]
//
// Outputs, per system directory:
//   dist/sha256-<hex>.json   the immutable bundle a page pins: tokens and every component's props,
//                            slots, CSS and code (a function body that returns the factory); the
//                            skeleton that runs it ships with each surface, not in the bundle
//   generated/<tag>.mjs      the component source as an ES module, for the product build
//   generated/index.d.ts     prop types generated from each props schema
//   generated/style.css      the components' CSS, for the product build
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 1;
/** The skeleton API a bundle may use (runtime 2): the page runtime's React and htm, plus cn. */
const RUNTIME = '2';
const SKELETON = ['React', 'html', 'cn'];
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode)) {
  console.error('usage: compile.mjs --write|--check [system-dir ...]');
  process.exit(2);
}
const systems = process.argv.slice(3).length
  ? process.argv.slice(3)
  : readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(here, entry.name, 'system.json')))
      .map((entry) => join(here, entry.name));

const fail = (message) => {
  throw new Error(message);
};
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
/** A newer schema needs a newer reader; an older one has no conversion yet. */
const schemaOf = (doc, path) => {
  if (doc.schema > SCHEMA) fail(`${path}: schema ${doc.schema} needs a newer TMT`);
  if (doc.schema !== SCHEMA) fail(`${path}: schema ${doc.schema} is not ${SCHEMA}`);
};

/** The token blocks of the generated static.css: everything before the first class rule. */
function tokensCss() {
  const css = readFileSync(join(repo, 'design/browser-ui/generated/static.css'), 'utf8');
  const end = css.search(/^@media \(max-width: 760px\)/m);
  if (end < 0) fail('static.css: the token blocks end marker moved');
  return css.slice(0, end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

/** A component source is one `export default <factory>` with no imports and no outside reach. */
function checkSource(source, path) {
  if (!/^export default /m.test(source)) fail(`${path}: needs one export default`);
  if ((source.match(/export\s/g) ?? []).length !== 1) fail(`${path}: exports only its default`);
  for (const banned of ['import', 'require', 'fetch', 'XMLHttpRequest', 'eval', 'Function', 'window', 'document', 'globalThis'])
    if (new RegExp(`\\b${banned}\\b`).test(source.replace(/\/\/.*$/gm, '')))
      fail(`${path}: uses ${banned}; a component reads only the skeleton (${SKELETON.join(', ')})`);
  if (/<!--|<\/script/i.test(source)) fail(`${path}: may not contain <!-- or </script`);
}

function propType(spec) {
  if (spec.enum) return spec.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (spec.type === 'boolean') return 'boolean';
  if (spec.type === 'string') return 'string';
  return fail(`unknown prop spec ${JSON.stringify(spec)}`);
}
const pascal = (tag) => tag.replace(/(^|-)([a-z])/g, (_, __, letter) => letter.toUpperCase());

function compile(dir) {
  const systemPath = join(dir, 'system.json');
  const system = readJson(systemPath);
  schemaOf(system, systemPath);
  if (system.kind !== 'design-system') fail(`${systemPath}: kind is not design-system`);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(system.prefix)) fail(`${systemPath}: bad prefix`);
  if (system.runtime !== RUNTIME) fail(`${systemPath}: runtime ${system.runtime} is not ${RUNTIME}`);
  const release = system.releases.at(-1);
  const components = system.components.map(({ doc }) => {
    const path = join(dir, doc);
    const component = readJson(path);
    schemaOf(component, path);
    if (component.kind !== 'component') fail(`${path}: kind is not component`);
    if (!/^[a-z][a-z0-9-]*$/.test(component.tag)) fail(`${path}: bad tag`);
    const source = readFileSync(join(dirname(path), component.source), 'utf8');
    checkSource(source, component.source);
    for (const [name, spec] of Object.entries(component.props)) {
      propType(spec);
      if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`${path}: prop ${name} is not an attribute name`);
      if (spec.default !== undefined && spec.enum && !spec.enum.includes(spec.default))
        fail(`${path}: ${name} default is outside its enum`);
    }
    return {
      tag: `${system.prefix}-${component.tag}`,
      name: component.tag,
      props: component.props,
      slots: component.slots,
      examples: component.examples,
      css: readFileSync(join(dirname(path), component.css), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      source,
      code: source.replace(/^export default /m, 'return '),
    };
  });
  const tokens = tokensCss();
  const css = components.map((component) => component.css).join('\n');
  if (/<!--|<\/style/i.test(tokens + css)) fail('CSS may not contain <!-- or </style');
  const body = {
    schema: SCHEMA,
    system: system.id,
    name: system.name,
    version: release.version,
    runtime: RUNTIME,
    prefix: system.prefix,
    tokensCss: tokens,
    components: components.map(({ tag, props, slots, css: rules, code }) => ({
      tag,
      props,
      slots,
      css: rules,
      code,
    })),
  };
  const hash = `sha256-${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  const bundle = `${JSON.stringify({ ...body, hash }, null, 1)}\n`;
  const files = new Map([
    [`dist/${hash}.json`, bundle],
    ['generated/style.css', `/* Generated by design/systems/compile.mjs from ${relative(repo, dir)}; do not edit. */\n${css}\n`],
    ['generated/release.json', `${JSON.stringify({ system: system.id, version: release.version, runtime: RUNTIME, prefix: system.prefix, hash }, null, 2)}\n`],
    [
      'generated/index.d.ts',
      `// Generated by design/systems/compile.mjs from ${relative(repo, dir)}; do not edit.\nimport type { ReactNode } from 'react';\n\n${components
        .map(
          (c) =>
            `/** <${c.tag}>: props from its schema, slots as nodes. */\nexport interface ${pascal(c.name)}Props {\n${Object.entries(c.props)
              .map(([name, spec]) => `  ${name.includes('-') ? JSON.stringify(name) : name}?: ${propType(spec)};`)
              .join('\n')}\n${c.slots
              .map((slot) => `  ${slot === 'default' ? 'children' : slot}?: ReactNode;`)
              .join('\n')}\n}\n`,
        )
        .join('\n')}`,
    ],
    ...components.map((c) => [
      `generated/${c.name}.mjs`,
      `// Generated by design/systems/compile.mjs from ${relative(repo, dir)}; do not edit.\n${c.source}`,
    ]),
  ]);
  let drift = [];
  const distDir = join(dir, 'dist');
  const stale = existsSync(distDir)
    ? readdirSync(distDir).filter((name) => `dist/${name}` !== `dist/${hash}.json`)
    : [];
  for (const [name, text] of files) {
    const path = join(dir, name);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === text) continue;
    if (mode === '--check') drift.push(name);
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  }
  if (mode === '--check') drift.push(...stale.map((name) => `dist/${name} (stale)`));
  else for (const name of stale) rmSync(join(distDir, name));
  if (drift.length) fail(`${relative(repo, dir)}: out of date: ${drift.join(', ')}; run --write`);
  console.log(`${relative(repo, dir)}: ${system.id}@${release.version}#${hash}`);
}

let failed = false;
for (const dir of systems) {
  try {
    compile(dir);
  } catch (error) {
    failed = true;
    console.error(error.message);
  }
}
process.exit(failed ? 1 : 0);

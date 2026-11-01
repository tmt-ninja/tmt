import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vite-plus/test';
import { imports } from '../support/source-imports.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const home = path.join(root, 'design/browser-ui');
const production = path.join(home, 'src');
function forbiddenLoads(file: string, text: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let forbidden = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))
    )
      forbidden = true;
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL'
    )
      forbidden = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return forbidden;
}
// Each directory export (`./src/<dir>/index.ts` in package.json "exports") is its own graph. The
// set of graphs comes from the exports; each one's admitted packages are listed here explicitly.
// Any other module is the root graph, which admits React only; static.ts admits nothing.
const UI_PACKAGES = [
  'react',
  'lucide-react',
  'clsx',
  'tailwind-merge',
  'radix-ui',
  'cmdk',
  'class-variance-authority',
];
const GRAPH_POLICIES: Record<string, { packages: string[]; graphs?: string[] }> = {
  './ui': { packages: UI_PACKAGES },
  './rich-input': {
    packages: [
      'react',
      'lucide-react',
      'lexical',
      '@lexical/react',
      '@lexical/plain-text',
      '@lexical/history',
    ],
  },
  './data-table': { packages: ['react', 'lucide-react'], graphs: ['./ui'] },
};
// Modules with no edges at all, which every graph may import.
const NEUTRAL = ['overlay.ts'];
const packageExports = JSON.parse(readFileSync(path.join(home, 'package.json'), 'utf8'))
  .exports as Record<string, string>;
const directoryExports = Object.entries(packageExports).flatMap(([name, target]) => {
  const match = /^\.\/src\/([^/]+)\/index\.ts$/.exec(target);
  return match ? [{ name, directory: match[1]! }] : [];
});
interface Graph {
  directory: string;
  packages: string[];
  graphs: string[];
}
function graphsOf(sourceRoot: string): Graph[] {
  return directoryExports.map(({ name, directory }) => ({
    directory: path.join(sourceRoot, directory),
    packages: GRAPH_POLICIES[name]?.packages ?? [],
    graphs: (GRAPH_POLICIES[name]?.graphs ?? []).map((other) =>
      path.join(sourceRoot, directoryExports.find((entry) => entry.name === other)!.directory)
    ),
  }));
}
const inside = (file: string, directory: string) => file.startsWith(`${directory}/`);
const packageOf = (edge: string) =>
  edge
    .split('/')
    .slice(0, edge.startsWith('@') ? 2 : 1)
    .join('/');
function violations(
  file: string,
  source: string,
  staticEntry: boolean,
  options: ts.CompilerOptions = {},
  sourceRoot = production
): string[] {
  const failures: string[] = [];
  const graphs = graphsOf(sourceRoot);
  const graph = graphs.find((candidate) => inside(file, candidate.directory));
  const uiGraph = graph?.directory === path.join(sourceRoot, 'ui');
  const neutral = NEUTRAL.map((name) => path.join(sourceRoot, name));
  const shellPortal = file === path.join(sourceRoot, 'browser-shell.tsx');
  // The root graph and ui/ admit exact peers; another declared graph admits its packages' subpaths.
  const admittedPeers = uiGraph
    ? ['react/jsx-runtime', ...UI_PACKAGES]
    : graph
      ? undefined
      : ['react', 'react/jsx-runtime', 'lucide-react'];
  const admittedPackages = graph
    ? [...graph.packages, ...(graph.packages.includes('react') ? ['@types/react'] : [])]
    : ['react', '@types/react', 'lucide-react'];
  if (shellPortal) {
    admittedPeers!.push('react-dom');
    admittedPackages.push('react-dom', '@types/react-dom');
  }
  if (forbiddenLoads(file, source)) failures.push('unproved runtime input');
  for (const edge of imports(file, source)) {
    if (!edge.startsWith('.') && !edge.startsWith('/')) {
      const resolved = ts.resolveModuleName(
        edge,
        file,
        { moduleResolution: ts.ModuleResolutionKind.Bundler, ...options },
        ts.sys
      ).resolvedModule;
      const named = admittedPeers
        ? admittedPeers.includes(edge)
        : graph!.packages.includes(packageOf(edge));
      if (
        staticEntry ||
        neutral.includes(file) ||
        !named ||
        !resolved?.isExternalLibraryImport ||
        !admittedPackages.includes(resolved.packageId?.name ?? '')
      )
        failures.push(edge);
      continue;
    }
    // A declared graph other than ui/ keeps its own stylesheet import inside its directory.
    if (graph && !uiGraph && edge.endsWith('.css')) {
      if (!inside(path.resolve(path.dirname(file), edge), graph.directory)) failures.push(edge);
      continue;
    }
    const target = ts.resolveModuleName(
      edge,
      file,
      { moduleResolution: ts.ModuleResolutionKind.Bundler, ...options },
      ts.sys
    ).resolvedModule?.resolvedFileName;
    const reachable = graph
      ? [graph.directory, ...graph.graphs].some((directory) => target && inside(target, directory))
      : !graphs.some((other) => target && inside(target, other.directory));
    if (
      !target ||
      !inside(target, sourceRoot) ||
      neutral.includes(file) ||
      (!reachable && !neutral.includes(target)) ||
      (staticEntry && target !== path.join(sourceRoot, 'static.ts'))
    )
      failures.push(edge);
  }
  return failures;
}
function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? productionFiles(file) : [file];
  });
}
function productionViolations(directory: string): string[] {
  const failures: string[] = [];
  for (const file of productionFiles(directory)) {
    if (!/\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.css')) continue;
    const source = readFileSync(file, 'utf8');
    if (/\.[cm]?[jt]sx?$/.test(file))
      failures.push(
        ...violations(file, source, file === path.join(directory, 'static.ts'), {}, directory).map(
          (edge) => `${path.relative(directory, file)}: ${edge}`
        )
      );
    if (file.endsWith('.css') && /@import\b|\burl\s*\(/i.test(source))
      failures.push(`${path.relative(directory, file)}: external CSS input`);
  }
  return failures;
}
it('protects production and the React-free static graph', () => {
  expect(productionViolations(production)).toEqual([]);
});
it('gives every directory export its own policy, and only those exports', () => {
  expect(directoryExports.map((entry) => entry.name).sort()).toEqual(
    Object.keys(GRAPH_POLICIES).sort()
  );
  for (const name of NEUTRAL) {
    const file = path.join(production, name);
    expect(imports(file, readFileSync(file, 'utf8'))).toEqual([]);
  }
});
it('keeps each declared graph to its own packages, stylesheet and admitted graphs', () => {
  const rich = path.join(production, 'rich-input/rich-input.tsx');
  const table = path.join(production, 'data-table/data-table.tsx');
  const floating = path.join(production, 'ui/floating.tsx');
  const legacy = path.join(production, 'header.tsx');
  const statics = path.join(production, 'static.ts');
  const lexical =
    "import { $getRoot } from 'lexical'; import '@lexical/react/LexicalComposerContext';";
  expect(violations(rich, `${lexical} import './rich-input.css';`, false)).toEqual([]);
  // The root graph stays free of an entry's packages, and the static graph of React itself.
  expect(violations(legacy, lexical, false)).toEqual([
    'lexical',
    '@lexical/react/LexicalComposerContext',
  ]);
  for (const peer of ['react', 'react/jsx-runtime'])
    expect(violations(statics, `import value from '${peer}';`, true)).toEqual([peer]);
  expect(violations(table, "import { $getRoot } from 'lexical';", false)).toEqual(['lexical']);
  expect(violations(table, "import { Button } from '../ui/index.js';", false)).toEqual([]);
  expect(violations(rich, "import { Button } from '../ui/index.js';", false)).toEqual([
    '../ui/index.js',
  ]);
  // A stylesheet stays inside its own entry; the root graph imports none.
  expect(violations(table, "import '../rich-input/rich-input.css';", false)).toEqual([
    '../rich-input/rich-input.css',
  ]);
  expect(violations(legacy, "import './data-table/data-table.css';", false)).toEqual([
    './data-table/data-table.css',
  ]);
  // Root modules do not reach into an entry; the edge-free overlay helper is open to every graph.
  expect(violations(legacy, "export * from './rich-input/index.js';", false)).toEqual([
    './rich-input/index.js',
  ]);
  for (const file of [legacy, table, floating]) {
    const edge = path.relative(path.dirname(file), path.join(production, 'overlay.js'));
    const source = `import { admitsOverlayEscape } from '${edge.startsWith('.') ? edge : `./${edge}`}';`;
    expect(violations(file, source, false)).toEqual([]);
  }
  expect(violations(floating, "import { Chips } from '../chips.js';", false)).toEqual([
    '../chips.js',
  ]);
  expect(violations(path.join(production, 'overlay.ts'), "import './chips.js';", false)).toEqual([
    './chips.js',
  ]);
});
it('keeps the search entry free of every import', () => {
  const file = path.join(production, 'search.ts');
  expect(imports(file, readFileSync(file, 'utf8'))).toEqual([]);
  expect(imports(file, "import type { ReactNode } from 'react';")).toEqual(['react']);
});

it('admits the bare portal peer only in the exact shell React adapter', () => {
  const file = path.join(production, 'browser-shell.tsx');
  const source = "import {createPortal} from 'react-dom';";
  expect(violations(file, source, false)).toEqual([]);
  for (const other of [
    'header.tsx',
    'nested/browser-shell.tsx',
    'ui/browser-shell.tsx',
    'shell.ts',
    'static.ts',
  ]) {
    expect(violations(path.join(production, other), source, other === 'static.ts')).toEqual([
      'react-dom',
    ]);
    expect(
      violations(path.join(production, other), "export {createPortal} from 'react-dom';", false)
    ).toEqual(['react-dom']);
  }
  for (const peer of ['react-dom/client', 'react-dom/server'])
    expect(violations(file, `import value from '${peer}';`, false)).toEqual([peer]);
  expect(violations(file, source, true)).toEqual(['react-dom']);
  expect(
    violations(file, source, false, {
      baseUrl: root,
      paths: { 'react-dom': ['extensions/tmt-colab/typescript/app/src/colab-header.tsx'] },
    })
  ).toEqual(['react-dom']);
  expect(violations(file, "import('react-' + name);", false)).toContain('unproved runtime input');
  expect(violations(file, 'new URL(target);', false)).toContain('unproved runtime input');
});
it('inspects nested local modules and CSS independently of the admitted first edge', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'tmt-browser-ui-boundary-'));
  try {
    mkdirSync(path.join(fixture, 'nested'));
    const header = path.join(fixture, 'header.tsx');
    const helper = path.join(fixture, 'nested/helper.ts');
    const css = path.join(fixture, 'nested/style.css');
    const firstEdge = "export * from './nested/helper';";
    writeFileSync(header, firstEdge);
    writeFileSync(helper, 'export const local = true;');
    writeFileSync(css, '.local { color: inherit; }');
    expect(
      productionFiles(fixture)
        .map((file) => path.relative(fixture, file))
        .sort()
    ).toEqual(['header.tsx', 'nested/helper.ts', 'nested/style.css']);
    expect(violations(header, firstEdge, false, {}, fixture)).toEqual([]);
    expect(productionViolations(fixture)).toEqual([]);
    writeFileSync(helper, "export * from '@tmt/colab-client';");
    expect(violations(header, firstEdge, false, {}, fixture)).toEqual([]);
    expect(productionViolations(fixture)).toEqual(['nested/helper.ts: @tmt/colab-client']);
    writeFileSync(helper, 'export const local = true;');
    for (const source of ["@import 'product.css';", '.local { background: URL(product); }']) {
      writeFileSync(css, source);
      expect(productionViolations(fixture)).toEqual(['nested/style.css: external CSS input']);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
it('rejects independent product/SDK/runtime/static-peer edges while admitting local and React type imports', () => {
  const file = path.join(production, 'header.tsx');
  expect(
    violations(
      file,
      "import type {ReactNode} from 'react'; import {browserUiClasses} from './static';",
      false
    )
  ).toEqual([]);
  for (const source of [
    "export * from '../../../extensions/tmt-colab/typescript/app/src/colab-header';",
    "import SDK from '@tmt/colab-client';",
    "import store from '@tanstack/react-router';",
    "import('product-' + name);",
    'require(name);',
    "new URL('../../../extensions/product/state.json', import.meta.url);",
  ])
    expect(violations(file, source, false).length).toBeGreaterThan(0);
  expect(
    violations(file, "import type {Header} from 'react';", false, {
      baseUrl: root,
      paths: { react: ['extensions/tmt-colab/typescript/app/src/colab-header.tsx'] },
    }).length
  ).toBeGreaterThan(0);
  for (const source of [
    "export * from './react';",
    "import type {ReactNode} from 'react';",
    "require('lucide-react');",
  ])
    expect(violations(path.join(production, 'static.ts'), source, true).length).toBeGreaterThan(0);
});

it('admits foundation dependencies only inside the separate UI graph, with no aliases or static leak', () => {
  const uiFile = path.join(production, 'ui/utils.ts');
  const legacyFile = path.join(production, 'header.tsx');
  for (const peer of ['clsx', 'tailwind-merge', 'radix-ui', 'cmdk', 'class-variance-authority']) {
    const source = `import value from '${peer}';`;
    expect(violations(uiFile, source, false)).toEqual([]);
    expect(violations(legacyFile, source, false)).toEqual([peer]);
    expect(violations(path.join(production, 'static.ts'), source, true)).toEqual([peer]);
    expect(
      violations(uiFile, source, false, {
        baseUrl: root,
        paths: { [peer]: ['extensions/tmt-colab/typescript/app/src/colab-header.tsx'] },
      })
    ).toEqual([peer]);
  }
  expect(violations(legacyFile, "export * from './ui/index';", false)).toEqual(['./ui/index']);
  // Valid JSX before an edge must not hide it: each file parses with its own syntax.
  expect(
    violations(
      legacyFile,
      "export const View = () => <div />; export { browserUiClasses } from '../static.js';",
      false
    )
  ).toEqual(['../static.js']);
  expect(
    violations(
      legacyFile,
      'export const View = () => <div />; export const load = (name: string) => import(name);',
      false
    )
  ).toEqual(['unproved runtime input']);
  expect(
    violations(legacyFile, "export const View = () => <div />; export * from './chips';", false)
  ).toEqual([]);
  expect(violations(uiFile, "export * from '../react';", false)).toEqual(['../react']);
  for (const peer of ['@base-ui/react'])
    expect(violations(uiFile, `export * from '${peer}';`, false)).toEqual([peer]);
});

/**
 * Products reach the leaf only through its package exports (`@tmt/browser-ui/<export>`), never by
 * a path into `design/browser-ui`; the test-only subpaths (`test-fixtures/*`, `gallery/*`) stay out
 * of every extension's production `src`. Byte reads of generated files (`new URL(…)`) are not
 * module edges and stay allowed.
 */
const extensions = path.join(root, 'extensions');
const CONSUMER_ROOTS = new Set(['src', 'test', 'e2e', 'acceptance']);
function consumerViolations(file: string, text: string): string[] {
  const failures: string[] = [];
  const production = path.relative(extensions, file).split(path.sep).includes('src');
  for (const edge of imports(file, text)) {
    const target = edge.startsWith('.') ? path.resolve(path.dirname(file), edge) : edge;
    if (
      target === home ||
      target.startsWith(`${home}/`) ||
      /(^|\/)design\/browser-ui(\/|$)/.test(edge)
    )
      failures.push(`deep path ${edge}`);
    else if (production && /^@tmt\/browser-ui\/(test-fixtures|gallery)(\/|$)/.test(edge))
      failures.push(`test-only subpath ${edge}`);
  }
  return failures;
}
function consumerFiles(directory: string, inside = false): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.'))
      return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return consumerFiles(file, inside || CONSUMER_ROOTS.has(entry.name));
    return inside && /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}
it('extensions import the leaf only through its package exports', () => {
  const failures = consumerFiles(extensions).flatMap((file) => {
    const name = path.relative(root, file);
    return consumerViolations(file, readFileSync(file, 'utf8')).map((edge) => `${name}: ${edge}`);
  });
  expect(failures).toEqual([]);
});
it('names a deep leaf path in any import form and a test-only subpath in production src', () => {
  const client = path.join(extensions, 'tmt-remote/typescript/remote-client');
  const deep = '../../../../../design/browser-ui/src/shell.js';
  const cases: [string, string, string[]][] = [
    // A relative import into the leaf, as a value, a type, a re-export and a dynamic import.
    ['src/a.ts', `import { shellAddress } from '${deep}';`, [`deep path ${deep}`]],
    ['src/b.tsx', `import type { ShellAnswer } from '${deep}';`, [`deep path ${deep}`]],
    ['src/c.mts', `export type { ShellMenu } from '${deep}';`, [`deep path ${deep}`]],
    ['src/d.ts', `const shell = await import('${deep}');`, [`deep path ${deep}`]],
    ['test/e.ts', `type T = import('${deep}').ShellAnswer;`, [`deep path ${deep}`]],
    // A path that names the leaf's source tree without walking up to it.
    [
      'src/f.ts',
      "import { x } from 'tmt/design/browser-ui/src/static';",
      ['deep path tmt/design/browser-ui/src/static'],
    ],
    // Test-only subpaths: refused in production src, admitted in tests.
    [
      'src/g.tsx',
      "import { DialogFixture } from '@tmt/browser-ui/test-fixtures/dialog.tsx';",
      ['test-only subpath @tmt/browser-ui/test-fixtures/dialog.tsx'],
    ],
    [
      'src/h.ts',
      "import { frameFor } from '@tmt/browser-ui/gallery/frames';",
      ['test-only subpath @tmt/browser-ui/gallery/frames'],
    ],
    ['test/i.tsx', "import { DialogFixture } from '@tmt/browser-ui/test-fixtures/dialog.tsx';", []],
    // The exports themselves and byte reads of generated files are fine.
    [
      'src/j.ts',
      "import type { ShellAnswer } from '@tmt/browser-ui/shell'; import '@tmt/browser-ui/static.css';",
      [],
    ],
    [
      'e2e/k.ts',
      "const svg = new URL('../../../../../design/browser-ui/generated/favicon.svg', import.meta.url);",
      [],
    ],
  ];
  for (const [name, source, expected] of cases)
    expect(consumerViolations(path.join(client, name), source), name).toEqual(expected);
});

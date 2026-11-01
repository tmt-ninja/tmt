import { expect, it } from 'vite-plus/test';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * #5821 B: every public part of the design system has a /docs entry. A ui export is named in a
 * component entry (docs/catalog.tsx, docs/catalog-more.tsx); a `@tmt/browser-ui/react` export maps to a gallery section
 * (gallery/covered.ts) that a Browser entry renders (docs/browser-catalog.tsx); a src/*.css module
 * is listed by a Browser entry or shown by a ui entry; a package entry point is one of these or is
 * allowed below with its reason.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const catalog = read('docs/catalog.tsx') + read('docs/catalog-more.tsx');
const browserCatalog = read('docs/browser-catalog.tsx');
const covered = read('gallery/covered.ts');

const names = (path: string) =>
  [...read(path).matchAll(/export\s*\{([^}]*)\}\s*from/g)]
    .filter((match) => !/export\s+type/.test(match[0]))
    .flatMap((match) => match[1]!.split(','))
    .map((name) =>
      name
        .trim()
        .split(/\s+as\s+/)
        .at(-1)!,
    )
    .filter((name) => name && !name.startsWith('type '));
const starExports = (path: string) =>
  [...read(path).matchAll(/export \* from '\.\/([\w-]+)\.js'/g)].flatMap((match) =>
    [
      ...read(`src/ui/${match[1]}.tsx`).matchAll(
        /export (?:function|const) (\w+)|export \{([^}]*)\};/g,
      ),
    ].flatMap((found) => (found[1] ? [found[1]] : found[2]!.split(',').map((name) => name.trim()))),
  );

/** Parts that are plumbing, not something a page shows; each says why it has no entry of its own. */
const internal: Record<string, string> = {
  cn: 'class-name merge helper',
  UiTheme: 'the island root every entry renders inside; documented on the Introduction page',
  useUiPortalContainer: 'portal plumbing inside the layer parts',
  useLayerController: 'overlay admission plumbing; the keyboard contract is on each layer entry',
  useMenuLayerHandoff: 'menu-to-layer focus handoff plumbing inside DropdownMenu',
  buttonVariants: 'the class recipe behind Button',
  badgeVariants: 'the class recipe behind Badge',
  tabsListVariants: 'the class recipe behind TabsList',
  surfaceVariants: 'the class recipe behind Surface',
  RichInputChipNode: 'the Lexical node behind the rich input chips',
};
const uiCss = new Set(['checkbox']); // also styles the ui Checkbox entry
const entries: Record<string, string> = {
  './static.css': 'every Browser entry',
  './editorial.css': 'Browser entry editorial',
  './static': 'Browser entries (static classes and helpers)',
  './glyph': 'Browser entry overview (glyphs)',
  './busy-mark': 'Browser entry busy-mark',
  './shell': 'Browser entry shell',
  './shell-host': 'Browser entry shell',
  './menu-host': 'Browser entry menu',
  './chart': 'Browser entry chart',
  './react': 'Browser entries',
  './ui': 'Components entries',
  './ui.css': 'Components entries',
  './theme': 'theme switch wiring for hosts, not a visual part',
  './search': 'search query parsing for hosts, not a visual part',
  './list-table': 'Browser entry list',
  './rich-input': 'Components entry rich-input',
  './gallery/frames': 'the gallery itself',
  './test-fixtures/*': 'test fixtures',
};

it('names every ui export in a component entry', () => {
  const exported = [
    ...new Set([
      ...starExports('src/ui/primitives.ts'),
      ...names('src/ui/layers.ts'),
      ...names('src/ui/selection.ts'),
      ...names('src/ui/index.ts'),
      ...names('src/rich-input/index.ts'),
    ]),
  ];
  const missing = exported.filter(
    (name) => !internal[name] && !new RegExp(`\\b${name}\\b`).test(catalog),
  );
  expect(missing).toEqual([]);
});

it('renders every React export through a Browser entry', () => {
  const sections = new Set(
    [...browserCatalog.matchAll(/section: '([\w-]+)'/g)].map((match) => match[1]),
  );
  const unrendered = [...covered.matchAll(/^ {2}(\w+): '([\w-]+)',$/gm)]
    .filter((match) => !sections.has(match[2]))
    .map((match) => `${match[1]} (${match[2]})`);
  expect(unrendered).toEqual([]);
});

it('lists every stylesheet module in an entry', () => {
  const listed = new Set(
    [...browserCatalog.matchAll(/css: \[([^\]]*)\]/g)].flatMap((match) =>
      [...match[1]!.matchAll(/'([\w-]+)'/g)].map((name) => name[1]),
    ),
  );
  const modules = readdirSync(new URL('../src/', import.meta.url))
    .filter((file) => file.endsWith('.css'))
    .map((file) => file.slice(0, -4));
  expect(modules.filter((name) => !listed.has(name) && !uiCss.has(name))).toEqual([]);
});

it('accounts for every package entry point', () => {
  const manifest = JSON.parse(read('package.json'));
  expect(Object.keys(manifest.exports).filter((name) => !entries[name])).toEqual([]);
});

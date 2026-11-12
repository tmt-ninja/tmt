import { readFile, writeFile } from 'node:fs/promises';
import { buildPageUi } from './page-ui.mjs';

const tokens = JSON.parse(
  await readFile(new URL('../../../design/tokens/tokens.json', import.meta.url), 'utf8'),
);
const file = new URL('../typescript/app/public/renderer.html', import.meta.url);
const mode = process.argv[2];
if (process.argv.length !== 3 || !['--write', '--check'].includes(mode))
  throw new Error('Use --write or --check');

// The opaque renderer cannot fetch styles. Project its paint roles, the shared circle and the page
// frame at build time.
const roles = [
  ['surface', 'annotation-highlight'],
  ['surface', 'annotation-highlight-hover'],
  ['surface', 'annotation-highlight-selected'],
  ['color', 'annotation-rule'],
  ['color', 'annotation-rule-selected'],
  ['surface', 'annotation-action'],
  ['color', 'annotation-on-action'],
  ['surface', 'sheet'],
  ['color', 'text'],
  ['surface', 'rule'],
];
const variables = (theme) =>
  roles
    .map(
      ([group, name]) =>
        `--tmt-ui-${group}-${name}:${tokens.browser[group][name][theme].toLowerCase()};`,
    )
    .join('');
// A template rule tag (#6333) takes the scheme the page paints, which the frame sets on the tag
// (`data-scheme`), under its own names so a design system's working roles never recolour it.
const ruleVariables = (theme) =>
  `--colab-rule-surface:${tokens.browser.surface['working-soft'][theme].toLowerCase()};--colab-rule-ink:${tokens.browser.color.working[theme].toLowerCase()};`;
const numberStyle = await readFile(
  new URL('../typescript/app/src/annotation-number.css', import.meta.url),
  'utf8',
);
const referenceStyle = await readFile(new URL('../typescript/app/src/components/comment-reference-chip.css', import.meta.url), 'utf8');
// Fallback annotation roles follow the painted scheme. They sit below page design-system tokens,
// so a pinned system can supply its own roles while ordinary pages retain these defaults.
const css = `@layer colab-frame{:root{${variables('light')}}:root[data-theme="dark"]{${variables('dark')}}:root[data-colab-scheme="light"]{${variables('light')}}:root[data-colab-scheme="dark"]{${variables('dark')}}[data-colab-rule]{${ruleVariables('light')}}[data-colab-rule][data-scheme="dark"]{${ruleVariables('dark')}}}${numberStyle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()}${referenceStyle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()}`;
const referenceComponent = await readFile(new URL('../typescript/app/src/components/comment-reference-chip.js', import.meta.url), 'utf8');
const frameStyle = (
  await readFile(new URL('../typescript/app/src/page-frame.css', import.meta.url), 'utf8')
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  // Double quotes keep the formatter from rewriting the single-quoted literal that holds it.
  .replaceAll("'", '"')
  .trim();
// The design system the frame injects into every page (#5057) and the icons it draws; page-ui.mjs builds
// both, and the standalone export carries the same bytes.
const { staticCss, editorialCss, pageUiStyle, iconNodes, pageIcons, dsProseStyle } = await buildPageUi();
// `page check` reads the same two lists the frame draws from: a `tmt-ui-*` class it does not know and an
// icon name it does not know are findings, not silent no-ops.
const classes = [...new Set([...(staticCss + editorialCss).matchAll(/\.(tmt-ui-[A-Za-z0-9_-]+)/g)].map((m) => m[1]))].sort();
const names = new URL('../rust/tmt-colab/src/page_check/page_ui.json', import.meta.url);
const namesText = `${JSON.stringify({ classes, icons: Object.keys(iconNodes).sort() }, null, 1)}\n`;
const source = await readFile(file, 'utf8');
// Each generated constant sits between a pair of marker comments in renderer.html.
const generate = (text, name, constant, value) => {
  const start = `          // BEGIN GENERATED ${name}`;
  const end = `          // END GENERATED ${name}`;
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to <= from) throw new Error(`Missing renderer ${name.toLowerCase()} markers`);
  const literal = `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return `${text.slice(0, from)}${start}\n          const ${constant} =\n            ${literal};\n${text.slice(to)}`;
};
const expected = generate(
  generate(generate(source, 'ANNOTATION TOKENS', 'annotationTokens', css), 'PAGE FRAME', 'pageFrame', frameStyle),
  'PAGE UI',
  'pageUi',
  pageUiStyle,
);
const withIcons = generate(
  generate(expected, 'PAGE ICONS', 'pageIcons', pageIcons),
  'DS PROSE',
  'dsProse',
  dsProseStyle,
);
const startComponent = '          // BEGIN GENERATED THREAD REFERENCE COMPONENT';
const endComponent = '          // END GENERATED THREAD REFERENCE COMPONENT';
const componentStart = withIcons.indexOf(startComponent);
const componentEnd = withIcons.indexOf(endComponent);
if (componentStart < 0 || componentEnd <= componentStart) throw new Error('Missing thread reference component markers');
const complete = `${withIcons.slice(0, componentStart)}${startComponent}\n${referenceComponent.trim().split('\n').map((line) => `          ${line}`).join('\n')}\n${withIcons.slice(componentEnd)}`;
if (mode === '--write') {
  await writeFile(file, complete);
  await writeFile(names, namesText);
} else if (source !== complete || (await readFile(names, 'utf8').catch(() => '')) !== namesText)
  throw new Error('Renderer generated styles are stale');

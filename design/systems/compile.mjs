// Compiles a design-system template's files (#5821, epic #5866) with design/systems/compiler.mjs,
// the same code the Colab app runs in the browser. `--write` regenerates, `--check` fails on drift.
//
//   node design/systems/compile.mjs --write|--check [system-dir ...]
//
// Outputs, per system directory:
//   generated/bundle.json    the template's release bundle, the built-in tmt GUI release every
//                            install can pin (#5921): tokens and every component's props, slots,
//                            examples, CSS and code (a function body that returns the factory); the
//                            skeleton that runs it ships with each surface, not in the bundle
//   generated/pages.json     the tmt GUI docs (foundations, components, patterns) as the static doc
//                            pages a new system copies under its root, rendered from browser-ui/docs
//   generated/template.json  the template as Colab copies it into a space: the root page's config
//                            and each component page's data block, with source and CSS inline
//   generated/<tag>.mjs      the component source as an ES module, for the product build
//   generated/index.d.ts     prop types generated from each props schema
//   generated/style.css      the components' CSS, for the product build
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle, propType } from './compiler.mjs';
import { renderDocs, withDocs } from './docs-render.mjs';
import { classTable, markupDrift } from './ui-port.mjs';

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

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
const sha256Hex = async (text) => createHash('sha256').update(text).digest('hex');
const pascal = (tag) => tag.replace(/(^|-)([a-z])/g, (_, __, letter) => letter.toUpperCase());

/** The token blocks of the generated static.css: everything before the first class rule,
 * including the compact (≤760px) token overrides, so a narrow frame draws as the docs do. */
function tokensCss() {
  const css = readFileSync(join(repo, 'design/browser-ui/generated/static.css'), 'utf8');
  const compact = /^@media \(max-width: 760px\) \{\s*:root \{[^{}]*\}\s*\}\n/m.exec(css);
  if (!compact) throw new Error('static.css: the token blocks end marker moved');
  const end = compact.index + compact[0].length;
  return stripComments(css.slice(0, end));
}

/** The UI island's CSS (browser-ui's generated ui.css) on a page of its own: the island is the
 * page root, and its theme is the frame's `data-theme`. */
function pageUiCss() {
  const css = readFileSync(join(repo, 'design/browser-ui/generated/ui.css'), 'utf8');
  const scoped = stripComments(css)
    .replaceAll("[data-tmt-ui]:not([data-tmt-theme='light'])", ":root:not([data-theme='light'])")
    .replaceAll("[data-tmt-ui][data-tmt-theme='light']", ":root[data-theme='light']")
    .replaceAll("[data-tmt-ui][data-tmt-theme='dark']", ":root[data-theme='dark']")
    .replaceAll('[data-tmt-ui]', ':root')
  if (/data-tmt-ui|data-tmt-theme/.test(scoped)) throw new Error('ui.css: an island selector was left');
  return scoped;
}

/** Keep nested stages' UI theme variables local, including stages opposite the page theme. */
function scopedUiThemeCss() {
  const css = readFileSync(join(repo, 'design/browser-ui/generated/ui.css'), 'utf8');
  const end = css.indexOf('@keyframes tmt-foundation-fade-in');
  if (end < 0) throw new Error('ui.css: the theme block end marker moved');
  return `@scope ([data-tmt-ds-scope]){${stripComments(css.slice(0, end))}}`;
}

/** The docs' own look (the article, canvases, snippets), scoped to `.tmt-design-docs`. */
const docsCss = () =>
  stripComments(readFileSync(join(repo, 'design/browser-ui/generated/docs-embed.css'), 'utf8'));

/**
 * The docs pages with their inline `style` attributes lifted into classes: a Colab page's CSP
 * refuses inline styles. Each distinct style becomes one rule in the system CSS, every declaration
 * `!important` so it still wins as the inline style did.
 */
function liftInlineStyles(sections) {
  const names = new Map();
  const lift = (html) =>
    html.replace(/<([a-z][a-z0-9-]*)([^>]*?)\sstyle="([^"]*)"([^>]*)>/g, (_, tag, before, style, after) => {
      if (!names.has(style)) names.set(style, `ds-inline-${names.size + 1}`);
      const name = names.get(style);
      const attrs = `${before}${after}`;
      const classed = /\sclass="/.test(attrs)
        ? attrs.replace(/\sclass="([^"]*)"/, (_, classes) => ` class="${classes} ${name}"`)
        : `${attrs} class="${name}"`;
      return `<${tag}${classed}>`;
    });
  const lifted = sections.map((section) => ({
    ...section,
    pages: section.pages.map((page) => ({ ...page, html: lift(page.html) })),
  }));
  if (lifted.some((section) => section.pages.some((page) => /\sstyle="/.test(page.html))))
    throw new Error('docs pages: an inline style was left');
  const css = [...names]
    .map(([style, name]) => {
      const rules = style
        .replaceAll('&quot;', '"')
        .replaceAll('&#x27;', "'")
        .replaceAll('&amp;', '&')
        .split(';')
        .filter((rule) => rule.trim())
        .map((rule) => `${rule.trim()} !important`)
        .join(';');
      return `.tmt-design-docs .${name}{${rules}}`;
    })
    .join('\n');
  return { sections: lifted, css };
}

async function compile(dir) {
  const { components: docs, ...rest } = readJson(join(dir, 'system.json'));
  const docsOut = await renderDocs();
  // The nav-only pages (Principles) lift their inline styles with the rest.
  const pages = liftInlineStyles([...docsOut.sections, { title: '', pages: docsOut.extras }]);
  const navPages = pages.sections.pop().pages;
  const css = [tokensCss(), pageUiCss(), scopedUiThemeCss(), docsCss(), pages.css].join('\n');
  const config = { ...rest, tokens: { ...rest.tokens, css } };
  const read = docs.map(({ doc }) => {
    const path = join(dir, doc);
    const { source, css, ui, ...component } = readJson(path);
    return {
      component: {
        ...component,
        source: readFileSync(join(dirname(path), source), 'utf8'),
        css: stripComments(readFileSync(join(dirname(path), css), 'utf8')),
      },
      ui,
    };
  });
  // A port of a browser-ui component takes its classes from that component's variants, and must
  // render every example like it (#5866).
  const components = await withDocs(async (docsContext) => {
    const filled = [];
    for (const { component, ui } of read) {
      if (!ui) {
        filled.push(component);
        continue;
      }
      if (!component.source.includes('/* classes */ null'))
        throw new Error(`${component.tag}: a ported source names its classes /* classes */ null`);
      const classes = await classTable(docsContext, ui);
      filled.push({
        ...component,
        source: component.source.replace('/* classes */ null', JSON.stringify(classes)),
      });
    }
    const drift = await markupDrift(
      docsContext,
      filled.flatMap((component, index) =>
        read[index].ui
          ? [{ ...component, ui: read[index].ui, code: component.source.replace(/^export default /m, 'return ') }]
          : [],
      ),
    );
    if (drift.length) throw new Error(`Template ports differ from browser-ui:\n${drift.join('\n')}`);
    return filled;
  });
  const bundle = await buildBundle(config.id, config, components, sha256Hex);
  const from = relative(repo, dir);
  const files = new Map([
    ['generated/bundle.json', `${JSON.stringify(bundle, null, 1)}\n`],
    [
      'generated/template.json',
      `${JSON.stringify({ system: { ...config, components: components.map(({ tag }) => ({ tag, status: 'stable' })) }, components }, null, 1)}\n`,
    ],
    [
      'generated/style.css',
      `/* Generated by design/systems/compile.mjs from ${from}; do not edit. */\n${components.map(({ css }) => css).join('\n').trimEnd()}\n`,
    ],
    [
      'generated/index.d.ts',
      `// Generated by design/systems/compile.mjs from ${from}; do not edit.\nimport type { ReactNode } from 'react';\n\n${components
        .map(
          (c) =>
            `/** <${config.prefix}-${c.tag}>: props from its schema, slots as nodes. */\nexport interface ${pascal(c.tag)}Props {\n${Object.entries(
              c.props,
            )
              .map(([name, spec]) => `  ${name.includes('-') ? JSON.stringify(name) : name}?: ${propType(spec)};`)
              .join('\n')}\n${c.slots
              .map((slot) => `  ${slot === 'default' ? 'children' : slot}?: ReactNode;`)
              .join('\n')}\n}\n`,
        )
        .join('\n')}`,
    ],
    [
      'generated/pages.json',
      `${JSON.stringify(
        pages.sections.map((section) => ({
          title: section.title,
          pages: section.pages.map((page) => ({
            ...page,
            html: `<div class="tmt-design-docs">${page.html}</div>`,
          })),
        })),
        null,
        1,
      )}\n`,
    ],
    [
      'generated/nav.json',
      `${JSON.stringify(
        {
          sections: docsOut.nav,
          pages: navPages.map((page) => ({
            ...page,
            html: `<div class="tmt-design-docs">${page.html}</div>`,
          })),
        },
        null,
        1,
      )}\n`,
    ],
    ...components.map((c) => [
      `generated/${c.tag}.mjs`,
      `// Generated by design/systems/compile.mjs from ${from}; do not edit.\n${c.source}`,
    ]),
  ]);
  const drift = [];
  for (const [name, text] of files) {
    const path = join(dir, name);
    if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
    if (mode === '--check') drift.push(name);
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  }
  if (drift.length) throw new Error(`${from}: out of date: ${drift.join(', ')}; run --write`);
  console.log(`${from}: ${config.id}@${config.version}#${bundle.hash}`);
}

let failed = false;
for (const dir of systems) {
  try {
    await compile(dir);
  } catch (error) {
    failed = true;
    console.error(error.message);
  }
}
process.exit(failed ? 1 : 0);

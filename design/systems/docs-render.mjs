// Renders the tmt GUI docs (design/browser-ui/docs) to static HTML for the design-system template
// (#5866): each component's preview and variants, the foundations pages and the patterns. The docs
// stay the single source; the template compiler turns this into the pages a new system copies.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../browser-ui/', import.meta.url));
/** The repo files a docs page is generated from, repo-relative: what a change to it edits (#5969). */
const sourceFiles = (...candidates) =>
  candidates.filter((path) => existsSync(fileURLToPath(new URL(`../../${path}`, import.meta.url))));
const componentFiles = (slug) =>
  sourceFiles(
    ...[`src/ui/${slug}`, `src/${slug}`, `src/${slug}/${slug}`].flatMap((stem) => [
      `design/browser-ui/${stem}.tsx`,
      `design/browser-ui/${stem}.css`,
    ]),
    'design/browser-ui/docs/catalog.tsx',
    'design/browser-ui/docs/catalog-more.tsx'
  );
const browserUi = createRequire(`${root}package.json`);

/** Start an SSR loader over the docs, render with `use`, and always close it. */
export async function withDocs(use) {
  const { createServer } = browserUi('vite-plus');
  const React = browserUi('react');
  const { renderToStaticMarkup } = browserUi('react-dom/server');
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
  });
  try {
    const load = (path) => server.ssrLoadModule(path);
    const { UiTheme } = await load('/src/ui/theme.tsx');
    const { drawFramesInline } = await load('/gallery/kit.tsx');
    const { renderDocsPreview } = await load('/docs/inline-preview.tsx');
    drawFramesInline(renderDocsPreview);
    // The docs render inside the UI island, as on the docs site; the page keeps only its content.
    const island = '<div data-tmt-ui="" data-tmt-theme="light">';
    const portal = '<div data-tmt-ui-portal=""></div></div>';
    const render = (node) => {
      const html = renderToStaticMarkup(
        React.createElement(
          UiTheme,
          { theme: 'light' },
          React.createElement(() => node())
        )
      );
      if (!html.startsWith(island) || !html.endsWith(portal))
        throw new Error('The docs island markup changed');
      return html.slice(island.length, -portal.length);
    };
    return await use({ load, render, React, renderToStaticMarkup });
  } finally {
    await server.close();
  }
}

/** A doc page's HTML is larger than this: its heaviest states are left out with a note. */
export const PAGE_BYTES = 192 * 1024;
const bytes = (text) => Buffer.byteLength(text);

/** Every docs page the template carries, as static HTML in the docs' own templates, by section. */
export async function renderDocs() {
  return withDocs(async ({ load, render, React }) => {
    const h = React.createElement;
    const { components } = await load('/docs/catalog.tsx');
    const { browserDocs } = await load('/docs/browser-catalog.tsx');
    const { tokenPages } = await load('/docs/tokens.tsx');
    const { patterns } = await load('/docs/patterns.tsx');
    const { morePatterns } = await load('/docs/patterns-more.tsx');
    const { Article, ComponentTemplate } = await load('/docs/templates.tsx');
    const page = (slug, title, node, files) => ({ slug, title, html: render(() => node), files });
    const tokenFiles = sourceFiles(
      'design/tokens/tokens.json',
      'design/browser-ui/docs/tokens.tsx'
    );
    const article = (title, lead, ...children) => h(Article, { title, lead }, ...children);
    return [
      {
        title: 'Foundations',
        pages: tokenPages.map((doc) =>
          page(doc.slug, doc.title, article(doc.title, doc.lead, h(doc.render)), tokenFiles)
        ),
      },
      {
        title: 'Components',
        pages: components.map((doc) =>
          page(
            doc.slug,
            doc.name,
            h(ComponentTemplate, {
              title: doc.name,
              lead: doc.description,
              preview: h(doc.preview),
              usage: doc.usage,
              variants: doc.variants.map(([label, node], index) => ({
                label,
                // The page frame resolves this bundle tag live, without a frame or a scene registry.
                render:
                  (doc.slug === 'page-list' && index > 0) ||
                  (doc.slug === 'data-table' && index < 7)
                    ? h('tmt-ui-page-view', {
                        label,
                        'group-by': doc.slug === 'data-table' ? 'none' : 'state',
                        ...(doc.slug === 'data-table' && index === 1
                          ? { selectable: true, selected: 'two' }
                          : {}),
                        ...(doc.slug === 'data-table' && index === 2
                          ? { density: 'comfortable' }
                          : {}),
                        ...(doc.slug === 'data-table' && index >= 4
                          ? { state: ['loading', 'empty', 'error'][index - 4] }
                          : {}),
                        rows: JSON.stringify([
                          {
                            id: 'one',
                            name: 'Structured pages',
                            projects: ['spec'],
                            stage: 'Awaiting decision',
                            updated: 'Today',
                            author: 'gui-lead',
                          },
                          {
                            id: 'two',
                            name: 'Night execution plan',
                            projects: ['night'],
                            stage: 'In progress',
                            updated: 'Yesterday',
                            author: 'night-lead',
                          },
                        ]),
                      })
                    : h(node),
              })),
              dos: doc.dos,
            }),
            componentFiles(doc.slug)
          )
        ),
      },
      {
        title: 'Browser components',
        pages: [
          ['avatar', 'browser-avatar'],
          ['busy-mark', 'busy-mark'],
          ['section', 'section'],
          ['disclosure', 'disclosure'],
          ['brand', 'brand-mark'],
          ['browser-checkbox', 'browser-checkbox'],
          ['status-tile', 'status-tile'],
          ['action', 'action'],
          ['toggle', 'toggle'],
          ['header', 'header'],
          ['notice', 'notice'],
          ['pager', 'pager'],
          ['list', 'list'],
          ['choice', 'choice'],
          ['menu', 'menu'],
          ['icon-action', 'icon-action'],
        ].map(([slug, tag]) => {
          const doc = browserDocs.find((entry) => entry.slug === slug);
          if (!doc) throw new Error(`Missing Browser component docs: ${slug}`);
          return {
            slug: tag,
            title: doc.name,
            html: '',
            files: sourceFiles('design/browser-ui/docs/browser-catalog.tsx'),
          };
        }),
      },
      {
        title: 'Patterns',
        pages: [
          ...patterns.map((doc) =>
            page(
              doc.slug,
              doc.title,
              article(doc.title, doc.lead, h(doc.render)),
              sourceFiles('design/browser-ui/docs/patterns.tsx')
            )
          ),
          ...morePatterns.map((doc) => {
            // A state too heavy for one page (a long table, say) is named, not drawn.
            const states = doc.states.map(([state, label]) => {
              const html = render(() => h(doc.Body, { state }));
              return { label, html, heavy: bytes(html) > PAGE_BYTES / 2 };
            });
            const body = (state) =>
              h('section', { key: state.label, className: 'docs-variant' }, [
                h('h3', { key: 'h' }, state.label),
                state.heavy
                  ? h(
                      'p',
                      { key: 'p', className: 'docs-motion-line' },
                      'Too large to draw on this page; see it on the tmt GUI docs.'
                    )
                  : h('div', {
                      key: 'c',
                      className: 'docs-canvas',
                      dangerouslySetInnerHTML: { __html: state.html },
                    }),
              ]);
            return page(
              doc.slug,
              doc.title,
              article(
                doc.title,
                doc.lead,
                ...states.map(body),
                h('h2', { key: 'rules' }, 'Rules'),
                h(
                  'ul',
                  { key: 'list' },
                  doc.rules.map((rule) => h('li', { key: rule }, rule))
                )
              ),
              sourceFiles('design/browser-ui/docs/patterns-more.tsx')
            );
          }),
        ],
      },
    ];
  });
}

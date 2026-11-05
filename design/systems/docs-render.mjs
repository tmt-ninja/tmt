// Renders the tmt GUI docs (design/browser-ui/docs) to static HTML for the design-system template
// (#5866): each component's preview and variants, the foundations pages and the patterns. The docs
// stay the single source; the template compiler turns this into the pages a new system copies.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../browser-ui/', import.meta.url));
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

/** Every docs page the template carries, as static HTML in the docs' own templates, by section;
 * and the docs site's own nav (`nav`, from `designSystems` in docs/app.tsx), which Design draws so
 * the two cannot drift, with the pages only the nav lists (`extras`, such as Principles). */
export async function renderDocs() {
  return withDocs(async ({ load, render, React }) => {
    const h = React.createElement;
    const { components } = await load('/docs/catalog.tsx');
    const { browserDocs } = await load('/docs/browser-catalog.tsx');
    const { tokenPages } = await load('/docs/tokens.tsx');
    const { patterns } = await load('/docs/patterns.tsx');
    const { morePatterns } = await load('/docs/patterns-more.tsx');
    const { livePatternSlugs } = await load('/docs/pattern-page.tsx');
    const { Article } = await load('/docs/templates.tsx');
    // `path` is the page's docs path under the system root, as the docs site routes it.
    // The docs nav's order: components by name, the newer patterns first.
    const byName = (a, b) => a.name.localeCompare(b.name, 'en');
    const page = (slug, title, node, path) => ({ slug, title, html: render(() => node), path });
    const article = (title, lead, ...children) => h(Article, { title, lead }, ...children);
    const sections = [
      {
        title: 'Foundations',
        pages: tokenPages.map((doc) =>
          page(doc.slug, doc.title, h('tmt-ui-foundation', { page: doc.slug }), `tokens/${doc.slug}`)
        ),
      },
      {
        title: 'Components',
        pages: [...components].sort(byName).map((doc) => ({
          ...page(
            doc.slug,
            doc.name,
            h('tmt-ui-component-docs', { page: `components/${doc.slug}` }),
            `components/${doc.slug}`
          ),
          description: doc.description,
          usage: doc.usage,
          dos: doc.dos,
        })),
      },
      {
        title: 'Browser components',
        pages: [
          ['page-row', 'page-row'],
          ['work-band', 'work-band'],
          ['message-row', 'message-row'],
          ['status-line', 'status-line'],
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
          ['field', 'field'],
          ['count-chip', 'count-chip'],
          ['table', 'table'],
          ['browser-command', 'browser-command'],
          ['browser-tabs', 'browser-tabs'],
          ['browser-chips', 'browser-chips'],
          ['dialog-drawer-panel', 'dialog-drawer-panel'],
          ['shell', 'shell'],
          ['notifications', 'notifications'],
          ['card-meter', 'card-meter'],
          ['overview', 'overview'],
          ['editorial', 'editorial'],
          ['visually-hidden', 'visually-hidden'],
          ['chart', 'chart'],
        ].map(([slug, tag]) => {
          const doc = browserDocs.find((entry) => entry.slug === slug);
          if (!doc) throw new Error(`Missing Browser component docs: ${slug}`);
          return {
            ...page(
              tag,
              doc.name,
              h('tmt-ui-component-docs', { page: `browser/${slug}` }),
              `browser/${slug}`
            ),
            description: doc.description,
          };
        }).sort((a, b) => a.title.localeCompare(b.title, 'en')),
      },
      {
        title: 'Patterns',
        pages: [
          ...morePatterns.map((doc) => {
            if (livePatternSlugs.includes(doc.slug))
              return page(
                doc.slug,
                doc.title,
                h('tmt-ui-pattern', { page: doc.slug }),
                `patterns/${doc.slug}`
              );
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
              `patterns/${doc.slug}`
            );
          }),
          ...patterns.map((doc) =>
            livePatternSlugs.includes(doc.slug)
              ? page(doc.slug, doc.title, h('tmt-ui-pattern', { page: doc.slug }), `patterns/${doc.slug}`)
              : page(
              doc.slug,
              doc.title,
              article(doc.title, doc.lead, h(doc.render)),
              `patterns/${doc.slug}`
            )
          ),
        ],
      },
    ];
    const { designSystems } = await load('/docs/app.tsx');
    const { guiRoot } = await load('/docs/routes.ts');
    const gui = designSystems.find((system) => system.id === 'gui');
    const rendered = new Set(sections.flatMap((section) => section.pages.map((doc) => doc.path)));
    const extras = [];
    // The docs nav, less its Mocks (full-screen routes, not pages); '' is the introduction.
    const nav = gui.sections
      .filter((section) => section.title !== 'Mocks')
      .map((section) => ({
        title: section.title,
        pages: section.pages.map((doc) => {
          if (doc.href !== guiRoot && !doc.href.startsWith(`${guiRoot}/`))
            throw new Error(`docs nav: ${doc.href} is outside ${guiRoot}`);
          const path = doc.href.slice(guiRoot.length + 1);
          if (path && !rendered.has(path))
            extras.push(page(path.split('/').pop(), doc.title, doc.render(), path));
          return { title: doc.title, path };
        }),
      }));
    const listed = new Set(nav.flatMap((section) => section.pages.map((doc) => doc.path)));
    for (const path of rendered)
      if (!listed.has(path)) throw new Error(`docs nav: ${path} is not in the docs nav`);
    return { sections, nav, extras };
  });
}

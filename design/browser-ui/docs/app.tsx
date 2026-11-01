import { useState, type ReactNode } from 'react';
import { BrandMark } from '../src/brand-mark.js';
import { UiTheme } from '../src/ui/index.js';
import { browserDocs, browserExports, type BrowserDoc } from './browser-catalog.js';
import { components, type ComponentDoc } from './catalog.js';
import { patterns } from './patterns.js';
import { morePatterns, PatternViewports } from './patterns-more.js';
import { motionNotes, Replay } from './motion.js';
import { tokenPages } from './tokens.js';
import { tuiPages } from './tui-nav.js';
import { radiusLabel, setRadius, setTheme, usePreview, type Radius } from './preview.js';
import { follow } from './router.js';
import { colabMockBase, guiRoot, tuiMockBase, tuiRoot } from './routes.js';

interface Page {
  href: string;
  title: string;
  render(): ReactNode;
}
interface Section {
  title: string;
  pages: Page[];
}
/** A design system the docs shell serves (#5821): its own route root, nav and header controls. */
interface DesignSystem {
  id: 'gui' | 'tui';
  name: string;
  root: string;
  sections: Section[];
  Controls(): ReactNode;
}
/** A Mocks entry: the route renders the full-screen mock, so the docs shell never draws it. */
const mock = (href: string, title: string): Page => ({ href, title, render: () => null });

const guiIntro: Page = { href: guiRoot, title: 'Introduction', render: () => <Introduction /> };
const gui: DesignSystem = {
  id: 'gui',
  name: 'tmt GUI',
  root: guiRoot,
  Controls: GuiControls,
  sections: [
    {
      title: 'Getting started',
      pages: [
        guiIntro,
        { href: `${guiRoot}/principles`, title: 'Principles', render: () => <Principles /> },
      ],
    },
    {
      title: 'Tokens',
      pages: tokenPages.map((page) => ({
        href: `${guiRoot}/tokens/${page.slug}`,
        title: page.title,
        render: () => (
          <Article title={page.title} lead={page.lead}>
            {page.render()}
          </Article>
        ),
      })),
    },
    {
      title: 'Components',
      pages: [...components]
        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
        .map((doc) => ({
          href: `${guiRoot}/components/${doc.slug}`,
          title: doc.name,
          render: () => <ComponentPage doc={doc} />,
        })),
    },
    {
      title: 'Browser components',
      pages: [...browserDocs]
        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
        .map((doc) => ({
          href: `${guiRoot}/browser/${doc.slug}`,
          title: doc.name,
          render: () => <BrowserPage doc={doc} />,
        })),
    },
    {
      title: 'Patterns',
      pages: [
        ...morePatterns.map((pattern) => ({
          href: `${guiRoot}/patterns/${pattern.slug}`,
          title: pattern.title,
          render: () => (
            <Article title={pattern.title} lead={pattern.lead}>
              <PatternViewports doc={pattern} />
            </Article>
          ),
        })),
        ...patterns.map((pattern) => ({
          href: `${guiRoot}/patterns/${pattern.slug}`,
          title: pattern.title,
          render: () => (
            <Article title={pattern.title} lead={pattern.lead}>
              {pattern.render()}
            </Article>
          ),
        })),
      ],
    },
    { title: 'Mocks', pages: [mock(colabMockBase, 'Colab')] },
  ],
};

/** The TUI pages, grouped by the group they name (#5835); an ungrouped page is a component. */
const tuiGroups = ['Getting started', 'Foundations', 'Components', 'Patterns'] as const;
const tuiPage = (page: (typeof tuiPages)[number]): Page => ({
  href: `${tuiRoot}/${page.slug}`,
  title: page.title,
  render: () => (
    <Article title={page.title} lead={page.lead}>
      {page.render()}
    </Article>
  ),
});
const tuiGroup = (page: (typeof tuiPages)[number]) =>
  (page as { group?: string }).group ?? 'Components';
const tui: DesignSystem = {
  id: 'tui',
  name: 'tmt TUI',
  root: tuiRoot,
  Controls: TuiControls,
  sections: [
    ...tuiGroups.map((title) => ({
      title,
      pages: [
        ...(title === 'Getting started'
          ? [{ href: tuiRoot, title: 'Introduction', render: () => <TuiIntroduction /> }]
          : []),
        ...tuiPages.filter((page) => tuiGroup(page) === title).map(tuiPage),
      ],
    })),
    { title: 'Mocks', pages: [mock(`${tuiMockBase}/agents`, 'Agents')] },
  ].filter((section) => section.pages.length > 0),
};
export const designSystems = [gui, tui];

export function DocsApp({ path }: { path: string }) {
  const { theme } = usePreview();
  const system = path === tuiRoot || path.startsWith(`${tuiRoot}/`) ? tui : gui;
  const pages = system.sections.flatMap((section) => section.pages);
  const page = pages.find((entry) => entry.href === path) ?? pages[0]!;
  const index = pages.indexOf(page);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <UiTheme theme={theme}>
      <div className="docs" data-system={system.id}>
        <TopBar system={system} onMenu={() => setMenuOpen((open) => !open)} />
        <div className="docs-body">
          <nav
            className="docs-nav"
            data-open={menuOpen || undefined}
            aria-label={`${system.name} documentation`}
          >
            {system.sections.map((section) => (
              <div key={section.title} className="docs-nav-group">
                <p className="docs-nav-title">{section.title}</p>
                {section.pages.map((entry) => (
                  <a
                    key={entry.href}
                    href={entry.href}
                    aria-current={entry === page ? 'page' : undefined}
                    onClick={(event) => {
                      setMenuOpen(false);
                      follow(event);
                    }}
                  >
                    {entry.title}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <main className="docs-main" key={page.href}>
            {page.render()}
            <footer className="docs-pager">
              {index > 0 ? (
                <a href={pages[index - 1]!.href} onClick={follow}>
                  <span>Previous</span>
                  {pages[index - 1]!.title}
                </a>
              ) : (
                <span />
              )}
              {index < pages.length - 1 && (
                <a href={pages[index + 1]!.href} onClick={follow} data-next>
                  <span>Next</span>
                  {pages[index + 1]!.title}
                </a>
              )}
            </footer>
          </main>
        </div>
      </div>
    </UiTheme>
  );
}

function TopBar({ system, onMenu }: { system: DesignSystem; onMenu?: () => void }) {
  return (
    <header className="docs-top">
      {onMenu && (
        <button type="button" className="docs-menu-button" aria-label="Menu" onClick={onMenu}>
          ☰
        </button>
      )}
      <a className="docs-brand" href={system.root} onClick={follow}>
        <BrandMark size={22} />
        <span>tmt</span>
        <span className="docs-brand-sub">design system</span>
      </a>
      <nav className="docs-segment docs-systems" aria-label="Design system">
        {designSystems.map((entry) => (
          <a
            key={entry.id}
            href={entry.root}
            aria-current={entry === system ? 'page' : undefined}
            onClick={follow}
          >
            {entry.name}
          </a>
        ))}
      </nav>
      <div className="docs-switches">
        <system.Controls />
      </div>
    </header>
  );
}

function ThemeSwitch() {
  const { theme } = usePreview();
  return (
    <button
      type="button"
      className="docs-theme"
      aria-label={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? '☾ Dark' : '☀ Light'}
    </button>
  );
}

/** The GUI system's header controls: the radius knob and the viewer theme. */
function GuiControls() {
  const { radius } = usePreview();
  return (
    <>
      <div className="docs-segment" role="group" aria-label="Radius">
        {(['2', '4', 'current'] as Radius[]).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={radius === value}
            onClick={() => setRadius(value)}
          >
            {radiusLabel[value]}
          </button>
        ))}
      </div>
      <ThemeSwitch />
    </>
  );
}

/** The TUI system's header controls: the viewer theme; the 16-colour fallback joins from #5835. */
function TuiControls() {
  return <ThemeSwitch />;
}

function TuiIntroduction() {
  return (
    <Article
      title="TMT TUI design system"
      lead="The terminal side of tmt: the roles, glyphs, components and patterns the Ops board and the CLI paint, shown from real painter frames rather than drawn by hand."
    >
      <p>
        Every frame on these pages is decoded from the recorded Ops oracle, so a page shows what a
        terminal shows. The TUI keeps its own palette; GUI palette B does not apply here.
      </p>
      <div className="docs-cards">
        <a className="docs-card" href={`${tuiMockBase}/agents`} onClick={follow}>
          <b>Agents mock</b>
          <span>The Agents board in each recorded state and terminal rendering.</span>
        </a>
      </div>
    </Article>
  );
}

export function Article({
  title,
  lead,
  children,
}: {
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="docs-article">
      <h1>{title}</h1>
      <p className="docs-lead">{lead}</p>
      {children}
    </article>
  );
}

function Introduction() {
  return (
    <Article
      title="TMT design system"
      lead="One family of components and tokens for Colab, Remote, Ops and the blog. What you see here is the code: every preview is the real component, skinned only by tokens."
    >
      <h2>How it is built</h2>
      <p>
        The tokens live in <code>design/tokens/tokens.json</code> in three tiers. <b>Ref</b> tokens
        are raw values. <b>Semantic roles</b> such as <code>--tmt-ui-color-accent</code> are what
        components read. <b>Component tokens</b> alias the roles inside the shadcn-based parts.
        Palette B, red, black, white and grey, maps the roles onto refs.
      </p>
      <p>
        The components come from <code>@tmt/browser-ui</code>. The <code>/ui</code> entry is the
        shadcn set on Radix; the <code>Browser*</code> family from <code>/react</code> moves onto
        those internals next, so there is one family.
      </p>
      <h2>Use the switches</h2>
      <p>
        The top bar switches the theme and the one radius knob for every page and the Colab mock:
        2/4, 4/6, or today&apos;s values for comparison.
      </p>
      <div className="docs-cards">
        <a className="docs-card" href={`${guiRoot}/principles`} onClick={follow}>
          <b>Principles</b>
          <span>Five rules every screen follows.</span>
        </a>
        <a className="docs-card" href={`${guiRoot}/tokens/colour`} onClick={follow}>
          <b>Tokens</b>
          <span>Colour, type, spacing, radius and motion, read live.</span>
        </a>
        <a className="docs-card" href={`${guiRoot}/components/button`} onClick={follow}>
          <b>Components</b>
          <span>{components.length} parts, each with variants, states and usage.</span>
        </a>
        <a className="docs-card" href={colabMockBase} onClick={follow}>
          <b>Colab mock</b>
          <span>The side menu, page list and page view rebuilt from these parts.</span>
        </a>
      </div>
    </Article>
  );
}

function Principles() {
  const rules: [string, string][] = [
    [
      'Red is rare',
      'The accent red marks only the brand, keyboard focus, the selected tab and the one primary action on a surface. Nothing else is red-filled.',
    ],
    [
      'Status is never the accent',
      'Working, waiting, review and blocked have their own muted hues and always a mark and a word (● ◆ ◐ ✕). Blocked is a darker red with its ✕, never the accent.',
    ],
    [
      'Corners are small',
      'Controls, fields and tags share one radius; cards and surfaces are one step larger. Only avatars and status dots are round.',
    ],
    [
      'Real components only',
      'A mock is built from the same components the product ships, so a mock is the implementation and review compares like with like.',
    ],
    [
      'One family',
      'One set of components and tokens serves Colab, Remote, Ops and the blog. Product code adds no colours, radii or local copies.',
    ],
  ];
  return (
    <Article title="Principles" lead="Short rules that decide most questions before they come up.">
      <ol className="docs-principles">
        {rules.map(([title, body]) => (
          <li key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </li>
        ))}
      </ol>
    </Article>
  );
}

function ComponentPage({ doc }: { doc: ComponentDoc }) {
  return (
    <Article title={doc.name} lead={doc.description}>
      <div className="docs-canvas docs-canvas-hero">
        {motionNotes[doc.slug] ? <Replay>{doc.preview()}</Replay> : doc.preview()}
      </div>
      {motionNotes[doc.slug] && (
        <p className="docs-motion-line">
          <b>Motion</b> {motionNotes[doc.slug]}
        </p>
      )}
      <h2>Usage</h2>
      <Snippet code={doc.usage} />
      {doc.variants.length > 0 && <h2>Variants and states</h2>}
      {doc.variants.map(([label, render]) => (
        <section key={label} className="docs-variant">
          <h3>{label}</h3>
          <div className="docs-canvas">{render()}</div>
        </section>
      ))}
      {doc.dos && (
        <>
          <h2>Do and don&apos;t</h2>
          <div className="docs-dos">
            {doc.dos.map(([kind, text]) => (
              <div key={text} className="docs-do" data-kind={kind}>
                <b>{kind === 'do' ? 'Do' : 'Don’t'}</b>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Article>
  );
}

/** A Browser component: the gallery's section for it, every demo in light and dark side by side. */
function BrowserPage({ doc }: { doc: BrowserDoc }) {
  const names = browserExports(doc);
  return (
    <Article title={doc.name} lead={doc.description}>
      {names.length > 0 && (
        <>
          <h2>Usage</h2>
          <Snippet code={`import { ${names.join(', ')} } from '@tmt/browser-ui/react';`} />
        </>
      )}
      <p className="docs-muted">
        Styles: {doc.css.map((name) => `src/${name}.css`).join(', ')}, in the shared static.css.
      </p>
      <h2>Variants and states</h2>
      <div className="docs-browser-demo">
        <doc.Demo />
      </div>
    </Article>
  );
}

export function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-snippet">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

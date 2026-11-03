import { staticCss } from './static-css.js';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vite-plus/test';
import { BrowserHeader } from '../src/react';

it('renders the shared ninja mark, exactly as its static-host copy, inside a retained brand link', () => {
  const copy = readFileSync(new URL('../generated/brand-mark-static.svg', import.meta.url), 'utf8');
  const html = renderToStaticMarkup(
    <BrowserHeader
      productLabel="Colab"
      title="Pages"
      brandLink={(brand) => <a href="/pages">{brand}</a>}
    />,
  );
  const normalize = (markup: string) =>
    markup
      .replace(/\s+/g, ' ')
      .replace(/ ?> ?</g, '><')
      .replace(/ >/g, '>');
  expect(html).toContain('<a href="/pages"><svg');
  expect(html.match(/<svg[^>]*class="tmt-brand-mark[ "]/g)).toHaveLength(1);
  expect(
    normalize(
      html.slice(html.indexOf('<svg'), html.indexOf('</svg></svg>') + '</svg></svg>'.length),
    ),
  ).toBe(normalize(copy.trim()));
  expect(html).not.toContain('style=');
  expect(html).not.toContain('<title');
  expect(html).toContain('tmt-ui-wordmark">Colab</span>');
  expect(html.match(/<h1/g)).toHaveLength(1);
});

it('draws no heading when the title is hidden, and keeps the landmark named', () => {
  const render = (titleVisible?: boolean, inShell?: boolean) =>
    renderToStaticMarkup(
      <BrowserHeader
        productLabel="Colab"
        title="Pages"
        caption="6 pages"
        captionId="pages-caption"
        titleVisible={titleVisible}
        inShell={inShell}
        status={<span>◆ 1 needs you</span>}
        actions={<button type="button">Share</button>}
      />,
    );
  for (const inShell of [true, false]) {
    const html = render(false, inShell);
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('tmt-ui-title');
    expect(html).toContain('aria-label="Colab · Pages"');
    expect(html).toContain('aria-describedby="pages-caption"');
    expect(html).toContain('id="pages-caption"');
    expect(html).toContain('◆ 1 needs you');
    expect(html).toContain('>Share<');
  }
  // The default is unchanged: the title is the page's h1, and a plain header carries no label.
  const shown = render();
  expect(shown.match(/<h1/g)).toHaveLength(1);
  expect(shown).toContain('>Pages</h1>');
  expect(shown).not.toContain('aria-label="Colab · Pages"');
  expect(render(true)).toBe(shown);
});

it('keeps linked and plain labels neutral and removes the section divider', () => {
  const css = staticCss;
  const block = (selector: string) => {
    expect(css).toContain(`${selector} {`);
    return css.slice(css.indexOf(`${selector} {`)).split('}')[0];
  };
  expect(block('.tmt-ui-brand > a')).toContain('color: var(--tmt-ui-color-text)');
  expect(block('.tmt-ui-wordmark')).toContain('color: var(--tmt-ui-color-text)');
  expect(block('.tmt-ui-heading,\n.tmt-ui-header > .tmt-ui-title')).not.toMatch(
    /border-left|padding-left/,
  );
});

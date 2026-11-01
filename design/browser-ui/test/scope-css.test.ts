import { describe, expect, it } from 'vite-plus/test';
import { readFileSync } from 'node:fs';
import { scopeCss } from '../scripts/scope-css.mjs';

/** #5866: the hosted docs' styles stay inside the docs' element. */
describe('scopeCss', () => {
  it('turns the page selectors into the scope root and wraps every rule', () => {
    const out = scopeCss(
      `:root { color-scheme: dark; }
:root[data-theme='light'] { color-scheme: light; }
body { margin: 0; font: 16px var(--tmt-ui-font-body); }
html, body > main { padding: 0; }
.docs-body a { color: inherit; }
@media (width<=760px) { body { margin: 1px; } }`,
      '.tmt-design-docs',
    );
    expect(out.trim().startsWith('@scope (.tmt-design-docs) {')).toBe(true);
    expect(out).toContain(':scope { color-scheme: dark; }');
    expect(out).toContain(":scope[data-theme='light']");
    expect(out).toContain(':scope { margin: 0; font: 16px var(--tmt-ui-font-body); }');
    expect(out).toContain(':scope, :scope > main');
    expect(out).toContain('.docs-body a');
    expect(out).toContain('@media (width<=760px) { :scope { margin: 1px; } }');
    expect(out).not.toMatch(/(^|[\s,}]):root\b|(^|[\s,}])body\b|(^|[\s,}])html\b/);
  });

  it('moves the at-rules @scope cannot hold out of it, whole', () => {
    const out = scopeCss(
      `@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }
.x { animation: spin 1s; }`,
      '.s',
    );
    expect(out.indexOf('@keyframes spin')).toBeLessThan(out.indexOf('@scope'));
    expect(out).toContain('to { rotate: 360deg; } }');
    expect(out.slice(out.indexOf('@scope'))).not.toContain('@keyframes');
  });

  it('leaves no page-level selector in the docs stylesheets it hosts', () => {
    for (const file of ['../docs/docs.css', '../gallery/gallery.css', '../docs/mock-reader.css']) {
      const out = scopeCss(readFileSync(new URL(file, import.meta.url), 'utf8'), '.s');
      const body = out.slice(out.indexOf('@scope'));
      expect(body, file).not.toMatch(/(^|[\s,>}(]):root\b/);
      expect(body, file).not.toMatch(/(^|[\s,>}])(body|html)\s*[{,]/);
    }
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vite-plus/test';
import { cn, DsScope, UiTheme, useUiPortalContainer } from '../src/ui/index.js';
import { assertUiUtilities } from '../scripts/ui-source-policy.mjs';
import { findDomScope } from '../src/ui/scope.js';
import hashes from './fixtures/ui/legacy-hashes.json';

it('retains the reviewed Browser source and static CSS baseline', () => {
  for (const [file, expected] of Object.entries(hashes.sha256)) {
    let bytes = readFileSync(new URL(`../${file}`, import.meta.url));
    if (file === 'src/react.ts') {
      // The new shared parts are additive: retain the original entry's exact reviewed bytes.
      const addition = `export {\n  BrowserEditorial,\n  BrowserVisuallyHidden,\n  BrowserCardMeter,\n  BrowserOverview,\n  BrowserChart,\n} from './design-components.js';\n`;
      const source = bytes.toString('utf8');
      expect(source.endsWith(addition)).toBe(true);
      bytes = Buffer.from(source.slice(0, -addition.length));
    }
    expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(expected);
  }
});
it('owns one local portal when a themed island is nested inside a design scope', () => {
  function PortalConsumer() {
    return <span>{useUiPortalContainer() === null ? 'Waiting for scope' : 'Ready'}</span>;
  }
  const html = renderToStaticMarkup(
    <DsScope>
      <UiTheme>
        <PortalConsumer />
      </UiTheme>
    </DsScope>,
  );
  expect(html).toContain('data-tmt-ds-scope=""');
  expect(html.match(/data-tmt-ui-portal=""/g)).toHaveLength(1);
  expect(html).toContain('Waiting for scope');
});
it('finds the nearest DOM scope and its own portal across independent React roots', () => {
  const portal = {} as HTMLElement;
  const root = {
    querySelector: (selector: string) =>
      selector === ':scope > [data-tmt-ui-portal]' ? portal : null,
  } as unknown as HTMLElement;
  const node = { parentElement: { closest: () => root } } as unknown as HTMLElement;
  expect(findDomScope(node)).toEqual({ root, portal });
  expect(findDomScope({ parentElement: null } as unknown as HTMLElement)).toBeUndefined();
});
it('merges conflicting prefixed classes while preserving variants and unrelated legacy classes', () => {
  expect(cn('tmt:p-2 tmt:text-foreground', ['tmt:p-4'], { 'tmt:flex': true }, false)).toBe(
    'tmt:text-foreground tmt:p-4 tmt:flex',
  );
  expect(cn('tmt:p-2 tmt:hover:p-4', 'tmt:hover:p-2', 'tmt-ui-field')).toBe(
    'tmt:p-2 tmt:hover:p-2 tmt-ui-field',
  );
});
it('does not invent a body portal before its own island container is mounted', () => {
  function PortalConsumer() {
    return <span>{useUiPortalContainer() === null ? 'Waiting for own container' : 'Ready'}</span>;
  }
  const html = renderToStaticMarkup(
    <UiTheme theme="dark">
      <PortalConsumer />
    </UiTheme>,
  );
  expect(html).toContain('data-tmt-theme="dark"');
  expect(html).toContain('Waiting for own container');
  expect(html).toContain('data-tmt-ui-portal=""');
  expect(() => renderToStaticMarkup(<PortalConsumer />)).toThrow('originating UiTheme');
});
function uiCss(): string {
  return readFileSync(new URL('../generated/ui.css', import.meta.url), 'utf8');
}

it('inherits semantic roles with standalone fallbacks and no palette scope', () => {
  const css = uiCss();
  expect(css).not.toContain('data-tmt-palette');
  expect(css).toContain('--tmt-foundation-primary: var(--tmt-ui-color-accent-fill,');
  expect(css).toContain('--tmt-foundation-radius: var(--tmt-ui-radius,');
});

it('publishes only a separate scoped namespace, without preflight, global variables or global registrations', () => {
  const css = uiCss();
  expect(css).not.toMatch(/:root|@property|@import|@theme|@tailwind|@layer|--tw-/);
  expect(() => assertUiUtilities(css)).not.toThrow();
  expect(css).toContain(':where([data-tmt-ui]) {');
  expect(css).toContain('.tmt\\:bg-background');
  // Shadows are the elevation levels alone (#5821): a card, the floating layers and a modal.
  expect([...css.matchAll(/\.tmt\\:shadow[^\s{]*/g)].map((match) => match[0]).sort()).toEqual([
    '.tmt\\:shadow-elevation-1',
    '.tmt\\:shadow-elevation-3',
    '.tmt\\:shadow-overlay',
  ]);
  expect(css).toMatch(/--tmt-foundation-tw-shadow:\s*var\(--tmt-foundation-shadow-overlay\)/);
  // Global registrations are limited to the prefixed motion keyframes layers name.
  const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]!);
  expect(keyframes.length).toBeGreaterThan(0);
  expect(keyframes.every((name) => name.startsWith('tmt-foundation-'))).toBe(true);
  const radiusValues = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1]);
  expect(radiusValues.length).toBeGreaterThan(0);
  expect(
    radiusValues.every((value) => /^var\(--tmt-foundation-radius(?:-s|-l|-pill)?\)$/.test(value!)),
  ).toBe(true);
  const tokens = JSON.parse(
    readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
  );
  for (const role of ['paper', 'sheet'])
    for (const theme of ['light', 'dark'])
      expect(css).toContain(tokens.browser.surface[role][theme].toLowerCase());
  for (const role of ['edge', 'focus', 'text'])
    for (const theme of ['light', 'dark'])
      expect(css).toContain(tokens.browser.color[role][theme].toLowerCase());
  for (const [key, value] of Object.entries(tokens.browser.ui))
    expect(css).toContain(`--tmt-foundation-${key}: ${value};`);
});

it('keeps the reviewed static token projection', () => {
  const tokens = JSON.parse(
    readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
  );
  expect({
    font: tokens.font,
    header: tokens.header,
    browser: {
      color: tokens.browser.color,
      surface: tokens.browser.surface,
      metric: tokens.browser.metric,
    },
  }).toEqual(hashes.tokenProjection);
});

it('keeps original source export targets and direct dependency pins explicit', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const provenance = JSON.parse(
    readFileSync(new URL('../src/ui/provenance.json', import.meta.url), 'utf8'),
  );
  expect(manifest.exports['./react']).toBe('./src/react.ts');
  expect(manifest.exports['./static']).toBe('./src/static.ts');
  expect(manifest.exports['./static.css']).toBe('./generated/static.css');
  expect(manifest.exports['./ui']).toBe('./src/ui/index.ts');
  expect(manifest.exports['./ui.css']).toBe('./generated/ui.css');
  for (const [name, value] of Object.entries(provenance.dependencies) as [
    string,
    { version: string; license: string },
  ][])
    expect(
      manifest.dependencies?.[name] ??
        manifest.devDependencies?.[name] ??
        manifest.peerDependencies?.[name],
    ).toBe(value.version);
  const cva = provenance.dependencies['class-variance-authority'];
  expect(cva.version).toBe('0.7.1');
  expect(cva.license).toBe('Apache-2.0');
  expect(
    createHash('sha256')
      .update(readFileSync(new URL('../src/ui/LICENSE.cva', import.meta.url)))
      .digest('hex'),
  ).toBe(cva.licenseSha256);
  const license = readFileSync(new URL('../src/ui/LICENSE.shadcn', import.meta.url));
  expect(createHash('sha256').update(license).digest('hex')).toBe(
    provenance.files.find((file: { path: string }) => file.path === 'LICENSE.md').sha256,
  );
});

it('projects light frame roles separately from strong focus and state indicators', () => {
  const css = uiCss();
  const tokens = JSON.parse(
    readFileSync(new URL('../../tokens/tokens.json', import.meta.url), 'utf8'),
  );
  const roles = {
    'layer-boundary': tokens.browser.surface.rule,
    border: tokens.browser.surface.rule,
    input: tokens.browser.surface.rule,
    indicator: tokens.browser.color.edge,
    ring: tokens.browser.color.focus,
  };
  for (const [role, colors] of Object.entries(roles)) {
    const actual = [...css.matchAll(new RegExp(`--tmt-foundation-${role}: ([^;]+);`, 'g'))].map(
      (match) => match[1]!.replace(/^var\(--tmt-ui-[\w-]+, (.+)\)$/, '$1'),
    );
    expect(actual.sort(), role).toEqual(
      [colors.light, colors.dark, colors.light, colors.dark]
        .map((color) => color.toLowerCase())
        .sort(),
    );
  }
});

import { describe, expect, it } from 'vite-plus/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { livePatternSlugs, PatternPage } from '../docs/pattern-page.js';
import {
  buildBundle,
  checkElements,
  validateComponent,
  validateCapabilities,
  type Bundle,
  type ComponentDoc,
  type DesignSystemConfig,
} from '../../systems/compiler.mjs';

/** #5821 / #5866: the design-system compiler the repo template and the Colab app share. */
const template = JSON.parse(
  readFileSync(new URL('../../systems/tmt-gui/generated/template.json', import.meta.url), 'utf8'),
) as { system: DesignSystemConfig; components: ComponentDoc[] };
const builtIn = new URL('../../systems/tmt-gui/generated/bundle.json', import.meta.url);
const sha256Hex = async (text: string) => createHash('sha256').update(text).digest('hex');
const button = template.components.find((component) => component.tag === 'button')!;
const legacyButton = { ...button, uiParts: undefined, source: 'export default () => () => null;' };

it('applies the same capability checks to authored components and stored bundle tags', () => {
  const cases = [
    { runtime: '3', parts: ['PageListTable'], data: ['page'] },
    { runtime: '4', uiParts: ['Button'], requires: ['other'] },
    { runtime: '2', parts: ['PageListTable'] },
    { runtime: '3', data: ['page', 'page'] },
    { runtime: '4', uiParts: ['Unknown'] },
    { runtime: '4', requires: ['missing'] },
  ];
  for (const item of cases) {
    const { runtime, ...capabilities } = item;
    const docs = [{ tag: 'one', ...capabilities }, { tag: 'other' }];
    const stored = docs.map((doc) => ({ ...doc, tag: `acme-${doc.tag}` }));
    let authored = true;
    let loaded = true;
    try {
      validateCapabilities({ runtime, prefix: 'acme', components: docs }, false);
    } catch {
      authored = false;
    }
    try {
      validateCapabilities({ runtime, prefix: 'acme', components: stored });
    } catch {
      loaded = false;
    }
    expect(loaded).toBe(authored);
    expect(authored).toBe(cases.indexOf(item) < 2);
  }
});

it('renders every live pattern scene', () => {
  expect(livePatternSlugs).toHaveLength(22);
  for (const slug of livePatternSlugs) {
    const markup = renderToStaticMarkup(createElement(PatternPage, { page: slug }));
    expect(markup, slug).toContain('<h1>');
    expect(markup, slug).toContain('data-tmt-ds-scope');
  }
});

describe('buildBundle', () => {
  it('requires named shared parts to be declared on runtime 3 components', async () => {
    const system = { ...template.system, runtime: '3' };
    const page = {
      ...legacyButton,
      parts: ['PageListTable'],
      source: 'export default ({ parts }) => parts.PageListTable;',
    };
    const bundle = await buildBundle('x', system, [page], sha256Hex);
    expect(bundle.runtime).toBe('3');
    expect(bundle.components[0]?.parts).toEqual(['PageListTable']);
    await expect(
      buildBundle('x', { ...template.system, runtime: '2' }, [page], sha256Hex),
    ).rejects.toThrow('runtime 3');
    await expect(
      buildBundle('x', system, [{ ...page, parts: ['Other'] }], sha256Hex),
    ).rejects.toThrow('shared part');
  });
  it('admits only named runtime 3 data capabilities', async () => {
    const component = { ...legacyButton, data: ['page'] };
    const system = { ...template.system, runtime: '3' };
    expect((await buildBundle('x', system, [component], sha256Hex)).components[0]?.data).toEqual([
      'page',
    ]);
    await expect(
      buildBundle('x', { ...system, runtime: '2' }, [component], sha256Hex),
    ).rejects.toThrow('runtime 3');
    await expect(
      buildBundle('x', system, [{ ...component, data: ['arbitrary'] }], sha256Hex),
    ).rejects.toThrow('data capability');
  });
  it('requires nested system tags to exist in the same runtime 3 bundle', async () => {
    const nested = { ...legacyButton, tag: 'composite', requires: ['button'] };
    const system = { ...template.system, runtime: '3' };
    await expect(buildBundle('x', system, [nested], sha256Hex)).rejects.toThrow(
      'missing component dependency',
    );
    const built = await buildBundle('x', system, [legacyButton, nested], sha256Hex);
    expect(built.components[1]?.requires).toEqual(['button']);
  });
  it('admits only named runtime 4 UI parts', async () => {
    const system = { ...template.system, runtime: '4' };
    expect((await buildBundle('x', system, [button], sha256Hex)).components[0]?.uiParts).toEqual([
      'Button',
    ]);
    await expect(
      buildBundle('x', { ...system, runtime: '3' }, [button], sha256Hex),
    ).rejects.toThrow('UI part');
    await expect(
      buildBundle('x', system, [{ ...button, uiParts: ['Other'] }], sha256Hex),
    ).rejects.toThrow('UI part');
    await expect(
      buildBundle('x', system, [{ ...button, uiParts: ['Button', 'Button'] }], sha256Hex),
    ).rejects.toThrow('UI part');
  });
  it('rebuilds the checked-in built-in bundle from the template', async () => {
    const bundle = await buildBundle('tmt-gui', template.system, template.components, sha256Hex);
    expect(JSON.parse(readFileSync(builtIn, 'utf8'))).toEqual(bundle);
    expect(bundle.components.map((component) => component.tag)).toEqual([
      'tmt-ui-foundation',
      'tmt-ui-pattern',
      'tmt-ui-component-docs',
      'tmt-ui-button',
      'tmt-ui-badge',
      'tmt-ui-separator',
      'tmt-ui-skeleton',
      'tmt-ui-input',
      'tmt-ui-textarea',
      'tmt-ui-switch',
      'tmt-ui-checkbox',
      'tmt-ui-card',
      'tmt-ui-alert',
      'tmt-ui-surface',
      'tmt-ui-empty',
      'tmt-ui-tabs',
      'tmt-ui-block-document',
      'tmt-ui-block',
      'tmt-ui-block-menu',
      'tmt-ui-heading-block',
      'tmt-ui-text-block',
      'tmt-ui-list-item',
      'tmt-ui-todo',
      'tmt-ui-table-block',
      'tmt-ui-card-block',
      'tmt-ui-callout',
      'tmt-ui-code-block',
      'tmt-ui-block-mention',
      'tmt-ui-block-toast',
      'tmt-ui-page-view',
      'tmt-ui-work-bundle',
      'tmt-ui-mockup-block',
      'tmt-ui-question-block',
      'tmt-ui-image-block',
      'tmt-ui-browser-avatar',
      'tmt-ui-busy-mark',
      'tmt-ui-section',
      'tmt-ui-disclosure',
      'tmt-ui-ds-scope',
      'tmt-ui-brand-mark',
      'tmt-ui-browser-checkbox',
      'tmt-ui-status-tile',
      'tmt-ui-action',
      'tmt-ui-toggle',
      'tmt-ui-dialog',
      'tmt-ui-sheet',
      'tmt-ui-popover',
      'tmt-ui-dropdown-menu',
      'tmt-ui-header',
      'tmt-ui-notice',
      'tmt-ui-pager',
      'tmt-ui-list',
      'tmt-ui-choice',
      'tmt-ui-menu',
      'tmt-ui-icon-action',
      'tmt-ui-field',
      'tmt-ui-count-chip',
      'tmt-ui-table',
      'tmt-ui-browser-command',
      'tmt-ui-browser-tabs',
      'tmt-ui-select',
      'tmt-ui-tooltip',
      'tmt-ui-command',
      'tmt-ui-floating',
      'tmt-ui-chips',
      'tmt-ui-data-table',
      'tmt-ui-page-list',
      'tmt-ui-rich-input',
      'tmt-ui-browser-chips',
      'tmt-ui-dialog-drawer-panel',
      'tmt-ui-shell',
      'tmt-ui-notifications',
      'tmt-ui-card-meter',
      'tmt-ui-overview',
      'tmt-ui-editorial',
      'tmt-ui-visually-hidden',
      'tmt-ui-chart',
      'tmt-ui-page-row',
      'tmt-ui-work-band',
      'tmt-ui-message-row',
      'tmt-ui-status-line',
    ]);
  });

  it('names tags with the system prefix and changes the hash with any content', async () => {
    const acme = { ...template.system, prefix: 'acme' };
    const bundle = await buildBundle('root-page', acme, template.components, sha256Hex);
    expect(bundle.components.find((component) => component.tag === 'acme-button')).toBeDefined();
    const original = await buildBundle(
      'root-page',
      template.system,
      template.components,
      sha256Hex,
    );
    expect(bundle.hash).not.toBe(original.hash);
  });

  it('refuses a newer schema, a bad prefix and two components with one tag', async () => {
    await expect(
      buildBundle('x', { ...template.system, schema: 2 }, template.components, sha256Hex),
    ).rejects.toThrow('needs a newer TMT');
    await expect(
      buildBundle('x', { ...template.system, prefix: 'Acme_UI' }, template.components, sha256Hex),
    ).rejects.toThrow('prefix');
    await expect(buildBundle('x', template.system, [button, button], sha256Hex)).rejects.toThrow(
      'share a tag',
    );
  });
});

describe('validateComponent', () => {
  it('accepts the template Button and refuses a source that reaches outside the skeleton', () => {
    expect(() => validateComponent(button)).not.toThrow();
    for (const source of [
      "import x from 'y';\nexport default () => x;",
      'export default () => () => fetch("/")',
      'export default () => () => window.alert(1)',
      'export default () => () => "</script>"',
      'export const other = 1;\nexport default () => () => null;',
    ])
      expect(() => validateComponent({ ...button, source })).toThrow();
  });

  it('refuses a prop that shadows a global attribute or a default outside its enum', () => {
    expect(() => validateComponent({ ...button, props: { class: { type: 'string' } } })).toThrow(
      'free attribute',
    );
    expect(() =>
      validateComponent({
        ...button,
        props: { size: { enum: ['sm', 'md'], default: 'xl' } },
      }),
    ).toThrow('outside its enum');
  });
});

describe('checkElements', () => {
  const pin = { system: 'tmt-gui', version: '0.1.0', hash: 'sha256-x' };
  let bundle: Bundle;
  it('accepts a valid component in page flow', async () => {
    const system = await buildBundle('tmt-gui', template.system, template.components, sha256Hex);
    expect(checkElements([{ tag: 'tmt-ui-button', attrs: {} }], pin, system)).toEqual([]);
  });
  it('skips only the host page elements it is given', async () => {
    const system = await buildBundle('tmt-gui', template.system, template.components, sha256Hex);
    const el = (tag: string) => ({ tag, attrs: {} });
    const page = [el('tmt-question'), el('tmt-ui-button'), el('acme-button')];
    expect(checkElements(page, pin, system, ['tmt-question'])).toEqual([
      { code: 'ds-prefix-mismatch', tag: 'acme-button', index: 2 },
    ]);
    // Without the host's list, its elements are foreign to the system like any other tag.
    expect(checkElements(page, pin, system).map((finding) => finding.tag)).toEqual([
      'tmt-question',
      'acme-button',
    ]);
  });
  it('reports each of the five page check codes', async () => {
    bundle = await buildBundle('tmt-gui', template.system, template.components, sha256Hex);
    const el = (tag: string, attrs: Record<string, string> = {}) => ({ tag, attrs });
    expect(checkElements([el('tmt-ui-button'), el('tmt-icon')], null, null)).toEqual([
      { code: 'ds-not-pinned', tag: 'tmt-ui-button', index: 0 },
    ]);
    expect(checkElements([el('tmt-ui-button')], pin, null)).toEqual([
      { code: 'unknown-ds-release', tag: 'meta', index: -1 },
    ]);
    expect(
      checkElements(
        [
          el('tmt-ui-button', { variant: 'outline', disabled: '', class: 'x', 'data-id': '1' }),
          el('acme-button'),
          el('tmt-ui-carousel'),
          el('tmt-ui-button', { variant: 'loud' }),
          el('tmt-ui-button', { tone: 'red', disabled: 'no' }),
        ],
        pin,
        bundle,
      ),
    ).toEqual([
      { code: 'ds-prefix-mismatch', tag: 'acme-button', index: 1 },
      { code: 'unknown-ds-component', tag: 'tmt-ui-carousel', index: 2 },
      { code: 'invalid-ds-prop', tag: 'tmt-ui-button', attribute: 'variant', index: 3 },
      { code: 'invalid-ds-prop', tag: 'tmt-ui-button', attribute: 'tone', index: 4 },
      { code: 'invalid-ds-prop', tag: 'tmt-ui-button', attribute: 'disabled', index: 4 },
    ]);
  });
});

it('keeps generated template pages iframe-free and draws component pages from the docs (#6060)', () => {
  const pages = JSON.parse(
    readFileSync(new URL('../../systems/tmt-gui/generated/pages.json', import.meta.url), 'utf8'),
  ) as { title: string; pages: { slug: string; html: string; path: string }[] }[];
  const all = pages.flatMap((section) => section.pages);
  expect(all.some((page) => /<iframe\b/i.test(page.html))).toBe(false);
  // A component page is the docs site's own page for its path, with the same live scenes.
  for (const section of pages.filter(({ title }) => title.endsWith('omponents')))
    for (const page of section.pages)
      expect(page.html).toBe(
        `<div class="tmt-design-docs"><tmt-ui-component-docs page="${page.path}"></tmt-ui-component-docs></div>`,
      );
  expect(all.find((page) => page.slug === 'browser-avatar')?.path).toBe('browser/avatar');
});

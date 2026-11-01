import { describe, expect, it } from 'vite-plus/test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import {
  buildBundle,
  checkElements,
  validateComponent,
  type Bundle,
  type ComponentDoc,
  type DesignSystemConfig,
} from '../../systems/compiler.mjs';

/** #5821 / #5866: the design-system compiler the repo template and the Colab app share. */
const template = JSON.parse(
  readFileSync(new URL('../../systems/tmt-gui/generated/template.json', import.meta.url), 'utf8'),
) as { system: DesignSystemConfig; components: ComponentDoc[] };
const dist = new URL('../../systems/tmt-gui/dist/', import.meta.url);
const sha256Hex = async (text: string) => createHash('sha256').update(text).digest('hex');
const button = template.components[0]!;

describe('buildBundle', () => {
  it('rebuilds the checked-in template bundle byte for byte, named by its hash', async () => {
    const bundle = await buildBundle('tmt-gui', template.system, template.components, sha256Hex);
    const [file] = readdirSync(dist);
    expect(file).toBe(`${bundle.hash}.json`);
    expect(JSON.parse(readFileSync(new URL(file!, dist), 'utf8'))).toEqual(bundle);
    expect(bundle.components.map((component) => component.tag)).toEqual(['tmt-ui-button']);
  });

  it('names tags with the system prefix and changes the hash with any content', async () => {
    const acme = { ...template.system, prefix: 'acme' };
    const bundle = await buildBundle('root-page', acme, template.components, sha256Hex);
    expect(bundle.components[0]!.tag).toBe('acme-button');
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
          el('tmt-ui-card'),
          el('tmt-ui-button', { variant: 'loud' }),
          el('tmt-ui-button', { tone: 'red', disabled: 'no' }),
        ],
        pin,
        bundle,
      ),
    ).toEqual([
      { code: 'ds-prefix-mismatch', tag: 'acme-button', index: 1 },
      { code: 'unknown-ds-component', tag: 'tmt-ui-card', index: 2 },
      { code: 'invalid-ds-prop', tag: 'tmt-ui-button', attribute: 'variant', index: 3 },
      { code: 'invalid-ds-prop', tag: 'tmt-ui-button', attribute: 'tone', index: 4 },
      { code: 'invalid-ds-prop', tag: 'tmt-ui-button', attribute: 'disabled', index: 4 },
    ]);
  });
});

import { expect, it } from 'vite-plus/test';
import template from '../../../../../design/systems/tmt-gui/generated/template.json';
import { blockHtml } from '../src/design-system-pages.js';
import { designExample, designPageModel } from '../src/design-page-model.js';

it('reads the published home and component data without treating their source as parent code', () => {
  expect(designPageModel(blockHtml('design-system', template.system))).toMatchObject({
    kind: 'home',
    config: { name: template.system.name, components: template.system.components },
  });
  expect(designPageModel(blockHtml('component', template.components[0]))).toMatchObject({
    kind: 'component',
    doc: { tag: 'button', props: template.components[0]!.props },
  });
  expect(designPageModel('<h1>A supporting page</h1>')).toEqual({ kind: 'page' });
});

it('refuses invalid component data and rewrites examples to the selected system element names', () => {
  expect(() =>
    designPageModel(blockHtml('component', { ...template.components[0], tag: 'BAD TAG' })),
  ).toThrow();
  expect(designExample('<tmt-ui-button variant="outline">Save</tmt-ui-button>', 'brio')).toBe(
    '<brio-button variant="outline">Save</brio-button>',
  );
});

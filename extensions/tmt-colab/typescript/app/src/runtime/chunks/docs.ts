/** The `docs` page-runtime chunk: the docs pages Design draws (#6085). */
import { createElement } from 'react';
import { registerChunk } from '../register.js';
import { FoundationPage } from '@tmt/browser-ui/docs-foundations';
import { PatternPage } from '@tmt/browser-ui/docs-patterns';
import { DocsComponentPage, drawComponentScenesInline } from '@tmt/browser-ui/docs-components';
// The frame cannot load the docs' frame pages: a component docs page draws their scenes inline.
drawComponentScenesInline();

type Example = { title: string; markup: string };
// Each built-in component's page markup, the examples `design show` prints (#6716): a component
// page leads its usage with them, since that is what a Colab page writes.
const examples = import.meta.glob<readonly Example[] | undefined>(
  '../../../../../../../design/systems/tmt-gui/components/*.json',
  { eager: true, import: 'examples' },
);
const byTag = new Map(
  Object.entries(examples).map(([path, list]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
    list ?? [],
  ]),
);
/** `components/button` is the `button` component; `browser/avatar` is `browser-avatar`. */
function pageExamples(page: string) {
  const [section, slug] = page.split('/');
  return byTag.get(section === 'browser' ? `browser-${slug}` : (slug ?? ''));
}

/** A component page, its usage led by the page markup. */
const ComponentPage = ({ page }: { page: string }) =>
  createElement(DocsComponentPage, { page, pageExamples: pageExamples(page) });

registerChunk('docs', {
  ui: { FoundationPage, PatternPage, DocsComponentPage: ComponentPage },
});

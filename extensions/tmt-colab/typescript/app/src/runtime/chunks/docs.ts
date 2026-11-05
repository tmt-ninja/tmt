/** The `docs` page-runtime chunk: the docs pages Design draws (#6085). */
import { registerChunk } from '../register.js';
import { FoundationPage } from '@tmt/browser-ui/docs-foundations';
import { PatternPage } from '@tmt/browser-ui/docs-patterns';
import { DocsComponentPage, drawComponentScenesInline } from '@tmt/browser-ui/docs-components';
// The frame cannot load the docs' frame pages: a component docs page draws their scenes inline.
drawComponentScenesInline();
registerChunk('docs', {
  ui: { FoundationPage, PatternPage, DocsComponentPage },
});

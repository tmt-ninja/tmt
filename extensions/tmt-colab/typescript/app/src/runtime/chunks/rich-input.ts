/** The `rich-input` page-runtime chunk: the rich input on Lexical (#6085). */
import { registerChunk } from '../register.js';
import { RichInput } from '@tmt/browser-ui/rich-input';
registerChunk('rich-input', {
  ui: { RichInput },
});
